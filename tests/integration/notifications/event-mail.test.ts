import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { emailOutbox } from "@/db/schema/email-outbox";
import { eventTranslations, events } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { type RegistrationStatus, registrations } from "@/db/schema/registrations";
import { staffUsers } from "@/db/schema/staff-users";
import { queueEventReminders, sendEventThanks } from "@/modules/notifications/event-mail";
import { renderOutboxMessage } from "@/modules/notifications/render";
import { canonicalizeEmail } from "@/modules/participants/domain/canonical-email";
import { resendRegistrationMessage } from "@/modules/registrations/admin-service";
import { runRegistrationMaintenance } from "@/modules/registrations/maintenance";
import { checkIn } from "@/modules/registrations/service";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

const NOW = new Date("2026-10-09T09:00:00.000Z");
const HOUR = 60 * 60_000;

/**
 * `DECISIONS.md` §81 (the reminder, the facts line, the footer) and §82 (after the race).
 * What is protected: the reminder goes to confirmed participants of scheduled events inside
 * the 48-hour window, once, whatever runs twice; the thank-you goes once per event to the
 * checked-in and leaves an audit row that names the event and never a person; a completed
 * event refuses a check-in and is left alone by the job.
 */
describe("§81 the reminder and §82 after the race", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let participantId: string;
  let admin: { id: string; role: "ADMIN" };

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());

  beforeEach(async () => {
    await resetTables(db);
    const identity = canonicalizeEmail("ana@example.ro");
    const [participant] = await db
      .insert(participants)
      .values({
        deliveryEmail: identity.deliveryEmail,
        normalizedEmail: identity.normalizedEmail,
        canonicalEmail: identity.canonicalEmail,
        canonicalizationVersion: identity.canonicalizationVersion,
        defaultName: "Ana Pop",
      })
      .returning();
    participantId = participant.id;
    const [a] = await db.insert(staffUsers).values({ email: "admin@dev.test", displayName: "Admin", role: "ADMIN" }).returning();
    admin = { id: a.id, role: "ADMIN" };
  });

  async function seedEvent(startsAt: Date, overrides: Partial<typeof events.$inferInsert> = {}) {
    const [event] = await db
      .insert(events)
      .values({
        type: "RACE",
        startsAt,
        registrationMode: "INTERNAL",
        editorialStatus: "PUBLISHED",
        publishedAt: NOW,
        locationName: "Parcul Tractorul",
        mapUrl: "https://maps.example/tractorul",
        stravaEventUrl: "https://www.strava.com/clubs/x/group_events/1",
        ...overrides,
      })
      .returning();
    await db.insert(eventTranslations).values([
      { eventId: event.id, locale: "ro", slug: `e-${event.id.slice(0, 8)}`, title: "Crosul", checklist: "număr, apă, jachetă" },
      { eventId: event.id, locale: "en", slug: `en-${event.id.slice(0, 8)}`, title: "The cross" },
    ]);
    return event;
  }

  async function seedRegistration(eventId: string, status: RegistrationStatus, owner = participantId, extra: Partial<typeof registrations.$inferInsert> = {}) {
    const [row] = await db
      .insert(registrations)
      .values({
        eventId,
        participantId: owner,
        status,
        locale: "ro",
        registeredName: "Ana Pop",
        displayName: "Ana P.",
        privacyNoticeVersion: 1,
        privacyAcknowledgedAt: NOW,
        resultsNameConsent: false,
        listOptOut: false,
        resultsConsentVersion: 1,
        // Confirmed two days before "now": a confirmation from the last day carries the same
        // facts as the reminder, and gets none (§126).
        confirmedAt: status === "CONFIRMED" ? new Date(NOW.getTime() - 2 * 24 * 60 * 60_000) : null,
        ...extra,
      })
      .returning();
    return row;
  }

  const outbox = (type: string) => db.select().from(emailOutbox).where(eq(emailOutbox.messageType, type as "EVENT_REMINDER"));

  it("reminds confirmed participants of scheduled events inside 48 hours, once, and nobody else", async () => {
    const soon = await seedEvent(new Date(NOW.getTime() + 40 * HOUR));
    const later = await seedEvent(new Date(NOW.getTime() + 60 * HOUR));
    const cancelled = await seedEvent(new Date(NOW.getTime() + 20 * HOUR), { eventStatus: "CANCELLED" });
    const confirmed = await seedRegistration(soon.id, "CONFIRMED");
    await seedRegistration(later.id, "CONFIRMED", participantId);
    const identity = canonicalizeEmail("ion@example.ro");
    const [ion] = await db
      .insert(participants)
      .values({ deliveryEmail: identity.deliveryEmail, normalizedEmail: identity.normalizedEmail, canonicalEmail: identity.canonicalEmail, canonicalizationVersion: identity.canonicalizationVersion, defaultName: "Ion" })
      .returning();
    await seedRegistration(soon.id, "WAITLISTED", ion.id);
    await seedRegistration(cancelled.id, "CONFIRMED", ion.id);

    expect(await queueEventReminders(db, NOW)).toBe(1);
    // A second run in the window sends nothing more (§16.1).
    expect(await queueEventReminders(db, new Date(NOW.getTime() + HOUR))).toBe(0);
    const rows = await outbox("EVENT_REMINDER");
    expect(rows).toHaveLength(1);
    expect(rows[0].registrationId).toBe(confirmed.id);
    expect(rows[0].idempotencyKey).toBe(`registration:${confirmed.id}:reminder`);

    // The job carries it, and reports it.
    const result = await runRegistrationMaintenance(db, new Date(NOW.getTime() + 2 * HOUR));
    expect(result.remindersQueued).toBe(0);
    expect(result.errorCount).toBe(0);
  });

  it("renders the reminder and the confirmation with the facts line, the links, the checklist, the QR and the footer", async () => {
    const soon = await seedEvent(new Date(NOW.getTime() + 40 * HOUR));
    const confirmed = await seedRegistration(soon.id, "CONFIRMED", participantId, { checkinCode: "ABCDEFGHJK" });
    const row = (type: "EVENT_REMINDER" | "REGISTRATION_CONFIRMED") => ({
      id: "row",
      participantId,
      registrationId: confirmed.id,
      messageType: type,
      locale: "ro" as const,
      recipientEmail: "ana@example.ro",
      payloadJson: {},
      idempotencyKey: `t:${type}`,
      requestedByStaffUserId: null,
      isManualResend: false,
      status: "PROCESSING" as const,
      attemptCount: 1,
      nextAttemptAt: null,
      lockedAt: NOW,
      providerMessageId: null,
      lastError: null,
      createdAt: NOW,
      sentAt: null,
    });
    for (const type of ["EVENT_REMINDER", "REGISTRATION_CONFIRMED"] as const) {
      const message = await renderOutboxMessage(row(type), db, NOW);
      expect(message.text).toContain("Parcul Tractorul");
      expect(message.text).toContain("https://maps.example/tractorul");
      expect(message.text).toContain("strava.com");
      expect(message.text).toContain("Ce să aduci: număr, apă, jachetă");
      expect(message.text).toContain("ABCDEFGHJK");
      expect(message.html).toContain("<strong>");
      expect(message.html).toContain("/api/registrations/qr/ABCDEFGHJK.png");
      // The manage link, minted at send time.
      expect(message.text).toMatch(/\/inregistrari\/gestionare\//);
      // Text-first and small: well under the 100 KB the brief allows.
      expect(Buffer.byteLength(message.html)).toBeLessThan(20_000);
    }
  });

  it("resends the reminder by hand only while confirmed and ahead of the start", async () => {
    const soon = await seedEvent(new Date(NOW.getTime() + 40 * HOUR));
    const confirmed = await seedRegistration(soon.id, "CONFIRMED");
    await resendRegistrationMessage(db, admin, confirmed.id, NOW, "EVENT_REMINDER");
    const rows = await outbox("EVENT_REMINDER");
    expect(rows).toHaveLength(1);
    expect(rows[0].isManualResend).toBe(true);

    const past = await seedEvent(new Date(NOW.getTime() - 2 * HOUR));
    const over = await seedRegistration(past.id, "CONFIRMED");
    const refused = await resendRegistrationMessage(db, admin, over.id, NOW, "EVENT_REMINDER").catch((e: unknown) => e);
    expect(isDomainError(refused) && refused.code).toBe("VALIDATION_ERROR");
  });

  it("sends the thank-you once per event to the checked-in, audited without recipients", async () => {
    const past = await seedEvent(new Date(NOW.getTime() - 5 * HOUR));
    const here = await seedRegistration(past.id, "CONFIRMED", participantId, { checkedInAt: NOW });
    const identity = canonicalizeEmail("ion@example.ro");
    const [ion] = await db
      .insert(participants)
      .values({ deliveryEmail: identity.deliveryEmail, normalizedEmail: identity.normalizedEmail, canonicalEmail: identity.canonicalEmail, canonicalizationVersion: identity.canonicalizationVersion, defaultName: "Ion" })
      .returning();
    await seedRegistration(past.id, "CONFIRMED", ion.id); // registered, never showed up

    const result = await sendEventThanks(db, admin, { eventId: past.id, url: "https://photos.example/album" }, NOW);
    expect(result.recipients).toBe(1);
    const rows = await outbox("EVENT_THANKS");
    expect(rows).toHaveLength(1);
    expect(rows[0].registrationId).toBe(here.id);
    expect(rows[0].payloadJson).toEqual({ url: "https://photos.example/album" });

    const [audit] = await db.select().from(auditLogs).where(eq(auditLogs.action, "event.thanks_sent"));
    expect(audit.entityType).toBe("event");
    expect(audit.entityId).toBe(past.id);
    expect(audit.participantId).toBeNull();
    expect(JSON.stringify(audit.metadataJson)).not.toContain("ana@");
    expect(audit.metadataJson).toMatchObject({ recipients: 1 });

    // Once: the second press is refused, and the event page says when it went.
    const again = await sendEventThanks(db, admin, { eventId: past.id }, NOW).catch((e: unknown) => e);
    expect(isDomainError(again) && again.code).toBe("CONFLICT");
    const [event] = await db.select().from(events).where(eq(events.id, past.id));
    expect(event.thanksSentAt).toEqual(NOW);

    // Not before the start, not with a plain http link, not by a volunteer.
    const future = await seedEvent(new Date(NOW.getTime() + 5 * HOUR));
    expect(isDomainError(await sendEventThanks(db, admin, { eventId: future.id }, NOW).catch((e: unknown) => e))).toBe(true);
    const badUrl = await sendEventThanks(db, admin, { eventId: past.id, url: "http://x" }, NOW).catch((e: unknown) => e);
    expect(isDomainError(badUrl) && badUrl.code).toBe("VALIDATION_ERROR");
    const [vol] = await db.insert(staffUsers).values({ email: "vol@dev.test", displayName: "Vol", role: "CONTRIBUTOR" }).returning();
    const forbidden = await sendEventThanks(db, { id: vol.id, role: "CONTRIBUTOR" }, { eventId: past.id }, NOW).catch((e: unknown) => e);
    expect(isDomainError(forbidden) && forbidden.code).toBe("FORBIDDEN");
  });

  it("renders the thank-you with its link as the action", async () => {
    const past = await seedEvent(new Date(NOW.getTime() - 5 * HOUR));
    const here = await seedRegistration(past.id, "CONFIRMED", participantId, { checkedInAt: NOW });
    const message = await renderOutboxMessage(
      {
        id: "row",
        participantId,
        registrationId: here.id,
        messageType: "EVENT_THANKS",
        locale: "en",
        recipientEmail: "ana@example.ro",
        payloadJson: { url: "https://photos.example/album" },
        idempotencyKey: "t:thanks",
        requestedByStaffUserId: null,
        isManualResend: false,
        status: "PROCESSING",
        attemptCount: 1,
        nextAttemptAt: null,
        lockedAt: NOW,
        providerMessageId: null,
        lastError: null,
        createdAt: NOW,
        sentAt: null,
      },
      db,
      NOW,
    );
    expect(message.subject).toBe("Thank you for running with us / Mulțumim că ai alergat cu noi");
    expect(message.text).toContain("Results and photos: https://photos.example/album");
    expect(message.html).not.toContain("<img");
  });

  it("refuses a check-in at a completed event", async () => {
    const done = await seedEvent(new Date(NOW.getTime() - 5 * HOUR), { eventStatus: "COMPLETED" });
    const confirmed = await seedRegistration(done.id, "CONFIRMED");
    const refused = await checkIn(db, confirmed.id, null, NOW).catch((e: unknown) => e);
    expect(isDomainError(refused) && refused.code).toBe("VALIDATION_ERROR");
  });
});
