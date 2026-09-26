import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { jobRuns } from "@/db/schema/job-runs";
import { platformSettings } from "@/db/schema/platform-settings";
import { GOVERNOR_EFFECTS, type NeonBudgetLevel } from "@/modules/diagnostics/domain/neon-budget";
import { PLAN_GRACE_MINUTES } from "@/modules/jobs/schedule";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §447 — the job pings under the month's budget, end to end through the route handlers, with the
 * data cache in memory and a pool that refuses to open when a case says the database must not be
 * touched (`job-sleep.test.ts`'s harness). The budget reading is stubbed: it is Neon's API, and
 * `diagnostics/neon-budget.test.ts` covers how it is read.
 *
 * - `exhausted` by the platform's own estimate: nothing stops — the run plans under red's two
 *   hours. Only Neon's refusal rests a job: 200 with the reason, still counted as a ping for
 *   `/api/health` (a 500 all day would get the monitor disabled, §98), and the next ping that
 *   the database answers runs.
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
const pool = vi.hoisted(() => ({ open: true, refuseWith: null as Error | null }));
const budget = vi.hoisted(() => ({ level: "green" as string, spent: false }));

vi.mock("next/cache", async () => (await import("../../helpers/next-cache")).fakeNextCache.module);
vi.mock("@/shared/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/shared/config/env")>();
  return { env: { ...actual.env, JOB_SECRET: "correct-job-secret-value" } };
});
vi.mock("@/db/client", () => ({
  getDb: () => {
    if (!pool.open) throw new Error("a ping the budget paused opened the database");
    // A database that is there as an object but refuses every query, as Neon's proxy does.
    const refusal = pool.refuseWith;
    if (refusal) {
      return new Proxy(
        {},
        {
          get: () => () => {
            throw refusal;
          },
        },
      );
    }
    return db;
  },
}));
vi.mock("@/modules/diagnostics/neon-budget", async () => {
  const { GOVERNOR_EFFECTS: effects } = await import("@/modules/diagnostics/domain/neon-budget");
  return {
    readNeonBudget: async () => ({
      level: budget.level,
      effects: effects[budget.level as NeonBudgetLevel],
      budget: { spent: budget.spent },
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
  pool.refuseWith = null;
  budget.level = "green";
  budget.spent = false;
  await resetTables(db);
  fakeNextCache.reset();
  vi.setSystemTime(NOW);
});

describe("§447 a job ping under the month's budget", () => {
  /*
    The platform's own estimate never stops a job (§447): an estimate that ran ahead of the
    counter Neon enforces would leave emails unsent for days while the database answered (§40).
    At 100% it only plans under red's two hours; the jobs rest on Neon's refusal alone.
  */
  it("still runs when the platform's estimate reads the quota spent and the database answers", async () => {
    budget.level = "red";
    budget.spent = true;
    const answer = await pingAt(0);
    expect(answer.status).toBe(200);
    expect(answer.body).toMatchObject({ job: "registration-maintenance", ran: true, cadenceMinutes: 120, budgetLevel: "red" });
    expect(await realRuns()).toBe(1);
    const outboxAnswer = await pingAt(1, { route: outbox });
    expect(outboxAnswer.body).toMatchObject({ job: "email-outbox", ran: true, budgetLevel: "red" });
  });

  it("rests on Neon's refusal and resumes on the first ping the database answers", async () => {
    budget.level = "red";
    budget.spent = true;
    pool.refuseWith = new Error("Your project has exceeded the compute time quota. Upgrade your plan to increase limits.");
    const refused = await pingAt(0);
    expect(refused.body).toMatchObject({ ran: false, reason: "database-away", quota: true });
    expect(await realRuns()).toBe(0);
    // `/api/health` measures the pinger against the cached pings: this one is there.
    expect(await readLastPing("registration-maintenance", at(0), 30 * MINUTE)).toMatchObject({ ran: false });

    // The period resets (or the owner raises the quota): the very next ping is the probe, and it runs.
    pool.refuseWith = null;
    const resumed = await pingAt(15);
    expect(resumed.body).toMatchObject({ ran: true });
    expect(await realRuns()).toBe(1);
  });

  it("plans a real run under the governor's hour while the month is amber, and holds the pings to it", async () => {
    budget.level = "amber";
    const run = await pingAt(0);
    expect(run.body).toMatchObject({ ran: true, cadenceMinutes: GOVERNOR_EFFECTS.amber.jobFloorMinutes, budgetLevel: "amber" });
    expect(run.body.notBefore).toBe(at(60 - PLAN_GRACE_MINUTES).toISOString());

    // Work turns up and forgets the cached quiet; the floor still holds the next pings back.
    wakeJobs("registration-maintenance");
    const held = await pingAt(15, { database: false });
    expect(held.body).toMatchObject({ ran: false, reason: "cadence" });
    expect((await pingAt(60)).body.ran).toBe(true);
    expect(await realRuns()).toBe(2);
  });

  it("plans a real run under two hours while the month is red", async () => {
    budget.level = "red";
    const run = await pingAt(0);
    expect(run.body).toMatchObject({ ran: true, cadenceMinutes: 120, budgetLevel: "red" });
    wakeJobs("registration-maintenance");
    expect((await pingAt(60, { database: false })).body).toMatchObject({ ran: false, reason: "cadence" });
  });

  it("plans under nothing extra while the month is green", async () => {
    const run = await pingAt(0);
    expect(run.body).toMatchObject({ ran: true, cadenceMinutes: 0, notBefore: null, budgetLevel: "green" });
  });

  it("lets the Administrator's longer interval win over the governor's shorter floor", async () => {
    await db.insert(platformSettings).values({ key: "jobCadence", value: { minutes: 120 }, updatedAt: NOW });
    budget.level = "amber";
    const run = await pingAt(0);
    expect(run.body.cadenceMinutes).toBe(120);
  });

  /*
    The case the governor cannot see: with a project-scoped key the level comes from the
    operations log, which stops growing once Neon suspends the project, so it may still read
    under 100% while every query is refused. The error itself says so, and the ping answers 200.
  */
  it("answers 200 with database-away when Neon refuses on its quota while the level still reads under 100%", async () => {
    budget.level = "red";
    pool.refuseWith = new Error("Your project has exceeded the compute time quota. Upgrade your plan to increase limits.");
    const answer = await pingAt(0);
    expect(answer.status).toBe(200);
    expect(answer.body).toMatchObject({ job: "registration-maintenance", ran: false, reason: "database-away", quota: true, budgetLevel: "red" });
    expect(await readLastPing("registration-maintenance", at(0), 30 * MINUTE)).toMatchObject({ ran: false });
  });

  it("answers 200 with database-away on an ordinary outage too, and still fails on a bug", async () => {
    pool.refuseWith = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5432"), { code: "ECONNREFUSED" });
    const away = await pingAt(0, { route: outbox });
    expect(away.status).toBe(200);
    expect(away.body).toMatchObject({ job: "email-outbox", ran: false, reason: "database-away", quota: false });

    pool.refuseWith = new Error('column "nope" does not exist');
    await expect(pingAt(5)).rejects.toThrow(/does not exist/);
  });
});
