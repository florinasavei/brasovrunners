import { desc, eq } from "drizzle-orm";
import { jobRuns } from "@/db/schema/job-runs";
import type { Database } from "@/db/types";
import { readJobCadence } from "./cadence";
import { jobStalenessThresholdMs } from "./quiet-hours";
import { RETENTION_ERROR_PREFIX } from "./retention";
import { isJobName, NEXT_DUE_CAP_MINUTES, SLOT_MINUTES } from "./schedule";
import { readLastPing } from "./schedule-cache";

/**
 * Job liveness (AGENTS.md §12.12, §16.2): "the health check reports degraded when the last
 * successful run of a job is older than its agreed threshold." The threshold follows the
 * monitor cadence in force — fifteen minutes by day, hourly at night, club time
 * (`quiet-hours.ts`, `DECISIONS.md` §68) — as twice the cadence plus a run, so one slow run
 * never flips the check before the next has had a chance. Both jobs share it.
 *
 * Since §NNN a ping with nothing to do answers from the cache and writes no `job_runs` row, so
 * "alive" is two questions, and the check must not cry wolf on either:
 *
 * - **Is the pinger still calling?** Measured against the last *ping*, skipped or real — read
 *   from the same cache the skip uses (`readLastPing`), or the last real run when that is newer —
 *   with the threshold it always had. No ping at all for twice the cadence plus five minutes is
 *   `stale`, exactly as before; pings every fifteen minutes that all skip are `ok`.
 * - **Does a real run still happen?** Measured against the last `job_runs` row, with the longest
 *   quiet a run may promise added to the same threshold: an hour (the cap), or the
 *   Administrator's minimum interval when that is longer (`cadence.ts`). A club that set two
 *   hours sees a real run every two hours and reads `ok`, rather than being paged by its own
 *   throttle.
 *
 * The cache answering nothing — evicted, or a caller outside a request — leaves the last real
 * run as the last ping, which is the check exactly as it was before §NNN.
 *
 * ## `failing` (§322)
 *
 * A job can run on time and still not do its work. The one piece of work whose silent failure
 * breaks a promise to the public is the retention sweep: it is what makes the privacy notice's
 * windows true. So when the **two most recent** runs both counted errors and both wrote a
 * retention failure into `last_error` (`retention:<steps>`, `maintenance.ts`), the job is
 * `failing` — not `ok` — and `/api/health` answers 503 as it does for anything but `ok`, which
 * is what the monitor emails on. Two, not one: a single lock timeout on a busy minute is
 * retried by the next run, and an alarm for it would be an alarm people learn to ignore.
 *
 * "The next run" is the next *ping* since §NNN, not the next hour: a retention failure is
 * counted as retryable (`retryableErrorCount`, `maintenance.ts`), so the run that hit it promises
 * the pings no quiet and the next one — fifteen minutes later by day, an hour at night — runs for
 * real. Only the Administrator's minimum interval, when one is set, holds that retry back, and
 * then by the interval they chose.
 */

export type JobHealth = {
  jobName: string;
  status: "ok" | "stale" | "never_run" | "failing";
  lastFinishedAt: string | null;
  /** The newest ping the cache remembers, skipped or real; null when it remembers none. */
  lastPingAt: string | null;
};

/** Whether a finished run wrote a retention failure (§322). */
function retentionFailed(run: { errorCount: number; lastError: string | null }): boolean {
  return run.errorCount > 0 && (run.lastError ?? "").startsWith(RETENTION_ERROR_PREFIX);
}

export async function checkJobHealth<T extends Record<string, unknown>>(
  db: Database<T>,
  jobName: string,
  now: Date,
): Promise<JobHealth> {
  const recent = await db
    .select({
      finishedAt: jobRuns.finishedAt,
      startedAt: jobRuns.startedAt,
      errorCount: jobRuns.errorCount,
      lastError: jobRuns.lastError,
    })
    .from(jobRuns)
    .where(eq(jobRuns.jobName, jobName))
    .orderBy(desc(jobRuns.startedAt))
    .limit(2);
  const [latest] = recent;

  const pingThresholdMs = jobStalenessThresholdMs(now);
  const ping = isJobName(jobName) ? await readLastPing(jobName, now, pingThresholdMs + SLOT_MINUTES * 60_000) : null;
  const lastPingAt = ping ? ping.at : null;

  if (!latest?.finishedAt) {
    return { jobName, status: "never_run", lastFinishedAt: null, lastPingAt };
  }

  const lastRun = latest.finishedAt.getTime();
  const lastSeen = Math.max(lastRun, ping ? Date.parse(ping.at) : 0);
  const { minutes: cadenceMinutes } = await readJobCadence(db);
  const realRunThresholdMs = Math.max(NEXT_DUE_CAP_MINUTES, cadenceMinutes) * 60_000 + pingThresholdMs;

  const stale = now.getTime() - lastSeen > pingThresholdMs || now.getTime() - lastRun > realRunThresholdMs;
  const failing = recent.length === 2 && recent.every((run) => run.finishedAt !== null && retentionFailed(run));

  return {
    jobName,
    status: stale ? "stale" : failing ? "failing" : "ok",
    lastFinishedAt: latest.finishedAt.toISOString(),
    lastPingAt,
  };
}
