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
          ...replyToOf(message, config.replyTo),
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
          // A calendar invitation (§672): Nodemailer writes the `text/calendar; method=…` alternative
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

/**
 * The Reply-To of one message on this road (§778): none at all for a confidential one (`noReplyTo`), the address a
 * visitor typed — with the name beside it, which Nodemailer quotes — for a message that carries one, else the
 * club's own as it always was. A transactional message sets neither flag and is exactly what it was.
 */
export function replyToOf(message: Pick<OutgoingEmail, "noReplyTo" | "replyTo" | "replyToName">, clubReplyTo: string | undefined): { replyTo?: string | SmtpAddress } {
  if (message.noReplyTo) return {};
  if (message.replyTo) return { replyTo: message.replyToName ? { name: message.replyToName, address: message.replyTo } : message.replyTo };
  return clubReplyTo ? { replyTo: clubReplyTo } : {};
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
 * Whether a Gmail failure came **before** the server could have taken the message (§778) — told by what
 * Nodemailer really gives, not by what would be convenient. Nodemailer 10 labels every connection-level
 * error with the command `CONN`, whatever the phase: a timeout while the body waits for Google's `250`
 * is `{code:'ETIMEDOUT', command:'CONN', message:'Timeout'}`, a socket closed after the body is
 * `{code:'ECONNECTION', command:'CONN', message:'Connection closed unexpectedly'}`. So the command says
 * nothing; the **message** and the **kind** of error do:
 *
 * - Before acceptance, certainly: a name that did not resolve (`EDNS`, `ENOTFOUND`, `EAI_AGAIN`), a connection
 *   that was refused or never made (`ECONNREFUSED`, and an `ESOCKET` whose failing system call was `connect`),
 *   the connect and greeting timeouts (`Connection timeout`, `Greeting never received`), TLS, a refused login,
 *   the server's own answer to an envelope command or to the message (`EAUTH`, `EENVELOPE`, `EMESSAGE`), and any
 *   failure that names an SMTP command ahead of `DATA` (`EHLO`, `STARTTLS`, `AUTH …`, `MAIL FROM`, `RCPT TO`).
 *   A server that closes the connection **with** a 4xx or 5xx reply said no.
 * - Ambiguous, so the message is never sent by another road at once: every other `ETIMEDOUT` (`Timeout`),
 *   `ESOCKET` and `ECONNECTION` (`Connection closed unexpectedly`) — the socket may have died after the body.
 *   A bare `ECONNECTION` with no message and no command keeps the answer it had before this lane: before.
 */
const BEFORE_ACCEPTANCE = new Set(["EDNS", "ETLS", "EAUTH", "ENOAUTH", "EOAUTH2", "EENVELOPE", "EMESSAGE", "ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "EHOSTUNREACH", "ENETUNREACH"]);

/** The commands the server answers before it is given the message: a failure that names one never reached `DATA`. */
const BEFORE_DATA_COMMAND = /^(EHLO|HELO|LHLO|STARTTLS|AUTH|MAIL FROM|RCPT TO)\b/i;

/** The messages Nodemailer gives a connect or greeting timeout, the only timeouts that are before acceptance. */
const CONNECT_TIMEOUT_MESSAGE = /^(Connection timeout|Greeting never received)\b/i;

/** A refusal or a failure to connect, in the words of the system call that failed (`connect ECONNREFUSED …`). */
const CONNECT_FAILURE_MESSAGE = /\b(ECONNREFUSED|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH)\b/;

export function gmailFailureIsBeforeAcceptance(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { code, command, message, syscall, responseCode } = error as { code?: unknown; command?: unknown; message?: unknown; syscall?: unknown; responseCode?: unknown };
  if (typeof code !== "string") return false;
  if (BEFORE_ACCEPTANCE.has(code)) return true;
  if (typeof command === "string" && BEFORE_DATA_COMMAND.test(command.trim())) return true;
  const text = typeof message === "string" ? message : "";
  if (code === "ETIMEDOUT") return CONNECT_TIMEOUT_MESSAGE.test(text);
  if (code === "ESOCKET") return syscall === "connect" || CONNECT_FAILURE_MESSAGE.test(text);
  if (code === "ECONNECTION") {
    // The server closed the connection with a refusal of its own: it said no. «Connection closed unexpectedly»
    // with nothing from the server may have come after the body.
    if (typeof responseCode === "number" && responseCode >= 400 && responseCode < 600) return true;
    return !/closed unexpectedly/i.test(text);
  }
  return false;
}
