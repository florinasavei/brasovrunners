import { and, desc, inArray, isNull, max, or, sql } from "drizzle-orm";
import { emailOutbox } from "@/db/schema/email-outbox";
import type { Database } from "@/db/types";
import { CLUB_COPY_FLAG, isClubCopy } from "./domain/club-notices";
import { CLUB_MAILBOX_MESSAGE_TYPES, recipientRoleOf, type RecipientRole } from "./domain/email-audience";
import { isRejectionCause, rejectionCause, type RejectionCause } from "./domain/rejection-cause";
import { participantMessageCondition, rejectionInstantSql } from "./delivery-facts";

/**
 * What the club's own side reads of the delivery facts (§670): the reads the club's screens draw, kept
 * beside the facts so the screens never write their own SQL over them. Each caller asserts its own
 * permission on the server first: the club mailboxes' refusals name addresses, and only those who read
 * registrations may see them (BR-REQ-060-01).
 */

type Schema = { emailOutbox: typeof emailOutbox };
type Db = Database<Schema>;

export type ClubMailboxRejection = {
  id: string;
  /** Whom it was for, by role (`recipientRoleOf`): the archive copy, the confirmation notice or a club copy. */
  role: RecipientRole;
  /**
   * The mailbox, only while it is still one of the club's (`mailboxes`, from the club's notice settings
   * now); null for an address the club has since removed, which is listed all the same, by its role.
   */
  recipientEmail: string | null;
  messageType: string;
  status: "BOUNCED" | "COMPLAINED";
  at: Date;
  cause: RejectionCause;
  code: string | null;
};

/**
 * The club's own mailboxes that refused a message since `since` (the club's side reads thirty days) —
 * the archive copy of a declaration (§99, §393), «somebody has confirmed» (§245) and the club's copies of
 * the participants' messages (§320), which no longer light a participant's «Email respins» and would
 * otherwise show nowhere. Every such refusal in the window, by its role, newest first, at most `limit` —
 * the limit in SQL, so nothing else can push a refusal out. The address is shown only while it is still
 * in the club's settings (`mailboxes`, `mailboxesReceivingCopies`): a removed mailbox is the club's
 * history, not an address to show. Never a participant's, a colleague's, a subscriber's or an invitee's
 * row: only the club audience and the club copies are read.
 */
export async function listClubMailboxRejections(
  db: Db,
  params: { since: Date; mailboxes: readonly string[]; limit?: number },
): Promise<ClubMailboxRejection[]> {
  // The club's lists drop a repeat without regard to case (`club-notices.ts`); the same reading here.
  const configured = new Set(params.mailboxes.map((address) => address.trim().toLowerCase()).filter((address) => address !== ""));
  const instant = rejectionInstantSql();
  const rows = await db
    .select({
      id: emailOutbox.id,
      recipientEmail: emailOutbox.recipientEmail,
      messageType: emailOutbox.messageType,
      payloadJson: emailOutbox.payloadJson,
      status: emailOutbox.status,
      sentAt: emailOutbox.sentAt,
      at: instant.mapWith(emailOutbox.createdAt),
      cause: emailOutbox.rejectionCause,
      lastError: emailOutbox.lastError,
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
    .orderBy(desc(instant), desc(emailOutbox.id))
    .limit(params.limit ?? 50);
  return rows.map((row) => {
    const status = row.status === "COMPLAINED" ? "COMPLAINED" : "BOUNCED";
    return {
      id: row.id,
      role: recipientRoleOf(row.messageType, isClubCopy(row.payloadJson)),
      recipientEmail: configured.has(row.recipientEmail.trim().toLowerCase()) ? row.recipientEmail : null,
      messageType: row.messageType,
      status,
      at: row.at instanceof Date ? row.at : new Date(String(row.at)),
      // A refusal written without a cause (an older deployment's) reads it as the state does.
      cause: isRejectionCause(row.cause) ? row.cause : rejectionCause({ status, sent: row.sentAt !== null, reason: row.lastError }),
      code: row.code,
    };
  });
}

/** The invitations «Echipa» sends (§123, §524): a colleague's and a club member's. */
const INVITATIONS = ["STAFF_INVITATION", "MEMBER_INVITATION"] as const;

/** How far back «Echipa» looks for an invitation's refusal: the outbox keeps a sent row ninety days. */
const INVITATION_WINDOW_MS = 90 * 24 * 3_600_000;

/**
 * The addresses whose newest invitation was refused (§671), by address in lower case, with the cause — for
 * «Echipa»'s mark beside the name. A later invitation that left answers it (the newest one is read); the
 * club's account refused at the send says nothing about the address and marks nobody. One read of the
 * window's invitations, which carry no registration (`email_outbox_registration_created_idx`). The caller
 * asserts who may read it (`canManageStaff`).
 */
export async function refusedInvitations(db: Db, now: Date): Promise<Map<string, RejectionCause>> {
  const rows = await db
    .select({
      recipientEmail: emailOutbox.recipientEmail,
      status: emailOutbox.status,
      sentAt: emailOutbox.sentAt,
      cause: emailOutbox.rejectionCause,
      lastError: emailOutbox.lastError,
    })
    .from(emailOutbox)
    .where(
      and(
        isNull(emailOutbox.registrationId),
        inArray(emailOutbox.messageType, [...INVITATIONS]),
        sql`${emailOutbox.createdAt} >= ${new Date(now.getTime() - INVITATION_WINDOW_MS).toISOString()}::timestamptz`,
      ),
    )
    .orderBy(desc(emailOutbox.createdAt), desc(emailOutbox.id));
  const newest = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    const key = row.recipientEmail.trim().toLowerCase();
    if (!newest.has(key)) newest.set(key, row);
  }
  const refused = new Map<string, RejectionCause>();
  for (const [address, row] of newest) {
    if (row.status !== "BOUNCED" && row.status !== "COMPLAINED") continue;
    const status = row.status === "COMPLAINED" ? "COMPLAINED" : "BOUNCED";
    const cause = isRejectionCause(row.cause) ? row.cause : rejectionCause({ status, sent: row.sentAt !== null, reason: row.lastError });
    if (cause !== "account") refused.set(address, cause);
  }
  return refused;
}

export type DeliveryEvidence = {
  /** The participants' own messages that left by Mailgun in the last seven days. */
  mailgunSent: number;
  /** Of those, how many Mailgun reported delivered (`delivered_at`): none while some left means the webhook's «Delivered» does not arrive. */
  delivered: number;
  /** The newest of those deliveries; null when none. */
  lastDeliveredAt: Date | null;
};

/**
 * Whether Mailgun's `delivered` events reach this deployment at all (§670): without them nothing ever
 * clears, and every refusal stays as it was. One aggregate over the participants' own messages that left
 * by Mailgun in the last seven days — bounded by `sent_at`, so it reads the recent rows and not the table
 * — against those of them that carry a delivery. Gmail's road reports none, and is left out.
 */
export async function readDeliveryEvidence(db: Db, now: Date): Promise<DeliveryEvidence> {
  const weekAgo = new Date(now.getTime() - 7 * 24 * 3_600_000).toISOString();
  const [row] = await db
    .select({
      mailgunSent: sql<number>`count(*)`.mapWith(Number),
      delivered: sql<number>`count(${emailOutbox.deliveredAt})`.mapWith(Number),
      lastDeliveredAt: max(emailOutbox.deliveredAt),
    })
    .from(emailOutbox)
    .where(
      and(
        participantMessageCondition(),
        sql`${emailOutbox.sentAt} >= ${weekAgo}::timestamptz`,
        sql`${emailOutbox.sentAt} <= ${now.toISOString()}::timestamptz`,
        sql`${emailOutbox.transport} is distinct from 'gmail'`,
      ),
    );
  const last = row?.lastDeliveredAt ?? null;
  return {
    mailgunSent: row?.mailgunSent ?? 0,
    delivered: row?.delivered ?? 0,
    lastDeliveredAt: last === null ? null : last instanceof Date ? last : new Date(String(last)),
  };
}
