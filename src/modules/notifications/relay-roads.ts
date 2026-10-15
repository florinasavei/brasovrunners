import type { Database } from "@/db/types";
import type { OutgoingEmail, SendResult } from "@/infrastructure/email/adapter";
import { GMAIL_NOT_TAKING_ERROR } from "@/infrastructure/email/delivery";
import { createEmailSenderForEnvironment } from "@/infrastructure/email/sender";
import { env } from "@/shared/config/env";
import type { EmailSender } from "@/infrastructure/email/delivery";
import type { Road } from "./domain/road-failover";
import { createGmailLedger, gmailIsConfigured, readEmailTransport, recordGmailFailure } from "./email-transport";
import { readMailgunStop } from "./mailgun-stop";
import type { RelayRoads } from "./relay";
import { recordRoadFailure, withRoadStatus } from "./road-status";

/**
 * The two roads as the relay uses them (§NNN): each one **strictly its own** — a message handed to Gmail is never
 * sent by Mailgun inside the sender, and the other way round — because which road carries a message, and when the
 * other may, is the relay's decision (`domain/road-failover.ts`), not the sender’s spill-over (§443, §622), which stays what it
 * was for the notifications.
 *
 * - **Mailgun** is the environment’s sender with no Gmail road in it: it captures on a laptop and in the tests, applies
 *   QA’s allowlist, and marks QA’s subjects.
 * - **Gmail** is the same sender with the club’s Gmail road and `gmailOnly`: the cap and the pace of §443 hold (the
 *   relay’s messages count against them), and the allowlist applies to it as to Mailgun — one rule for both roads. Where
 *   the deployment has no Gmail account (a laptop, the tests) the capture stands in for it, as it does for Mailgun.
 * - **Available** means the road exists on this deployment and is not stopped: Gmail needs `CONTACT_SMTP_USER` and its
 *   app password (or the capture); Mailgun needs the email service to transmit (or the capture) and no stop in force
 *   — a pause it asked for, or its allowance spent (§605, §622) — so a stop moves a message to the other road at once
 *   and never knocks on Mailgun during it.
 */
export async function createRelayRoads<T extends Record<string, unknown>>(db: Database<T>): Promise<RelayRoads> {
  const capture = env.APP_ENV === "local" || env.APP_ENV === "test";
  const setting = await readEmailTransport(db);
  // The refusal Gmail’s sender hands to `onFailure`: the sender’s answer to a failed Gmail send is a generic «not taking»,
  // and the relay needs the real code to count the failure and to say it. Kept for the sender’s life, which is one batch: once
  // Gmail failed, every later message of the batch is «not taken» for that same reason, and says its code.
  let lastGmailError: string | null = null;

  let mailgun: EmailSender | null = null;
  const mailgunSender = (): EmailSender => (mailgun ??= withRoadStatus(db, createEmailSenderForEnvironment(env).sender));

  let gmail: EmailSender | null = null;
  const gmailSender = (): EmailSender =>
    (gmail ??= withRoadStatus(
      db,
      createEmailSenderForEnvironment(env, {
        gmail: {
          dailyCap: setting.gmailDailyCap,
          paceSeconds: setting.gmailPaceSeconds,
          atGmailCap: setting.atGmailCap,
          // The relay decides when the other road may carry a message; the sender’s own spill is not it.
          overflowToGmail: false,
          ledger: createGmailLedger(db),
          onFailure: async (error, at) => {
            lastGmailError = error;
            await recordGmailFailure(db, error, at);
            await recordRoadFailure(db, "gmail", error, at);
          },
        },
      }).sender,
    ));

  return {
    async available(now) {
      const mailgunExists = env.EMAIL_DELIVERY_MODE !== "capture" || capture;
      const stopped = mailgunExists ? (await readMailgunStop(db, now)) !== null : false;
      return { gmail: gmailIsConfigured() || capture, mailgun: mailgunExists && !stopped };
    },

    async send(road: Road, message: OutgoingEmail): Promise<SendResult> {
      if (road === "mailgun") return mailgunSender().send({ ...message, transport: "mailgun" });
      if (!gmailIsConfigured()) {
        // No Gmail account here: the laptop’s capture stands in, labelled as the road it stands in for.
        const captured = await mailgunSender().send(message);
        return captured.outcome === "sent" ? { ...captured, transport: "gmail" } : captured;
      }
      const result = await gmailSender().send({ ...message, transport: "gmail", gmailOnly: true });
      if (result.outcome === "throttled" && !result.paced && result.error === GMAIL_NOT_TAKING_ERROR) {
        // A refusal before Gmail could have taken the message: the service’s, counted once like any other, not a stop.
        return { outcome: "transient_failure", error: lastGmailError ?? "gmail: failed earlier in this batch" };
      }
      return result;
    },

    close() {
      gmail?.close?.();
      mailgun?.close?.();
    },
  };
}
