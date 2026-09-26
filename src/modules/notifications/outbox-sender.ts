import type { EmailTransportName } from "@/infrastructure/email/adapter";
import { type EmailSender, GMAIL_PACE_BUDGET_MS } from "@/infrastructure/email/delivery";
import { createEmailSenderForEnvironment } from "@/infrastructure/email/sender";
import type { Database } from "@/db/types";
import { env } from "@/shared/config/env";
import { isClubCopy } from "./domain/club-notices";
import { gmailClaimSize, gmailRoadRows, preferredTransport } from "./domain/email-transport";
import { createGmailLedger, gmailIsConfigured, readEmailTransport, recordGmailFailure } from "./email-transport";
import { OUTBOX_BATCH_SIZE, type OutboxRoads, type OutboxRow } from "./outbox";

/**
 * The sender a batch of the outbox goes out through, the road each row asks for, and how the claim
 * splits the rows between the two roads (§NNN) — the one place the three workers (the drain after a
 * response, the job, "Trimite acum") build them.
 *
 * One small read before the batch: the club's setting (one row by key). Gmail's usage is not read
 * here: the sender asks the database's ledger before every Gmail message, so the pace and the cap
 * hold across drains and instances (§NNN review).
 */
export type OutboxRoute = (row: OutboxRow) => EmailTransportName;

export async function createOutboxSender<T extends Record<string, unknown>>(
  db: Database<T>,
): Promise<{ sender: EmailSender; route: OutboxRoute; roads?: OutboxRoads }> {
  const setting = await readEmailTransport(db);
  const configured = gmailIsConfigured();
  const { sender } = createEmailSenderForEnvironment(env, {
    dailyCap: setting.gmailDailyCap,
    paceSeconds: setting.gmailPaceSeconds,
    atGmailCap: setting.atGmailCap,
    overflowToGmail: setting.overflowToGmail,
    ledger: createGmailLedger(db),
    // Every Gmail failure is kept for /admin/emails and /api/health (§NNN), not only fallen back from.
    onFailure: (error, at) => recordGmailFailure(db, error, at),
  });
  const gmail = gmailRoadRows(setting);
  return {
    sender,
    route: (row) => preferredTransport(setting, row.messageType, isClubCopy(row.payloadJson)),
    /*
      Claimed apart only where Gmail can carry anything (§NNN review): without the account every
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
