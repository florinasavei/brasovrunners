import { eq, or, sql } from "drizzle-orm";
import { type EmailMessageType, emailOutbox } from "@/db/schema/email-outbox";
import type { Database } from "@/db/types";
import { DomainError } from "@/shared/errors/domain-error";
import { roomToSendNow } from "./domain/send-at-once";
import { roadsByMessageType } from "./domain/email-transport";
import { gmailIsConfigured, readEmailTransport } from "./email-transport";
import { readEmailVolumeToday } from "./volume";

/**
 * The server half of «Trimite acum, fără să aștepte trecerea programată» (§NNN, amending §513, §80
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

/** The refusal's code, a sentence in `Admin.errors` (§NNN). */
export const SEND_NOW_ALLOWANCE_SPENT = "SEND_NOW_ALLOWANCE_SPENT";

/** A press that asked to send now past what the day's Mailgun allowance still holds (§80, §NNN). */
export class SendNowRefused extends DomainError {
  readonly reason = SEND_NOW_ALLOWANCE_SPENT;
  constructor(message: string) {
    super("VALIDATION_ERROR", message);
    this.name = "SendNowRefused";
  }
}

/** The code a backoffice action lands on: the allowance's own sentence, or the domain code. */
export function sendNowRefusalCode(error: DomainError): string {
  return error instanceof SendNowRefused ? error.reason : error.code;
}

/**
 * Refuses a press whose Mailgun messages the day's allowance cannot hold. Gmail's road costs the
 * allowance nothing (§443); a road that is Gmail's where Gmail is not configured is Mailgun's.
 */
export async function assertRoomToSendNow<T extends Record<string, unknown>>(
  db: Database<T>,
  messageTypes: readonly EmailMessageType[],
  now: Date,
): Promise<void> {
  if (messageTypes.length === 0) return;
  const [setting, volume] = await Promise.all([readEmailTransport(db), readEmailVolumeToday(db, now)]);
  const roads = roadsByMessageType(setting, gmailIsConfigured());
  const mailgunMessages = messageTypes.filter((type) => roads[type] === "mailgun").length;
  if (!roomToSendNow({ remaining: volume.remaining, mailgunMessages })) {
    throw new SendNowRefused(`the day's Mailgun allowance has ${volume.remaining} left; ${mailgunMessages} would be sent now`);
  }
}

/**
 * The rows one press queued: the key it wrote, and every row keyed under it — the club's copies
 * (`<key>:club-copy:<address>`) and, for a send to many, each recipient's (`<key>:registration:<id>`).
 */
export async function outboxIdsForKey<T extends Record<string, unknown>>(db: Database<T>, key: string): Promise<string[]> {
  const under = `${key}:`;
  const rows = await db
    .select({ id: emailOutbox.id })
    .from(emailOutbox)
    .where(or(eq(emailOutbox.idempotencyKey, key), sql`left(${emailOutbox.idempotencyKey}, ${under.length}) = ${under}`))
    .orderBy(emailOutbox.createdAt);
  return rows.map((row) => row.id);
}
