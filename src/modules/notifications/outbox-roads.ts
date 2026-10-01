import { GMAIL_PACE_BUDGET_MS } from "@/infrastructure/email/delivery";
import type { Database } from "@/db/types";
import { type EmailTransportSetting, gmailClaimSize, gmailRoadRows } from "./domain/email-transport";
import { gmailIsConfigured, readEmailTransport } from "./email-transport";
import { OUTBOX_BATCH_SIZE, type OutboxRoads } from "./outbox";

/**
 * The two roads as the claim splits them (§442): Gmail's rows, by the club's setting, apart from
 * Mailgun's. Claimed apart only where Gmail can carry anything (§443 review): without the account
 * every row takes Mailgun's road, and one claim, oldest first, is the whole story — undefined.
 * The one rule the sender (`outbox-sender.ts`), `/api/health`, the page's hour and the queue
 * panel read the roads by (§NNN, §529).
 */
export function outboxRoadsFor(setting: EmailTransportSetting, configured: boolean): OutboxRoads | undefined {
  const gmail = gmailRoadRows(setting);
  if (!configured || (gmail.messageTypes.length === 0 && !gmail.clubCopies)) return undefined;
  return {
    gmailMessageTypes: gmail.messageTypes,
    gmailClubCopies: gmail.clubCopies,
    gmailBatchSize: gmailClaimSize(setting.gmailPaceSeconds, GMAIL_PACE_BUDGET_MS, OUTBOX_BATCH_SIZE),
  };
}

/** `outboxRoadsFor` from the stored setting: one row by key. */
export async function readOutboxRoads<T extends Record<string, unknown>>(db: Database<T>): Promise<OutboxRoads | undefined> {
  return outboxRoadsFor(await readEmailTransport(db), gmailIsConfigured());
}
