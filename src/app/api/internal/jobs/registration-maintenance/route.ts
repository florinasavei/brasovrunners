import { answerJobPing } from "@/modules/jobs/ping";

/**
 * The registration maintenance job (AGENTS.md §16.2), posted by the external pinger every
 * fifteen minutes by day and hourly at night, and by the GitHub backstop.
 *
 * Most pings find nothing to do, and since §334 they say so from Next's data cache without
 * waking the database: the last real run left "nothing due until" — its soonest hold or offer
 * deadline, reminder, window or close, never more than an hour ahead — and a ping before that
 * instant answers with it (`modules/jobs/ping.ts`). Skipping is safe because a lapsed hold or
 * offer is lapsed on every read whether or not this job has run (§10.6); what a skipped run can
 * delay is a message or a hand-over to the waiting list, never a place.
 *
 * Authenticated first, throttled (§19.4) in its own bucket before any real run: a maintenance
 * run that is being hammered must not stop confirmations going out, and the two endpoints have
 * no reason to spend each other's allowance.
 */
export async function POST(request: Request): Promise<Response> {
  return answerJobPing(request, "registration-maintenance", async (db, now) => {
    // Imported here, not above: a ping that answers from the cache never loads the job.
    const { runRegistrationMaintenance } = await import("@/modules/registrations/maintenance");
    const result = await runRegistrationMaintenance(db, now);
    return { summary: result, failed: result.retryableErrorCount > 0 };
  });
}
