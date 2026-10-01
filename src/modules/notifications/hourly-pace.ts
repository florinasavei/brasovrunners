import { and, count, eq, gt, type SQL, sql } from "drizzle-orm";
import { emailOutbox } from "@/db/schema/email-outbox";
import type { Database } from "@/db/types";
import { PROCESSING_LOCK_TIMEOUT_MS } from "./domain/retry";
import { hourlyRoom, PACE_EVIDENCE_MS, PACE_WINDOW_MS } from "./domain/hourly-pace";
import { readEmailPlan } from "./email-plan";

/**
 * Mailgun's hour as the outbox counts it (§NNN, `domain/hourly-pace.ts`): what Mailgun's road
 * carried in the trailing sixty minutes, what it is carrying now, and the room the pace leaves.
 */
export type MailgunHour = {
  /** The email plan setting's `hourlyAllowance`; null when the club cleared it — no pace. */
  allowance: number | null;
  /** Messages Mailgun carried in the last sixty minutes (`sent_at` inside the window). */
  sentLastHour: number;
  /** Rows claimed for Mailgun's road and not yet recorded: leaving now, so already spent. */
  inFlight: number;
  /** `allowance − sentLastHour − inFlight`, never below zero; null when no pace is set. */
  remaining: number | null;
  /** Messages Mailgun carried in the last ninety minutes: whether the pace, not a stall, holds a backlog. */
  carriedRecently: number;
};

/**
 * A row Mailgun's API took: every sent row but the club's Gmail's (§443), as the day's and the
 * month's volume count it (`volume.ts`) — whatever its status since (a webhook may have moved it to
 * DELIVERED or BOUNCED; it left all the same); a null `transport` predates the column. Less the
 * rows the environment captured (`recipient_count = 0`: local, the tests, a QA address off the
 * allowlist): they never reached Mailgun, and counting them would pace a laptop or the end-to-end
 * suite to a hundred an hour for nothing. A null count predates that column and is counted.
 */
export const carriedByMailgunApi = sql`((${emailOutbox.transport} IS NULL OR ${emailOutbox.transport} <> 'gmail') AND (${emailOutbox.recipientCount} IS NULL OR ${emailOutbox.recipientCount} > 0))`;

/**
 * The hour's figures in **one query**: two conditional counts over the rows sent since the window
 * opened or claimed and still held. Its cost: `sent_at` is the second column of
 * `email_outbox_transport_sent_idx` and the claim's status is the first of
 * `email_outbox_status_next_attempt_created_idx`, and the table is the club's own mail — a season's
 * worth is a few thousand rows — so it is a scan of an index range or of a small table, a
 * millisecond, once per claim; never per row.
 *
 * `mailgunRoad` narrows the in-flight rows to Mailgun's road when Gmail carries some of the mail
 * (`outbox.ts`): a row claimed for Gmail costs Mailgun nothing. Without it, every held row counts —
 * the cautious answer. A held row past the lock timeout is not counted: it is a crashed worker's,
 * and the claim is about to take it back.
 */
export async function countMailgunHour<T extends Record<string, unknown>>(
  db: Database<T>,
  now: Date,
  mailgunRoad?: SQL,
): Promise<{ sentLastHour: number; inFlight: number; carriedRecently: number }> {
  const windowStart = new Date(now.getTime() - PACE_WINDOW_MS);
  const evidenceStart = new Date(now.getTime() - PACE_EVIDENCE_MS);
  const staleBefore = new Date(now.getTime() - PROCESSING_LOCK_TIMEOUT_MS);
  const held = and(eq(emailOutbox.status, "PROCESSING"), gt(emailOutbox.lockedAt, staleBefore), mailgunRoad) as SQL;
  const [row] = await db
    .select({
      sentLastHour: count(sql`case when ${emailOutbox.sentAt} > ${windowStart.toISOString()}::timestamptz then 1 end`),
      carriedRecently: count(sql`case when ${emailOutbox.sentAt} > ${evidenceStart.toISOString()}::timestamptz then 1 end`),
      inFlight: count(sql`case when ${held} then 1 end`),
    })
    .from(emailOutbox)
    .where(sql`((${emailOutbox.sentAt} > ${evidenceStart.toISOString()}::timestamptz AND ${carriedByMailgunApi}) OR ${held})`);
  return { sentLastHour: row?.sentLastHour ?? 0, inFlight: row?.inFlight ?? 0, carriedRecently: row?.carriedRecently ?? 0 };
}

/**
 * The hour against the setting: the plan read once (a primary-key lookup), the count only when a
 * pace is set — a club that cleared the box pays nothing for it — unless `alwaysCount` asks for the
 * figure anyway (the page that shows it).
 */
export async function readMailgunHour<T extends Record<string, unknown>>(
  db: Database<T>,
  now: Date,
  options: { mailgunRoad?: SQL; hourlyAllowance?: number | null; alwaysCount?: boolean } = {},
): Promise<MailgunHour> {
  const allowance = options.hourlyAllowance !== undefined ? options.hourlyAllowance : (await readEmailPlan(db)).hourlyAllowance;
  if (allowance === null && !options.alwaysCount) return { allowance, sentLastHour: 0, inFlight: 0, remaining: null, carriedRecently: 0 };
  const { sentLastHour, inFlight, carriedRecently } = await countMailgunHour(db, now, options.mailgunRoad);
  return { allowance, sentLastHour, inFlight, remaining: hourlyRoom(allowance, sentLastHour + inFlight), carriedRecently };
}
