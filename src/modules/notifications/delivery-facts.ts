import { and, desc, eq, inArray, isNotNull, min, ne, type SQL, sql } from "drizzle-orm";
import { type EmailMessageType, emailOutbox } from "@/db/schema/email-outbox";
import type { Database } from "@/db/types";
import { CLUB_COPY_FLAG, isClubCopy } from "./domain/club-notices";
import { PARTICIPANT_MESSAGE_TYPES } from "./domain/email-audience";

/**
 * What a later message says about an earlier refusal (§NNN) — the three facts the registration's email
 * state is read from, kept on the refused row itself so that a list of two hundred registrations reads
 * them with one probe each and nothing more:
 *
 * - `later_delivered_at` — a later message to the same address was **delivered**: the address works
 *   again. Any of the participant's own messages, for any registration — the address is one fact, and a
 *   family on one address (§543) shares it. Never on a complaint, which is the person's own word, and
 *   never on a refusal of the club's account, which said nothing about the address.
 * - `resolved_at` — the **same** message (its type, for the same registration) was delivered later; or,
 *   for a refusal of the club's account, left later. Only that ends the refusal: a delivered «Mesaj de
 *   la organizatori» does not give the runner the QR the bounced confirmation carried.
 * - `retried_at` and `retried_via` — the same message left again later, and by which road: delivery not
 *   known yet, or never (Gmail's road reports no delivery).
 *
 * Kept from both sides, so the result does not depend on the order Mailgun's events arrive in (it does
 * not promise one, and retries a webhook for hours): a refusal written after the delivery that clears it
 * reads that delivery (`settleRejection`), and a delivery written after the refusal marks it
 * (`settleDelivery`) — both under the participant's advisory lock, so two events for one address
 * processed at the same moment cannot each miss the other's uncommitted row. Instants are the events'
 * own (Mailgun's `timestamp`), never the moment the webhook ran.
 *
 * The rows live as long as the registration does (the retention sweep deletes only `SENT` rows past 90
 * days, `jobs/retention.ts`), so a refusal stays cleared after the delivery that cleared it is gone.
 */

type Schema = { emailOutbox: typeof emailOutbox };
type Db = Database<Schema>;
type Handle = Pick<Db, "select" | "update">;

/** The participant's own messages, as SQL (§NNN): their type, their id on the row, and not a club copy. */
export function participantMessageCondition(): SQL {
  return and(
    isNotNull(emailOutbox.participantId),
    inArray(emailOutbox.messageType, [...PARTICIPANT_MESSAGE_TYPES]),
    // `::text`: jsonb has `->` for a key and for an index, and an untyped parameter matches both.
    sql`coalesce(${emailOutbox.payloadJson} -> ${CLUB_COPY_FLAG}::text = 'true'::jsonb, false) = false`,
  ) as SQL;
}

/**
 * A participant's own message whose refusal still stands for the **address** (§NNN, amending §653): a
 * complaint — the person's own word, which no delivery withdraws — or a refusal with nothing delivered to
 * the address since. Never a refusal of the club's account, which said nothing about the address, and
 * never a club mailbox's.
 */
export function addressRefusedCondition(): SQL {
  return and(
    participantMessageCondition(),
    sql`(${emailOutbox.status} = 'COMPLAINED' or (${emailOutbox.status} = 'BOUNCED' and ${emailOutbox.rejectionCause} is distinct from 'account' and ${emailOutbox.laterDeliveredAt} is null))`,
  ) as SQL;
}

/** The same answer for one row in hand. */
export function isParticipantMeant(row: { participantId: string | null; messageType: EmailMessageType; payloadJson: unknown }): boolean {
  return row.participantId !== null && PARTICIPANT_MESSAGE_TYPES.includes(row.messageType) && !isClubCopy(row.payloadJson);
}

/**
 * When a refusal happened: `rejected_at`, or — on a row refused before the column existed — when it
 * left, else when it was queued (a refusal at the send never left).
 */
export function rejectionInstantSql(): SQL<Date> {
  return sql<Date>`coalesce(${emailOutbox.rejectedAt}, ${emailOutbox.sentAt}, ${emailOutbox.createdAt})`;
}

const at = (instant: Date) => sql`${instant.toISOString()}::timestamptz`;

/** A timestamp a driver handed back as a `Date` or as text, or null. */
function instantOf(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

/** The participant's lock (§NNN): the settling of one address's facts, one transaction at a time. */
export async function lockParticipantFacts(handle: Pick<Db, "execute">, participantId: string): Promise<void> {
  await handle.execute(sql`select pg_advisory_xact_lock(hashtext(${`email-facts:${participantId}`}))`);
}

type DeliveredRow = { id: string; participantId: string; registrationId: string | null; messageType: EmailMessageType };

/**
 * A participant's message was delivered at `deliveredAt`: every earlier refusal of the address says the
 * address works now, and every earlier refusal of the same message says it is over. A complaint is left
 * as it is; a refusal of the account takes no `later_delivered_at` (it was never about the address).
 */
export async function settleDelivery(handle: Handle, row: DeliveredRow, deliveredAt: Date): Promise<void> {
  const before = sql`${rejectionInstantSql()} < ${at(deliveredAt)}`;
  await handle
    .update(emailOutbox)
    .set({ laterDeliveredAt: sql`least(${emailOutbox.laterDeliveredAt}, ${at(deliveredAt)})` })
    .where(
      and(
        eq(emailOutbox.participantId, row.participantId),
        ne(emailOutbox.id, row.id),
        eq(emailOutbox.status, "BOUNCED"),
        participantMessageCondition(),
        sql`${emailOutbox.rejectionCause} is distinct from 'account'`,
        before,
      ),
    );
  await handle
    .update(emailOutbox)
    .set({ resolvedAt: sql`least(${emailOutbox.resolvedAt}, ${at(deliveredAt)})` })
    .where(
      and(
        eq(emailOutbox.participantId, row.participantId),
        ne(emailOutbox.id, row.id),
        eq(emailOutbox.status, "BOUNCED"),
        eq(emailOutbox.messageType, row.messageType),
        sql`${emailOutbox.registrationId} is not distinct from ${row.registrationId}`,
        before,
      ),
    );
}

/**
 * A participant's message was refused (its row already says so): read what came after it from the other
 * rows — a delivery to the address, a delivery of the same message, the same message sent again — so a
 * refusal processed after the delivery that answers it is answered all the same. Nothing for a complaint.
 */
export async function settleRejection(handle: Handle, rowId: string): Promise<void> {
  const [row] = await handle
    .select({
      id: emailOutbox.id,
      participantId: emailOutbox.participantId,
      registrationId: emailOutbox.registrationId,
      messageType: emailOutbox.messageType,
      payloadJson: emailOutbox.payloadJson,
      status: emailOutbox.status,
      rejectionCause: emailOutbox.rejectionCause,
      createdAt: emailOutbox.createdAt,
      instant: rejectionInstantSql(),
    })
    .from(emailOutbox)
    .where(eq(emailOutbox.id, rowId))
    .limit(1);
  const instant = instantOf(row?.instant);
  if (!row || !instant || row.status !== "BOUNCED" || row.participantId === null || !isParticipantMeant(row)) return;

  const others = and(eq(emailOutbox.participantId, row.participantId), ne(emailOutbox.id, row.id), participantMessageCondition()) as SQL;
  const sameMessage = and(
    others,
    eq(emailOutbox.messageType, row.messageType),
    sql`${emailOutbox.registrationId} is not distinct from ${row.registrationId}`,
  ) as SQL;
  const deliveredAfter = sql`${emailOutbox.deliveredAt} > ${at(instant)}`;
  const leftAgain = and(sameMessage, sql`${emailOutbox.createdAt} >= ${at(row.createdAt)}`, isNotNull(emailOutbox.sentAt)) as SQL;
  const account = row.rejectionCause === "account";

  // The address works again: never read for the account's refusal, which was not about it.
  const [address] = account ? [] : await handle.select({ first: min(emailOutbox.deliveredAt) }).from(emailOutbox).where(and(others, deliveredAfter));
  const [same] = await handle.select({ first: min(emailOutbox.deliveredAt) }).from(emailOutbox).where(and(sameMessage, deliveredAfter));
  const [again] = await handle
    .select({ sentAt: emailOutbox.sentAt, transport: emailOutbox.transport })
    .from(emailOutbox)
    .where(leftAgain)
    .orderBy(desc(emailOutbox.sentAt))
    .limit(1);
  // The account's refusal is over once the same message left at all — the earliest such send.
  const [firstAgain] = account && again ? await handle.select({ first: min(emailOutbox.sentAt) }).from(emailOutbox).where(leftAgain) : [];

  const laterDelivered = instantOf(address?.first);
  const resolvedCandidates = [instantOf(same?.first), instantOf(firstAgain?.first)].filter((value): value is Date => value !== null);
  const resolved = resolvedCandidates.length > 0 ? new Date(Math.min(...resolvedCandidates.map((value) => value.getTime()))) : null;
  const retried = instantOf(again?.sentAt);
  if (!laterDelivered && !resolved && !retried) return;
  await handle
    .update(emailOutbox)
    .set({
      ...(laterDelivered ? { laterDeliveredAt: sql`least(${emailOutbox.laterDeliveredAt}, ${at(laterDelivered)})` } : {}),
      ...(resolved ? { resolvedAt: sql`least(${emailOutbox.resolvedAt}, ${at(resolved)})` } : {}),
      ...(retried ? { retriedAt: retried, retriedVia: again?.transport ?? "mailgun" } : {}),
    })
    .where(eq(emailOutbox.id, row.id));
}

type SentRow = { id: string; participantId: string | null; registrationId: string | null; messageType: EmailMessageType; payloadJson: unknown; createdAt: Date };

/**
 * A participant's message left (`sent_at`, by `via`): every earlier refusal of the same message — its
 * type, for the same registration, queued no later — was sent again. A refusal of the club's account is
 * over with it (it never left; now it has). Refusals only (BOUNCED): a complaint stays the person's word.
 * One statement, and it changes nothing for a message with no refusal before it.
 */
export async function noteSentAgain(handle: Pick<Db, "update">, row: SentRow, sentAt: Date, via: "mailgun" | "gmail"): Promise<void> {
  if (row.participantId === null || !isParticipantMeant(row)) return;
  await handle
    .update(emailOutbox)
    .set({
      // Every expression reads the row as it was: the road is the newest send's.
      retriedVia: sql`case when ${emailOutbox.retriedAt} is null or ${emailOutbox.retriedAt} <= ${at(sentAt)} then ${via} else ${emailOutbox.retriedVia} end`,
      retriedAt: sql`greatest(${emailOutbox.retriedAt}, ${at(sentAt)})`,
      resolvedAt: sql`case when ${emailOutbox.rejectionCause} = 'account' then least(${emailOutbox.resolvedAt}, ${at(sentAt)}) else ${emailOutbox.resolvedAt} end`,
    })
    .where(
      and(
        eq(emailOutbox.participantId, row.participantId),
        ne(emailOutbox.id, row.id),
        eq(emailOutbox.status, "BOUNCED"),
        eq(emailOutbox.messageType, row.messageType),
        sql`${emailOutbox.registrationId} is not distinct from ${row.registrationId}`,
        sql`${emailOutbox.createdAt} <= ${at(row.createdAt)}`,
      ),
    );
}
