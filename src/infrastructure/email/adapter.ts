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
  /**
   * The club's own copies of this message (`DECISIONS.md` §244): visible on it, and invisible.
   *
   * Only the declaration archive uses them, and only because the club asked for a second
   * reader without a deployment. They are envelope recipients like `to`, so every one of them
   * spends a message of the Mailgun allowance, and the allowlist filters them one by one
   * outside production — a copy must never be the thing that reaches a stranger's inbox from
   * QA (`delivery.ts`).
   */
  cc?: readonly string[];
  bcc?: readonly string[];
  locale: EmailLocale;
  /**
   * Passed to the provider so a webhook can be traced back to the outbox row (§16.5) without
   * the provider's own id being the only link. It is the outbox row's idempotency key, which
   * identifies the trigger and never the participant.
   */
  idempotencyKey: string;
  /** Files carried with the message — the signed declaration (§95). Rendered at send time, never stored in the outbox. */
  attachments?: EmailAttachment[];
  /**
   * A calendar invitation the runner's calendar answers (§NNN): the `.ics` text and its iTIP method.
   * Not an attachment like the others, because a calendar app offers «Da / Nu / Poate» only for a
   * part typed `text/calendar; method=REQUEST` (Gmail, Outlook and Apple all read the parameter):
   * both roads hand it to Nodemailer's composer, which writes it as that `multipart/alternative`
   * part beside the text and the HTML, and once more as an `invite.ics` attachment — the shape
   * Google's own invitations have. Rendered at send time, never stored, never on a club copy (§320).
   */
  calendar?: EmailCalendar;
  /**
   * The road the club chose for this message's group (§443). A wish, not an order: the sender
   * takes Mailgun's road whenever Gmail is not configured, is at its daily cap, or failed. Absent
   * means Mailgun.
   */
  transport?: EmailTransportName;
  /**
   * Mailgun said stop and the club's switch hands its mail to Gmail (§622): Gmail's road or none —
   * never Mailgun's, whatever Gmail answers. A message Gmail cannot take now (its cap, a refused
   * login) is handed back for the outbox to hold, rather than knocking on Mailgun during its pause.
   */
  gmailOnly?: true;
  /**
   * A newsletter or a new-event alert (§443): never spilled to Gmail when Mailgun refuses, unless
   * the club chose Gmail for the group — a bulk send from a personal Gmail is what Google restricts.
   */
  bulk?: true;
};

/**
 * Mailgun's own refusal of the account (§622), carried on a result the sender got elsewhere — Gmail
 * took the message after Mailgun said stop — so the outbox still learns that Mailgun's road is
 * closed and until when, and does not knock on it with the next message.
 */
export type MailgunStopped = { kind: "paused" | "allowance"; until?: Date };

/** The two roads out (§443): the provider's HTTP API, or the club's own Gmail over SMTP. */
export type EmailTransportName = "mailgun" | "gmail";

export type EmailAttachment = { filename: string; contentType: string; data: Buffer };

/** An invitation (§NNN): the method the calendar part is typed with, and the file, `METHOD` and all. */
export type EmailCalendar = { method: "REQUEST" | "CANCEL"; ics: string };

/**
 * The four outcomes the outbox knows how to act on.
 *
 * The distinction between transient and permanent is the whole reason this is a union rather
 * than a boolean: a transient failure is retried with backoff, and a permanent one must not
 * be, because retrying a hard bounce for six attempts is how a sending domain's reputation is
 * destroyed (§16.1, §16.5).
 *
 * `throttled` is the third case, and it is not a shade of transient. A transient failure is
 * the provider being unable to take the message *now* and probably able in a minute, so the
 * outbox retries in one, two, four minutes and gives up after six attempts — about an hour.
 * A throttled failure is the provider refusing because **this account's own allowance is
 * spent**, which on Mailgun Free is a *daily* limit of 100 messages (`docs/PLATFORM.md`,
 * limit 1). Retrying that on a minute scale burns all six attempts inside the hour and marks
 * a confirmation FAILED that would have sent perfectly well the next morning — which is the
 * registration-day failure this distinction exists to prevent. Nothing was transmitted, so no
 * reputation was spent and there is nothing to back off *from*; what there is, is a reset to
 * wait for. `retryAfter` says when.
 *
 * `error` is a short provider reason for `email_outbox.last_error`. It is sanitized before it
 * is stored — never a body, an address, or an action token (§14.5).
 */
export type SendResult =
  | {
      outcome: "sent";
      providerMessageId: string;
      /** Which road carried it (§443), set by the sender; the outbox stores it. Absent is Mailgun. */
      transport?: EmailTransportName;
      /**
       * How many recipients the send reached (§443): the address plus every copy transmitted, 0 when
       * captured. Set by the sender; Gmail's cap is counted in recipients, as Google counts them.
       */
      recipients?: number;
      /**
       * When the server took the message (§443 review), set by the sender for Gmail: the row's
       * `sent_at`, which every other sender paces from. Absent, the outbox reads its own clock the
       * moment the send returned (§605), never the batch's start.
       */
      acceptedAt?: Date;
      /** Mailgun refused it first, for the account and not the message (§622); Gmail carried it. */
      mailgunStopped?: MailgunStopped;
    }
  | {
      outcome: "transient_failure";
      error: string;
      /**
       * The connection broke where the server may already have taken the message (a socket error or
       * a timeout, §443): sending it again by another road could reach the runner twice with the
       * same link, so the sender does not; the outbox retries it on its own backoff.
       */
      mayHaveBeenAccepted?: true;
      /**
       * The runner's own address refused for now while the club's copies went (Gmail, §443): a
       * refusal of the address, not of the account — the sender neither marks Gmail down nor
       * records a Gmail failure, and the outbox retries the row on its own backoff.
       */
      addressRefusedForNow?: true;
      /** How many recipients the server took all the same — the copies — for Gmail's daily ledger. */
      acceptedRecipients?: number;
      /**
       * Mailgun refused it first, for the account (§622), and the spill to Gmail ended here — the
       * connection broke where Gmail may have taken it. The stop still closes Mailgun's road.
       */
      mailgunStopped?: MailgunStopped;
    }
  | {
      outcome: "throttled";
      error: string;
      /**
       * A pause, not a refusal of the message: held back by Gmail's pace (§443), where nothing was
       * tried, or by Mailgun's rate limit (§605: a 429, the probation's "temporarily disabled"),
       * where nothing was taken. The outbox gives the attempt back rather than spending one of six
       * on a wait, so no number of pauses ever marks a message FAILED.
       */
      paced?: true;
      /**
       * The provider refused for the rate (§605), as opposed to the club's own pace: the outbox keeps
       * the reason on the row, holds the rest of the batch's Mailgun messages until `retryAfter`
       * rather than knocking again at once, and `/api/health` counts a message held this way past
       * the overdue allowance as overdue — a pause that never ends needs a person.
       */
      rateRefused?: true;
      /**
       * When the provider's allowance is expected back. The outbox schedules the next attempt
       * for then rather than applying its own backoff. Absent means "the adapter does not
       * know", and the outbox falls back to the next daily reset.
       */
      retryAfter?: Date;
      /** Mailgun refused it first, for the account (§622), and Gmail handed it back for its pace. */
      mailgunStopped?: MailgunStopped;
    }
  | {
      outcome: "permanent_failure";
      error: string;
      /**
       * The refusal is about the account or the message, not the recipient's address (§622): bad
       * credentials, an unverified or closed domain, a malformed message. The outbox marks it FAILED —
       * a person can fix it and press «Reîncearcă emailurile eșuate» — rather than BOUNCED, which is
       * an address that does not exist and is never tried again.
       */
      notTheAddress?: true;
      /**
       * How many recipients the server took before refusing the address (Gmail, §443): the club's
       * copies left and count against Google's daily cap, so the sender credits the ledger with them.
       */
      acceptedRecipients?: number;
      /**
       * Mailgun refused it first, for the account (§622), and Gmail then refused the address for good.
       * The message is BOUNCED; the stop Mailgun announced still closes its road.
       */
      mailgunStopped?: MailgunStopped;
    };

export interface EmailAdapter {
  /** Identifies the adapter in logs and in the backoffice. Never a secret. */
  readonly name: string;
  send(message: OutgoingEmail): Promise<SendResult>;
  /**
   * Let go of whatever the adapter holds open between two messages — the Gmail road's one pooled
   * SMTP connection (§493). Called once, when the batch that built it ends; an adapter that holds
   * nothing (Mailgun's HTTP calls, the capture) has none.
   */
  close?(): void;
}
