import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { emailOutbox } from "@/db/schema/email-outbox";
import { events } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { type RegistrationStatus, registrations } from "@/db/schema/registrations";
import { canonicalizeEmail } from "@/modules/participants/domain/canonical-email";
import { requestRegistrationLink } from "@/modules/registrations/service";
import { RATE_LIMITS } from "@/modules/rate-limit/service";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-036-02, AGENTS.md §19.4's second surface — the participant asking for their own link
 * again.
 *
 * The property under test throughout is that the function is *silent about what it found*.
 * Every case below returns the same nothing; what separates them is whether an outbox row
 * appeared, which the caller cannot see. A test that asserted a distinguishable return value
 * would be asserting the membership oracle this surface must not be.
 */
const NOW = new Date("2026-09-04T10:00:00.000Z");

describe("BR-REQ-036-02 participant link request", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let eventId: string;
  let participantId: string;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());

  async function seedRegistration(status: RegistrationStatus): Promise<string> {
    const [registration] = await db
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
        waitlistedAt: status === "WAITLISTED" ? NOW : null,
      })
      .returning();
    return registration.id;
  }

  const outboxRows = () => db.select().from(emailOutbox);

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
        kind: "COMMUNITY_RUN",
        startsAt: new Date("2026-10-01T09:00:00.000Z"),
        registrationMode: "INTERNAL",
      })
      .returning();
    eventId = event.id;
  });

  it("queues the message the current status allows", async () => {
    const registrationId = await seedRegistration("PENDING_EMAIL_CONFIRMATION");

    await requestRegistrationLink(db, { email: "ana@example.ro", eventId }, NOW);

    const [row] = await outboxRows();
    expect(row.messageType).toBe("VERIFY_REGISTRATION_EMAIL");
    expect(row.registrationId).toBe(registrationId);
    // §14.5: the row carries no secret. The token is minted by the renderer at send time.
    expect(JSON.stringify(row.payloadJson)).not.toMatch(/token/i);
  });

  it("sends the declaration link, not the verification one, once the email is confirmed", async () => {
    await seedRegistration("PENDING_DECLARATION");

    await requestRegistrationLink(db, { email: "ana@example.ro", eventId }, NOW);

    const [row] = await outboxRows();
    expect(row.messageType).toBe("COMPLETE_DECLARATION");
  });

  it("sends nothing for a waitlisted registration, which is waiting on the club and not on them", async () => {
    await seedRegistration("WAITLISTED");

    await requestRegistrationLink(db, { email: "ana@example.ro", eventId }, NOW);

    expect(await outboxRows()).toHaveLength(0);
  });

  it("sends nothing for an address nobody registered, and says so no differently", async () => {
    await seedRegistration("PENDING_EMAIL_CONFIRMATION");

    // Same call shape, same absence of a return value — only the outbox knows.
    await expect(
      requestRegistrationLink(db, { email: "nobody@example.ro", eventId }, NOW),
    ).resolves.toBeUndefined();

    expect(await outboxRows()).toHaveLength(0);
  });

  it("sends nothing for a malformed address rather than raising", async () => {
    await seedRegistration("PENDING_EMAIL_CONFIRMATION");

    await expect(
      requestRegistrationLink(db, { email: "not an address", eventId }, NOW),
    ).resolves.toBeUndefined();

    expect(await outboxRows()).toHaveLength(0);
  });

  it("treats a Gmail +tag as the same mailbox, so it cannot buy a fresh allowance", async () => {
    // BR-REQ-032: dots and tags collapse for gmail.com. The registration is under the plain
    // address; the request arrives tagged, and must still find it.
    const identity = canonicalizeEmail("ana.pop@gmail.com");
    const [gmailParticipant] = await db
      .insert(participants)
      .values({
        deliveryEmail: identity.deliveryEmail,
        normalizedEmail: identity.normalizedEmail,
        canonicalEmail: identity.canonicalEmail,
        canonicalizationVersion: identity.canonicalizationVersion,
        defaultName: "Ana Pop",
      })
      .returning();
    participantId = gmailParticipant.id;
    await seedRegistration("PENDING_EMAIL_CONFIRMATION");

    await requestRegistrationLink(db, { email: "anapop+race@googlemail.com", eventId }, NOW);

    expect(await outboxRows()).toHaveLength(1);
  });

  it("finds the most recent active registration when no event is given", async () => {
    await seedRegistration("CANCELLED");
    const live = await seedRegistrationForOtherEvent();

    await requestRegistrationLink(db, { email: "ana@example.ro" }, NOW);

    const rows = await outboxRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].registrationId).toBe(live);
  });

  async function seedRegistrationForOtherEvent(): Promise<string> {
    const [other] = await db
      .insert(events)
      .values({
        kind: "TRAIL_RUN",
        startsAt: new Date("2026-11-01T09:00:00.000Z"),
        registrationMode: "INTERNAL",
      })
      .returning();

    const [registration] = await db
      .insert(registrations)
      .values({
        eventId: other.id,
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
      })
      .returning();
    return registration.id;
  }

  it("stops sending once the hourly allowance for that mailbox is spent", async () => {
    await seedRegistration("PENDING_EMAIL_CONFIRMATION");
    const { limit } = RATE_LIMITS["link-request"];

    for (let attempt = 0; attempt < limit + 2; attempt += 1) {
      // Each a minute apart, so this is a spent allowance rather than an idempotency clash.
      await requestRegistrationLink(
        db,
        { email: "ana@example.ro", eventId },
        new Date(NOW.getTime() + attempt * 60_000),
      );
    }

    // Refused silently: the caller cannot tell this apart from an unregistered address.
    expect(await outboxRows()).toHaveLength(limit);
  });

  it("does not change the registration it sends about", async () => {
    const registrationId = await seedRegistration("PENDING_DECLARATION");
    const [before] = await db.select().from(registrations).where(eq(registrations.id, registrationId));

    await requestRegistrationLink(db, { email: "ana@example.ro", eventId }, NOW);

    const [after] = await db.select().from(registrations).where(eq(registrations.id, registrationId));
    expect(after).toEqual(before);
  });
});
