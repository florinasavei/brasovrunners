import { and, count, eq, gte, inArray, isNull, lte, or, type SQL, sql } from "drizzle-orm";
import { emailOutbox } from "@/db/schema/email-outbox";
import type { Database } from "@/db/types";
import { BULK_MESSAGE_TYPES, bulkBudget } from "./domain/bulk";
import { emailCeilings, emailHeadroom } from "./domain/email-plan";
import { readEmailPlan } from "./email-plan";

/**
 * How many newsletter and new-event messages this batch may claim (§NNN, `domain/bulk.ts`), or
 * `null` for "no limit to apply" — nothing of the kind is due, or the plan sets no ceiling.
 *
 * One cheap query on the ordinary path: whether any bulk message is due at all. Only when one is
 * are the plan and the day's and the month's sent counts read — the same figures `/admin/emails`
 * shows (`readEmailVolumeToday`), counted the same way, from the same UTC boundaries: what Mailgun
 * carried, never the club's Gmail's rows (§NNN), which cost the allowance nothing.
 *
 * `road` narrows "any due" to Mailgun's road when Gmail carries some of the mail (`outbox.ts`):
 * a newsletter going by Gmail is not held to Mailgun's reserve.
 */
export async function readBulkLimit<T extends Record<string, unknown>>(
  db: Database<T>,
  now: Date,
  road?: SQL,
): Promise<number | null> {
  const [due] = await db
    .select({ id: emailOutbox.id })
    .from(emailOutbox)
    .where(
      and(
        eq(emailOutbox.status, "PENDING"),
        inArray(emailOutbox.messageType, [...BULK_MESSAGE_TYPES]),
        or(isNull(emailOutbox.nextAttemptAt), lte(emailOutbox.nextAttemptAt, now)),
        road,
      ),
    )
    .limit(1);
  if (!due) return null;

  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [sent] = await db
    .select({
      today: count(sql`CASE WHEN ${emailOutbox.sentAt} >= ${day.toISOString()}::timestamptz THEN 1 END`),
      month: count(),
    })
    .from(emailOutbox)
    .where(
      and(
        gte(emailOutbox.sentAt, month),
        sql`${emailOutbox.sentAt} IS NOT NULL`,
        // A row Mailgun carried (`volume.ts`): a null `transport` predates the column, and was Mailgun's.
        sql`(${emailOutbox.transport} IS NULL OR ${emailOutbox.transport} <> 'gmail')`,
      ),
    );
  const plan = await readEmailPlan(db);
  return bulkBudget(emailHeadroom(emailCeilings(plan), sent?.today ?? 0, sent?.month ?? 0));
}
