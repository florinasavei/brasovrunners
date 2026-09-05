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
 * - **400** — permanent. A malformed message, an unauthorized sandbox recipient, an address
 *   Mailgun refuses. Retrying an unchanged message that was already refused is pointless.
 * - **429, 5xx, and any network error** — transient. Rate limits and outages pass.
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

type MailgunAccepted = { id?: string; message?: string };

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
          providerMessageId: accepted.id ?? `mailgun:${message.idempotencyKey}`,
        };
      }

      const body = await response.text().catch(() => "");
      const permanent =
        response.status === 400 || response.status === 401 || response.status === 403;

      return {
        outcome: permanent ? "permanent_failure" : "transient_failure",
        error: sanitizeError(response.status, body, config.apiKey),
      };
    },
  };
}
