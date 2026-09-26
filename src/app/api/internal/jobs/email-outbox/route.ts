import { answerJobPing } from "@/modules/jobs/ping";

/**
 * The email outbox job (AGENTS.md §16.1, §16.2). The request that queues a message drains the
 * outbox after its own response (§68, `notifications/drain.ts`); this endpoint is what the
 * external pinger and the GitHub backstop post to for everything that drain leaves behind — a
 * retry after a transient failure, a row deferred to the allowance reset, a batch longer than
 * twenty, or every message when the club chose "scheduled" delivery (§221).
 *
 * Since §334 a ping with nothing claimable answers from Next's data cache without waking the
 * database: the last real run left the soonest instant a row becomes claimable, and the drain
 * that leaves a row behind forgets that promise (`wakeJobs`), so the next ping runs for real.
 *
 * Throttled as well as authenticated (§19.4). `JOB_SECRET` says who is calling and nothing about
 * how often, and this is the endpoint where that gap costs the most: an unlimited drain is every
 * message the club will ever send, and Mailgun's daily allowance spent by somebody who is not the
 * club (`docs/PLATFORM.md`, limit 1 of the four).
 */
export async function POST(request: Request): Promise<Response> {
  return answerJobPing(request, "email-outbox", async (db, now) => {
    // Imported here, not above: a ping that answers from the cache never loads the sender.
    const [{ processOutboxBatch }, { createOutboxRenderer }, { createOutboxSender }] = await Promise.all([
      import("@/modules/notifications/outbox"),
      import("@/modules/notifications/render"),
      import("@/modules/notifications/outbox-sender"),
    ]);
    // The club's road per group, read once for the batch (§NNN); Gmail's cap and pace from the database before each Gmail message.
    const { sender, route, roads } = await createOutboxSender(db);
    // One renderer per batch: each event's words are read once for it (§373, email follow-up).
    const summary = await processOutboxBatch(db, { sender, route, roads, render: createOutboxRenderer(), now });
    return { summary, failed: false };
  });
}
