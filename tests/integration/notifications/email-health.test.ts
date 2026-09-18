import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { emailOutbox } from "@/db/schema/email-outbox";
import { checkEmailHealth, EMAIL_HEALTH_THRESHOLDS } from "@/modules/notifications/health";
import { MAX_SEND_ATTEMPTS } from "@/modules/notifications/domain/retry";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-080-02 criterion 6 (`DECISIONS.md` §98) — the club is told when email has stopped.
 *
 * The outbox already keeps every message the provider refuses; what was missing was the
 * answer to "is anything stuck?", in a form a monitor can act on. Three shapes of stuck, each
 * asserted from the rows the worker actually leaves behind, and the two shapes that are *not*
 * stuck — a backoff retry due in minutes, a message sent — so the alert does not cry wolf on a
 * normal Tuesday.
 */
const NOW = new Date("2026-10-11T09:00:00.000Z");
const HOUR = 3_600_000;

describe("email health", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());
  beforeEach(async () => resetTables(db));

  const row = (overrides: Partial<typeof emailOutbox.$inferInsert>, key: string) => ({
    participantId: null,
    registrationId: null,
    messageType: "REGISTRATION_CONFIRMED" as const,
    locale: "ro" as const,
    recipientEmail: "runner@example.com",
    payloadJson: {},
    idempotencyKey: key,
    createdAt: new Date(NOW.getTime() - 10 * 60_000),
    ...overrides,
  });

  it("is ok with an empty outbox, a sent message, and a retry the backoff will get to", async () => {
    await db.insert(emailOutbox).values([
      row({ status: "SENT", sentAt: NOW }, "sent"),
      // A transient failure two minutes ago, due again in four: the mechanism working.
      row({ status: "PENDING", attemptCount: 2, nextAttemptAt: new Date(NOW.getTime() + 4 * 60_000), lastError: "socket" }, "retry"),
      // Queued just now by a request, not yet drained.
      row({ status: "PENDING", createdAt: NOW }, "fresh"),
    ]);
    const health = await checkEmailHealth(db, NOW);
    expect(health.status).toBe("ok");
    expect(health.waiting).toBe(2);
    expect(health.deferred + health.overdue + health.failed).toBe(0);
    expect(health.lastError).toBeNull();
  });

  it("is stalled while the allowance holds a message until the reset, and says when", async () => {
    // What `processOutboxBatch` writes for a 402/420: PENDING, next attempt at the UTC reset.
    const resumesAt = new Date("2026-10-12T00:05:00.000Z");
    await db.insert(emailOutbox).values([
      row({ status: "PENDING", attemptCount: 1, nextAttemptAt: resumesAt, lastError: "throttled: daily limit" }, "d1"),
      row({ status: "PENDING", attemptCount: 1, nextAttemptAt: resumesAt, lastError: "throttled: daily limit" }, "d2"),
    ]);
    const health = await checkEmailHealth(db, NOW);
    expect(health.status).toBe("stalled");
    expect(health.deferred).toBe(2);
    expect(health.resumesAt).toBe(resumesAt.toISOString());
    expect(health.lastError).toBe("throttled: daily limit");
  });

  it("is stalled when a pending message's turn passed and nothing drained it", async () => {
    const late = new Date(NOW.getTime() - EMAIL_HEALTH_THRESHOLDS.OVERDUE_AFTER_MS - 60_000);
    await db.insert(emailOutbox).values([
      // Never claimed: no next attempt, created two hours ago.
      row({ status: "PENDING", createdAt: late }, "never"),
      // Claimed once, due again long ago.
      row({ status: "PENDING", attemptCount: 1, nextAttemptAt: late, lastError: "socket" }, "due"),
    ]);
    const health = await checkEmailHealth(db, NOW);
    expect(health.status).toBe("stalled");
    expect(health.overdue).toBe(2);
    expect(health.deferred).toBe(0);
  });

  it("is stalled for a message that spent every attempt this week, and forgets it after", async () => {
    await db.insert(emailOutbox).values(
      row({ status: "FAILED", attemptCount: MAX_SEND_ATTEMPTS, lastError: "bad key" }, "f1"),
    );
    expect((await checkEmailHealth(db, NOW)).status).toBe("stalled");
    expect((await checkEmailHealth(db, NOW)).failed).toBe(1);
    expect((await checkEmailHealth(db, NOW)).lastError).toBe("bad key");

    // Eight days on, the same row is history, not an alarm.
    const later = new Date(NOW.getTime() + EMAIL_HEALTH_THRESHOLDS.FAILED_WINDOW_MS + 24 * HOUR);
    expect((await checkEmailHealth(db, later)).status).toBe("ok");
  });

  it("does not count a bounce: that is one address, shown on its registration", async () => {
    await db.insert(emailOutbox).values(row({ status: "BOUNCED", lastError: "no such mailbox" }, "b1"));
    expect((await checkEmailHealth(db, NOW)).status).toBe("ok");
  });

  it("draws its thresholds from the backoff it must not mistake for a stall", () => {
    // Six attempts, one to thirty-two minutes apart (`domain/retry.ts`), and the night
    // cadence is hourly: a deferral is always further away than that, an overdue row later.
    expect(EMAIL_HEALTH_THRESHOLDS.DEFERRED_BEYOND_MS).toBeGreaterThanOrEqual(32 * 60_000);
    expect(EMAIL_HEALTH_THRESHOLDS.OVERDUE_AFTER_MS).toBeGreaterThan(HOUR);
  });
});
