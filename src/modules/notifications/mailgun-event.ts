import { ENVIRONMENT_TAG_PREFIX } from "@/infrastructure/email/mailgun-adapter";
import type { MailgunSignature } from "@/infrastructure/email/mailgun-webhook";
import { redactProviderText } from "@/infrastructure/email/redact";
import { enhancedStatusTextIn, rejectionCause } from "./domain/rejection-cause";
import type { MailgunDeliveryEvent, MailgunEventType } from "./outbox";

/**
 * What the delivery webhook keeps of one Mailgun event (§NNN; AGENTS.md §16.5), read from its JSON:
 * its kind, its instant (`timestamp`), whom it is about (`recipient` — compared with the row's, never
 * stored or logged), the delivery status's codes and words — redacted before anything stores them, of
 * any address, the recipient's local part, an IP literal and a token-length run, and cut to 200
 * characters —, Mailgun's one-word reason, and the row's own key it carried (`user-variables`). Never the
 * message, its headers beyond the id, the MX host, the sending IP, a geolocation or a client: what the
 * privacy notice calls «starea trimiterii». Every field may be missing — Mailgun's own SDKs mark most of
 * them optional, and older payloads lack the enhanced code — and a missing one is simply not known.
 */
export type MailgunWebhookPayload = {
  signature?: MailgunSignature;
  "event-data"?: {
    event?: unknown;
    timestamp?: unknown;
    recipient?: unknown;
    reason?: unknown;
    severity?: unknown;
    tags?: unknown;
    message?: { headers?: { "message-id"?: unknown } | null } | null;
    "user-variables"?: Record<string, unknown> | null;
    "delivery-status"?: {
      code?: unknown;
      "enhanced-code"?: unknown;
      message?: unknown;
      description?: unknown;
      "last-code"?: unknown;
      "last-message"?: unknown;
    } | null;
  } | null;
};

type EventData = NonNullable<MailgunWebhookPayload["event-data"]>;

const text = (value: unknown): string | null => (typeof value === "string" && value.trim() !== "" ? value.trim() : null);

/** A code Mailgun sends as a number, or as text: «550». */
const codeOf = (value: unknown): string | null =>
  typeof value === "number" && Number.isFinite(value)
    ? String(Math.trunc(value))
    : typeof value === "string" && /^\d{3}$/.test(value.trim())
      ? value.trim()
      : null;

/**
 * The codes and the words of one event's delivery status: «550 5.1.1» and the server's sentence. A final
 * `old` failure carries the last deferral's own as `last-code` and `last-message` — a full mailbox reads
 * as one, not as a give-up.
 */
export function deliveryStatusOf(eventData: EventData | null | undefined, recipient: string | null): { code: string | null; detail: string | null } {
  const status = eventData?.["delivery-status"] ?? null;
  if (!status) return { code: null, detail: null };
  const words = text(status.message) ?? text(status.description) ?? text(status["last-message"]);
  const basic = codeOf(status.code) ?? codeOf(status["last-code"]);
  // Mailgun's own field when it sends one, else the code standing alone in the words — never three parts of
  // an IP literal the words quote (`enhancedStatusTextIn`, the one pattern `rejectionCause` reads too).
  const enhanced = text(status["enhanced-code"])?.match(/^[245]\.\d{1,3}\.\d{1,3}$/)?.[0] ?? enhancedStatusTextIn(words);
  const code = [basic, enhanced].filter(Boolean).join(" ");
  const detail = words ? redactProviderText(words, { recipient }) : "";
  return { code: code === "" ? null : code.slice(0, 20), detail: detail === "" ? null : detail };
}

/** Mailgun's instant for the event: seconds since the epoch, with a fraction. */
function instantOf(value: unknown): Date | null {
  const seconds = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(seconds) && seconds > 0 ? new Date(Math.round(seconds * 1000)) : null;
}

/**
 * Whether an event's tags name another deployment's message (`env:qa` on production's webhook, and the
 * reverse; the adapter tags every message with its own, `mailgun-adapter.ts`). An untagged event — a
 * message sent before the tag existed — is everyone's, as every event was before.
 */
export function taggedForAnotherEnvironment(tags: unknown, environment: string): boolean {
  if (!Array.isArray(tags)) return false;
  const named = tags.filter((tag): tag is string => typeof tag === "string" && tag.startsWith(ENVIRONMENT_TAG_PREFIX));
  return named.length > 0 && !named.includes(`${ENVIRONMENT_TAG_PREFIX}${environment}`);
}

/** Mailgun's reason is one word of its own vocabulary (`bounce`, `suppress-bounce`, `old`): kept as it is. */
const REASON_TOKEN = /^[a-z][a-z0-9-]{0,39}$/i;

/** The event the outbox applies, from a verified payload; null when it names no message. */
export function deliveryEventOf(body: MailgunWebhookPayload, now: Date): MailgunDeliveryEvent | null {
  const eventData = body["event-data"] ?? null;
  const event = text(eventData?.event) as MailgunEventType | null;
  const providerMessageId = text(eventData?.message?.headers?.["message-id"]);
  const idempotencyKey = text(eventData?.["user-variables"]?.idempotency_key);
  if (!event || (!providerMessageId && !idempotencyKey)) return null;
  const recipient = text(eventData?.recipient);
  const { code, detail } = deliveryStatusOf(eventData, recipient);
  const rawReason = text(eventData?.reason);
  // What `last_error` keeps: Mailgun's word as it is, anything else through the same redactor.
  const reason = rawReason === null ? null : REASON_TOKEN.test(rawReason) ? rawReason : redactProviderText(rawReason, { recipient }) || null;
  const severity = text(eventData?.severity);
  /*
    The cause is read from the server's own words before the redactor took a name out of them: a
    mailbox called «user» would otherwise turn «User unknown» into «<address> unknown» and lose the
    cause. The words themselves are never kept unredacted — only the one word this yields.
  */
  const rawWords = (() => {
    const status = eventData?.["delivery-status"] ?? null;
    return status ? (text(status.message) ?? text(status.description) ?? text(status["last-message"])) : null;
  })();
  const cause = event === "complained" ? "complained" : rejectionCause({ status: "BOUNCED", sent: true, reason: rawReason, code, detail: rawWords });
  return {
    providerMessageId,
    idempotencyKey,
    event,
    reason,
    // `failed` alone does not say whether the provider has given up; this does.
    severity,
    recipient,
    occurredAt: instantOf(eventData?.timestamp),
    code,
    detail,
    cause,
    now,
  };
}
