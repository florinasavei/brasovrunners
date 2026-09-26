import type { EmailTransportName } from "@/infrastructure/email/adapter";
import { type EmailSender, GMAIL_PACE_BUDGET_MS } from "@/infrastructure/email/delivery";
import { createEmailSenderForEnvironment } from "@/infrastructure/email/sender";
import type { Database } from "@/db/types";
import { replyToInForce } from "@/modules/contact/shown-address";
import { env } from "@/shared/config/env";
import { isClubCopy } from "./domain/club-notices";
import { gmailClaimSize, gmailRoadRows, preferredTransport } from "./domain/email-transport";
import { createGmailLedger, gmailIsConfigured, readEmailTransport, recordGmailFailure } from "./email-transport";
import { OUTBOX_BATCH_SIZE, type OutboxRoads, type OutboxRow } from "./outbox";

/**
 * The sender a batch of the outbox goes out through, the road each row asks for, how the claim
 * splits the rows between the two roads (§442), and the Reply-To both the sender and the renderer
 * set (§442, «Adresa de contact afișată») — the one place the three workers (the drain after a
 * response, the job, "Trimite acum") build them.
 *
 * Two small reads before the batch: the club's transport setting and the shown contact address
 * (one row by key each). Gmail's usage is not read here: the sender asks the database's ledger
 * before every Gmail message, so the pace and the cap hold across drains and instances (§443 review).
 */
export type OutboxRoute = (row: OutboxRow) => EmailTransportName;

export async function createOutboxSender<T extends Record<string, unknown>>(
  db: Database<T>,
): Promise<{ sender: EmailSender; route: OutboxRoute; roads?: OutboxRoads; replyTo: string | undefined }> {
  // The Reply-To the club chose to show (§442), read once per batch; the renderer's "or reply" line follows it.
  const [setting, replyTo] = await Promise.all([readEmailTransport(db), replyToInForce(db)]);
  const configured = gmailIsConfigured();
  const { sender } = createEmailSenderForEnvironment(env, {
    replyTo,
    gmail: {
      dailyCap: setting.gmailDailyCap,
      paceSeconds: setting.gmailPaceSeconds,
      atGmailCap: setting.atGmailCap,
      overflowToGmail: setting.overflowToGmail,
      ledger: createGmailLedger(db),
      // Every Gmail failure is kept for /admin/emails and /api/health (§443), not only fallen back from.
      onFailure: (error, at) => recordGmailFailure(db, error, at),
    },
  });
  const gmail = gmailRoadRows(setting);
  return {
    sender,
    replyTo,
    route: (row) => preferredTransport(setting, row.messageType, isClubCopy(row.payloadJson)),
    /*
      Claimed apart only where Gmail can carry anything (§443 review): without the account every
      row takes Mailgun's road, and one claim, oldest first, is the whole story.
    */
    ...(configured && (gmail.messageTypes.length > 0 || gmail.clubCopies)
      ? {
          roads: {
            gmailMessageTypes: gmail.messageTypes,
            gmailClubCopies: gmail.clubCopies,
            gmailBatchSize: gmailClaimSize(setting.gmailPaceSeconds, GMAIL_PACE_BUDGET_MS, OUTBOX_BATCH_SIZE),
          },
        }
      : {}),
  };
}
