import { NextResponse } from "next/server";
import type { getDb } from "@/db/client";
import { isAuthorizedJobRequest } from "./auth";
import { type JobName, planQuiet, type QuietPlan } from "./schedule";
import { insideJobRun, readPingVerdict, recordPing, recordRealRun } from "./schedule-cache";

/**
 * One ping of a job endpoint, in the order the rules rank (§NNN):
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

  // The database, only now: everything above this line runs without a connection or its module.
  const [{ getDb: openDb }, { consumeRateLimit }, { readJobCadence }, { nextWork }] = await Promise.all([
    import("@/db/client"),
    import("@/modules/rate-limit/service"),
    import("./cadence"),
    import("./next-work"),
  ]);
  const db = openDb();

  // After the secret check, never before it: a bucket an unauthenticated caller can fill is a
  // way to switch the scheduler off, which is worse than the flood it would be refusing.
  const throttle = await consumeRateLimit(db, "job-invoke", job, now);
  if (!throttle.allowed) {
    return NextResponse.json(
      { error: "RATE_LIMITED" },
      { status: 429, headers: { "Retry-After": String(throttle.retryAfter) } },
    );
  }

  const outcome = await insideJobRun(job, () => run(db, now));

  let plan: QuietPlan | null = null;
  try {
    const cadence = await readJobCadence(db);
    plan = planQuiet({ ranAt: now, nextWorkAt: await nextWork(db, job, now), cadenceMinutes: cadence.minutes, failed: outcome.failed });
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
    checkedAt: now.toISOString(),
  });
}
