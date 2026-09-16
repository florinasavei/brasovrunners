import { desc, eq } from "drizzle-orm";
import { jobRuns } from "@/db/schema/job-runs";
import type { Database } from "@/db/types";

/**
 * Job liveness thresholds (AGENTS.md §12.12, §16.2): "the health check reports degraded when
 * the last successful run of a job is older than its agreed threshold." Matches §16.2's
 * watchdog cadence — roughly five minutes for maintenance, one to five for the outbox — with
 * headroom so one slow run does not flip the check before the next one has even had a chance.
 */
export const JOB_STALENESS_THRESHOLDS_MS: Record<string, number> = {
  "registration-maintenance": 15 * 60_000,
  "email-outbox": 15 * 60_000,
};

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

  const threshold = JOB_STALENESS_THRESHOLDS_MS[jobName] ?? 15 * 60_000;
  const stale = now.getTime() - latest.finishedAt.getTime() > threshold;

  return {
    jobName,
    status: stale ? "stale" : "ok",
    lastFinishedAt: latest.finishedAt.toISOString(),
  };
}
