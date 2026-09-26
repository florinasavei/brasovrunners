import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { jobRuns } from "@/db/schema/job-runs";
import { platformSettings } from "@/db/schema/platform-settings";
import { GOVERNOR_EFFECTS, type NeonBudgetLevel } from "@/modules/diagnostics/domain/neon-budget";
import { PLAN_GRACE_MINUTES } from "@/modules/jobs/schedule";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §NNN — the job pings under the month's budget, end to end through the route handlers, with the
 * data cache in memory and a pool that refuses to open when a case says the database must not be
 * touched (`job-sleep.test.ts`'s harness). The budget reading is stubbed: it is Neon's API, and
 * `diagnostics/neon-budget.test.ts` covers how it is read.
 *
 * - `exhausted`: a ping does not try the database at all, answers 200 with the reason, and still
 *   counts as a ping for `/api/health` — a 500 all day would get the monitor disabled (§98).
 * - `ahead`: a real run plans under the governor's hour, so the pings after it hold back from the
 *   cache even when work turns up — the owner's own interval's mechanism (§334), not a new one.
 * - The Administrator's longer interval still wins over a shorter floor.
 */
const NOW = new Date("2026-10-20T10:00:00.000Z");
const MINUTE = 60_000;
const at = (minutes: number) => new Date(NOW.getTime() + minutes * MINUTE);
const SECRET = "correct-job-secret-value";

let db: TestDatabase;
let close: () => Promise<void>;
const pool = vi.hoisted(() => ({ open: true }));
const budget = vi.hoisted(() => ({ level: "normal" as string }));

vi.mock("next/cache", async () => (await import("../../helpers/next-cache")).fakeNextCache.module);
vi.mock("@/shared/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/shared/config/env")>();
  return { env: { ...actual.env, JOB_SECRET: "correct-job-secret-value" } };
});
vi.mock("@/db/client", () => ({
  getDb: () => {
    if (!pool.open) throw new Error("a ping the budget paused opened the database");
    return db;
  },
}));
vi.mock("@/modules/diagnostics/neon-budget", async () => {
  const { GOVERNOR_EFFECTS: effects } = await import("@/modules/diagnostics/domain/neon-budget");
  return {
    readNeonBudget: async () => ({
      level: budget.level,
      effects: effects[budget.level as NeonBudgetLevel],
      budget: null,
      meter: null,
    }),
  };
});

const { fakeNextCache } = await import("../../helpers/next-cache");
const { POST: maintenance } = await import("@/app/api/internal/jobs/registration-maintenance/route");
const { POST: outbox } = await import("@/app/api/internal/jobs/email-outbox/route");
const { wakeJobs } = await import("@/modules/jobs/schedule-cache");
const { readLastPing } = await import("@/modules/jobs/schedule-cache");

function ping(url = "https://example.test/api/internal/jobs/registration-maintenance"): Request {
  return new Request(url, { method: "POST", headers: { authorization: `Bearer ${SECRET}` } });
}

async function pingAt(minutes: number, options: { database?: boolean; route?: typeof maintenance } = {}) {
  vi.setSystemTime(at(minutes));
  pool.open = options.database ?? true;
  try {
    const response = await (options.route ?? maintenance)(ping());
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  } finally {
    pool.open = true;
  }
}

async function realRuns(job = "registration-maintenance"): Promise<number> {
  return (await db.select().from(jobRuns).where(eq(jobRuns.jobName, job))).length;
}

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  vi.useFakeTimers({ toFake: ["Date"] });
});
afterAll(async () => {
  vi.useRealTimers();
  await close();
});
beforeEach(async () => {
  pool.open = true;
  budget.level = "normal";
  await resetTables(db);
  fakeNextCache.reset();
  vi.setSystemTime(NOW);
});

describe("§NNN a job ping under the month's budget", () => {
  it("does not try a suspended database: 200, the reason, no run, and the ping still counted", async () => {
    budget.level = "exhausted";
    const answer = await pingAt(0, { database: false });
    expect(answer.status).toBe(200);
    expect(answer.body).toMatchObject({ job: "registration-maintenance", ran: false, reason: "budget", budgetLevel: "exhausted" });
    expect(await realRuns()).toBe(0);
    const outboxAnswer = await pingAt(1, { database: false, route: outbox });
    expect(outboxAnswer.body).toMatchObject({ job: "email-outbox", ran: false, reason: "budget" });
    // `/api/health` measures the pinger against the cached pings: this one is there.
    expect(await readLastPing("registration-maintenance", at(1), 30 * MINUTE)).toMatchObject({ ran: false });
  });

  it("plans a real run under the governor's hour while the month runs ahead, and holds the pings to it", async () => {
    budget.level = "ahead";
    const run = await pingAt(0);
    expect(run.body).toMatchObject({ ran: true, cadenceMinutes: GOVERNOR_EFFECTS.ahead.jobFloorMinutes, budgetLevel: "ahead" });
    expect(run.body.notBefore).toBe(at(60 - PLAN_GRACE_MINUTES).toISOString());

    // Work turns up and forgets the cached quiet; the floor still holds the next pings back.
    wakeJobs("registration-maintenance");
    const held = await pingAt(15, { database: false });
    expect(held.body).toMatchObject({ ran: false, reason: "cadence" });
    expect((await pingAt(60)).body.ran).toBe(true);
    expect(await realRuns()).toBe(2);
  });

  it("plans under nothing extra while the pace fits", async () => {
    const run = await pingAt(0);
    expect(run.body).toMatchObject({ ran: true, cadenceMinutes: 0, notBefore: null, budgetLevel: "normal" });
  });

  it("lets the Administrator's longer interval win over the governor's shorter floor", async () => {
    await db.insert(platformSettings).values({ key: "jobCadence", value: { minutes: 120 }, updatedAt: NOW });
    budget.level = "ahead";
    const run = await pingAt(0);
    expect(run.body.cadenceMinutes).toBe(120);
  });
});
