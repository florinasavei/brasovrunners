import type { emailOutbox } from "@/db/schema/email-outbox";
import type { Database } from "@/db/types";
import { type OutboxBatchSummary, OUTBOX_BATCH_SIZE, processOutboxBatch } from "./outbox";
import { SEND_NOW_ROW_LIMIT } from "./domain/send-at-once";
import { createOutboxSender } from "./outbox-sender";
import { createOutboxRenderer } from "./render";

/**
 * Two batches of twenty: `SEND_NOW_ROW_LIMIT` (forty) rows, twice what the ordinary drain after a
 * response sends (one batch, `drain.ts`). One person's resend is one row and its club copies; an
 * organizer's message to a long list marks and hands over only its first forty
 * (`sendNowSplit`), and the rest wait for the outbox job's next pass. The bound keeps the `after()`
 * short: a function stopped mid-batch leaves its rows PROCESSING until the lock times out and the
 * job sends them again, and the fewer rows one call holds, the fewer a stop can send twice (§540 review).
 */
const MAX_BATCHES = Math.ceil(SEND_NOW_ROW_LIMIT / OUTBOX_BATCH_SIZE);

/**
 * Sends exactly these rows now (§540, `send-at-once.ts`), in the order they were queued, up to
 * `MAX_BATCHES` batches — the worker every other sender runs (§16.2), limited to the ids. Not a run
 * of the outbox job: no `job_runs` row is written (`recordRun: false`), so «Ultima trecere
 * programată», the next round, the health check and the jobs' overview still say the scheduler's
 * own passes. Called after a press's response (`drainOutboxRowsAfterResponse`), and by the tests.
 * Its own file, imported only inside the drain's `after()`: the renderer it needs reads the
 * registrations module, which imports the press's half.
 */
export async function sendOutboxRowsNow(
  // What the worker reads; any fuller schema — the app's, the tests' — fits (as `send-now.ts`).
  db: Database<{ emailOutbox: typeof emailOutbox }>,
  ids: readonly string[],
  now: Date,
): Promise<OutboxBatchSummary> {
  const total: OutboxBatchSummary = { claimed: 0, sent: 0, retrying: 0, deferred: 0, failed: 0, bounced: 0 };
  if (ids.length === 0) return total;
  // The club's road per group and the Reply-To it chose to show (§442), once for the press.
  const { sender, route, roads, replyTo } = await createOutboxSender(db);
  for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
    const summary = await processOutboxBatch(db, {
      sender,
      route,
      roads,
      render: createOutboxRenderer({ replyTo }),
      now,
      batchSize: OUTBOX_BATCH_SIZE,
      ids,
      recordRun: false,
    });
    for (const key of Object.keys(total) as (keyof OutboxBatchSummary)[]) total[key] += summary[key];
    // A batch that was not full took the last of the press's rows: no empty batch after it.
    if (summary.claimed < OUTBOX_BATCH_SIZE) break;
    // The provider said stop (a spent cap defers the rest, §40): the outbox job takes it from here.
    if (summary.deferred > 0) break;
  }
  return total;
}
