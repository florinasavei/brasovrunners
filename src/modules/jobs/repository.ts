import { eq } from "drizzle-orm";
import { jobRuns } from "@/db/schema/job-runs";
import type { Database } from "@/db/types";

/**
 * `job_runs` bookkeeping (AGENTS.md §12.12, §16.2) — a liveness record, not a correctness one.
 * `/api/health` reads the latest row per job name to report a stalled scheduler; nothing else
 * in the application reads this table.
 */

export async function startJobRun<T extends Record<string, unknown>>(
  db: Database<T>,
  jobName: string,
  now: Date,
): Promise<string> {
  const [row] = await db.insert(jobRuns).values({ jobName, startedAt: now }).returning({ id: jobRuns.id });
  return row.id;
}

export async function finishJobRun<T extends Record<string, unknown>>(
  db: Database<T>,
  id: string,
  result: { itemsProcessed: number; errorCount: number; lastError?: string | null },
  now: Date,
): Promise<void> {
  await db
    .update(jobRuns)
    .set({
      finishedAt: now,
      itemsProcessed: result.itemsProcessed,
      errorCount: result.errorCount,
      lastError: result.lastError ?? null,
    })
    .where(eq(jobRuns.id, id));
}
