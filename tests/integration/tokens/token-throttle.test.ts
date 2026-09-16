import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { rateLimitBuckets } from "@/db/schema/rate-limit";
import { generateTokenSecret, hashTokenSecret } from "@/modules/action-tokens/domain/token-secret";
import { tokenAttemptAllowed } from "@/modules/action-tokens/throttle";
import { RATE_LIMITS } from "@/modules/rate-limit/service";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-036-02, AGENTS.md §19.4 — the throttle on token validation.
 *
 * §19.4 names five surfaces and this is the third. What is asserted here is not "it counts" —
 * `rate-limit/throttle.test.ts` owns that — but the three decisions that are specific to a
 * token: the bucket is one link rather than one caller, the key stored is the hash and never
 * the secret (§14.5), and a malformed value is not counted at all because it never reaches the
 * database to be amplified.
 */
const NOW = new Date("2026-09-05T10:15:00.000Z");

let db: TestDatabase;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => {
  await close();
});
beforeEach(async () => {
  await resetTables(db);
});

describe("BR-REQ-036-02 token validation is rate limited", () => {
  it("allows the limit and refuses beyond it for one token", async () => {
    const secret = generateTokenSecret();
    const { limit } = RATE_LIMITS["token-validate"];

    for (let attempt = 1; attempt <= limit; attempt += 1) {
      expect(await tokenAttemptAllowed(db, secret, NOW), `attempt ${attempt}`).toBe(true);
    }

    expect(await tokenAttemptAllowed(db, secret, NOW)).toBe(false);
  });

  it("keys on the token, so a hammered link cannot throttle anybody else's", async () => {
    const hammered = generateTokenSecret();
    const other = generateTokenSecret();
    const { limit } = RATE_LIMITS["token-validate"];

    for (let attempt = 0; attempt <= limit + 5; attempt += 1) {
      await tokenAttemptAllowed(db, hammered, NOW);
    }

    expect(await tokenAttemptAllowed(db, hammered, NOW)).toBe(false);
    expect(await tokenAttemptAllowed(db, other, NOW)).toBe(true);
  });

  it("stores the hash and never the secret (§14.5)", async () => {
    const secret = generateTokenSecret();
    await tokenAttemptAllowed(db, secret, NOW);

    const rows = await db
      .select({ key: rateLimitBuckets.key })
      .from(rateLimitBuckets)
      .where(eq(rateLimitBuckets.scope, "token-validate"));

    expect(rows).toHaveLength(1);
    expect(rows[0]?.key).toBe(hashTokenSecret(secret));
    // The assertion that matters: the value that went into an email is nowhere in this table.
    expect(rows.map((row) => row.key)).not.toContain(secret);
  });

  it("does not count a malformed value, which never reaches the database anyway", async () => {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      expect(await tokenAttemptAllowed(db, "not-a-token", NOW)).toBe(true);
    }

    const rows = await db.select({ key: rateLimitBuckets.key }).from(rateLimitBuckets);
    expect(rows).toHaveLength(0);
  });

  it("starts fresh in the next window", async () => {
    const secret = generateTokenSecret();
    const { limit, windowMs } = RATE_LIMITS["token-validate"];

    for (let attempt = 0; attempt <= limit; attempt += 1) {
      await tokenAttemptAllowed(db, secret, NOW);
    }
    expect(await tokenAttemptAllowed(db, secret, NOW)).toBe(false);

    expect(await tokenAttemptAllowed(db, secret, new Date(NOW.getTime() + windowMs))).toBe(true);
  });
});
