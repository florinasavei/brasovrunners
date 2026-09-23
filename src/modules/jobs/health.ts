import { desc, eq } from "drizzle-orm";
import { jobRuns } from "@/db/schema/job-runs";
import type { Database } from "@/db/types";
import { jobStalenessThresholdMs } from "./quiet-hours";
import { RETENTION_ERROR_PREFIX } from "./retention";

/**
 * Job liveness (AGENTS.md §12.12, §16.2): "the health check reports degraded when the last
 * successful run of a job is older than its agreed threshold." The threshold follows the
 * monitor cadence in force — fifteen minutes by day, hourly at night, club time
 * (`quiet-hours.ts`, `DECISIONS.md` §68) — as twice the cadence plus a run, so one slow run
 * never flips the check before the next has had a chance. Both jobs share it.
 *
 * ## `failing` (§NNN)
 *
 * A job can run on time and still not do its work. The one piece of work whose silent failure
 * breaks a promise to the public is the retention sweep: it is what makes the privacy notice's
 * windows true. So when the **two most recent** runs both counted errors and both wrote a
 * retention failure into `last_error` (`retention:<steps>`, `maintenance.ts`), the job is
 * `failing` — not `ok` — and `/api/health` answers 503 as it does for anything but `ok`, which
 * is what the monitor emails on. Two, not one: a single lock timeout on a busy minute is
 * retried by the next run five minutes later, and an alarm for it would be an alarm people learn
 * to ignore.
 */

export type JobHealth = {
  jobName: string;
  status: "ok" | "stale" | "never_run" | "failing";
  lastFinishedAt: string | null;
};

/** Whether a finished run wrote a retention failure (§NNN). */
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

  if (!latest?.finishedAt) {
    return { jobName, status: "never_run", lastFinishedAt: null };
  }

  const stale = now.getTime() - latest.finishedAt.getTime() > jobStalenessThresholdMs(now);
  const failing = recent.length === 2 && recent.every((run) => run.finishedAt !== null && retentionFailed(run));

  return {
    jobName,
    status: stale ? "stale" : failing ? "failing" : "ok",
    lastFinishedAt: latest.finishedAt.toISOString(),
  };
}
