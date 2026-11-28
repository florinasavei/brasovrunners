import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { deliveryEventsOf, type EventGridEvent, validationCodeOf } from "@/modules/notifications/acs-event";
import { applyMailgunEvent } from "@/modules/notifications/outbox";
import { env } from "@/shared/config/env";

/**
 * Azure Communication Services' delivery webhook, through Event Grid (`docs/AZURE.md` Part 1).
 *
 * Event Grid does not sign a delivery as Mailgun does, so the subscription's URL carries a long
 * random key (`?key=`, `ACS_WEBHOOK_KEY`) and a request without it is refused — refused for lacking
 * a key altogether until the variable is set, as the Mailgun route is. The first request Event Grid
 * sends is its validation handshake, answered with its own code. Every other event is mapped onto the
 * outbox's delivery event (`acs-event.ts`) and applied by the code the Mailgun webhook uses. Each
 * environment has its own Azure resource and its own subscription, so no environment tag is needed.
 */
export async function POST(request: Request): Promise<Response> {
  if (!env.ACS_WEBHOOK_KEY) return NextResponse.json({ error: "NOT_CONFIGURED" }, { status: 503 });

  const key = new URL(request.url).searchParams.get("key") ?? "";
  if (!sameKey(key, env.ACS_WEBHOOK_KEY)) return NextResponse.json({ error: "INVALID_KEY" }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "MALFORMED" }, { status: 400 });
  }
  const events: EventGridEvent[] = Array.isArray(body) ? (body as EventGridEvent[]) : [];

  const validationCode = validationCodeOf(events);
  if (validationCode) return NextResponse.json({ validationResponse: validationCode });

  const db = getDb();
  for (const event of deliveryEventsOf(events, new Date())) await applyMailgunEvent(db, event);
  return NextResponse.json({ ok: true });
}

function sameKey(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
