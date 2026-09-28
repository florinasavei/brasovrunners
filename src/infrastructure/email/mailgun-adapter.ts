import type { EmailAdapter, OutgoingEmail, SendResult } from "./adapter";

/**
 * Mailgun over its HTTP API with `fetch`, no SDK (AGENTS.md §16, §1.5; BR-REQ-080-01, BR-REQ-080-03).
 * The API base, domain and sender come from configuration, never literals (AGENTS.md §8).
 * The status mapping is `classifyMailgunFailure`; anything not clearly the caller's fault is
 * retried, since retrying hard rejections ruins the domain's reputation (§16.1, §16.5).
 */

export type MailgunConfig = {
  apiKey: string;
  /** The verified sending domain — a sandbox while testing, the club's domain in production. */
  domain: string;
  /** Mailgun's API base (AGENTS.md §8); the EU region is a different host. */
  apiBaseUrl: string;
  /** `Brașov Runners <noreply@…>`, assembled in `sender.ts` from configuration. */
  from: string;
  /** Where a reply goes; absent, it goes to `from`, which for `noreply@` is nowhere. */
  replyTo?: string;
};

/** Longer than this and the message is stuck behind a provider that is not answering. */
const REQUEST_TIMEOUT_MS = 15_000;

/**
 * A 400 body saying the account's allowance is spent (Mailgun uses the same 400 for a bad message).
 * Narrow on purpose: a false positive retries a bad message daily forever. "not allowed to send"
 * alone also means a disabled domain, and sandbox refusals must stay permanent.
 */
const ALLOWANCE_SPENT = /limit exceeded|exceeded your|sending limit|daily limit|quota/i;

/** Which refusals are final, which are the allowance (deferred, §40), and which retry soon. */
export function classifyMailgunFailure(
  status: number,
  body: string,
): "permanent_failure" | "throttled" | "transient_failure" {
  // Credentials, or a sending domain that is not verified. Every retry fails identically.
  if (status === 401 || status === 403) return "permanent_failure";

  // 420: spent allowance; 402: plan/payment. Undocumented by Mailgun, observed in practice.
  if (status === 402 || status === 420) return "throttled";

  // The hourly rate limit clears within the hour: ordinary backoff, not a daily deferral.
  if (status === 429) return "transient_failure";

  if (status === 400) {
    return ALLOWANCE_SPENT.test(body) ? "throttled" : "permanent_failure";
  }

  // 404, 5xx, anything unrecognised: not clearly the caller's fault, so retried.
  return "transient_failure";
}

type MailgunAccepted = { id?: string; message?: string };

/**
 * Strip the send response's angle brackets from the id: the webhook reports it without them,
 * and `applyMailgunEvent` matches exactly (AGENTS.md §16.5).
 */
function normalizeProviderMessageId(id: string | undefined): string | undefined {
  const trimmed = id?.trim();
  if (!trimmed) return undefined;
  return trimmed.startsWith("<") && trimmed.endsWith(">")
    ? trimmed.slice(1, -1)
    : trimmed;
}

/** Anything shaped like an address; greedy on purpose, since a miss stores somebody's address. */
const EMAIL_SHAPED = /[^\s<>"']+@[^\s<>"']+\.[^\s<>"',;)]+/g;

/**
 * Make a provider message safe for `email_outbox.last_error` (§14.5): redact the key and any
 * address, since Mailgun's refusals can echo the recipient.
 */
function sanitizeError(status: number, body: string, apiKey: string): string {
  const redacted = body
    .replace(/\s+/g, " ")
    .replaceAll(apiKey, "<redacted>")
    .replace(EMAIL_SHAPED, "<address>");

  return `mailgun ${status}: ${redacted.slice(0, 200)}`;
}

export function createMailgunAdapter(config: MailgunConfig): EmailAdapter {
  // Basic auth `api:<key>`; built once, never logged or exposed.
  const authorization = `Basic ${Buffer.from(`api:${config.apiKey}`).toString("base64")}`;
  const endpoint = `${config.apiBaseUrl.replace(/\/+$/, "")}/${config.domain}/messages`;

  return {
    name: "mailgun",

    async send(message: OutgoingEmail): Promise<SendResult> {
      const form = new FormData();
      form.set("from", config.from);
      form.set("to", message.to);
      // Repeated fields for several recipients; a `bcc` appears nowhere on the message (§244).
      for (const address of message.cc ?? []) form.append("cc", address);
      for (const address of message.bcc ?? []) form.append("bcc", address);
      form.set("subject", message.subject);
      form.set("text", message.text);
      form.set("html", message.html);
      /*
        No open or click tracking (§320): click tracking would route action tokens through
        Mailgun's redirect host, and the privacy notice promises no tracking. Per-message options
        override the domain's setting.
      */
      form.set("o:tracking", "no");
      form.set("o:tracking-clicks", "no");
      form.set("o:tracking-opens", "no");
      if (config.replyTo) form.set("h:Reply-To", config.replyTo);
      for (const attachment of message.attachments ?? []) {
        form.append("attachment", new Blob([new Uint8Array(attachment.data)], { type: attachment.contentType }), attachment.filename);
      }

      // Returned in webhooks as `user-variables`, so tracing a row does not depend on the provider id (§16.5).
      form.set("v:idempotency_key", message.idempotencyKey);
      // Mailgun allows three tags; per-locale statistics is the only one needed.
      form.set("o:tag", `locale:${message.locale}`);

      let response: Response;
      try {
        response = await fetch(endpoint, {
          method: "POST",
          headers: { Authorization: authorization },
          body: form,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (error) {
        // DNS, TLS, a timeout, a dropped connection: none says the message is bad.
        return {
          outcome: "transient_failure",
          error: `mailgun unreachable: ${error instanceof Error ? error.name : "unknown"}`,
        };
      }

      if (response.ok) {
        const accepted = (await response.json().catch(() => ({}))) as MailgunAccepted;
        return {
          outcome: "sent",
          // Fallback so an unexpected response shape is still a send, not an exception.
          providerMessageId:
            normalizeProviderMessageId(accepted.id) ?? `mailgun:${message.idempotencyKey}`,
        };
      }

      const body = await response.text().catch(() => "");

      return {
        outcome: classifyMailgunFailure(response.status, body),
        error: sanitizeError(response.status, body, config.apiKey),
      };
    },
  };
}
