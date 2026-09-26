import { after } from "next/server";
import { getDb } from "@/db/client";
import { wakeJobs } from "@/modules/jobs/schedule-cache";
import { env } from "@/shared/config/env";

/**
 * Send what was just queued, after the response (AGENTS.md §16.2, `DECISIONS.md` §68).
 *
 * The outbox used to wait for the external pinger: a verification email left the building up
 * to five minutes after the click, and keeping that latency bearable meant pinging every five
 * minutes — which keeps a Neon compute awake around the clock, and the Free plan's 100 CU-hours
 * a month run out on about the 17th (QA measured 74 CU-hours by 2026-09-18). So the request
 * that creates a message now also drains the queue, once, after its own response has gone
 * out: `after()` is the platform's hook for exactly this, it extends the function's life on
 * Vercel without delaying the reply, and the pinger becomes the backstop it was always
 * described as — it can run every fifteen minutes, and the compute sleeps between.
 *
 * Not an in-process interval, which serverless has no process for: one shot, per request, for
 * work that request created. Nothing is lost when it fails — the row stays PENDING and the next
 * pinger run or the next request sends it. Concurrent drains are safe by construction
 * (`FOR UPDATE SKIP LOCKED` in `claimOutboxBatch`).
 *
 * Silent outside a request (the tests call `enqueueEmail` directly) and in `test`, where a
 * drain would send through the fake adapter behind a test's back. The outbox and renderer are
 * imported inside the callback: `enqueueEmail` calls this, so a static import here would be a
 * cycle.
 */
export function drainOutboxAfterResponse(): void {
  if (env.APP_ENV === "test") return;
  try {
    after(async () => {
      try {
        const [{ processOutboxBatch }, { createOutboxRenderer }, { readDeliveryTiming }, { nextOutboxWork }, { createOutboxSender }] = await Promise.all([
          import("./outbox"),
          import("./render"),
          import("./delivery-timing"),
          import("@/modules/jobs/next-work"),
          import("./outbox-sender"),
        ]);
        const db = getDb();

        /*
          The club's own choice about when mail leaves (§221).

          Read **inside** `after()`, never at the call site: `enqueueEmail` calls this from
          within the caller's transaction, and a settings read there would put one more query
          between a registration and its commit. Here the response has already gone out and
          the transaction is closed, so the cost is a single indexed lookup on a path that was
          about to open a connection anyway.

          `scheduled` means the request does nothing and the pinger sends — up to fifteen
          minutes later by day (§68). Nothing is lost either way: the row stays PENDING and
          whoever gets there first claims it under `FOR UPDATE SKIP LOCKED`.
        */
        const { timing } = await readDeliveryTiming(db);
        // The pinger sends, so the pinger has to look (§334): the outbox job's cached "nothing
        // due" was written before this row existed.
        if (timing === "scheduled") {
          wakeJobs("email-outbox");
          return;
        }

        // The club's road per group, Gmail's cap and pace (§NNN): read once for the batch.
        const now = new Date();
        const { sender, route } = await createOutboxSender(db, now);
        // One renderer per batch: each event's words are read once for it (§373, email follow-up).
        await processOutboxBatch(db, { sender, route, render: createOutboxRenderer(), now });
        /*
          Whatever the drain could not send — a retry after a transient failure, a row deferred to
          the allowance reset, a batch longer than twenty — is the outbox job's again, and the job
          may be answering "nothing due" from the cache (§334). Told only when it is sooner than a
          real run would find it on its own; a queue the drain emptied tells it nothing.
        */
        const left = await nextOutboxWork(db);
        if (left) wakeJobs("email-outbox", left);
      } catch (error) {
        console.error("[email-outbox] drain after response failed", error);
        wakeJobs("email-outbox");
      }
    });
  } catch {
    // Outside a request scope — a script, a test — there is no "after" and nothing to do.
  }
}
