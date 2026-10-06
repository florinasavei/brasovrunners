import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { JobRunOutcome } from "@/modules/jobs/ping";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-090-03, §667 — a job ping that runs for real answers within the response deadline: a run
 * that ends first answers as it always did, and a run still going answers `continuing: true`, is
 * handed to the platform to finish after the response, and leaves its plan when it ends.
 *
 * `job-sleep.test.ts`'s harness (the data cache in memory, PGlite behind `getDb`), with the budget
 * reading stubbed as in `job-budget.test.ts`, and `answerJobPing` called directly with a run the
 * test controls, an injected deadline of milliseconds and an injected `keepAlive` — never a real
 * twenty-second wait.
 */
const NOW = new Date("2026-10-06T10:00:00.000Z");
const SECRET = "correct-job-secret-value";

let db: TestDatabase;
let close: () => Promise<void>;
const pool = vi.hoisted(() => ({ open: true }));

vi.mock("next/cache", async () => (await import("../../helpers/next-cache")).fakeNextCache.module);
vi.mock("@/shared/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/shared/config/env")>();
  return { env: { ...actual.env, JOB_SECRET: "correct-job-secret-value" } };
});
vi.mock("@/db/client", () => ({
  getDb: () => {
    if (!pool.open) throw new Error("a ping with nothing to do opened the database");
    return db;
  },
}));
vi.mock("@/modules/diagnostics/neon-budget", async () => {
  const { GOVERNOR_EFFECTS: effects } = await import("@/modules/diagnostics/domain/neon-budget");
  return { readNeonBudget: async () => ({ level: "green", effects: effects.green, budget: { spent: false }, meter: null }) };
});

const { fakeNextCache } = await import("../../helpers/next-cache");
const { answerJobPing, JOB_RESPONSE_DEADLINE_MS } = await import("@/modules/jobs/ping");
const { readLastPing } = await import("@/modules/jobs/schedule-cache");

const JOB = "registration-maintenance" as const;

function ping(): Request {
  return new Request("https://example.test/api/internal/jobs/registration-maintenance", {
    method: "POST",
    headers: { authorization: `Bearer ${SECRET}` },
  });
}

/** A run that waits for `release()` and then answers `outcome`, or throws `failure`. */
function heldRun(result: { outcome?: JobRunOutcome; failure?: Error } = {}) {
  let release = () => {};
  const gate = new Promise<void>((resolve) => (release = resolve));
  const state = { finished: false };
  const run = async () => {
    await gate;
    state.finished = true;
    if (result.failure) throw result.failure;
    return result.outcome ?? { summary: { processed: 1 }, failed: false };
  };
  return { run, release, state };
}

async function read(response: Response) {
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

/** The next ping, with the pool closed: "nothing-due" proves the plan was left in the cache. */
async function nextPingFromCache() {
  pool.open = false;
  try {
    return await read(await answerJobPing(ping(), JOB, async () => ({ summary: {}, failed: false })));
  } finally {
    pool.open = true;
  }
}

let log: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  // `Date` alone: faking timers wholesale would stall PGlite, and the deadline is a real timer.
  vi.useFakeTimers({ toFake: ["Date"] });
});
afterAll(async () => {
  vi.useRealTimers();
  await close();
});
beforeEach(async () => {
  pool.open = true;
  await resetTables(db);
  fakeNextCache.reset();
  vi.setSystemTime(NOW);
  log = vi.spyOn(console, "log").mockImplementation(() => {});
  error = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  log.mockRestore();
  error.mockRestore();
});

describe("BR-REQ-090-03 a job ping answers within the response deadline (§667)", () => {
  it("leaves cron-job.org's thirty seconds a margin", () => {
    expect(JOB_RESPONSE_DEADLINE_MS).toBe(20_000);
  });

  it("answers a run that ends before the deadline exactly as before", async () => {
    const keepAlive = vi.fn();
    const answer = await read(
      await answerJobPing(ping(), JOB, async () => ({ summary: { processed: 3 }, failed: false }), { deadlineMs: 10_000, keepAlive }),
    );
    expect(answer.status).toBe(200);
    expect(answer.body).toMatchObject({ job: JOB, ran: true, processed: 3, budgetLevel: "green", checkedAt: NOW.toISOString() });
    expect(answer.body).toHaveProperty("nextCheckAt");
    expect(answer.body).not.toHaveProperty("continuing");
    expect(keepAlive).not.toHaveBeenCalled();
  });

  it("throws an error that comes before the deadline, as before", async () => {
    const failing = async (): Promise<JobRunOutcome> => {
      throw new Error("a bug in the job");
    };
    await expect(answerJobPing(ping(), JOB, failing, { deadlineMs: 10_000, keepAlive: vi.fn() })).rejects.toThrow("a bug in the job");
  });

  it("answers `continuing` at the deadline, hands the run over, and leaves the plan when it ends", async () => {
    const held = heldRun();
    let handed: Promise<unknown> | undefined;
    const keepAlive = vi.fn((work: Promise<unknown>) => {
      handed = work;
    });

    const answer = await read(await answerJobPing(ping(), JOB, held.run, { deadlineMs: 20, keepAlive }));
    expect(answer.status).toBe(200);
    expect(answer.body).toEqual({ job: JOB, ran: true, continuing: true, startedAt: NOW.toISOString(), checkedAt: NOW.toISOString() });
    expect(held.state.finished).toBe(false);
    expect(keepAlive).toHaveBeenCalledTimes(1);
    expect(handed).toBeInstanceOf(Promise);

    held.release();
    await handed;
    expect(held.state.finished).toBe(true);
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/^\[jobs\] registration-maintenance: finished after the response in \d+ ms$/));
    expect(error).not.toHaveBeenCalled();

    const next = await nextPingFromCache();
    expect(next.body).toMatchObject({ job: JOB, ran: false, reason: "nothing-due" });
  });

  it("logs and records a run that fails after the response, and never rejects unhandled", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      const held = heldRun({ failure: new Error("a bug found after the response") });
      let handed: Promise<unknown> | undefined;
      const answer = await read(
        await answerJobPing(ping(), JOB, held.run, {
          deadlineMs: 20,
          keepAlive: (work) => {
            handed = work;
          },
        }),
      );
      expect(answer.body).toMatchObject({ ran: true, continuing: true });

      held.release();
      await expect(handed).resolves.toBeUndefined();
      // The failure is recorded as a ping that ran, with no plan.
      expect(await readLastPing(JOB, NOW, 10 * 60_000)).toMatchObject({ ran: true });
      // Two turns of the event loop: long enough for Node to report a rejection nobody handled.
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));
      expect(unhandled).not.toHaveBeenCalled();
      expect(error).toHaveBeenCalledWith("[jobs] registration-maintenance: failed after the response", expect.any(Error));
      expect(log).toHaveBeenCalledWith(expect.stringMatching(/finished after the response in \d+ ms$/));

      // A failed run promises no quiet: the next ping runs for real.
      const next = await read(await answerJobPing(ping(), JOB, async () => ({ summary: { processed: 0 }, failed: false })));
      expect(next.body).toMatchObject({ job: JOB, ran: true, processed: 0 });
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });

  it("waits for the run and answers as before when nothing can keep it alive past the response", async () => {
    const held = heldRun({ outcome: { summary: { processed: 2 }, failed: false } });
    const keepAlive = vi.fn(() => {
      throw new Error("`after` was called outside a request scope");
    });
    const pending = answerJobPing(ping(), JOB, held.run, { deadlineMs: 20, keepAlive });
    // Past the deadline, then the run ends: the handler was waiting for it, not answering.
    await new Promise((resolve) => setTimeout(resolve, 60));
    held.release();
    const answer = await read(await pending);
    expect(keepAlive).toHaveBeenCalledTimes(1);
    expect(answer.status).toBe(200);
    expect(answer.body).toMatchObject({ job: JOB, ran: true, processed: 2, budgetLevel: "green" });
    expect(answer.body).not.toHaveProperty("continuing");
    expect(log).not.toHaveBeenCalledWith(expect.stringMatching(/finished after the response/));

    const next = await nextPingFromCache();
    expect(next.body).toMatchObject({ ran: false, reason: "nothing-due" });
  });

  it("keeps the throttle's status and Retry-After when the run is refused before the deadline", async () => {
    const quick = async () => ({ summary: {}, failed: false });
    let last: Response | undefined;
    // The bucket's limit is small; the first pings run (each leaves a plan, so the cache is reset between them).
    for (let attempt = 0; attempt < 50; attempt += 1) {
      fakeNextCache.reset();
      last = await answerJobPing(ping(), JOB, quick, { deadlineMs: 10_000, keepAlive: vi.fn() });
      if (last.status === 429) break;
    }
    expect(last?.status).toBe(429);
    expect(last?.headers.get("Retry-After")).toMatch(/^\d+$/);
    expect(await last?.json()).toEqual({ error: "RATE_LIMITED" });
  });
});
