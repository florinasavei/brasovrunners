import type { EmailAdapter, OutgoingEmail, SendResult } from "./adapter";
import { createSmtpConnection, describeSmtpFailure, type SmtpAddress, type SmtpConfig } from "./smtp-adapter";

/**
 * The outbox's second road: the club's own Gmail, over SMTP with its app password (§NNN).
 *
 * The same account and connection the contact form sends with (§149, `smtp-adapter.ts`), wearing
 * the outbox's contract — one message, its copies, its attachments, a classified outcome. What it
 * does not have is Mailgun's: no delivery webhook, so a bounce comes back as an email to the club's
 * inbox and never marks the row BOUNCED; no sending domain of the club's, so the From is the Gmail
 * address with the club's name (Google rewrites any other address to it anyway).
 *
 * Every failure is `transient_failure` here, deliberately. A failure before Gmail could have taken
 * the message is not retried on Gmail: the sender hands it to Mailgun at once (`delivery.ts`),
 * never a permanent refusal it would mark FAILED — delivery first, the owner's cost second. A
 * failure that may have come after acceptance carries `mayHaveBeenAccepted`, and the sender leaves
 * it to the outbox's own retry instead of risking a second copy of a single-use link. Where Mailgun
 * takes over, its own classification decides — so a Gmail refusal can never be the thing that marks
 * a runner's confirmation BOUNCED.
 */
export type GmailAdapterConfig = SmtpConfig & {
  from: SmtpAddress;
  /** Where a reply goes when the club named a mailbox; absent, a reply reaches the Gmail account itself. */
  replyTo?: string;
};

export function createGmailAdapter(config: GmailAdapterConfig): EmailAdapter {
  const connection = createSmtpConnection(config);

  return {
    name: "gmail",

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
        });
        if (info.accepted.length === 0) return { outcome: "transient_failure", error: "gmail rejected every recipient" };
        return { outcome: "sent", providerMessageId: info.messageId, transport: "gmail" };
      } catch (error) {
        // A code or a class, never the server's reply, which may echo the login (§14.5).
        const failure = `gmail: ${describeSmtpFailure(error)}`;
        return gmailFailureIsBeforeAcceptance(error)
          ? { outcome: "transient_failure", error: failure }
          : { outcome: "transient_failure", error: failure, mayHaveBeenAccepted: true };
      }
    },
  };
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
