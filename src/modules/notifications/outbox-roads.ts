import { GMAIL_PACE_BUDGET_MS } from "@/infrastructure/email/delivery";
import type { Database } from "@/db/types";
import { type EmailTransportSetting, gmailClaimSize, gmailRoadRows } from "./domain/email-transport";
import { fallbackActive } from "./domain/mailgun-stop";
import { gmailIsConfigured, readEmailTransport } from "./email-transport";
import { OUTBOX_BATCH_SIZE, type OutboxRoads } from "./outbox";

/**
 * The two roads as the claim splits them (§442): Gmail's rows, by the club's setting, apart from
 * Mailgun's. Claimed apart only where Gmail can carry anything (§443 review): without the account
 * every row takes Mailgun's road, and one claim, oldest first, is the whole story — undefined.
 * The one rule the sender (`outbox-sender.ts`), `/api/health`, the page's hour and the queue
 * panel read the roads by (§605, §529).
 */
export function outboxRoadsFor(setting: EmailTransportSetting, configured: boolean): OutboxRoads | undefined {
  const gmail = gmailRoadRows(setting);
  // «Gmail preia când Mailgun se oprește» (§NNN): Gmail's road exists for a stop even when no group is Gmail's.
  const fallback = fallbackActive(setting, configured);
  if (!configured || (gmail.messageTypes.length === 0 && !gmail.clubCopies && !fallback)) return undefined;
  return {
    gmailMessageTypes: gmail.messageTypes,
    gmailClubCopies: gmail.clubCopies,
    gmailBatchSize: gmailClaimSize(setting.gmailPaceSeconds, GMAIL_PACE_BUDGET_MS, OUTBOX_BATCH_SIZE),
    fallbackToGmail: fallback,
  };
}

/** `outboxRoadsFor` from the stored setting: one row by key. */
export async function readOutboxRoads<T extends Record<string, unknown>>(db: Database<T>): Promise<OutboxRoads | undefined> {
  return outboxRoadsFor(await readEmailTransport(db), gmailIsConfigured());
}
