import { and, eq, or, sql } from "drizzle-orm";
import { type EmailMessageType, emailOutbox } from "@/db/schema/email-outbox";
import type { Database } from "@/db/types";
import { DomainError } from "@/shared/errors/domain-error";
import { readClubNotices } from "./club-notices";
import { clubCopyRecipients, isCopiedPerMessage, participantMessageBcc } from "./domain/club-notices";
import { roomToSendNow, SENT_NOW_FLAG } from "./domain/send-at-once";
import { preferredTransport, roadsByMessageType } from "./domain/email-transport";
import { gmailIsConfigured, readEmailTransport } from "./email-transport";
import { readEmailVolumeToday } from "./volume";

/**
 * The server half of «Trimite acum, fără să aștepte trecerea programată» (§540, amending §513, §80
 * and §68): the press's own rows, and only those, sent right after its response, inside the day's
 * allowance and through the road the message's group is set to (§443). What a press sends:
 *
 * - **its own rows** — the message it queued and the club's copies that ride on it (§320, §419),
 *   found by the idempotency key the press wrote (`outboxIdsForKey`), never the rest of the queue:
 *   everything automatic keeps «Când pleacă emailurile»;
 * - **inside the allowance** (§80): checked before anything is queued (`assertRoomToSendNow`). A
 *   press over it is refused with a sentence and queues nothing — never a silent defer; «Pune la
 *   coadă» is the answer that waits for the reset;
 * - **through the same worker** (`processOutboxBatch`, §16.2): claimed under `FOR UPDATE SKIP
 *   LOCKED`, rendered, retried and deferred as at 03:00. A row already sent, bounced or failed is
 *   not claimed (§39: a resend is a new row, and the same message is never sent twice).
 */

/** The refusal's code, a sentence in `Admin.errors` (§540). */
export const SEND_NOW_ALLOWANCE_SPENT = "SEND_NOW_ALLOWANCE_SPENT";
/** The hour's refusal (§NNN): Mailgun's hourly pace has no room for the press; a sentence in `Admin.errors`. */
export const SEND_NOW_HOUR_SPENT = "SEND_NOW_HOUR_SPENT";

/**
 * A press that asked to send now past what Mailgun still holds (§80, §540): the day's allowance, or
 * since §NNN the hour's pace. `reason` names which, and is the sentence's key.
 */
export class SendNowRefused extends DomainError {
  readonly reason: typeof SEND_NOW_ALLOWANCE_SPENT | typeof SEND_NOW_HOUR_SPENT;
  constructor(message: string, reason: typeof SEND_NOW_ALLOWANCE_SPENT | typeof SEND_NOW_HOUR_SPENT = SEND_NOW_ALLOWANCE_SPENT) {
    super("VALIDATION_ERROR", message);
    this.name = "SendNowRefused";
    this.reason = reason;
  }
}

/** The code a backoffice action lands on: the allowance's own sentence, or the domain code. */
export function sendNowRefusalCode(error: DomainError): string {
  return error instanceof SendNowRefused ? error.reason : error.code;
}

/**
 * Refuses a press whose Mailgun messages the day's allowance cannot hold — the participants' and the
 * club's copies that ride on them (`clubCopyTypes`), each on its own group's road. Gmail's road costs
 * the allowance nothing (§443); a road that is Gmail's where Gmail is not configured is Mailgun's.
 *
 * And, since §NNN, the hour: a press whose Mailgun messages the hourly pace has no room for is
 * refused the same way, with its own sentence — the claim would hold them back anyway, and a «now»
 * that leaves in forty minutes is not what the person pressed. «Pune la coadă» is the answer.
 */
export async function assertRoomToSendNow<T extends Record<string, unknown>>(
  db: Database<T>,
  messageTypes: readonly EmailMessageType[],
  now: Date,
  clubCopyTypes: readonly EmailMessageType[] = [],
): Promise<void> {
  if (messageTypes.length === 0 && clubCopyTypes.length === 0) return;
  const [setting, volume] = await Promise.all([readEmailTransport(db), readEmailVolumeToday(db, now)]);
  const gmail = gmailIsConfigured();
  const roads = roadsByMessageType(setting, gmail);
  const copyRoad = (type: EmailMessageType) => (gmail ? preferredTransport(setting, type, true) : "mailgun");
  const mailgunMessages =
    messageTypes.filter((type) => roads[type] === "mailgun").length + clubCopyTypes.filter((type) => copyRoad(type) === "mailgun").length;
  if (!roomToSendNow({ remaining: volume.remaining, mailgunMessages })) {
    throw new SendNowRefused(`the day's Mailgun allowance has ${volume.remaining} left; ${mailgunMessages} would be sent now`);
  }
  if (!roomToSendNow({ remaining: volume.hourRemaining, mailgunMessages })) {
    throw new SendNowRefused(`Mailgun's hourly pace has ${volume.hourRemaining} left this hour; ${mailgunMessages} would be sent now`, SEND_NOW_HOUR_SPENT);
  }
}

/**
 * The club's copies a press's message brings with it, one message type per copy (§320, §419): per
 * message for a real registration's own message (`enqueueClubCopies`), one per address for a send to
 * many (`perSend`, `enqueueBulkClubCopies`). What the allowance check counts beside the message.
 */
export async function clubCopyTypesFor<T extends Record<string, unknown>>(
  db: Database<T>,
  input: { messageType: EmailMessageType; recipientEmail: string; real: boolean; perSend?: boolean },
): Promise<EmailMessageType[]> {
  if (!input.real || (!input.perSend && !isCopiedPerMessage(input.messageType))) return [];
  const recipients = clubCopyRecipients(input.perSend ? "" : input.recipientEmail, participantMessageBcc(await readClubNotices(db)));
  return recipients.map(() => input.messageType);
}

/**
 * The rows one press queued: the key it wrote, and every row keyed under it — the club's copies
 * (`<key>:club-copy:<address>`) and, for a send to many, each recipient's (`<key>:registration:<id>`).
 *
 * Only waiting rows (`PENDING`): the press has just queued them and nothing else may send them but
 * this drain or the outbox job — and only a waiting row can be claimed anyway. The status is the
 * claim index's first column (`email_outbox_status_next_attempt_created_idx`), so the prefix is
 * compared over the queue, never over every message the club ever sent (§540 review).
 */
export async function outboxIdsForKey<T extends Record<string, unknown>>(
  db: Database<T>,
  key: string,
  options: { markedOnly?: boolean } = {},
): Promise<string[]> {
  const under = `${key}:`;
  const rows = await db
    .select({ id: emailOutbox.id })
    .from(emailOutbox)
    .where(
      and(
        eq(emailOutbox.status, "PENDING"),
        or(eq(emailOutbox.idempotencyKey, key), sql`left(${emailOutbox.idempotencyKey}, ${under.length}) = ${under}`),
        // A send to many past `SEND_NOW_ROW_LIMIT` (§540): only the rows the press marked leave now.
        options.markedOnly ? sql`(${emailOutbox.payloadJson} ->> ${SENT_NOW_FLAG}::text) = 'true'` : undefined,
      ),
    )
    .orderBy(emailOutbox.createdAt);
  return rows.map((row) => row.id);
}
