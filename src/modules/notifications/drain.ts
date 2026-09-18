import { after } from "next/server";
import { getDb } from "@/db/client";
import { createEmailSenderForEnvironment } from "@/infrastructure/email/sender";
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
        const [{ processOutboxBatch }, { renderOutboxMessage }] = await Promise.all([
          import("./outbox"),
          import("./render"),
        ]);
        const { sender } = createEmailSenderForEnvironment(env);
        await processOutboxBatch(getDb(), { sender, render: renderOutboxMessage, now: new Date() });
      } catch (error) {
        console.error("[email-outbox] drain after response failed", error);
      }
    });
  } catch {
    // Outside a request scope — a script, a test — there is no "after" and nothing to do.
  }
}
