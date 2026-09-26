import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { emailOutbox } from "@/db/schema/email-outbox";
import { eventTranslations, events } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { type RegistrationStatus, registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { createEvent, duplicateEvent } from "@/modules/content/events/service";
import { updateDeadlines } from "@/modules/deadlines/deadlines";
import { DEFAULT_DEADLINES } from "@/modules/deadlines/domain/deadlines";
import { nextMaintenanceWork } from "@/modules/jobs/next-work";
import { queueEventReminders } from "@/modules/notifications/event-mail";
import { renderOutboxMessage } from "@/modules/notifications/render";
import { canonicalizeEmail } from "@/modules/participants/domain/canonical-email";
import { runRegistrationMaintenance } from "@/modules/registrations/maintenance";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §377 — the reminder before the start (§81) is the club's lead unless the event chose its own:
 * `events.reminder_hours_before` null is "as usual", zero is no reminder, 24/48/72 (or anything a
 * script stored inside the CHECK) is the event's. What is protected: the job queues the reminder —
 * and the last call to sign (§160) — inside exactly that window and not at all when it is off; the
 * job's plan (§334) wakes at the same instant; the editor stores the choice on create, a copy keeps
 * it; and the email says the lead it was sent with, in words.
 */
const NOW = new Date("2026-10-09T09:00:00.000Z");
const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

describe("§377 the reminder lead, the event's or the club's", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let participantId: string;
  let admin: StaffUser;

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
    [admin] = await db.insert(staffUsers).values({ email: "admin@example.ro", displayName: "Admin", role: "ADMIN" }).returning();
  });

  async function seedEvent(startsAt: Date, reminderHoursBefore: number | null) {
    const [event] = await db
      .insert(events)
      .values({ type: "RACE", startsAt, registrationMode: "INTERNAL", editorialStatus: "PUBLISHED", publishedAt: NOW, locationName: "Parcul Tractorul", reminderHoursBefore })
      .returning();
    await db.insert(eventTranslations).values([
      { eventId: event.id, locale: "ro", slug: `e-${event.id.slice(0, 8)}`, title: "Crosul" },
      { eventId: event.id, locale: "en", slug: `en-${event.id.slice(0, 8)}`, title: "The cross" },
    ]);
    return event;
  }

  async function seedRegistration(eventId: string, status: RegistrationStatus) {
    const [row] = await db
      .insert(registrations)
      .values({
        eventId,
        participantId,
        status,
        locale: "ro",
        registeredName: "Ana Pop",
        displayName: "Ana P.",
        privacyNoticeVersion: 1,
        privacyAcknowledgedAt: NOW,
        resultsNameConsent: false,
        listOptOut: false,
        resultsConsentVersion: 1,
        // Confirmed long ago, so §126's "not in the last day" never decides these cases.
        confirmedAt: status === "CONFIRMED" ? new Date(NOW.getTime() - 10 * DAY) : null,
        holdExpiresAt: status === "PENDING_DECLARATION" ? new Date(NOW.getTime() - DAY) : null,
      })
      .returning();
    return row;
  }

  const queued = async (type: "EVENT_REMINDER" | "COMPLETE_DECLARATION") =>
    (await db.select().from(emailOutbox).where(eq(emailOutbox.messageType, type))).map((row) => row.registrationId);

  it("reminds an event left 'as usual' inside the club's lead, one with its own inside its own, and one set to none never", async () => {
    const usual = await seedEvent(new Date(NOW.getTime() + 40 * HOUR), null);
    const ownLonger = await seedEvent(new Date(NOW.getTime() + 60 * HOUR), 72);
    const ownShorter = await seedEvent(new Date(NOW.getTime() + 30 * HOUR), 24);
    const none = await seedEvent(new Date(NOW.getTime() + 2 * HOUR), 0);
    const [a, b, c, d] = await Promise.all([usual, ownLonger, ownShorter, none].map((event) => seedRegistration(event.id, "CONFIRMED")));

    expect(await queueEventReminders(db, NOW, DEFAULT_DEADLINES)).toBe(2);
    expect(await queued("EVENT_REMINDER")).toEqual(expect.arrayContaining([a.id, b.id]));
    expect(await queued("EVENT_REMINDER")).not.toContain(c.id);

    // Seven hours on, the 24-hour event comes inside its own lead; the one with none never does.
    expect(await queueEventReminders(db, new Date(NOW.getTime() + 7 * HOUR), DEFAULT_DEADLINES)).toBe(1);
    expect(await queued("EVENT_REMINDER")).toContain(c.id);
    expect(await queued("EVENT_REMINDER")).not.toContain(d.id);
  });

  it("follows the club's lead when it changes, and sends nothing by default when the club sets none", async () => {
    const usual = await seedEvent(new Date(NOW.getTime() + 60 * HOUR), null);
    const own = await seedEvent(new Date(NOW.getTime() + 20 * HOUR), 24);
    const [a, b] = await Promise.all([usual, own].map((event) => seedRegistration(event.id, "CONFIRMED")));

    // No reminder by default: the event that chose its own still gets one.
    expect(await queueEventReminders(db, NOW, { reminderHours: 0 })).toBe(1);
    expect(await queued("EVENT_REMINDER")).toEqual([b.id]);
    // Three days by default: the event left "as usual" is inside it now.
    expect(await queueEventReminders(db, NOW, { reminderHours: 72 })).toBe(1);
    expect(await queued("EVENT_REMINDER")).toEqual(expect.arrayContaining([a.id, b.id]));
  });

  it("asks once more for the declaration inside the same lead (§160), and not at all where there is no reminder", async () => {
    const withReminder = await seedEvent(new Date(NOW.getTime() + 60 * HOUR), 72);
    const without = await seedEvent(new Date(NOW.getTime() + 10 * HOUR), 0);
    const kept = await seedRegistration(withReminder.id, "PENDING_DECLARATION");
    await seedRegistration(without.id, "PENDING_DECLARATION");

    expect(await queueEventReminders(db, NOW, DEFAULT_DEADLINES)).toBe(1);
    expect(await queued("COMPLETE_DECLARATION")).toEqual([kept.id]);
  });

  it("is read once per run by the job, from the setting", async () => {
    const usual = await seedEvent(new Date(NOW.getTime() + 60 * HOUR), null);
    const confirmed = await seedRegistration(usual.id, "CONFIRMED");
    // Forty-eight hours by default: sixty hours out is not inside it.
    expect((await runRegistrationMaintenance(db, NOW)).remindersQueued).toBe(0);
    await updateDeadlines(db, admin, { ...DEFAULT_DEADLINES, reminderHours: 72 }, NOW);
    expect((await runRegistrationMaintenance(db, new Date(NOW.getTime() + HOUR))).remindersQueued).toBe(1);
    expect(await queued("EVENT_REMINDER")).toEqual([confirmed.id]);
  });

  it("wakes the job's plan at the event's own lead, and never for an event with none (§334)", async () => {
    const own = await seedEvent(new Date(NOW.getTime() + 10 * DAY), 72);
    await seedRegistration(own.id, "CONFIRMED");
    // The next instant is the reminder, three days before — the start and the close come later.
    expect(await nextMaintenanceWork(db, NOW)).toEqual(new Date(own.startsAt.getTime() - 3 * DAY));

    await resetTables(db);
    const [again] = await db
      .insert(participants)
      .values({ deliveryEmail: "ana@example.ro", normalizedEmail: "ana@example.ro", canonicalEmail: "ana@example.ro", canonicalizationVersion: 1, defaultName: "Ana" })
      .returning();
    participantId = again.id;
    const none = await seedEvent(new Date(NOW.getTime() + 10 * DAY), 0);
    await seedRegistration(none.id, "CONFIRMED");
    // No reminder: the start is all that is ahead.
    expect(await nextMaintenanceWork(db, NOW)).toEqual(none.startsAt);
  });

  it("says the event is coming, never a number of days — whatever the lead, even none (§357)", async () => {
    const own = await seedEvent(new Date(NOW.getTime() + 60 * HOUR), 72);
    const confirmed = await seedRegistration(own.id, "CONFIRMED");
    const row = {
      id: "row",
      participantId,
      registrationId: confirmed.id,
      messageType: "EVENT_REMINDER" as const,
      locale: "ro" as const,
      recipientEmail: "ana@example.ro",
      payloadJson: {},
      idempotencyKey: "t:reminder",
      requestedByStaffUserId: null,
      isManualResend: false,
      status: "PROCESSING" as const,
      attemptCount: 1,
      nextAttemptAt: null,
      lockedAt: NOW,
      providerMessageId: null,
      transport: null,
      recipientCount: null,
      lastError: null,
      createdAt: NOW,
      sentAt: null,
    };
    const message = await renderOutboxMessage(row, db, NOW);
    // "Se apropie", not "peste 3 zile": a runner confirmed after the lead opened gets this nearer
    // the start than the lead says (§357, which landed on qa beside this branch).
    expect(message.text).toContain("Crosul se apropie.");
    expect(message.text).toContain("The cross is coming up.");
    expect(message.text).not.toContain("3 zile");
    expect(message.text).not.toContain("3 days");

    // A reminder resent by hand for an event that sends none (§15.8) names no lead.
    await db.update(events).set({ reminderHoursBefore: 0 }).where(eq(events.id, own.id));
    const resent = await renderOutboxMessage(row, db, NOW);
    expect(resent.text).toContain("Crosul se apropie.");
    expect(resent.text).toContain("The cross is coming up.");
  });

  describe("in the editor", () => {
    const base = {
      type: "RACE",
      eventStatus: "SCHEDULED",
      timezone: "Europe/Bucharest",
      startsAtWallTime: "2026-10-11T09:00",
      endsAtWallTime: "",
      raceStartsAtWallTime: "",
      locationName: "Parcul Tractorul",
      locationAddress: "",
      surface: null,
      difficulty: null,
      costType: null,
      mapUrl: "",
      routeUrl: "",
      distanceMeters: "",
      elevationGainMeters: "",
      featured: false,
      // Kept whatever the mode, like the confirmation days (§350): the editor shows the select only
      // for an event registered here, and storage is the same; "NONE" spares a declaration here.
      registrationMode: "NONE",
      participantListVisibility: "HIDDEN" as const,
      capacity: "",
      registrationOpensAtWallTime: "",
      registrationClosesAtWallTime: "",
      declarationDocumentId: "",
      externalProvider: "",
      externalRegistrationUrl: "",
    };
    const withReminder = (reminderHoursBefore: string | undefined, slug: string) => ({
      ...base,
      ...(reminderHoursBefore === undefined ? {} : { reminderHoursBefore }),
      translations: {
        ro: { slug: `${slug}-ro`, title: "Crosul", excerpt: "Cursa." },
        en: { slug: `${slug}-en`, title: "The cross", excerpt: "The race." },
      },
    });

    it("stores 'as usual' as null, none as zero, a lead as itself, and nothing when the select was not posted", async () => {
      expect((await createEvent(db, { actor: admin, fields: withReminder("", "obicei") })).reminderHoursBefore).toBeNull();
      expect((await createEvent(db, { actor: admin, fields: withReminder("0", "fara") })).reminderHoursBefore).toBe(0);
      expect((await createEvent(db, { actor: admin, fields: withReminder("72", "trei-zile") })).reminderHoursBefore).toBe(72);
      expect((await createEvent(db, { actor: admin, fields: withReminder(undefined, "absent") })).reminderHoursBefore).toBeNull();
    });

    it("refuses a lead outside the column's bounds, naming the select, and writes nothing", async () => {
      for (const value of ["169", "-1", "2.5", "mâine"]) {
        let fields: readonly string[] = [];
        try {
          await createEvent(db, { actor: admin, fields: withReminder(value, `refuzat-${value.length}`) });
        } catch (error) {
          if (!isDomainError(error)) throw error;
          expect(error.code, value).toBe("VALIDATION_ERROR");
          fields = error.fields;
        }
        expect(fields, value).toContain("reminderHoursBefore");
      }
      expect(await db.select().from(events)).toHaveLength(0);
    });

    it("travels with a copy, like the confirmation window beside it", async () => {
      const source = await createEvent(db, { actor: admin, fields: withReminder("24", "o-zi") });
      expect((await duplicateEvent(db, { actor: admin, eventId: source.id })).reminderHoursBefore).toBe(24);
    });
  });
});
