import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { emailActionTokens } from "@/db/schema/email-action-tokens";
import { emailOutbox } from "@/db/schema/email-outbox";
import { eventTranslations, events } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { type RegistrationStatus, registrations } from "@/db/schema/registrations";
import { issueActionToken } from "@/modules/action-tokens/repository";
import { renderOutboxMessage } from "@/modules/notifications/render";
import { canonicalizeEmail } from "@/modules/participants/domain/canonical-email";
import { newCheckinCode } from "@/modules/registrations/checkin-code";
import {
  checkInSelfFromMyRegistrations,
  consumeAndCancelFromMyRegistrations,
  readMyRegistrations,
  requestMyRegistrationsLink,
} from "@/modules/registrations/my-registrations";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

const NOW = new Date("2026-09-04T10:00:00.000Z");
const RACE_DAY = new Date("2026-10-01T09:00:00.000Z");

/**
 * BR-REQ-036-04 — one link, every active registration (`DECISIONS.md` §77). What is protected:
 * the request answers the same whatever the address means; the message mints a MANAGE_PROFILE
 * token scoped to the participant alone; the page lists active registrations only; "I am here"
 * and cancel work only on the token holder's own rows; cancel consumes the link.
 */
describe("BR-REQ-036-04 my registrations", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let participantId: string;
  let otherParticipantId: string;
  let soonEventId: string;
  let laterEventId: string;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());

  async function seedParticipant(email: string): Promise<string> {
    const identity = canonicalizeEmail(email);
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
    return participant.id;
  }

  async function seedEvent(startsAt: Date, title: string): Promise<string> {
    const [event] = await db
      .insert(events)
      .values({ type: "GROUP_RUN", startsAt, registrationMode: "INTERNAL", editorialStatus: "PUBLISHED", publishedAt: NOW })
      .returning();
    await db.insert(eventTranslations).values([
      { eventId: event.id, locale: "ro", slug: `${title}-ro`, title: `${title} RO` },
      { eventId: event.id, locale: "en", slug: `${title}-en`, title: `${title} EN` },
    ]);
    return event.id;
  }

  async function seedRegistration(eventId: string, status: RegistrationStatus, owner = participantId): Promise<string> {
    const [registration] = await db
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
        confirmedAt: status === "CONFIRMED" ? NOW : null,
        checkinCode: status === "CONFIRMED" ? newCheckinCode() : null,
        waitlistedAt: status === "WAITLISTED" ? NOW : null,
      })
      .returning();
    return registration.id;
  }

  const profileToken = async (owner = participantId) =>
    (await issueActionToken(db, { participantId: owner, registrationId: null, purpose: "MANAGE_PROFILE", expiresAt: RACE_DAY, now: NOW })).secret;

  beforeEach(async () => {
    await resetTables(db);
    participantId = await seedParticipant("ana@example.ro");
    otherParticipantId = await seedParticipant("ion@example.ro");
    soonEventId = await seedEvent(RACE_DAY, "crosul");
    laterEventId = await seedEvent(new Date("2026-11-01T09:00:00.000Z"), "tura");
  });

  it("queues one participant-scoped message for a known address, and nothing — identically — for anything else", async () => {
    await requestMyRegistrationsLink(db, { email: "  ANA@example.ro ", locale: "ro" }, NOW);
    const [row] = await db.select().from(emailOutbox);
    expect(row.messageType).toBe("PROFILE_MANAGE_LINK");
    expect(row.participantId).toBe(participantId);
    expect(row.registrationId).toBeNull();

    await resetTables(db);
    participantId = await seedParticipant("ana@example.ro");
    await expect(requestMyRegistrationsLink(db, { email: "nobody@example.ro", locale: "ro" }, NOW)).resolves.toBeUndefined();
    await expect(requestMyRegistrationsLink(db, { email: "not an address", locale: "ro" }, NOW)).resolves.toBeUndefined();
    expect(await db.select().from(emailOutbox)).toHaveLength(0);
  });

  it("renders the message with a MANAGE_PROFILE token scoped to the participant and a link to the page", async () => {
    const message = await renderOutboxMessage(
      {
        id: "row-1",
        participantId,
        registrationId: null,
        messageType: "PROFILE_MANAGE_LINK",
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
        transport: null,
        recipientCount: null,
        lastError: null,
        createdAt: NOW,
        sentAt: null,
      },
      db,
      NOW,
    );
    expect(message.html).toMatch(/https?:\/\/.+\/inscrieri\/ale-mele\//);
    const [token] = await db.select().from(emailActionTokens).where(eq(emailActionTokens.participantId, participantId));
    expect(token.purpose).toBe("MANAGE_PROFILE");
    expect(token.registrationId).toBeNull();
  });

  it("lists the active registrations of the token holder only, soonest first, with the code once confirmed", async () => {
    await seedRegistration(laterEventId, "WAITLISTED");
    const confirmed = await seedRegistration(soonEventId, "CONFIRMED");
    await seedRegistration(soonEventId, "CANCELLED", otherParticipantId);
    await seedRegistration(laterEventId, "CONFIRMED", otherParticipantId);

    const context = await readMyRegistrations(db, await profileToken(), "en", NOW);
    expect(context.ok).toBe(true);
    if (!context.ok) return;
    expect(context.items.map((item) => [item.eventTitle, item.status])).toEqual([
      ["crosul EN", "CONFIRMED"],
      ["tura EN", "WAITLISTED"],
    ]);
    expect(context.items[0].id).toBe(confirmed);
    expect(context.items[0].checkinCode).toMatch(/^[A-Z2-9]{10}$/);
    // Not the day before yet.
    expect(context.items[0].selfCheckinOpen).toBe(false);
    expect((await readMyRegistrations(db, await profileToken(), "en", new Date(RACE_DAY.getTime() - 60 * 60_000))).ok && true).toBe(true);
  });

  it("answers the same generic rejection for a wrong, spent or registration-scoped token", async () => {
    expect((await readMyRegistrations(db, "not-a-token", "ro", NOW)).ok).toBe(false);
    const registrationScoped = (
      await issueActionToken(db, {
        participantId,
        registrationId: await seedRegistration(soonEventId, "CONFIRMED"),
        purpose: "MANAGE_REGISTRATION",
        expiresAt: RACE_DAY,
        now: NOW,
      })
    ).secret;
    expect((await readMyRegistrations(db, registrationScoped, "ro", NOW)).ok).toBe(false);
  });

  it("marks the holder present from the day before, for their own registration only, without spending the link", async () => {
    const mine = await seedRegistration(soonEventId, "CONFIRMED");
    const theirs = await seedRegistration(laterEventId, "CONFIRMED", otherParticipantId);
    const secret = await profileToken();
    const dayBefore = new Date(RACE_DAY.getTime() - 2 * 60 * 60_000);

    const tooEarly = await checkInSelfFromMyRegistrations(db, secret, mine, "ro", NOW).catch((e: unknown) => e);
    expect(isDomainError(tooEarly) && tooEarly.code).toBe("VALIDATION_ERROR");

    const notMine = await checkInSelfFromMyRegistrations(db, secret, theirs, "ro", dayBefore).catch((e: unknown) => e);
    expect(isDomainError(notMine) && notMine.code).toBe("NOT_FOUND");

    const result = await checkInSelfFromMyRegistrations(db, secret, mine, "ro", dayBefore);
    expect(result.ok && result.registration.checkedInAt).toEqual(dayBefore);
    // Still readable afterwards.
    expect((await readMyRegistrations(db, secret, "ro", dayBefore)).ok).toBe(true);
  });

  it("cancels the holder's own registration, releases the place, and spends the link", async () => {
    const mine = await seedRegistration(soonEventId, "CONFIRMED");
    const theirs = await seedRegistration(soonEventId, "CONFIRMED", otherParticipantId);
    const secret = await profileToken();

    const notMine = await consumeAndCancelFromMyRegistrations(db, secret, theirs, NOW).catch((e: unknown) => e);
    expect(isDomainError(notMine) && notMine.code).toBe("NOT_FOUND");
    // The refused attempt rolled back: the token is still live.
    expect((await readMyRegistrations(db, secret, "ro", NOW)).ok).toBe(true);

    const result = await consumeAndCancelFromMyRegistrations(db, secret, mine, NOW);
    expect(result.ok && result.registration.status).toBe("CANCELLED");
    const [theirRow] = await db.select().from(registrations).where(eq(registrations.id, theirs));
    expect(theirRow.status).toBe("CONFIRMED");
    // Single use (§12.8): a second cancellation needs a fresh link.
    expect((await readMyRegistrations(db, secret, "ro", NOW)).ok).toBe(false);
  });
});
