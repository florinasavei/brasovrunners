import type { EmailAdapter, OutgoingEmail, SendResult } from "./adapter";
import { icalEventOf } from "./calendar-mime";
import { enhancedStatusOf, gmailFailureIsBeforeAcceptance, gmailRefusedTheAddress, refusalOf, replyToOf } from "./gmail-adapter";
import { createSmtpConnection, describeSmtpFailure, type SmtpAddress, type SmtpConfig } from "./smtp-adapter";

/**
 * Azure Communication Services Email over its SMTP relay (`docs/AZURE.md` Part 1).
 *
 * It takes the provider's road, the one Mailgun holds today: when its two variables are set,
 * `sender.ts` builds this adapter instead of Mailgun's, and nothing else in the outbox changes —
 * the road keeps its internal name (`"mailgun"` in `email_outbox.transport`), because some forty
 * screens and the Gmail spill (§443, §622) read it as «the provider's road», not as a brand. The
 * Gmail road stays beside it, as it does beside Mailgun.
 *
 * SMTP and not Azure's REST API, for the calendar invitation (§672): Nodemailer writes its
 * `text/calendar; method=REQUEST` part here exactly as on the Gmail road, which the REST API would
 * not let it do. One pooled connection per batch, as on the Gmail road (§493).
 *
 * The SMTP reply is classified into the outbox's four outcomes:
 *
 * - the runner's address refused with a `5.1.x`: `permanent_failure`, the bounce it is;
 * - a refused login, or any other 5xx (a policy, an unverified sender): `permanent_failure` with
 *   `notTheAddress`, which a person fixes and retries — never BOUNCED;
 * - a 4xx before Azure took the message — its 30-a-minute and 100-an-hour quota answers this way:
 *   `throttled`, retried in a minute without spending one of the six attempts' backoff;
 * - a connection that failed before acceptance: `transient_failure`; one that may have broken after
 *   it: `transient_failure` with `mayHaveBeenAccepted`, so the message is not sent twice.
 *
 * The id stored is the `Message-ID` Nodemailer wrote, without its brackets. Whether Azure's
 * delivery report carries the same id (`internetMessageId`) is the plan's open question 1, settled on
 * QA before production (`src/app/api/webhooks/acs/route.ts`).
 */
export type AcsAdapterConfig = SmtpConfig & {
  /** A MailFrom address verified on the Azure domain, with the club's name. */
  from: SmtpAddress;
  replyTo?: string;
};

/** How long a quota refusal waits: Azure counts per minute and per hour, so a minute is the first useful retry. */
export const ACS_THROTTLE_RETRY_MS = 60_000;

export function createAcsAdapter(config: AcsAdapterConfig, clock: () => Date = () => new Date()): EmailAdapter {
  const connection = createSmtpConnection(config, { pooled: true });

  return {
    name: "acs",

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
          ...(message.calendar ? { icalEvent: icalEventOf(message.calendar) } : {}),
        });
        const refusedTo = refusalOf(message.to, info);
        if (refusedTo) {
          return gmailRefusedTheAddress(refusedTo)
            ? { outcome: "permanent_failure", error: `acs: the address was refused (${enhancedStatusOf(refusedTo) ?? "5xx"})` }
            : { outcome: "transient_failure", error: "acs: the address was refused for now", mayHaveBeenAccepted: true, addressRefusedForNow: true };
        }
        if (info.accepted.length === 0) return { outcome: "transient_failure", error: "acs rejected every recipient" };
        return { outcome: "sent", providerMessageId: withoutBrackets(info.messageId) };
      } catch (error) {
        return classifyAcsFailure(message.to, error, clock());
      }
    },
  };
}

/** What a failed SMTP send to Azure means for the outbox. Exported for its tests. */
export function classifyAcsFailure(to: string, error: unknown, now: Date): SendResult {
  const failure = `acs: ${describeSmtpFailure(error)}`;
  const refused = error && typeof error === "object" ? refusalOf(to, error) : null;
  if (refused && gmailRefusedTheAddress(refused)) {
    return { outcome: "permanent_failure", error: `${failure} ${enhancedStatusOf(refused) ?? ""}`.trim() };
  }
  const { code, responseCode } = (error && typeof error === "object" ? error : {}) as { code?: unknown; responseCode?: unknown };
  const status = enhancedStatusOf(error);
  const tagged = status ? `${failure} ${status}` : failure;
  if (code === "EAUTH" || responseCode === 535) {
    return { outcome: "permanent_failure", error: `${failure} (login refused)`, notTheAddress: true };
  }
  if (typeof responseCode === "number" && responseCode >= 400 && responseCode < 500 && gmailFailureIsBeforeAcceptance(error)) {
    return { outcome: "throttled", error: tagged, rateRefused: true, retryAfter: new Date(now.getTime() + ACS_THROTTLE_RETRY_MS) };
  }
  if (typeof responseCode === "number" && responseCode >= 500 && responseCode < 600) {
    return { outcome: "permanent_failure", error: tagged, notTheAddress: true };
  }
  return gmailFailureIsBeforeAcceptance(error)
    ? { outcome: "transient_failure", error: failure }
    : { outcome: "transient_failure", error: failure, mayHaveBeenAccepted: true };
}

/** `<abc@host>` → `abc@host`: the shape the webhook compares, as Mailgun's ids are stored. */
export function withoutBrackets(id: string): string {
  return id.trim().replace(/^<|>$/g, "");
}
