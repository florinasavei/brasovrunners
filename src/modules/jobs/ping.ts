import { after, NextResponse } from "next/server";
import type { getDb } from "@/db/client";
import { governedCadence } from "@/modules/diagnostics/domain/neon-budget";
import { readNeonBudget } from "@/modules/diagnostics/neon-budget";
import { isDatabaseAwayError, isQuotaRefusalError } from "@/modules/resilience/domain/database-away";
import { isAuthorizedJobRequest } from "./auth";
import { type JobName, planQuiet, type QuietPlan } from "./schedule";
import { insideJobRun, readPingVerdict, recordPing, recordRealRun } from "./schedule-cache";

/**
 * One ping of a job endpoint, in the order the rules rank (§334):
 *
 *   1. who is calling — `JOB_SECRET`, before anything else is read, the cache included;
 *   2. whether there is anything to do — from the cache alone. A ping before the cached "nothing
 *      due until", or inside the Administrator's minimum interval, answers 200 with the instant
 *      and never imports the pool, let alone opens it;
 *   3. how often — the throttle (§39), which lives in PostgreSQL and so is only asked by a ping
 *      that is about to use PostgreSQL anyway;
 *   4. the work, then the plan: the database the run already has awake says when the job next
 *      has something to do, and the plan is left in the cache for the pings after it;
 *   5. the answer, within twenty seconds (§667): a run still going then answers `continuing: true`
 *      and finishes after the response, its plan written when it ends.
 *
 * The body stays informative for cron-job.org's log either way: which job, whether it ran, why
 * not, and until when.
 */

type AppDb = ReturnType<typeof getDb>;
export type JobRunOutcome = {
  /** What the job did, as the endpoint has always answered it. */
  summary: object;
  /** A failure the next ping could repair: the run promises no quiet, so the next ping tries again. */
  failed: boolean;
};

/**
 * How long a ping that runs for real may keep its caller waiting, from the handler's start (§667).
 *
 * cron-job.org abandons a request after 30 seconds and reports the job failed, although the run
 * goes on and finishes on the platform; a job it sees failing long enough it disables (§98). The
 * email job alone can spend 20 seconds pacing Gmail (`GMAIL_PACE_BUDGET_MS`, §443), and up to 5
 * more reading Neon's budget before the work (`NEON_TIMEOUT_MS`, §447), before the database has
 * even woken. Twenty seconds leaves ten for a cold start before the handler and the answer's way
 * back. A run still going then answers `continuing: true` and finishes after the response.
 */
export const JOB_RESPONSE_DEADLINE_MS = 20_000;

/** What a ping answers, before it is a `Response`: the work's verdict, kept apart so it can be dropped. */
type PingAnswer = { body: object; status?: number; headers?: Record<string, string> };

/** For the tests only: a deadline of milliseconds, and what keeps the platform alive past the response. */
export type JobPingOptions = {
  deadlineMs?: number;
  keepAlive?: (work: Promise<unknown>) => void;
};

/*
  `after` with a callback, not the promise itself: Next applies the cache writes and the
  `revalidateTag`s queued inside an `after` *callback* when it settles (`withExecuteRevalidates`
  in `next/dist/server/after/after-context.js`), while a bare promise is only waited for. The
  plan a continuing run leaves (`recordRealRun`) and a write path's `wakeJobs` are exactly those.
*/
const keepAliveAfterResponse = (work: Promise<unknown>) => after(() => work);

function respond(answer: PingAnswer): Response {
  return NextResponse.json(answer.body, { status: answer.status ?? 200, headers: answer.headers });
}

export async function answerJobPing(
  request: Request,
  job: JobName,
  run: (db: AppDb, now: Date) => Promise<JobRunOutcome>,
  options: JobPingOptions = {},
): Promise<Response> {
  // Elapsed time from a clock no test fakes: the tests freeze `Date` and leave `performance` alone.
  const startedAt = performance.now();
  if (!isAuthorizedJobRequest(request)) {
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  }

  const now = new Date();
  const verdict = await readPingVerdict(job, now);
  if (!verdict.run) {
    await recordPing(job, now, false);
    return NextResponse.json({
      job,
      ran: false,
      reason: verdict.reason,
      // "nothing due until …" or "the minimum interval holds until …" — the log says which.
      [verdict.reason === "cadence" ? "notBefore" : "nothingDueUntil"]: verdict.until.toISOString(),
      lastRealRunAt: verdict.ranAt.toISOString(),
      cadenceMinutes: verdict.cadenceMinutes,
      checkedAt: now.toISOString(),
    });
  }

  /*
    The real run, started once, raced against the response deadline (§667). It settles first —
    nearly always — and the answer is the run's own, status and headers included. The deadline
    comes first, and the run is handed to the platform to finish after the response: cron-job.org
    gets a 200 within its thirty seconds, the run's result is dropped, and its plan is written when
    it ends, exactly as it would have been.
  */
  const work = runForReal(job, run, now);
  const deadlineMs = options.deadlineMs ?? JOB_RESPONSE_DEADLINE_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<"deadline">((resolve) => {
    timer = setTimeout(() => resolve("deadline"), Math.max(0, deadlineMs - (performance.now() - startedAt)));
  });
  let first: PingAnswer | "deadline";
  try {
    // Before the deadline an error throws as it always did: a 500, loud.
    first = await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
  }
  if (first !== "deadline") return respond(first);

  let handedOver = false;
  const continuing = work.then(
    () => {
      if (handedOver) console.log(`[jobs] ${job}: finished after the response in ${Math.round(performance.now() - startedAt)} ms`);
    },
    async (error: unknown) => {
      // Not handed over: the handler below awaits `work` itself and throws it as today.
      if (!handedOver) return;
      // A failed run promises no quiet: the ping is recorded as run, with no plan, so the next one runs for real.
      console.error(`[jobs] ${job}: failed after the response`, error);
      await recordPing(job, now, true);
      console.log(`[jobs] ${job}: finished after the response in ${Math.round(performance.now() - startedAt)} ms`);
    },
  );
  try {
    (options.keepAlive ?? keepAliveAfterResponse)(continuing);
    handedOver = true;
  } catch {
    // Outside a request scope (a script, a test without one) there is no "after": wait, as before.
    return respond(await work);
  }
  return NextResponse.json({
    job,
    ran: true,
    continuing: true,
    startedAt: now.toISOString(),
    checkedAt: new Date().toISOString(),
  });
}

/**
 * The ping's real run, from the budget read through the plan, and what it answers. Every error but
 * the database being away is thrown to the caller.
 */
async function runForReal(
  job: JobName,
  run: (db: AppDb, now: Date) => Promise<JobRunOutcome>,
  now: Date,
): Promise<PingAnswer> {
  /*
    The month's budget (§447), from Neon's API and never the database, and only for a ping that
    is about to run: the ones answered from the cache above never ask. It only ever widens the
    interval a run plans under (red's two hours); it never stops a job on its own. The platform's
    estimate is not the counter Neon enforces, and an estimate that ran ahead of Neon would leave
    the outbox, the reminders and the maintenance idle for days while the database answered — an
    email silently not sent, which §40 forbids (a spent allowance defers, never discards). The
    jobs rest only on Neon's own refusal, in the catch below, and the next ping is the probe that
    resumes them.
  */
  const budget = await readNeonBudget(now);

  // The database, only now: everything above this line runs without a connection or its module.
  const [{ getDb: openDb }, { consumeRateLimit }, { readJobCadence }, { nextWork }] = await Promise.all([
    import("@/db/client"),
    import("@/modules/rate-limit/service"),
    import("./cadence"),
    import("./next-work"),
  ]);
  const db = openDb();

  let outcome: JobRunOutcome;
  try {
    // After the secret check, never before it: a bucket an unauthenticated caller can fill is a
    // way to switch the scheduler off, which is worse than the flood it would be refusing.
    const throttle = await consumeRateLimit(db, "job-invoke", job, now);
    if (!throttle.allowed) {
      return { body: { error: "RATE_LIMITED" }, status: 429, headers: { "Retry-After": String(throttle.retryAfter) } };
    }
    outcome = await insideJobRun(job, () => run(db, now));
  } catch (error) {
    /*
      The database is away — Neon's quota refusal (the only thing that rests the jobs, whatever
      the governor reads), a compute that cannot start, a network that does not reach it (§447). Answering 500 on every
      ping of an outage is how cron-job.org switches a monitor off (§98), and the scheduler would
      then stay off after the database is back. So an away-error answers 200 with the reason and
      records the ping; any other error is a bug and still fails loudly. Nothing is lost: a job
      that did not run leaves its rows as they were, and the next ping finds them due.
    */
    if (!isDatabaseAwayError(error)) throw error;
    const quota = isQuotaRefusalError(error);
    console.error(`[jobs] ${job}: the database is away${quota ? " (Neon's compute quota)" : ""}; not run`, error);
    await recordPing(job, now, false);
    return {
      body: {
        job,
        ran: false,
        reason: "database-away",
        quota,
        budgetLevel: budget.level,
        checkedAt: now.toISOString(),
      },
    };
  }

  let plan: QuietPlan | null = null;
  try {
    const cadence = await readJobCadence(db);
    // The governor's floor rides the Administrator's interval (§447): the longer wins, and it is
    // the one the floor slots carry, so the pings after this run honour it from the cache.
    const cadenceMinutes = governedCadence(cadence.minutes, budget.effects.jobFloorMinutes);
    plan = planQuiet({ ranAt: now, nextWorkAt: await nextWork(db, job, now), cadenceMinutes, failed: outcome.failed });
    await recordRealRun(job, plan);
  } catch (error) {
    // The work is done; only the promise to the next pings is missing, so they run for real.
    console.error(`[jobs] ${job}: could not plan the next check`, error);
    await recordPing(job, now, true);
  }

  return {
    body: {
      job,
      ran: true,
      ...outcome.summary,
      nextCheckAt: plan ? plan.quietUntil.toISOString() : now.toISOString(),
      notBefore: plan?.floorUntil ? plan.floorUntil.toISOString() : null,
      cadenceMinutes: plan?.cadenceMinutes ?? null,
      budgetLevel: budget.level,
      checkedAt: now.toISOString(),
    },
  };
}
