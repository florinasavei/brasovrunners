import type { EmailTransportName } from "@/infrastructure/email/adapter";
import type { EmailSender } from "@/infrastructure/email/delivery";
import { createEmailSenderForEnvironment } from "@/infrastructure/email/sender";
import type { Database } from "@/db/types";
import { env } from "@/shared/config/env";
import { isClubCopy } from "./domain/club-notices";
import { preferredTransport } from "./domain/email-transport";
import { gmailIsConfigured, readEmailTransport, readGmailUsage } from "./email-transport";
import type { OutboxRow } from "./outbox";

/**
 * The sender a batch of the outbox goes out through, and the road each row asks for (§NNN) — the
 * one place the three workers (the drain after a response, the job, "Trimite acum") build it.
 *
 * Two small reads before the batch: the club's setting (one row by key) and Gmail's last day
 * (one count on the outbox) — the second only when this deployment has Gmail at all. Neither is
 * read again per message: the sender keeps counting from there.
 */
export type OutboxRoute = (row: OutboxRow) => EmailTransportName;

export async function createOutboxSender<T extends Record<string, unknown>>(
  db: Database<T>,
  now: Date,
): Promise<{ sender: EmailSender; route: OutboxRoute }> {
  const setting = await readEmailTransport(db);
  const configured = gmailIsConfigured();
  const usage = configured ? await readGmailUsage(db, now, true) : { configured: false, sentLastDay: 0, lastSentAt: null };
  const { sender } = createEmailSenderForEnvironment(env, {
    dailyCap: setting.gmailDailyCap,
    paceSeconds: setting.gmailPaceSeconds,
    overflowToGmail: setting.overflowToGmail,
    usage,
  });
  return {
    sender,
    route: (row) => preferredTransport(setting, row.messageType, isClubCopy(row.payloadJson)),
  };
}
