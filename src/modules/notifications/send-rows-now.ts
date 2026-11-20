import type { emailOutbox } from "@/db/schema/email-outbox";
import type { Database } from "@/db/types";
import { type OutboxBatchSummary, OUTBOX_BATCH_SIZE, OUTBOX_SUMMARY_COUNTS, processOutboxBatch } from "./outbox";
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
    for (const key of OUTBOX_SUMMARY_COUNTS) total[key] += summary[key];
    // Gmail carried for a stopped Mailgun (§622): the press's own rows left that way, said with the stop.
    if (summary.carried) total.carried = { stop: summary.carried.stop, viaGmail: (total.carried?.viaGmail ?? 0) + summary.carried.viaGmail };
    // A batch that was not full took the last of the press's rows: no empty batch after it.
    if (summary.claimed < OUTBOX_BATCH_SIZE) break;
    // The provider said stop (a spent cap defers the rest, §40): the outbox job takes it from here.
    if (summary.deferred > 0) break;
  }
  return total;
}

/**
 * The longest a press's drain waits for its rows' turn (§1021): the club's invitation, let go a minute and a half after
 * Zitadel answered (`INVITATION_GAP_MS`), with half a minute to spare for the press's own work after the release. A turn
 * further away is not waited for: the rows stay PENDING and due at that turn, for the outbox job.
 */
export const TURN_WAIT_MAX_MS = 120_000;

/** The clock a wait reads, and how it sleeps: the real ones, or a test's. */
export type TurnClock = { now: () => Date; sleep: (ms: number) => Promise<void> };

const REAL_CLOCK: TurnClock = { now: () => new Date(), sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) };

/**
 * A press's own rows sent at their turn (§1021, amending §1000): one wait — up to `TURN_WAIT_MAX_MS` — until `dueAt`, the last
 * of the rows' turns (a members' press waits once, for its last member), then exactly these rows, `SEND_NOW_ROW_LIMIT` at a
 * time, by the worker «Trimite acum» runs (`sendOutboxRowsNow`, §540) — whatever «Când pleacă emailurile» says. The claim's
 * instant is never before `dueAt`, so a timer that fires a moment early still finds the rows due; a row not yet due is never
 * claimed by any drain, the job included, because every claim honours `next_attempt_at`.
 *
 * Null when the turn is too far to wait for: nothing was sent. A wait that never ends — the platform stopped the function
 * first — sends nothing either, and the rows stay PENDING and due at their turn, for the outbox job's next pass. Called inside
 * the press's `after()` (`drain.ts#drainOutboxRowsAtTurnAfterResponse`), and by the tests with a clock of their own.
 */
export async function sendOutboxRowsAtTurn(
  db: Database<{ emailOutbox: typeof emailOutbox }>,
  ids: readonly string[],
  dueAt: Date,
  clock: TurnClock = REAL_CLOCK,
): Promise<OutboxBatchSummary | null> {
  const total: OutboxBatchSummary = { claimed: 0, sent: 0, retrying: 0, deferred: 0, failed: 0, bounced: 0 };
  if (ids.length === 0) return total;
  const wait = dueAt.getTime() - clock.now().getTime();
  if (wait > TURN_WAIT_MAX_MS) return null;
  if (wait > 0) await clock.sleep(wait);
  const at = new Date(Math.max(clock.now().getTime(), dueAt.getTime()));
  for (let start = 0; start < ids.length; start += SEND_NOW_ROW_LIMIT) {
    const summary = await sendOutboxRowsNow(db, ids.slice(start, start + SEND_NOW_ROW_LIMIT), at);
    for (const key of OUTBOX_SUMMARY_COUNTS) total[key] += summary[key];
    if (summary.carried) total.carried = { stop: summary.carried.stop, viaGmail: (total.carried?.viaGmail ?? 0) + summary.carried.viaGmail };
    // The provider said stop: the outbox job takes the rest, as after «Trimite acum».
    if (summary.deferred > 0) break;
  }
  return total;
}
