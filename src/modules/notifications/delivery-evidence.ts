import { and, desc, inArray, max, or, sql } from "drizzle-orm";
import { emailOutbox } from "@/db/schema/email-outbox";
import type { Database } from "@/db/types";
import { CLUB_COPY_FLAG } from "./domain/club-notices";
import { CLUB_MAILBOX_MESSAGE_TYPES } from "./domain/email-audience";
import { isRejectionCause, type RejectionCause } from "./domain/rejection-cause";
import { rejectionInstantSql } from "./delivery-facts";

/**
 * What the club's own side reads of the delivery facts (§NNN): the reads the club's screens draw, kept
 * beside the facts so the screens never write their own SQL over them. Each caller asserts its own
 * permission on the server first: the club mailboxes' refusals name addresses, and only those who read
 * registrations may see them (BR-REQ-060-01).
 */

type Schema = { emailOutbox: typeof emailOutbox };
type Db = Database<Schema>;

export type ClubMailboxRejection = {
  id: string;
  /** One of the mailboxes the caller named: the club's own, never a participant's, a colleague's or a subscriber's. */
  recipientEmail: string;
  messageType: string;
  status: "BOUNCED" | "COMPLAINED";
  at: Date;
  cause: RejectionCause;
  code: string | null;
};

/**
 * The club's own mailboxes that refused a message since `since` — the archive copy of a declaration
 * (§99, §393), «somebody has confirmed» (§245) and the club's copies of the participants' messages
 * (§320), which no longer light a participant's «Email respins» and would otherwise show nowhere. Only
 * rows addressed to one of `mailboxes` — the caller passes the addresses in the club's notice settings
 * now (`mailboxesReceivingCopies`), so an address the club removed, a colleague's invitation, a
 * subscriber's newsletter and an invitee are never listed. Newest first; at most `limit`.
 */
export async function listClubMailboxRejections(
  db: Db,
  params: { since: Date; mailboxes: readonly string[]; limit?: number },
): Promise<ClubMailboxRejection[]> {
  // The club's lists drop a repeat without regard to case (`club-notices.ts`); the same reading here.
  const wanted = new Set(params.mailboxes.map((address) => address.trim().toLowerCase()).filter((address) => address !== ""));
  if (wanted.size === 0) return [];
  const instant = rejectionInstantSql();
  const rows = await db
    .select({
      id: emailOutbox.id,
      recipientEmail: emailOutbox.recipientEmail,
      messageType: emailOutbox.messageType,
      status: emailOutbox.status,
      at: instant.mapWith(emailOutbox.createdAt),
      cause: emailOutbox.rejectionCause,
      code: emailOutbox.providerCode,
    })
    .from(emailOutbox)
    .where(
      and(
        inArray(emailOutbox.status, ["BOUNCED", "COMPLAINED"]),
        or(
          inArray(emailOutbox.messageType, [...CLUB_MAILBOX_MESSAGE_TYPES]),
          sql`coalesce(${emailOutbox.payloadJson} -> ${CLUB_COPY_FLAG}::text = 'true'::jsonb, false)`,
        ),
        sql`${instant} >= ${params.since.toISOString()}::timestamptz`,
      ),
    )
    .orderBy(desc(instant))
    .limit(500);
  return rows
    .filter((row) => wanted.has(row.recipientEmail.trim().toLowerCase()))
    .slice(0, params.limit ?? 50)
    .map((row) => ({
      ...row,
      status: row.status === "COMPLAINED" ? "COMPLAINED" : "BOUNCED",
      at: row.at instanceof Date ? row.at : new Date(String(row.at)),
      cause: isRejectionCause(row.cause) ? row.cause : row.status === "COMPLAINED" ? "complaint" : "other",
    }));
}

export type DeliveryEvidence = {
  /** The newest delivery Mailgun reported (`delivered_at`); null when none ever was — the webhook's «Delivered» is not subscribed, or nothing left yet. */
  lastDeliveredAt: Date | null;
  /** Messages that left by Mailgun between a day and an hour ago: if these exist and no delivery came, the delivered events are not arriving. */
  mailgunSentLastDay: number;
};

/**
 * Whether Mailgun's `delivered` events reach this deployment at all (§NNN): without them nothing ever
 * clears, and every refusal stays as it was. One aggregate over the outbox, which the retention sweep
 * keeps to ninety days of sent rows.
 */
export async function readDeliveryEvidence(db: Db, now: Date): Promise<DeliveryEvidence> {
  const dayAgo = new Date(now.getTime() - 24 * 3_600_000).toISOString();
  const hourAgo = new Date(now.getTime() - 3_600_000).toISOString();
  const [row] = await db
    .select({
      lastDeliveredAt: max(emailOutbox.deliveredAt),
      mailgunSentLastDay: sql<number>`count(*) filter (where ${emailOutbox.sentAt} >= ${dayAgo}::timestamptz and ${emailOutbox.sentAt} <= ${hourAgo}::timestamptz and ${emailOutbox.transport} is distinct from 'gmail')`.mapWith(Number),
    })
    .from(emailOutbox);
  const last = row?.lastDeliveredAt ?? null;
  return { lastDeliveredAt: last === null ? null : last instanceof Date ? last : new Date(String(last)), mailgunSentLastDay: row?.mailgunSentLastDay ?? 0 };
}
