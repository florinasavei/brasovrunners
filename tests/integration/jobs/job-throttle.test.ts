import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { RATE_LIMITS } from "@/modules/rate-limit/service";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-090-03, AGENTS.md §19.4 — the job endpoints are throttled, not only authenticated.
 *
 * §19.4's fifth surface. Criterion 5 of BR-REQ-090-03 already required the endpoint to refuse
 * a caller without a valid `JOB_SECRET`; nothing required it to refuse a caller *with* one who
 * never stops. A leaked secret was an unlimited outbox drain.
 *
 * The route handler itself is exercised, not the policy in isolation, because the property
 * that matters is an ordering: **authenticate, then count**. A throttle in front of the secret
 * check would let an anonymous flood fill the bucket and switch the club's scheduler off,
 * which is a worse outage than the one it prevents. That is only visible end to end.
 *
 * `registration-maintenance` is the route under test because it is the thinner of the two —
 * the outbox route additionally builds an email sender from the environment. The throttle is
 * the same call in both, keyed on each route's own job name, and the last test here asserts
 * the two buckets do not share.
 */
const NOW = new Date("2026-09-05T10:15:00.000Z");
const SECRET = "correct-job-secret-value";

let db: TestDatabase;
let close: () => Promise<void>;

// The literal is repeated rather than referencing `SECRET`: `vi.mock` is hoisted above every
// declaration in the file, so a factory that closed over a `const` would read it too early.
vi.mock("@/shared/config/env", () => ({ env: { JOB_SECRET: "correct-job-secret-value" } }));
// A getter, so it resolves when the route calls it rather than when this factory is built.
vi.mock("@/db/client", () => ({ getDb: () => db }));

const { POST } = await import("@/app/api/internal/jobs/registration-maintenance/route");
const { consumeRateLimit } = await import("@/modules/rate-limit/service");

function post(authorization?: string): Request {
  return new Request("https://example.test/api/internal/jobs/registration-maintenance", {
    method: "POST",
    headers: authorization ? { authorization } : {},
  });
}

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  // The route reads the wall clock (`new Date()`), so the window boundary and the
  // `Retry-After` below are only assertable with the clock pinned. `Date` alone — faking
  // timers wholesale would stall PGlite, which is real PostgreSQL on an async WASM runtime.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterAll(async () => {
  vi.useRealTimers();
  await close();
});
beforeEach(async () => {
  await resetTables(db);
  vi.setSystemTime(NOW);
});

describe("BR-REQ-090-03 job endpoints are throttled", () => {
  it("refuses with 429 and a Retry-After once the limit is spent", async () => {
    const { limit } = RATE_LIMITS["job-invoke"];

    for (let attempt = 1; attempt <= limit; attempt += 1) {
      const response = await POST(post(`Bearer ${SECRET}`));
      expect(response.status, `attempt ${attempt}`).toBe(200);
    }

    const refused = await POST(post(`Bearer ${SECRET}`));
    expect(refused.status).toBe(429);
    expect(await refused.json()).toEqual({ error: "RATE_LIMITED" });
    // 10:15 into an hourly window leaves 45 minutes, and a scheduler that reads the header
    // learns when to come back rather than retrying into the same refusal.
    expect(refused.headers.get("Retry-After")).toBe(String(45 * 60));
  });

  it("counts only authenticated calls, so a flood cannot lock the scheduler out", async () => {
    const { limit } = RATE_LIMITS["job-invoke"];

    for (let attempt = 0; attempt < limit * 3; attempt += 1) {
      const response = await POST(post("Bearer wrong-secret-entirely"));
      expect(response.status).toBe(401);
    }

    // The real scheduler arrives after all of that with a full allowance.
    expect((await POST(post(`Bearer ${SECRET}`))).status).toBe(200);
  });

  it("gives each job its own bucket", async () => {
    const { limit } = RATE_LIMITS["job-invoke"];

    for (let attempt = 0; attempt <= limit; attempt += 1) {
      await POST(post(`Bearer ${SECRET}`));
    }
    expect((await POST(post(`Bearer ${SECRET}`))).status).toBe(429);

    // A hammered maintenance endpoint must not stop confirmations going out.
    const outbox = await consumeRateLimit(db, "job-invoke", "email-outbox", NOW);
    expect(outbox.allowed).toBe(true);
    expect(outbox.count).toBe(1);
  });
});
