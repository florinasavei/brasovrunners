import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { consumeRateLimit, RATE_LIMITS } from "@/modules/rate-limit/service";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * AGENTS.md §19.4 — the database-backed throttle, against real PostgreSQL.
 *
 * The property worth testing here is not "it counts", it is that it counts **in one statement**.
 * A read followed by a write lets two requests arriving together each see the same count and
 * each write the same increment, which is precisely the case a rate limit exists for. PGlite is
 * single-connection so it cannot prove the concurrent case — what it proves is that the upsert
 * is a single round trip whose returned count is authoritative, which is the half that can be
 * asserted without two connections.
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

describe("§19.4 counting", () => {
  it("allows up to the limit and refuses after it", async () => {
    const { limit } = RATE_LIMITS["registration-submit"];

    for (let attempt = 1; attempt <= limit; attempt += 1) {
      const verdict = await consumeRateLimit(db, "registration-submit", "ana@example.org", NOW);
      expect(verdict.allowed, `attempt ${attempt}`).toBe(true);
      expect(verdict.count).toBe(attempt);
    }

    const refused = await consumeRateLimit(db, "registration-submit", "ana@example.org", NOW);
    expect(refused.allowed).toBe(false);
    expect(refused.count).toBe(limit + 1);
  });

  it("keeps counting while refusing, so hammering does not earn a fresh allowance", async () => {
    const { limit } = RATE_LIMITS["registration-submit"];
    for (let attempt = 0; attempt < limit + 3; attempt += 1) {
      await consumeRateLimit(db, "registration-submit", "ana@example.org", NOW);
    }

    const verdict = await consumeRateLimit(db, "registration-submit", "ana@example.org", NOW);
    expect(verdict.count).toBe(limit + 4);
    expect(verdict.allowed).toBe(false);
  });

  it("counts each key separately", async () => {
    await consumeRateLimit(db, "registration-submit", "ana@example.org", NOW);
    await consumeRateLimit(db, "registration-submit", "ana@example.org", NOW);

    const other = await consumeRateLimit(db, "registration-submit", "bogdan@example.org", NOW);
    expect(other.count).toBe(1);
  });

  it("counts each scope separately", async () => {
    // One person registering has nothing to do with an organizer resending, even for the same
    // string — the scopes are different guards on different actions.
    await consumeRateLimit(db, "registration-submit", "shared-key", NOW);
    const resend = await consumeRateLimit(db, "admin-resend", "shared-key", NOW);

    expect(resend.count).toBe(1);
  });

  it("starts fresh in the next window", async () => {
    const { limit, windowMs } = RATE_LIMITS["registration-submit"];
    for (let attempt = 0; attempt <= limit; attempt += 1) {
      await consumeRateLimit(db, "registration-submit", "ana@example.org", NOW);
    }

    const nextWindow = new Date(NOW.getTime() + windowMs);
    const verdict = await consumeRateLimit(db, "registration-submit", "ana@example.org", nextWindow);

    expect(verdict.count).toBe(1);
    expect(verdict.allowed).toBe(true);
  });

  it("reports when the window resets, in whole seconds", async () => {
    const verdict = await consumeRateLimit(db, "registration-submit", "ana@example.org", NOW);
    // 10:15 into an hourly window leaves 45 minutes.
    expect(verdict.retryAfter).toBe(45 * 60);
  });
});
