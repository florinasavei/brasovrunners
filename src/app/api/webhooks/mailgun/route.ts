import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { isValidMailgunSignature, type MailgunSignature } from "@/infrastructure/email/mailgun-webhook";
import { applyMailgunEvent, type MailgunEventType } from "@/modules/notifications/outbox";
import { env } from "@/shared/config/env";

/**
 * The Mailgun delivery webhook (AGENTS.md §16.5). Not reachable to any effect until Mailgun is
 * actually wired (`infrastructure/email/mailgun-adapter.ts` — declared, deliberately not
 * connected) and `MAILGUN_WEBHOOK_SIGNING_KEY` is configured; until then every request is
 * refused for lacking a signing key, which is the correct behavior for an endpoint nothing
 * should be calling yet.
 */
export async function POST(request: Request): Promise<Response> {
  if (!env.MAILGUN_WEBHOOK_SIGNING_KEY) {
    return NextResponse.json({ error: "NOT_CONFIGURED" }, { status: 503 });
  }

  let body: {
    signature?: MailgunSignature;
    "event-data"?: {
      event?: string;
      message?: { headers?: { "message-id"?: string } };
      reason?: string;
      severity?: string;
    };
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "MALFORMED" }, { status: 400 });
  }

  if (!body.signature || !isValidMailgunSignature(env.MAILGUN_WEBHOOK_SIGNING_KEY, body.signature)) {
    // No detail in the response: §16.5 asks that a stale or malformed request be rejected,
    // not explained — the same reasoning §13.2 gives for a generic invalid-token page.
    return NextResponse.json({ error: "INVALID_SIGNATURE" }, { status: 401 });
  }

  const eventData = body["event-data"];
  const providerMessageId = eventData?.message?.headers?.["message-id"];
  const event = eventData?.event as MailgunEventType | undefined;

  if (providerMessageId && event) {
    await applyMailgunEvent(getDb(), {
      providerMessageId,
      event,
      // Sanitized: a short reason, never Mailgun's full event payload or a message body
      // (§14.5, and `outbox.ts`'s own `sanitizeProviderError` reasoning).
      reason: typeof eventData?.reason === "string" ? eventData.reason.slice(0, 200) : null,
      // `failed` alone does not say whether the provider has given up; this does.
      severity: typeof eventData?.severity === "string" ? eventData.severity : null,
    });
  }

  return NextResponse.json({ ok: true });
}
