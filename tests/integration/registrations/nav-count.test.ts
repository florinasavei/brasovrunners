import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { events } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations, type RegistrationStatus } from "@/db/schema/registrations";
import { countRegisteredForUpcoming, forgetRegisteredBadgeCount, registeredBadgeCount } from "@/modules/registrations/nav-count";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-041-01, `DECISIONS.md` §255 — the figure beside the "Înscrieri" tab.
 *
 * The owner asked for it with a constraint attached: "but DB efficiently! please note we use a
 * light DB". So what is asserted here is as much *what is not counted* as what is: one query,
 * no cancellations, no test rows, nothing from an event that has already run — and a memo, so
 * the shell that renders on every backoffice page does not ask again on every page.
 */
const NOW = new Date("2026-10-11T09:00:00.000Z");
const DAY = 86_400_000;

describe("§255 how many are signed up", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let upcoming: string;
  let past: string;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());

  beforeEach(async () => {
    await resetTables(db);
    forgetRegisteredBadgeCount();
    const [next] = await db
      .insert(events)
      .values({ type: "RACE", startsAt: new Date(NOW.getTime() + 7 * DAY), registrationMode: "INTERNAL", capacity: 100 })
      .returning();
    const [done] = await db
      .insert(events)
      .values({ type: "RACE", startsAt: new Date(NOW.getTime() - 7 * DAY), registrationMode: "INTERNAL", capacity: 100 })
      .returning();
    upcoming = next.id;
    past = done.id;
  });

  let counter = 0;
  async function enter(eventId: string, status: RegistrationStatus, kind: "REAL" | "TEST" = "REAL") {
    counter += 1;
    const email = `runner-${counter}@example.test`;
    const [participant] = await db
      .insert(participants)
      .values({ deliveryEmail: email, normalizedEmail: email, canonicalEmail: email, canonicalizationVersion: 1, defaultName: `Runner ${counter}` })
      .returning();
    await db.insert(registrations).values({
      eventId,
      participantId: participant.id,
      status,
      kind,
      locale: "ro",
      registeredName: `Runner ${counter}`,
      displayName: `Runner ${counter}`,
      privacyNoticeVersion: 1,
      privacyAcknowledgedAt: NOW,
      resultsNameConsent: false,
      resultsConsentVersion: 1,
      submittedAt: NOW,
    });
  }

  it("counts everybody still in the queue for an event that has not run", async () => {
    for (const status of ["PENDING_EMAIL_CONFIRMATION", "PENDING_DECLARATION", "WAITLISTED", "WAITLIST_OFFERED", "CONFIRMED"] as const) {
      await enter(upcoming, status);
    }
    expect(await countRegisteredForUpcoming(db, NOW)).toBe(5);
  });

  it("leaves out what the club does not mean by 'signed up'", async () => {
    await enter(upcoming, "CONFIRMED");
    // Gone: cancelled and expired rows.
    await enter(upcoming, "CANCELLED");
    await enter(upcoming, "EXPIRED");
    // Never in a number the club is given (§12.6).
    await enter(upcoming, "CONFIRMED", "TEST");
    // History: last month's race is not "signed up".
    await enter(past, "CONFIRMED");

    expect(await countRegisteredForUpcoming(db, NOW)).toBe(1);
  });

  it("answers from the memo rather than asking again", async () => {
    await enter(upcoming, "CONFIRMED");
    expect(await registeredBadgeCount(db, NOW)).toBe(1);

    // Somebody registers a second later; the badge is allowed to be a minute stale, and the
    // list itself is always exact.
    await enter(upcoming, "CONFIRMED");
    expect(await registeredBadgeCount(db, new Date(NOW.getTime() + 1_000))).toBe(1);
    // A minute on, or the moment anything drops the memo, it is current again.
    expect(await registeredBadgeCount(db, new Date(NOW.getTime() + 61_000))).toBe(2);
    forgetRegisteredBadgeCount();
    expect(await registeredBadgeCount(db, NOW)).toBe(2);
  });
});
