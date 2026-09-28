import type { emailOutbox } from "@/db/schema/email-outbox";
import type { Database } from "@/db/types";
import { type OutboxBatchSummary, OUTBOX_BATCH_SIZE, processOutboxBatch } from "./outbox";
import { createOutboxSender } from "./outbox-sender";
import { createOutboxRenderer } from "./render";

/** Ten batches of twenty: two hundred rows, more than any event's list; the rest is the outbox job's. */
const MAX_BATCHES = 10;

/**
 * Sends exactly these rows now (§NNN, `send-at-once.ts`), in the order they were queued, batch after
 * batch until none is left to claim — the worker every other sender runs (§16.2), limited to the ids.
 * Called after a press's response (`drainOutboxRowsAfterResponse`), and by the tests. Its own file,
 * imported only inside the drain's `after()`: the renderer it needs reads the registrations module,
 * which imports the press's half.
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
    });
    if (summary.claimed === 0) break;
    for (const key of Object.keys(total) as (keyof OutboxBatchSummary)[]) total[key] += summary[key];
    // The provider said stop (a spent cap defers the rest, §40): the outbox job takes it from here.
    if (summary.deferred > 0) break;
  }
  return total;
}
