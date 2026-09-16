import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Job runs (AGENTS.md §12.12, §16.2).
 *
 * Exists so a stalled scheduler is visible rather than silently correctness-affecting. It is
 * not a correctness mechanism itself — §16.2 is explicit that capacity and queue correctness
 * come from transaction-time expiry evaluation (§10.6), never from this table having a recent
 * row. `/api/health` reports degraded when the latest row for a job is older than that job's
 * agreed threshold.
 */
export const jobRuns = pgTable(
  "job_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    jobName: text("job_name").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    itemsProcessed: integer("items_processed").notNull().default(0),
    errorCount: integer("error_count").notNull().default(0),
    lastError: text("last_error"),
  },
  (t) => [
    index("job_runs_job_name_started_at_idx").on(t.jobName, t.startedAt),
    check("job_runs_items_processed_non_negative", sql`${t.itemsProcessed} >= 0`),
    check("job_runs_error_count_non_negative", sql`${t.errorCount} >= 0`),
  ],
);

export type JobRun = typeof jobRuns.$inferSelect;
