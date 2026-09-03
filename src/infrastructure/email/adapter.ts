/**
 * The email provider boundary (AGENTS.md §3.4, §16).
 *
 * Four things go out, three things can come back. Nothing else about Mailgun — its SDK, its
 * error shapes, its retry semantics — is allowed past this file, so replacing the provider is
 * a new file next to `mailgun-adapter.ts` and one line in `createEmailSender`, and no domain
 * or module code changes at all.
 *
 * There is no `sendBatch`, no template registry and no attachment support, because nothing
 * needs them (`AGENTS.md` §1.3). Add a method when a caller exists.
 */

export type EmailLocale = "ro" | "en";

/** One message, already rendered. Templates are BR-REQ-080-01 and are not built yet. */
export type OutgoingEmail = {
  /** The delivery address as the participant typed it (AGENTS.md §10.4). */
  to: string;
  subject: string;
  html: string;
  text: string;
  locale: EmailLocale;
  /**
   * Passed to the provider so a webhook can be traced back to the outbox row (§16.5) without
   * the provider's own id being the only link. It is the outbox row's idempotency key, which
   * identifies the trigger and never the participant.
   */
  idempotencyKey: string;
};

/**
 * The three outcomes the outbox knows how to act on.
 *
 * The distinction between transient and permanent is the whole reason this is a union rather
 * than a boolean: a transient failure is retried with backoff, and a permanent one must not
 * be, because retrying a hard bounce for six attempts is how a sending domain's reputation is
 * destroyed (§16.1, §16.5).
 *
 * `error` is a short provider reason for `email_outbox.last_error`. It is sanitized before it
 * is stored — never a body, an address, or an action token (§14.5).
 */
export type SendResult =
  | { outcome: "sent"; providerMessageId: string }
  | { outcome: "transient_failure"; error: string }
  | { outcome: "permanent_failure"; error: string };

export interface EmailAdapter {
  /** Identifies the adapter in logs and in the backoffice. Never a secret. */
  readonly name: string;
  send(message: OutgoingEmail): Promise<SendResult>;
}
