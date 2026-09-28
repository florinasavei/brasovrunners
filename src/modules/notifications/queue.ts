import { and, asc, count, eq, gt, inArray, isNull, lte, not, or, sql } from "drizzle-orm";
import { emailOutbox, type EmailMessageType, type EmailOutboxStatus } from "@/db/schema/email-outbox";
import type { Database } from "@/db/types";
import { BULK_MESSAGE_TYPES } from "./domain/bulk";

/**
 * What is actually queued, for the club rather than for a developer (`DECISIONS.md` §243; the
 * owner: "the outbox in /admin — not only /devs").
 *
 * `/devs` has counts and `/admin/emails` had a forecast; neither answered the question somebody
 * asks at 08:40 on race morning, which is *which* message is stuck and why. This is that
 * answer: the rows still owed to the provider, oldest first, with the attempts already made and
 * the provider's own last word on each.
 *
 * ## What is in it, and what is deliberately not
 *
 * `PENDING` and `PROCESSING` are the queue: waiting, or claimed by a worker right now.
 * `FAILED` is a row that has spent its retries and will not move again without a hand — it is
 * the one everybody needs to see and the one a count of "waiting" hides. `SENT` is history and
 * belongs to the registration's own timeline; `BOUNCED` and `COMPLAINED` are delivery outcomes
 * the registrations list already filters by (`AGENTS.md` §15.10), not things to send.
 *
 * **No body and no token.** The row carries the recipient, the type and the provider's sanitized
 * error, which is all §14.5 allows to exist outside the moment of sending: the message is
 * rendered at send time and the action link is minted then, so there is nothing here to leak.
 *
 * **The recipient is personal data**, so this read is for the roles that already hold the
 * participant list (`canManageRegistrations`, §15.11) and the page asserts that before asking.
 */
export type QueuedMessage = {
  id: string;
  messageType: EmailMessageType;
  recipientEmail: string;
  status: EmailOutboxStatus;
  attemptCount: number;
  nextAttemptAt: Date | null;
  /** Sanitized by the worker: a short provider reason, never a body (`AGENTS.md` §16.1). */
  lastError: string | null;
  createdAt: Date;
  /** Whether a staff member asked for this one by hand — a resend, rather than the flow. */
  isManualResend: boolean;
  /** A family sitting's hold, read from the payload's own flag (`sittingHeld` / `familyHeld`), never from timing. */
  familyHeld: boolean;
};

/** The statuses that mean "still owed": waiting, mid-flight, or out of retries. */
const UNSENT: readonly EmailOutboxStatus[] = ["PENDING", "PROCESSING", "FAILED"];

/**
 * Enough to see a race morning's queue at a glance, and few enough that the page stays a page.
 * The count beside the rows is the whole queue, so a longer one says so in words.
 */
export const OUTBOX_QUEUE_LIMIT = 50;

/**
 * What «Trimite acum» would send and what it would leave (§529): the claim's own rule
 * (`claimOutboxBatch`) — a `PENDING` row is due when its `next_attempt_at` is empty or passed — so
 * the confirm names the due ones, not the whole queue. The rest wait on purpose, each for one reason:
 *
 * - `family` — a family sitting holds its messages until «Gata» or the club's window (§519): no
 *   attempt made yet, a turn set in the future;
 * - `retry` — a retry after a failure, or a deferral (a spent allowance §40, Gmail's cap §443);
 * - `reserve` — a newsletter or a new-event alert waiting for the allowance's reserve (§445).
 *
 * `until` is the earliest of their turns: the first one «Trimite acum» could send if pressed then.
 */
export type OutboxHeld = { total: number; family: number; retry: number; reserve: number; until: Date | null };

export type OutboxQueue = {
  rows: QueuedMessage[];
  /** Every row still owed — waiting, mid-flight, or out of retries. */
  total: number;
  /** `PENDING` rows whose turn has come: what «Trimite acum» sends now, within the day's limit. */
  due: number;
  held: OutboxHeld;
};

export async function readOutboxQueue<T extends Record<string, unknown>>(
  db: Database<T>,
  limit: number = OUTBOX_QUEUE_LIMIT,
  now: Date = new Date(),
): Promise<OutboxQueue> {
  /*
    The family hold is the payload's own flag (§519): a row Gmail's pace threw back is a retry, not a family.
    One parenthesised boolean, never null (the review of 2026-09-28, round two): bare, its «or» bound
    looser than the «and» it is put inside, so a flagged row counted as a retry too, and a row with
    neither key made `not(…)` null, so a real retry counted nowhere.
  */
  const familyFlag = sql`coalesce((${emailOutbox.payloadJson} ->> 'sittingHeld') = 'true' or (${emailOutbox.payloadJson} ->> 'familyHeld') = 'true', false)`;
  const rows = await db
    .select({
      id: emailOutbox.id,
      messageType: emailOutbox.messageType,
      recipientEmail: emailOutbox.recipientEmail,
      status: emailOutbox.status,
      attemptCount: emailOutbox.attemptCount,
      nextAttemptAt: emailOutbox.nextAttemptAt,
      lastError: emailOutbox.lastError,
      createdAt: emailOutbox.createdAt,
      isManualResend: emailOutbox.isManualResend,
      familyHeld: sql<boolean>`coalesce((${familyFlag}), false)`,
    })
    .from(emailOutbox)
    .where(inArray(emailOutbox.status, UNSENT))
    // The queue's own order: what has waited longest is what is worth explaining first.
    .orderBy(asc(emailOutbox.createdAt))
    .limit(limit);

  const pending = eq(emailOutbox.status, "PENDING");
  const dueWhere = and(pending, or(isNull(emailOutbox.nextAttemptAt), lte(emailOutbox.nextAttemptAt, now)));
  const later = and(pending, gt(emailOutbox.nextAttemptAt, now));
  const bulk = inArray(emailOutbox.messageType, [...BULK_MESSAGE_TYPES]);
  const [counts] = await db
    .select({
      total: count(),
      due: count(sql`case when ${dueWhere} then 1 end`),
      family: count(sql`case when ${and(later, not(bulk), familyFlag)} then 1 end`),
      retry: count(sql`case when ${and(later, not(bulk), not(familyFlag))} then 1 end`),
      reserve: count(sql`case when ${and(later, bulk)} then 1 end`),
      until: sql<Date | string | null>`min(case when ${later} then ${emailOutbox.nextAttemptAt} end)`,
    })
    .from(emailOutbox)
    .where(inArray(emailOutbox.status, UNSENT));

  const family = counts?.family ?? 0;
  const retry = counts?.retry ?? 0;
  const reserve = counts?.reserve ?? 0;
  // A raw `min()` comes back as text on some drivers; the column's own mapping is not applied to it.
  const until = counts?.until ? new Date(counts.until) : null;
  return {
    rows,
    total: counts?.total ?? 0,
    due: counts?.due ?? 0,
    held: { total: family + retry + reserve, family, retry, reserve, until },
  };
}
