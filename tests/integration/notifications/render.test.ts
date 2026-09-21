import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { emailActionTokens } from "@/db/schema/email-action-tokens";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { renderOutboxMessage } from "@/modules/notifications/render";
import { canonicalizeEmail } from "@/modules/participants/domain/canonical-email";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-080-01 — the renderer that fills the outbox's `EmailRenderer` seam: it looks up the
 * participant/registration/event a row points at and, for a message type that needs one,
 * mints a fresh action token right here rather than earlier (see `notifications/render.ts` and
 * `outbox.ts` for why token issuance is deferred to render time).
 */
const NOW = new Date("2026-09-04T10:00:00.000Z");

describe("BR-REQ-080-01 outbox renderer", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let participantId: string;
  let registrationId: string;

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

    const [event] = await db
      .insert(events)
      .values({
        type: "GROUP_RUN",
        startsAt: new Date("2026-10-01T09:00:00.000Z"),
        registrationMode: "INTERNAL",
      })
      .returning();

    const [registration] = await db
      .insert(registrations)
      .values({
        eventId: event.id,
        participantId,
        status: "PENDING_DECLARATION",
        locale: "ro",
        registeredName: "Ana Pop",
        displayName: "Ana P.",
        privacyNoticeVersion: 1,
        privacyAcknowledgedAt: NOW,
        resultsNameConsent: false,
        listOptOut: false,
        resultsConsentVersion: 1,
        holdExpiresAt: new Date(NOW.getTime() + 30 * 60_000),
      })
      .returning();
    registrationId = registration.id;
  });

  it("mints a fresh token and builds a working action link for a token-bearing message", async () => {
    const message = await renderOutboxMessage(
      {
        id: "row-1",
        participantId,
        registrationId,
        messageType: "COMPLETE_DECLARATION",
        locale: "ro",
        recipientEmail: "ana@example.ro",
        payloadJson: {},
        idempotencyKey: "test:1",
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

    expect(message.subject.length).toBeGreaterThan(0);
    expect(message.html).toMatch(/https?:\/\/.+\/inregistrari\/declaratie\//);

    const [token] = await db.select().from(emailActionTokens).where(eq(emailActionTokens.registrationId, registrationId));
    expect(token.purpose).toBe("COMPLETE_DECLARATION");
    // The declaration link lives until the race, not until the hold (§160): a hold past its
    // deadline is kept while nobody waits, and the link must still open the declaration then.
    // Read from the event's own row, so it does not depend on a translation existing.
    expect(token.expiresAt).toEqual(new Date("2026-10-01T09:00:00.000Z"));
  });

  it("gives the declaration token the event's start, the offer's token the offer's deadline (§160)", async () => {
    const [event] = await db.select().from(events).limit(1);
    await db.insert(eventTranslations).values({ eventId: event.id, locale: "ro", slug: "crosul", title: "Crosul", excerpt: "x" });

    const row = {
      id: "row-t",
      participantId,
      registrationId,
      messageType: "COMPLETE_DECLARATION" as const,
      locale: "ro" as const,
      recipientEmail: "ana@example.ro",
      payloadJson: {},
      idempotencyKey: "test:t",
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
    };

    // With the translation in place the answer is the same instant: the event's start.
    await renderOutboxMessage(row, db, NOW);
    const [declaration] = await db
      .select()
      .from(emailActionTokens)
      .where(eq(emailActionTokens.purpose, "COMPLETE_DECLARATION"));
    expect(declaration.expiresAt).toEqual(event.startsAt);

    // An offer is a promise to the queue: its token dies with the offer, not with the race.
    const offerDeadline = new Date(NOW.getTime() + 24 * 60 * 60_000);
    await db
      .update(registrations)
      .set({ status: "WAITLIST_OFFERED", holdExpiresAt: offerDeadline })
      .where(eq(registrations.id, registrationId));
    await renderOutboxMessage({ ...row, id: "row-o", messageType: "WAITLIST_SPOT_OFFER", idempotencyKey: "test:o" }, db, NOW);
    const [offer] = await db.select().from(emailActionTokens).where(eq(emailActionTokens.purpose, "WAITLIST_OFFER"));
    expect(offer.expiresAt).toEqual(offerDeadline);

    // Past the start there is no place left to bound the link: the fourteen-day default.
    const afterStart = new Date(event.startsAt.getTime() + 60_000);
    await db
      .update(registrations)
      .set({ status: "PENDING_DECLARATION", holdExpiresAt: null })
      .where(eq(registrations.id, registrationId));
    await renderOutboxMessage({ ...row, id: "row-l", idempotencyKey: "test:l" }, db, afterStart);
    const late = await db
      .select()
      .from(emailActionTokens)
      .where(eq(emailActionTokens.purpose, "COMPLETE_DECLARATION"));
    expect(late.at(-1)?.expiresAt).toEqual(new Date(afterStart.getTime() + 14 * 24 * 60 * 60_000));
  });

  it("repeats the programme's rows in the reminder, each half in its own language (§117)", async () => {
    const [event] = await db.select().from(events).limit(1);
    // The details come through the translation; the fixture above has none.
    await db.insert(eventTranslations).values({ eventId: event.id, locale: "ro", slug: "crosul", title: "Crosul", excerpt: "x" });
    await db
      .update(events)
      .set({
        scheduleItems: [
          { startsAt: "2026-10-01T06:30:00.000Z", endsAt: null, label: { ro: "Briefing", en: "Briefing" }, place: null },
          { startsAt: "2026-10-01T06:00:00.000Z", endsAt: null, label: { ro: "Ridicarea numerelor", en: "Number pickup" }, place: "Cort" },
        ],
      })
      .where(eq(events.id, event.id));

    const message = await renderOutboxMessage(
      {
        id: "row-r",
        participantId,
        registrationId,
        messageType: "EVENT_REMINDER",
        locale: "ro",
        recipientEmail: "ana@example.ro",
        payloadJson: {},
        idempotencyKey: "test:r",
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

    // Sorted, at the event's wall clock (09:00 EEST), the Romanian half first and the English after.
    expect(message.text).toContain("Programul: 09:00 — Ridicarea numerelor (Cort); 09:30 — Briefing.");
    expect(message.text).toContain("The programme: 09:00 — Number pickup (Cort); 09:30 — Briefing.");
  });

  it("renders a message with no token and no action link", async () => {
    const message = await renderOutboxMessage(
      {
        id: "row-2",
        participantId,
        registrationId,
        messageType: "REGISTRATION_CANCELLED",
        locale: "en",
        recipientEmail: "ana@example.ro",
        payloadJson: {},
        idempotencyKey: "test:2",
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

    // Below the header band, which links nothing and only shows the lockup (§174).
    expect(message.html.slice(message.html.indexOf("</div>") + 6)).not.toContain("http");
    const tokens = await db.select().from(emailActionTokens).where(eq(emailActionTokens.registrationId, registrationId));
    expect(tokens).toHaveLength(0);
  });

  it("falls back to the default token lifetime when the borrowed hold has already lapsed by render time", async () => {
    // A hold that was still live when this message was queued, but has since expired — the
    // delayed-batch race `notifications/render.ts` guards against.
    const renderedAt = new Date(NOW.getTime() + 60 * 60_000); // one hour after the hold's own deadline

    const message = await renderOutboxMessage(
      {
        id: "row-3",
        participantId,
        registrationId,
        messageType: "COMPLETE_DECLARATION",
        locale: "ro",
        recipientEmail: "ana@example.ro",
        payloadJson: {},
        idempotencyKey: "test:3",
        requestedByStaffUserId: null,
        isManualResend: false,
        status: "PROCESSING",
        attemptCount: 1,
        nextAttemptAt: null,
        lockedAt: renderedAt,
        providerMessageId: null,
        lastError: null,
        createdAt: NOW,
        sentAt: null,
      },
      db,
      renderedAt,
    );

    expect(message.html).toMatch(/https?:\/\//);
    const [token] = await db
      .select()
      .from(emailActionTokens)
      .where(eq(emailActionTokens.registrationId, registrationId));
    // Not the lapsed hold deadline (NOW + 30 minutes, already in the past) — the default
    // lifetime instead, so the token itself is still issuable.
    expect(token.expiresAt.getTime()).toBeGreaterThan(renderedAt.getTime());
  });
});
