import type { EmailAdapter, OutgoingEmail, SendResult } from "./adapter";
import { icalEventOf } from "./calendar-mime";
import { createSmtpConnection, describeSmtpFailure, type SmtpAddress, type SmtpConfig } from "./smtp-adapter";

/**
 * The outbox's second road: the club's own Gmail, over SMTP with its app password (§443).
 *
 * The same account and connection the contact form sends with (§149, `smtp-adapter.ts`), wearing
 * the outbox's contract — one message, its copies, its attachments, a classified outcome. What it
 * does not have is Mailgun's: no delivery webhook, so a bounce comes back as an email to the club's
 * inbox and never marks the row BOUNCED; no sending domain of the club's, so the From is the Gmail
 * address with the club's name (Google rewrites any other address to it anyway).
 *
 * A failure before Gmail could have taken the message — no connection, a refused login, Google's
 * own daily limit, a message its filters would not take — is `transient_failure`: the sender hands
 * it to Mailgun at once (`delivery.ts`), delivery first, the owner's cost second. A failure that may
 * have come after acceptance carries `mayHaveBeenAccepted`, and the sender leaves it to the outbox's
 * own retry instead of risking a second copy of a single-use link.
 *
 * One refusal is not Gmail's to fall back from (§493): the address itself. A 5xx answer with an
 * enhanced status of `5.1.x` to the recipient — "no such mailbox", "bad destination", "bad syntax" —
 * says the address cannot receive mail from anybody; handing it to Mailgun spent a message of the
 * club's allowance to learn the same thing from a bounce hours later, and meanwhile the row read as
 * sent. It is `permanent_failure` now, the outbox's one terminal answer for a refusal (BOUNCED,
 * BR-REQ-080-02 criterion 4), exactly what Mailgun's own `5.1.1` becomes through the webhook.
 * Everything else about a refusal stays Mailgun's to try.
 *
 * One connection per batch (§493): the adapter keeps one pooled SMTP connection for every message
 * the batch sends through it, and `close()` lets it go when the batch ends.
 */
export type GmailAdapterConfig = SmtpConfig & {
  from: SmtpAddress;
  /** Where a reply goes when the club named a mailbox; absent, a reply reaches the Gmail account itself. */
  replyTo?: string;
};

export function createGmailAdapter(config: GmailAdapterConfig): EmailAdapter {
  const connection = createSmtpConnection(config, { pooled: true });

  return {
    name: "gmail",

    close() {
      connection.close();
    },

    async send(message: OutgoingEmail): Promise<SendResult> {
      try {
        const info = await connection.sendMail({
          from: config.from,
          to: message.to,
          ...(message.cc && message.cc.length > 0 ? { cc: [...message.cc] } : {}),
          ...(message.bcc && message.bcc.length > 0 ? { bcc: [...message.bcc] } : {}),
          ...(config.replyTo ? { replyTo: config.replyTo } : {}),
          subject: message.subject,
          text: message.text,
          html: message.html,
          // The row's key, as Mailgun carries it in `v:idempotency_key`: the trigger, never the person.
          headers: { "X-Outbox-Key": message.idempotencyKey },
          ...(message.attachments && message.attachments.length > 0
            ? {
                attachments: message.attachments.map((attachment) => ({
                  filename: attachment.filename,
                  contentType: attachment.contentType,
                  content: attachment.data,
                })),
              }
            : {}),
          // A calendar invitation (§NNN): Nodemailer writes the `text/calendar; method=…` alternative
          // and the `invite.ics` attachment itself — the same composer the Mailgun road uses.
          ...(message.calendar ? { icalEvent: icalEventOf(message.calendar) } : {}),
        });
        /*
          The runner's own address refused while a copy went (§493): Gmail took the message for the
          club's copies and not for the person it is for. Never "sent" — the runner has nothing. A
          permanent refusal of the address is the bounce it is; a temporary one goes back to the
          outbox's retry, never to Mailgun, which would send the copies a second time at once.
        */
        const refusedTo = refusalOf(message.to, info);
        if (refusedTo) {
          // The copies Gmail took all the same: they left, and Google counts them against the day.
          const acceptedRecipients = Array.isArray(info.accepted) ? info.accepted.length : 0;
          return gmailRefusedTheAddress(refusedTo)
            ? { outcome: "permanent_failure", error: `gmail: the address was refused (${enhancedStatusOf(refusedTo) ?? "5xx"})`, acceptedRecipients }
            : {
                outcome: "transient_failure",
                error: "gmail: the address was refused for now",
                mayHaveBeenAccepted: true,
                addressRefusedForNow: true,
                acceptedRecipients,
              };
        }
        if (info.accepted.length === 0) return { outcome: "transient_failure", error: "gmail rejected every recipient" };
        return { outcome: "sent", providerMessageId: info.messageId, transport: "gmail" };
      } catch (error) {
        // A code or a class, never the server's reply, which may echo the login (§14.5).
        const failure = `gmail: ${describeSmtpFailure(error)}`;
        // The address itself cannot receive mail (§493): the bounce it is, not Mailgun's to try again.
        const refused = error && typeof error === "object" ? refusalOf(message.to, error) : null;
        if (refused && gmailRefusedTheAddress(refused)) {
          return { outcome: "permanent_failure", error: `${failure} ${enhancedStatusOf(refused) ?? ""}`.trim() };
        }
        return gmailFailureIsBeforeAcceptance(error)
          ? { outcome: "transient_failure", error: failure }
          : { outcome: "transient_failure", error: failure, mayHaveBeenAccepted: true };
      }
    },
  };
}

/** The SMTP answer's enhanced status (`5.1.1`), read from its reply without keeping the reply. */
export function enhancedStatusOf(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const response = (error as { response?: unknown }).response;
  if (typeof response !== "string") return null;
  const match = /^\s*\d{3}[ -](\d\.\d{1,3}\.\d{1,3})\b/.exec(response);
  return match?.[1] ?? null;
}

/**
 * Whether one recipient's SMTP refusal refused the **address** for good (§493): a 5xx reply whose
 * enhanced status is `5.1.x` — the addressing class of RFC 3463 (bad mailbox, bad domain, bad
 * syntax). Nothing else is: a `5.4.5` (Google's daily sending limit), a `5.7.x` (policy, a login) or
 * a 4xx is about the account or the moment, and Mailgun may still deliver.
 */
export function gmailRefusedTheAddress(refusal: unknown): boolean {
  if (!refusal || typeof refusal !== "object") return false;
  const code = (refusal as { responseCode?: unknown }).responseCode;
  const status = enhancedStatusOf(refusal);
  return typeof code === "number" && code >= 500 && code < 600 && status !== null && status.startsWith("5.1.");
}

/**
 * The runner's own address among the recipients Gmail refused — from a sent message's answer (some
 * recipients refused) or from the error Nodemailer throws when all of them were — with that
 * recipient's own refusal when Nodemailer kept one (`rejectedErrors` names the recipient each is
 * about); null when the address was not refused. Compared ignoring case: the envelope carries it as
 * typed. Only the runner's refusal decides: a club copy's address the server refused says nothing
 * about the runner's.
 */
export function refusalOf(to: string, answer: { rejected?: unknown; rejectedErrors?: unknown }): object | null {
  const wanted = to.trim().toLowerCase();
  const rejected = Array.isArray(answer.rejected) ? answer.rejected : [];
  const refused = rejected.some((address) => typeof address === "string" && address.trim().toLowerCase() === wanted);
  if (!refused) return null;
  const info = answer;
  const errors = Array.isArray(info.rejectedErrors) ? (info.rejectedErrors as unknown[]) : [];
  const own = errors.find((candidate) => {
    const recipient = (candidate as { recipient?: unknown } | null)?.recipient;
    return typeof recipient === "string" && recipient.trim().toLowerCase() === wanted;
  });
  return (own as object | undefined) ?? {};
}

/**
 * Nodemailer's codes for a failure that happened before Gmail could have taken the message: no
 * connection, no TLS, no DNS, a refused login, an envelope or a message the server answered "no"
 * to. Anything else — a socket error, a timeout, an unknown throw — may have come after the
 * server accepted DATA, and is reported as such so the sender does not send it again by Mailgun.
 */
const BEFORE_ACCEPTANCE = new Set(["ECONNECTION", "EDNS", "ETLS", "EAUTH", "ENOAUTH", "EOAUTH2", "EENVELOPE", "EMESSAGE"]);

export function gmailFailureIsBeforeAcceptance(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && BEFORE_ACCEPTANCE.has(code);
}
