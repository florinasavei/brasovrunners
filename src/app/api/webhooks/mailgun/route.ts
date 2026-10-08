import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { isValidMailgunSignature } from "@/infrastructure/email/mailgun-webhook";
import { deliveryEventOf, type MailgunWebhookPayload, taggedForAnotherEnvironment } from "@/modules/notifications/mailgun-event";
import { applyMailgunEvent } from "@/modules/notifications/outbox";
import { env } from "@/shared/config/env";

/**
 * The Mailgun delivery webhook (AGENTS.md §16.5): `delivered`, a permanent failure and a complaint, for
 * the outbox row whose message they are about. Refused for lacking a signing key until
 * `MAILGUN_WEBHOOK_SIGNING_KEY` is configured, which is the correct behaviour for an endpoint nothing
 * should be calling yet. What is kept of an event, and how it is redacted first, is
 * `notifications/mailgun-event.ts` (§NNN); what it does to the row, `applyMailgunEvent`.
 *
 * An event tagged for another deployment is answered without touching the database: QA and production
 * share the sending domain and its webhooks, and a delivery of a QA message must not wake production's.
 */
export async function POST(request: Request): Promise<Response> {
  if (!env.MAILGUN_WEBHOOK_SIGNING_KEY) {
    return NextResponse.json({ error: "NOT_CONFIGURED" }, { status: 503 });
  }

  let body: MailgunWebhookPayload;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "MALFORMED" }, { status: 400 });
  }

  if (!body?.signature || !isValidMailgunSignature(env.MAILGUN_WEBHOOK_SIGNING_KEY, body.signature)) {
    // No detail in the response: §16.5 asks that a stale or malformed request be rejected,
    // not explained — the same reasoning §13.2 gives for a generic invalid-token page.
    return NextResponse.json({ error: "INVALID_SIGNATURE" }, { status: 401 });
  }

  // Another deployment's message: answered, never looked up (§NNN).
  if (taggedForAnotherEnvironment(body["event-data"]?.tags, env.APP_ENV)) return NextResponse.json({ ok: true });

  const event = deliveryEventOf(body, new Date());
  if (event) await applyMailgunEvent(getDb(), event);

  return NextResponse.json({ ok: true });
}
