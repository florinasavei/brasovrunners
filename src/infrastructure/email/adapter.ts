/**
 * The email provider boundary (AGENTS.md §3.4, §16). Nothing provider-specific passes this file;
 * a new provider is a new adapter and one line in `createEmailSender`.
 */

export type EmailLocale = "ro" | "en";

/** One message, already rendered (BR-REQ-080-01). */
export type OutgoingEmail = {
  /** The delivery address as the participant typed it (AGENTS.md §10.4). */
  to: string;
  subject: string;
  html: string;
  text: string;
  /**
   * The club's own copies (§244). Envelope recipients like `to`: each spends allowance, and
   * outside production the allowlist filters each one (`delivery.ts`).
   */
  cc?: readonly string[];
  bcc?: readonly string[];
  locale: EmailLocale;
  /**
   * The outbox row's idempotency key, passed to the provider so a webhook traces back to the row
   * (§16.5). It identifies the trigger, never the participant.
   */
  idempotencyKey: string;
  /** Files carried with the message — the signed declaration (§95). Rendered at send time, never stored in the outbox. */
  attachments?: EmailAttachment[];
  /**
   * The club's chosen road for this message's group (§443). A preference: the sender falls back
   * to Mailgun when Gmail is unconfigured, capped or failing. Absent means Mailgun.
   */
  transport?: EmailTransportName;
};

/** The two roads out (§443): the provider's HTTP API, or the club's own Gmail over SMTP. */
export type EmailTransportName = "mailgun" | "gmail";

export type EmailAttachment = { filename: string; contentType: string; data: Buffer };

/**
 * The outcomes the outbox acts on. Transient is retried with backoff; permanent never is, since
 * retrying hard bounces ruins the domain's reputation (§16.1, §16.5). Throttled means the
 * account's allowance is spent (a daily limit, `docs/PLATFORM.md` limit 1): the outbox waits for
 * `retryAfter` instead of burning its six minute-scale attempts.
 *
 * `error` is a short reason for `email_outbox.last_error`, sanitized: never a body, an address
 * or an action token (§14.5).
 */
export type SendResult =
  | {
      outcome: "sent";
      providerMessageId: string;
      /** Which road carried it (§443), set by the sender; the outbox stores it. Absent is Mailgun. */
      transport?: EmailTransportName;
      /** Recipients reached, copies included, 0 when captured; Gmail's cap counts these (§443). */
      recipients?: number;
      /** When Gmail took it: the row's `sent_at`, which pacing reads (§443). Absent is the batch's time. */
      acceptedAt?: Date;
    }
  | {
      outcome: "transient_failure";
      error: string;
      /**
       * The connection broke after the server may have taken it (§443): no fallback road, which
       * could deliver twice; the outbox retries on its backoff.
       */
      mayHaveBeenAccepted?: true;
      /**
       * Gmail refused the runner's address for now while the copies went (§443): an address
       * refusal, not an account one, so Gmail is not marked down.
       */
      addressRefusedForNow?: true;
      /** Recipients taken anyway (the copies), for Gmail's daily ledger. */
      acceptedRecipients?: number;
    }
  | {
      outcome: "throttled";
      error: string;
      /** Held by Gmail's pace, nothing tried (§443): the outbox gives the attempt back. */
      paced?: true;
      /** When the allowance is expected back; absent means the next daily reset. */
      retryAfter?: Date;
    }
  | {
      outcome: "permanent_failure";
      error: string;
      /** Recipients (the copies) Gmail took before refusing the address; they count against its cap (§443). */
      acceptedRecipients?: number;
    };

export interface EmailAdapter {
  /** Identifies the adapter in logs and in the backoffice. Never a secret. */
  readonly name: string;
  send(message: OutgoingEmail): Promise<SendResult>;
  /** Release what the adapter holds between messages (Gmail's pooled SMTP connection), once per batch (§493). */
  close?(): void;
}
