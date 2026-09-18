import { desc, eq } from "drizzle-orm";
import { jobRuns } from "@/db/schema/job-runs";
import type { Database } from "@/db/types";
import { jobStalenessThresholdMs } from "./quiet-hours";

/**
 * Job liveness (AGENTS.md §12.12, §16.2): "the health check reports degraded when the last
 * successful run of a job is older than its agreed threshold." The threshold follows the
 * monitor cadence in force — fifteen minutes by day, hourly at night, club time
 * (`quiet-hours.ts`, `DECISIONS.md` §68) — as twice the cadence plus a run, so one slow run
 * never flips the check before the next has had a chance. Both jobs share it.
 */

export type JobHealth = { jobName: string; status: "ok" | "stale" | "never_run"; lastFinishedAt: string | null };

export async function checkJobHealth<T extends Record<string, unknown>>(
  db: Database<T>,
  jobName: string,
  now: Date,
): Promise<JobHealth> {
  const [latest] = await db
    .select({ finishedAt: jobRuns.finishedAt, startedAt: jobRuns.startedAt })
    .from(jobRuns)
    .where(eq(jobRuns.jobName, jobName))
    .orderBy(desc(jobRuns.startedAt))
    .limit(1);

  if (!latest?.finishedAt) {
    return { jobName, status: "never_run", lastFinishedAt: null };
  }

  const stale = now.getTime() - latest.finishedAt.getTime() > jobStalenessThresholdMs(now);

  return {
    jobName,
    status: stale ? "stale" : "ok",
    lastFinishedAt: latest.finishedAt.toISOString(),
  };
}
