import { asc, count, inArray } from "drizzle-orm";
import { emailOutbox, type EmailMessageType, type EmailOutboxStatus } from "@/db/schema/email-outbox";
import type { Database } from "@/db/types";

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
};

/** The statuses that mean "still owed": waiting, mid-flight, or out of retries. */
const UNSENT: readonly EmailOutboxStatus[] = ["PENDING", "PROCESSING", "FAILED"];

/**
 * Enough to see a race morning's queue at a glance, and few enough that the page stays a page.
 * The count beside the rows is the whole queue, so a longer one says so in words.
 */
export const OUTBOX_QUEUE_LIMIT = 50;

export type OutboxQueue = { rows: QueuedMessage[]; total: number };

export async function readOutboxQueue<T extends Record<string, unknown>>(
  db: Database<T>,
  limit: number = OUTBOX_QUEUE_LIMIT,
): Promise<OutboxQueue> {
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
    })
    .from(emailOutbox)
    .where(inArray(emailOutbox.status, UNSENT))
    // The queue's own order: what has waited longest is what is worth explaining first.
    .orderBy(asc(emailOutbox.createdAt))
    .limit(limit);

  const [total] = await db.select({ value: count() }).from(emailOutbox).where(inArray(emailOutbox.status, UNSENT));

  return { rows, total: total?.value ?? 0 };
}
