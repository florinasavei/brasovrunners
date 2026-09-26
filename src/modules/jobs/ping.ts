import { NextResponse } from "next/server";
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
 *      has something to do, and the plan is left in the cache for the pings after it.
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

export async function answerJobPing(
  request: Request,
  job: JobName,
  run: (db: AppDb, now: Date) => Promise<JobRunOutcome>,
): Promise<Response> {
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
    The month's budget (§NNN), from Neon's API and never the database, and only for a ping that
    is about to run: the ones answered from the cache above never ask. Once the quota is spent Neon
    has suspended the project, so trying would only fail — and a job endpoint that answers 500 all
    day is one cron-job.org disables (§98), which would leave the scheduler off when the period
    resets. It answers 200 with the reason instead, and records the ping so `/api/health` still
    sees a pinger that calls.
  */
  const budget = await readNeonBudget(now);
  if (budget.budget?.spent) {
    await recordPing(job, now, false);
    return NextResponse.json({ job, ran: false, reason: "budget", budgetLevel: budget.level, checkedAt: now.toISOString() });
  }

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
      return NextResponse.json(
        { error: "RATE_LIMITED" },
        { status: 429, headers: { "Retry-After": String(throttle.retryAfter) } },
      );
    }
    outcome = await insideJobRun(job, () => run(db, now));
  } catch (error) {
    /*
      The database is away — Neon's quota refusal while the governor still reads under 100%, a
      compute that cannot start, a network that does not reach it (§NNN). Answering 500 on every
      ping of an outage is how cron-job.org switches a monitor off (§98), and the scheduler would
      then stay off after the database is back. So an away-error answers 200 with the reason and
      records the ping; any other error is a bug and still fails loudly. Nothing is lost: a job
      that did not run leaves its rows as they were, and the next ping finds them due.
    */
    if (!isDatabaseAwayError(error)) throw error;
    const quota = isQuotaRefusalError(error);
    console.error(`[jobs] ${job}: the database is away${quota ? " (Neon's compute quota)" : ""}; not run`, error);
    await recordPing(job, now, false);
    return NextResponse.json({
      job,
      ran: false,
      reason: "database-away",
      quota,
      budgetLevel: budget.level,
      checkedAt: now.toISOString(),
    });
  }

  let plan: QuietPlan | null = null;
  try {
    const cadence = await readJobCadence(db);
    // The governor's floor rides the Administrator's interval (§NNN): the longer wins, and it is
    // the one the floor slots carry, so the pings after this run honour it from the cache.
    const cadenceMinutes = governedCadence(cadence.minutes, budget.effects.jobFloorMinutes);
    plan = planQuiet({ ranAt: now, nextWorkAt: await nextWork(db, job, now), cadenceMinutes, failed: outcome.failed });
    await recordRealRun(job, plan);
  } catch (error) {
    // The work is done; only the promise to the next pings is missing, so they run for real.
    console.error(`[jobs] ${job}: could not plan the next check`, error);
    await recordPing(job, now, true);
  }

  return NextResponse.json({
    job,
    ran: true,
    ...outcome.summary,
    nextCheckAt: plan ? plan.quietUntil.toISOString() : now.toISOString(),
    notBefore: plan?.floorUntil ? plan.floorUntil.toISOString() : null,
    cadenceMinutes: plan?.cadenceMinutes ?? null,
    budgetLevel: budget.level,
    checkedAt: now.toISOString(),
  });
}
