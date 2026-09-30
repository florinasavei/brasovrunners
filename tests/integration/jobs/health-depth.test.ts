import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { jobRuns } from "@/db/schema/job-runs";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §577 — `/api/health` against a real PostgreSQL (PGlite): the shallow answer opens no connection
 * at all, the deep one (`?deep=1`) asks the database everything it always did.
 *
 * The pool refuses to open whenever a case says the database must not be touched, as in
 * `job-sleep.test.ts`: "no connection" is only proved by a pool that throws. The third parties the
 * deep answer also reads (Neon's API, Cloudflare, DeepL) are stubbed; their own tests are theirs.
 */
const NOW = new Date("2026-10-01T01:02:00.000Z"); // 04:02 in Brașov: the daily deep check (`SETUP.md` §40)
const pool = vi.hoisted(() => ({ open: true, opened: 0 }));
let db: TestDatabase;
let close: () => Promise<void>;

vi.mock("next/cache", async () => (await import("../../helpers/next-cache")).fakeNextCache.module);
vi.mock("@/db/client", () => ({
  getDb: () => {
    pool.opened += 1;
    if (!pool.open) throw new Error("the shallow health opened the database");
    return db;
  },
}));
vi.mock("@/modules/diagnostics/neon", () => {
  const notRead = { status: "ok", quotaCuHours: null, usedCuHours: null, percent: null, lineCuHours: null, level: "unknown" };
  return { checkNeonQuotaHealth: async () => notRead, QUOTA_NOT_READ: notRead };
});
vi.mock("@/modules/diagnostics/budget-thresholds", () => ({ cachedBudgetThresholds: async () => ({ amberPercent: 60, redPercent: 85 }) }));
vi.mock("@/modules/registrations/turnstile", () => ({ probeTurnstileSecret: async () => "not_configured" }));
vi.mock("@/modules/translate/credit", () => ({ readTranslationCredit: async () => ({ ok: false, reason: "unavailable" }) }));

const { fakeNextCache } = await import("../../helpers/next-cache");
const { GET } = await import("@/app/api/health/route");

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterAll(async () => {
  vi.useRealTimers();
  await close();
});
beforeEach(async () => {
  pool.open = true;
  pool.opened = 0;
  await resetTables(db);
  fakeNextCache.reset();
});

describe("§577 /api/health's two depths on a real database", () => {
  it("answers shallow with the pool refusing to open", async () => {
    pool.open = false;
    const response = await GET(new Request("http://localhost/api/health"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "ok", depth: "shallow" });
    expect(pool.opened).toBe(0);
  });

  it("asks the database on `?deep=1`: the connection, the schema and both jobs, as after the window's 04:00 runs", async () => {
    const window = new Date("2026-10-01T01:00:00.000Z");
    for (const jobName of ["registration-maintenance", "email-outbox"]) {
      await db.insert(jobRuns).values({ jobName, startedAt: window, finishedAt: window });
    }
    const body = await (await GET(new Request("http://localhost/api/health?deep=1"))).json();
    expect(pool.opened).toBe(1);
    expect(body).toMatchObject({ depth: "deep", database: "ok" });
    expect(body.schema).not.toBeNull();
    expect(body.jobs.map((job: { jobName: string; status: string }) => [job.jobName, job.status])).toEqual([
      ["registration-maintenance", "ok"],
      ["email-outbox", "ok"],
    ]);
    expect(body.email).not.toBeNull();
  });

  it("says a job that never ran on `?deep=1`, and nothing about jobs when shallow", async () => {
    const deep = await (await GET(new Request("http://localhost/api/health?deep=1"))).json();
    expect(deep.jobs.every((job: { status: string }) => job.status === "never_run")).toBe(true);
    expect(deep.status).not.toBe("ok");
    pool.open = false;
    const shallow = await (await GET(new Request("http://localhost/api/health"))).json();
    expect(shallow).not.toHaveProperty("jobs");
    expect(shallow.status).toBe("ok");
  });
});
