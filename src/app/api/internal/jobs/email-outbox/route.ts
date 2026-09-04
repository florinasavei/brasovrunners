import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { isAuthorizedJobRequest } from "@/modules/jobs/auth";
import { renderOutboxMessage } from "@/modules/notifications/render";
import { processOutboxBatch } from "@/modules/notifications/outbox";
import { env } from "@/shared/config/env";
import { createEmailSenderForEnvironment } from "@/infrastructure/email/sender";

/**
 * The email outbox job (AGENTS.md §16.1, §16.2). External watchdog layer, at roughly one to
 * five minutes — see `registration-maintenance/route.ts` for why there is no in-process
 * interval: this application deploys to Vercel serverless functions (AGENTS.md §7), which have
 * no persistent process for an interval to live in, so the external scheduler is not a
 * fallback here, it is the only mechanism.
 */
export async function POST(request: Request): Promise<Response> {
  if (!isAuthorizedJobRequest(request)) {
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  }

  const { sender } = createEmailSenderForEnvironment(env);
  const summary = await processOutboxBatch(getDb(), {
    sender,
    render: renderOutboxMessage,
    now: new Date(),
  });

  return NextResponse.json(summary);
}
