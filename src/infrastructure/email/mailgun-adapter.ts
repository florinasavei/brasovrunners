import type { EmailAdapter, OutgoingEmail, SendResult } from "./adapter";

/**
 * Mailgun, over its HTTP API (AGENTS.md §16; BR-REQ-080-01, BR-REQ-080-03).
 *
 * `fetch` and `FormData`, no SDK. AGENTS.md §1.5 ranks "prefer nothing, then the platform,
 * then what is already installed" above convenience, and what the official client would add
 * here is a dependency, a bundled HTTP stack and its own error shapes in exchange for four
 * form fields and a status code. Everything Mailgun-specific stays inside this file, which is
 * the promise `adapter.ts` makes: replacing the provider is a new file next to this one and
 * one line in `sender.ts`.
 *
 * ## The one thing that is not obvious: transient versus permanent
 *
 * `SendResult` distinguishes them because the outbox acts on the difference — a transient
 * failure is retried with backoff, a permanent one never is. Retrying a hard rejection six
 * times is how a sending domain's reputation is destroyed (§16.1, §16.5), so the mapping is
 * conservative in the safe direction: anything that is not clearly the caller's fault is
 * treated as transient and tried again.
 *
 * - **2xx** — queued. Mailgun's `id` becomes `providerMessageId`, which is what a later
 *   webhook is matched against.
 * - **401, 403** — permanent. Bad credentials or an unverified sending domain: every retry
 *   fails identically, and the deployment needs a person, not another attempt.
 * - **400** — permanent, *unless the body says the allowance is spent*. See below; this is the
 *   one that was wrong. Otherwise a malformed message, an unauthorized sandbox recipient, an
 *   address Mailgun refuses — retrying an unchanged message already refused is pointless.
 * - **402, 420** — throttled. Mailgun's own non-standard code for "Domain … is not allowed to
 *   send: recipient limit exceeded" is **420**, and a plan or payment refusal surfaces as 402.
 *   Neither is documented in Mailgun's status-code table, which lists only 400, 401, 403, 404,
 *   429 and 500 — so neither may be inferred from the documentation, and both are handled
 *   because they are observed.
 * - **429** — transient, deliberately *not* throttled. This is Mailgun's per-hour rate limit
 *   (300/hour on a free account), which clears within the hour, so the ordinary one-, two-,
 *   four-minute backoff is the right response and a full-day deferral would be an own goal.
 * - **5xx and any network error** — transient. Outages pass.
 *
 * ## The 400 that is not the caller's fault, and why it mattered
 *
 * Mailgun refuses a send whose account allowance is spent with the *same* 400 it uses for a
 * malformed message: `Domain <domain> is not allowed to send: recipient limit exceeded`. Mapped
 * as a flat permanent failure, that marked every message queued after the cap BOUNCED —
 * terminal, never retried — on the one day of the year the club most needs them: a race opening
 * entries sends three messages per completed registration against a 100/day allowance, so it
 * crosses the cap before lunch (`docs/PLATFORM.md`, limit 1). The messages that would have gone
 * out at midnight were being thrown away instead.
 *
 * So a 400 is checked against `ALLOWANCE_SPENT` before it is called permanent. The pattern is
 * kept **narrow on purpose**: the sandbox's own refusals — "is not among the authorized
 * recipients", "Sandbox subdomains are for test purposes only" — must stay permanent, because
 * no amount of waiting authorizes a recipient, and retrying those daily forever is the
 * reputation cost this file exists to avoid. Limit language only.
 *
 * ## Every hostname here is configuration, never a literal
 *
 * §8 forbids a hostname anywhere under `src/` and exempts no provider. That covers all three
 * of them: the API base, the sending domain, and the sending address itself. They arrive from
 * the environment (`sender.ts`), which is also what lets one build run against a Mailgun
 * sandbox today and the club's own domain later with no code change at all.
 */

export type MailgunConfig = {
  apiKey: string;
  /** The verified sending domain — a sandbox while testing, the club's domain in production. */
  domain: string;
  /**
   * Mailgun's API base, from configuration.
   *
   * AGENTS.md §8 forbids a hostname literal anywhere under `src/` and exempts no provider —
   * the same rule that keeps the map service's URL out of the code. It is not ceremony here
   * either: Mailgun's EU region is a different host, and a club storing European participants'
   * data may well have to move to it.
   */
  apiBaseUrl: string;
  /** `Brașov Runners <noreply@…>`, assembled in `sender.ts` from configuration. */
  from: string;
  /**
   * Where a participant's reply goes, when the club has named a mailbox.
   *
   * Absent means a reply goes to `from`, which for a `noreply@` sender means it goes nowhere.
   * That is why this exists: the messages this application sends are the club's side of a
   * conversation with somebody who is about to run a race, and "do not reply" is a poor answer
   * to "can I still change my mind?".
   */
  replyTo?: string;
};

/** Longer than this and the message is stuck behind a provider that is not answering. */
const REQUEST_TIMEOUT_MS = 15_000;

/**
 * The account's own allowance, refused — not the message.
 *
 * Matched against the provider's body, and only ever to move a refusal from permanent to
 * throttled, so a false negative costs nothing new and a false positive is what has to be
 * avoided: it would retry a genuinely bad message once a day forever. Hence limit language and
 * nothing else. "not allowed to send" alone is not enough — Mailgun uses it for a disabled
 * domain too, which waiting does not fix.
 */
const ALLOWANCE_SPENT = /limit exceeded|exceeded your|sending limit|daily limit|quota/i;

/**
 * Which refusals are final, which are the allowance, and which are worth another minute.
 *
 * Split out of `send` so the mapping can be read as a table and asserted directly — it is the
 * part of this adapter with real consequences, and it was wrong once.
 */
export function classifyMailgunFailure(
  status: number,
  body: string,
): "permanent_failure" | "throttled" | "transient_failure" {
  // Credentials, or a sending domain that is not verified. Every retry fails identically.
  if (status === 401 || status === 403) return "permanent_failure";

  // Mailgun's own code for a refused send against a spent allowance, and the payment/plan
  // refusal. Neither appears in the documented status table; both are observed.
  if (status === 402 || status === 420) return "throttled";

  // The hourly rate limit. Clears within the hour, so ordinary backoff, not a daily deferral.
  if (status === 429) return "transient_failure";

  if (status === 400) {
    return ALLOWANCE_SPENT.test(body) ? "throttled" : "permanent_failure";
  }

  // 404, 5xx, anything unrecognised. Conservative in the safe direction, which is the
  // principle this whole mapping follows: what is not clearly the caller's fault is retried.
  return "transient_failure";
}

type MailgunAccepted = { id?: string; message?: string };

/**
 * Mailgun's two spellings of one message id, reduced to one (AGENTS.md §16.5).
 *
 * The send response returns the id in RFC 5322 form, angle brackets included. The delivery
 * webhook reports the same message as `message.headers.message-id`, *without* them.
 * `applyMailgunEvent` finds the outbox row by an exact match on this value, so storing the
 * response's spelling means no webhook ever matches: a bounce updates zero rows and reports
 * success, and the row sits at SENT for a message that was rejected.
 *
 * Verified against the live provider before this was written, not inferred from the docs.
 */
function normalizeProviderMessageId(id: string | undefined): string | undefined {
  const trimmed = id?.trim();
  if (!trimmed) return undefined;
  return trimmed.startsWith("<") && trimmed.endsWith(">")
    ? trimmed.slice(1, -1)
    : trimmed;
}

/** Anything shaped like an address. Deliberately greedy: a false positive costs a word of
 * context in an error message, a false negative stores somebody's address. */
const EMAIL_SHAPED = /[^\s<>"']+@[^\s<>"']+\.[^\s<>"',;)]+/g;

/**
 * Trim a provider message down to something safe to store in `email_outbox.last_error`.
 *
 * §14.5: never a body, an address, or a token — and this redacts rather than merely truncates,
 * because Mailgun's most common rejection on a sandbox domain is literally *"…is not among the
 * authorized recipients"* with the participant's address in it. That string is read by an
 * organizer in the backoffice and shipped into logs, so the address comes out here, at the one
 * boundary that sees it, rather than being trusted not to appear.
 */
function sanitizeError(status: number, body: string, apiKey: string): string {
  const redacted = body
    .replace(/\s+/g, " ")
    .replaceAll(apiKey, "<redacted>")
    .replace(EMAIL_SHAPED, "<address>");

  return `mailgun ${status}: ${redacted.slice(0, 200)}`;
}

export function createMailgunAdapter(config: MailgunConfig): EmailAdapter {
  // Basic auth, username `api`, password the key — Mailgun's documented scheme. Built once,
  // never logged, and never attached to an object anything else can read.
  const authorization = `Basic ${Buffer.from(`api:${config.apiKey}`).toString("base64")}`;
  const endpoint = `${config.apiBaseUrl.replace(/\/+$/, "")}/${config.domain}/messages`;

  return {
    name: "mailgun",

    async send(message: OutgoingEmail): Promise<SendResult> {
      const form = new FormData();
      form.set("from", config.from);
      form.set("to", message.to);
      form.set("subject", message.subject);
      form.set("text", message.text);
      form.set("html", message.html);
      if (config.replyTo) form.set("h:Reply-To", config.replyTo);

      /**
       * The outbox row's key, carried through the provider and back.
       *
       * Mailgun returns `v:` variables in webhook payloads as `user-variables`, so §16.5's
       * "trace a webhook back to the outbox row" does not depend on the provider's own id
       * having been stored successfully. It identifies the trigger, never the participant.
       */
      form.set("v:idempotency_key", message.idempotencyKey);
      // Three tags at most, and one is enough: delivery statistics per locale is the only
      // question the club would ever ask of them.
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
        // DNS, TLS, a timeout, a dropped connection. None of them says the message is bad.
        return {
          outcome: "transient_failure",
          error: `mailgun unreachable: ${error instanceof Error ? error.name : "unknown"}`,
        };
      }

      if (response.ok) {
        const accepted = (await response.json().catch(() => ({}))) as MailgunAccepted;
        return {
          outcome: "sent",
          // Mailgun always returns an id for an accepted message; the fallback exists so a
          // surprising response shape is still a send that happened rather than an exception.
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
