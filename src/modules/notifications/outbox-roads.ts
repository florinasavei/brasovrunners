import { GMAIL_PACE_BUDGET_MS } from "@/infrastructure/email/delivery";
import type { Database } from "@/db/types";
import { type EmailTransportSetting, gmailClaimSize, gmailRoadRows } from "./domain/email-transport";
import { noticeDescribesGmailFallback } from "@/modules/legal-documents/repository";
import { fallbackActive, fallbackSwitchOn } from "./domain/mailgun-stop";
import { gmailIsConfigured, readEmailTransport } from "./email-transport";
import { OUTBOX_BATCH_SIZE, type OutboxRoads } from "./outbox";

/**
 * The two roads as the claim splits them (§442): Gmail's rows, by the club's setting, apart from
 * Mailgun's. Claimed apart only where Gmail can carry anything (§443 review): without the account
 * every row takes Mailgun's road, and one claim, oldest first, is the whole story — undefined.
 * The one rule the sender (`outbox-sender.ts`), `/api/health`, the page's hour and the queue
 * panel read the roads by (§605, §529).
 */
export function outboxRoadsFor(setting: EmailTransportSetting, configured: boolean, noticeNamesFallback: boolean): OutboxRoads | undefined {
  const gmail = gmailRoadRows(setting);
  // «Gmail preia când Mailgun se oprește» (§622): Gmail's road exists for a stop even when no group is Gmail's —
  // once the notice in force names the fallback.
  const fallback = fallbackActive(setting, configured, noticeNamesFallback);
  if (!configured || (gmail.messageTypes.length === 0 && !gmail.clubCopies && !fallback)) return undefined;
  return {
    gmailMessageTypes: gmail.messageTypes,
    gmailClubCopies: gmail.clubCopies,
    gmailBatchSize: gmailClaimSize(setting.gmailPaceSeconds, GMAIL_PACE_BUDGET_MS, OUTBOX_BATCH_SIZE),
    fallbackToGmail: fallback,
  };
}

/**
 * Whether the privacy notice in force lets the fallback carry (§622, `noticeDescribesGmailFallback`),
 * for the outbox's own readers — the claim's roads, the sender, `/api/health`. Asked only where it can
 * change something: with Gmail not configured, or the switch off, the answer cannot make Gmail carry,
 * so the two reads of the notice are not made on every batch for nothing.
 */
export async function fallbackNoticeForOutbox<T extends Record<string, unknown>>(
  db: Database<T>,
  setting: EmailTransportSetting,
  configured: boolean,
  now: Date,
): Promise<boolean> {
  if (!configured || !fallbackSwitchOn(setting)) return false;
  return noticeDescribesGmailFallback(db, now);
}

/** `outboxRoadsFor` from the stored setting: one row by key, and the notice when the switch could act. */
export async function readOutboxRoads<T extends Record<string, unknown>>(db: Database<T>, now: Date = new Date()): Promise<OutboxRoads | undefined> {
  const setting = await readEmailTransport(db);
  const configured = gmailIsConfigured();
  return outboxRoadsFor(setting, configured, await fallbackNoticeForOutbox(db, setting, configured, now));
}
