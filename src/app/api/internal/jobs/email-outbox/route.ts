import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { isAuthorizedJobRequest } from "@/modules/jobs/auth";
import { renderOutboxMessage } from "@/modules/notifications/render";
import { processOutboxBatch } from "@/modules/notifications/outbox";
import { consumeRateLimit } from "@/modules/rate-limit/service";
import { env } from "@/shared/config/env";
import { createEmailSenderForEnvironment } from "@/infrastructure/email/sender";

/**
 * The email outbox job (AGENTS.md §16.1, §16.2). External watchdog layer, at roughly one to
 * five minutes — see `registration-maintenance/route.ts` for why there is no in-process
 * interval: this application deploys to Vercel serverless functions (AGENTS.md §7), which have
 * no persistent process for an interval to live in, so the external scheduler is not a
 * fallback here, it is the only mechanism.
 *
 * Throttled as well as authenticated (§19.4). `JOB_SECRET` says who is calling and said
 * nothing at all about how often, and this is the endpoint where that gap costs the most: an
 * unlimited drain is every message the club will ever send, and Mailgun's daily allowance
 * spent by somebody who is not the club (`docs/PLATFORM.md`, limit 1 of the four).
 */
export async function POST(request: Request): Promise<Response> {
  if (!isAuthorizedJobRequest(request)) {
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  }

  const db = getDb();
  const now = new Date();

  // After the secret check, never before it: a bucket an unauthenticated caller can fill is a
  // way to switch the scheduler off, which is worse than the flood it would be refusing.
  const verdict = await consumeRateLimit(db, "job-invoke", "email-outbox", now);
  if (!verdict.allowed) {
    return NextResponse.json(
      { error: "RATE_LIMITED" },
      { status: 429, headers: { "Retry-After": String(verdict.retryAfter) } },
    );
  }

  const { sender } = createEmailSenderForEnvironment(env);
  const summary = await processOutboxBatch(db, {
    sender,
    render: renderOutboxMessage,
    now,
  });

  return NextResponse.json(summary);
}
