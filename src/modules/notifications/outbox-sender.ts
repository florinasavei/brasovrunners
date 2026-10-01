import type { EmailTransportName } from "@/infrastructure/email/adapter";
import type { EmailSender } from "@/infrastructure/email/delivery";
import { createEmailSenderForEnvironment } from "@/infrastructure/email/sender";
import type { Database } from "@/db/types";
import { replyToInForce } from "@/modules/contact/shown-address";
import { env } from "@/shared/config/env";
import { isClubCopy } from "./domain/club-notices";
import { preferredTransport } from "./domain/email-transport";
import { fallbackActive } from "./domain/mailgun-stop";
import { createGmailLedger, gmailIsConfigured, readEmailTransport, recordGmailFailure } from "./email-transport";
import type { OutboxRoads, OutboxRow } from "./outbox";
import { fallbackNoticeForOutbox, outboxRoadsFor } from "./outbox-roads";

/**
 * The sender a batch of the outbox goes out through, the road each row asks for, how the claim
 * splits the rows between the two roads (§442), and the Reply-To both the sender and the renderer
 * set (§442, «Adresa de contact afișată») — the one place the three workers (the drain after a
 * response, the job, "Trimite acum") build them.
 *
 * Two small reads before the batch: the club's transport setting and the shown contact address
 * (one row by key each) — and, while «Gmail preia când Mailgun se oprește» is on where Gmail is
 * configured, the privacy notice in force in each language (§NNN). Gmail's usage is not read here: the sender asks the database's ledger
 * before every Gmail message, so the pace and the cap hold across drains and instances (§443 review).
 */
export type OutboxRoute = (row: OutboxRow) => EmailTransportName;

export async function createOutboxSender<T extends Record<string, unknown>>(
  db: Database<T>,
): Promise<{ sender: EmailSender; route: OutboxRoute; roads?: OutboxRoads; replyTo: string | undefined }> {
  // The Reply-To the club chose to show (§442), read once per batch; the renderer's "or reply" line follows it.
  const [setting, replyTo] = await Promise.all([readEmailTransport(db), replyToInForce(db)]);
  const configured = gmailIsConfigured();
  // The fallback acts only under a notice that names it (§NNN): read once per batch, and only when the switch could act.
  const noticeNamesFallback = await fallbackNoticeForOutbox(db, setting, configured, new Date());
  const { sender } = createEmailSenderForEnvironment(env, {
    replyTo,
    gmail: {
      dailyCap: setting.gmailDailyCap,
      paceSeconds: setting.gmailPaceSeconds,
      atGmailCap: setting.atGmailCap,
      /*
        A Mailgun refusal of the account spills to Gmail when the club lets it (§443), and always while
        «Gmail preia când Mailgun se oprește» is on (§NNN): the message Mailgun just refused is the
        first the fallback carries, and the stop it announced closes Mailgun's road for the rest.
      */
      overflowToGmail: setting.overflowToGmail || fallbackActive(setting, configured, noticeNamesFallback),
      ledger: createGmailLedger(db),
      // Every Gmail failure is kept for /admin/emails and /api/health (§443), not only fallen back from.
      onFailure: (error, at) => recordGmailFailure(db, error, at),
    },
  });
  const roads = outboxRoadsFor(setting, configured, noticeNamesFallback);
  return {
    sender,
    replyTo,
    route: (row) => preferredTransport(setting, row.messageType, isClubCopy(row.payloadJson)),
    ...(roads ? { roads } : {}),
  };
}
