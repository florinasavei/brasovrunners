import type { EmailAdapter, OutgoingEmail, SendResult } from "./adapter";
import { createSmtpConnection, describeSmtpFailure, type SmtpAddress, type SmtpConfig } from "./smtp-adapter";

/**
 * The outbox's second road: the club's Gmail over SMTP with its app password (§443, §149). No
 * delivery webhook, so a bounce never marks the row BOUNCED; the From is the Gmail address.
 *
 * A failure before acceptance is `transient_failure` and goes to Mailgun at once; one that may
 * follow acceptance carries `mayHaveBeenAccepted` and is left to the outbox's retry, never risking
 * a second single-use link. A `5.1.x` refusal of the address is `permanent_failure` (BOUNCED,
 * BR-REQ-080-02 criterion 4; §493). One pooled connection per batch, released by `close()`.
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
        });
        /*
          The runner's address refused while a copy went (§493): never "sent". Permanent is a bounce;
          temporary goes to the outbox's retry, not Mailgun, which would resend the copies.
        */
        const refusedTo = refusalOf(message.to, info);
        if (refusedTo) {
          // The copies that left count against Google's day.
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
        // The address cannot receive mail (§493): a bounce, not Mailgun's to retry.
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
 * Whether a refusal rejects the address for good (§493): a 5xx with enhanced status `5.1.x`, RFC
 * 3463's addressing class. `5.4.5` (Google's daily limit), `5.7.x` or a 4xx is about the account or
 * the moment, and Mailgun may still deliver.
 */
export function gmailRefusedTheAddress(refusal: unknown): boolean {
  if (!refusal || typeof refusal !== "object") return false;
  const code = (refusal as { responseCode?: unknown }).responseCode;
  const status = enhancedStatusOf(refusal);
  return typeof code === "number" && code >= 500 && code < 600 && status !== null && status.startsWith("5.1.");
}

/**
 * The runner's own refusal from a send's answer or Nodemailer's error (from `rejectedErrors` when
 * kept, else `{}`), or null when the runner's address was not refused. Case-insensitive; a refused
 * club copy does not count.
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
 * Nodemailer codes for failures before Gmail could have taken the message. Anything else (a socket
 * error, a timeout) may follow accepted DATA, so the sender does not resend it by Mailgun.
 */
const BEFORE_ACCEPTANCE = new Set(["ECONNECTION", "EDNS", "ETLS", "EAUTH", "ENOAUTH", "EOAUTH2", "EENVELOPE", "EMESSAGE"]);

export function gmailFailureIsBeforeAcceptance(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && BEFORE_ACCEPTANCE.has(code);
}
