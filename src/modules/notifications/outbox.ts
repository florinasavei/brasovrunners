import { and, asc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import {
  type EmailMessageType,
  type EmailOutboxStatus,
  emailOutbox,
} from "@/db/schema/email-outbox";
import type { Database, Transaction } from "@/db/types";
import type { OutgoingEmail } from "@/infrastructure/email/adapter";
import type { EmailSender } from "@/infrastructure/email/delivery";
import {
  MAX_SEND_ATTEMPTS,
  nextAttemptAt,
  PROCESSING_LOCK_TIMEOUT_MS,
  sanitizeProviderError,
} from "./domain/retry";

/**
 * The transactional outbox (BR-REQ-080-02; AGENTS.md §16.1).
 *
 * Two halves that must never touch:
 *
 *   enqueueEmail        runs inside the caller's transaction, writes a row, calls nobody.
 *   processOutboxBatch  runs later, claims rows in its own transaction, and calls the
 *                       provider with no transaction open at all.
 *
 * That separation is the requirement. A provider call inside the registration transaction
 * holds a database transaction open for the length of an HTTP request to a third party, and
 * — worse — a network timeout after Mailgun accepted the message rolls back a registration
 * the participant has already been told about. Committing the *intent* is atomic; delivering
 * it is not, and pretending otherwise is what the outbox pattern exists to prevent.
 *
 * The type system carries the first half of the rule: `enqueueEmail` takes a `Transaction`,
 * and a `Database` is not assignable to one, so queuing a message outside a transaction does
 * not compile.
 */

type Schema = { emailOutbox: typeof emailOutbox };
type Db = Database<Schema>;

export type OutboxRow = typeof emailOutbox.$inferSelect;

/**
 * Turns a queued row into the message to transmit.
 *
 * Injected rather than imported because the templates it needs are BR-REQ-080-01 and do not
 * exist: Romanian and English bodies for ten message types, which the club has not approved
 * and this repository must not invent (`AGENTS.md` §10.8). The seam is here so that the
 * worker is finished and tested now, and the day templates land they are one argument.
 */
export type EmailRenderer = (row: OutboxRow) => OutgoingEmail;

export type EnqueueEmailParams = {
  participantId: string | null;
  registrationId: string | null;
  messageType: EmailMessageType;
  locale: "ro" | "en";
  /** The delivery address (AGENTS.md §10.4), not the canonical identity. */
  recipientEmail: string;
  /** What the template needs. Never a rendered body and never a token (§14.5). */
  payload: Record<string, unknown>;
  /**
   * This trigger, once. BR-REQ-080-02 criterion 3: two code paths reacting to the same state
   * change produce the same key and therefore one row. A *deliberate* resend is a different
   * trigger and must pass a different key (§12.11) — that is why this is a parameter and not
   * something derived here from the message type.
   */
  idempotencyKey: string;
  requestedByStaffUserId?: string | null;
  isManualResend?: boolean;
  now: Date;
};

/**
 * Queue one message, inside the transaction that caused it.
 *
 * Returns the row, or `null` when this trigger was already queued — that is the idempotency
 * key doing its job, not an error. The caller decides whether a duplicate matters; for a
 * confirmation email it does not.
 *
 * Nothing here contacts a provider, reads configuration, or renders a body. Everything this
 * function does is one INSERT in the caller's transaction, so if the caller rolls back, the
 * message was never queued.
 */
export async function enqueueEmail(
  tx: Transaction<Schema>,
  params: EnqueueEmailParams,
): Promise<OutboxRow | null> {
  const [row] = await tx
    .insert(emailOutbox)
    .values({
      participantId: params.participantId,
      registrationId: params.registrationId,
      messageType: params.messageType,
      locale: params.locale,
      recipientEmail: params.recipientEmail,
      payloadJson: params.payload,
      idempotencyKey: params.idempotencyKey,
      requestedByStaffUserId: params.requestedByStaffUserId ?? null,
      isManualResend: params.isManualResend ?? false,
      status: "PENDING",
      attemptCount: 0,
      createdAt: params.now,
    })
    .onConflictDoNothing({ target: emailOutbox.idempotencyKey })
    .returning();

  return row ?? null;
}

/**
 * Take ownership of up to `batchSize` messages.
 *
 * `FOR UPDATE SKIP LOCKED` inside the sub-select is what makes concurrent workers safe
 * (BR-REQ-080-02 criterion 3): each worker locks the rows it selects and skips rows another
 * worker already holds, so two workers claim disjoint sets and no message is sent twice. The
 * claim commits before any provider call, so a row is never "being sent" and uncommitted at
 * the same time.
 *
 * Rows stuck in PROCESSING past the lock timeout are claimed too — see
 * `PROCESSING_LOCK_TIMEOUT_MS` for why, and for the duplicate-send window that implies.
 *
 * `attempt_count` is incremented at claim time, not at failure time. A worker that dies
 * mid-send has still consumed an attempt, so a message that reliably kills the process cannot
 * be retried forever.
 *
 * NOT VERIFIABLE IN THE UNIT SUITE. PGlite is single-connection, so it cannot run two
 * transactions at once and cannot prove SKIP LOCKED does anything (`tests/helpers/db.ts`).
 * Criterion 3 needs a real PostgreSQL server and two connections; until that harness exists,
 * it is unproven rather than tested, and no test in this repository claims otherwise.
 */
export async function claimOutboxBatch(
  db: Db,
  params: { now: Date; batchSize: number },
): Promise<OutboxRow[]> {
  const { now, batchSize } = params;
  const staleBefore = new Date(now.getTime() - PROCESSING_LOCK_TIMEOUT_MS);

  return db.transaction(async (tx) => {
    const claimable = tx
      .select({ id: emailOutbox.id })
      .from(emailOutbox)
      .where(
        or(
          and(
            eq(emailOutbox.status, "PENDING"),
            or(isNull(emailOutbox.nextAttemptAt), lte(emailOutbox.nextAttemptAt, now)),
          ),
          and(eq(emailOutbox.status, "PROCESSING"), lte(emailOutbox.lockedAt, staleBefore)),
        ),
      )
      .orderBy(asc(emailOutbox.createdAt))
      .limit(batchSize)
      .for("update", { skipLocked: true });

    const claimed = await tx
      .update(emailOutbox)
      .set({
        status: "PROCESSING",
        lockedAt: now,
        attemptCount: sql`${emailOutbox.attemptCount} + 1`,
      })
      .where(inArray(emailOutbox.id, claimable))
      .returning();

    // The sub-select orders which rows are claimed; RETURNING has no defined order at all.
    // Sorting here makes the batch oldest-first for the worker too, so a participant who has
    // been waiting longest is not overtaken within a batch.
    return claimed.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  });
}

export type OutboxBatchSummary = {
  claimed: number;
  sent: number;
  retrying: number;
  failed: number;
  bounced: number;
};

/**
 * Claim a batch, render each message, send it, record the outcome.
 *
 * The provider call is on the line marked below, outside every transaction this function
 * opens. That is the second half of BR-REQ-080-02 criterion 1 and the reason the loop is
 * written one row at a time rather than as a single bulk update: each outcome is recorded as
 * it happens, so a crash halfway through leaves the earlier rows correctly marked.
 *
 * A render failure is permanent. A template that throws on this row's payload will throw on
 * every retry, and five more attempts only delay the moment someone looks at it.
 */
export async function processOutboxBatch(
  db: Db,
  params: { sender: EmailSender; render: EmailRenderer; now: Date; batchSize?: number },
): Promise<OutboxBatchSummary> {
  const { sender, render, now, batchSize = 20 } = params;

  const claimed = await claimOutboxBatch(db, { now, batchSize });
  const summary: OutboxBatchSummary = {
    claimed: claimed.length,
    sent: 0,
    retrying: 0,
    failed: 0,
    bounced: 0,
  };

  for (const row of claimed) {
    let message: OutgoingEmail;
    try {
      message = render(row);
    } catch (error) {
      await recordFailure(db, row.id, "FAILED", sanitizeProviderError(error));
      summary.failed += 1;
      continue;
    }

    // The provider call. No transaction is open here, by construction.
    let result;
    try {
      result = await sender.send(message);
    } catch (error) {
      // An adapter that throws instead of returning a result is treated as transient: the
      // usual cause is a socket, and the usual cure is trying again.
      result = { outcome: "transient_failure", error: sanitizeProviderError(error) } as const;
    }

    if (result.outcome === "sent") {
      await db
        .update(emailOutbox)
        .set({
          status: "SENT",
          sentAt: now,
          providerMessageId: result.providerMessageId,
          lockedAt: null,
          nextAttemptAt: null,
          lastError: null,
        })
        .where(eq(emailOutbox.id, row.id));
      summary.sent += 1;
      continue;
    }

    const error = sanitizeProviderError(result.error);

    if (result.outcome === "permanent_failure") {
      // BR-REQ-080-02 criterion 4: a permanent failure is not retried. Suppressing *further*
      // messages to that address needs the provider's webhook verdict (BR-REQ-080-04), which
      // is not built; this half — never retrying this message — is.
      await recordFailure(db, row.id, "BOUNCED", error);
      summary.bounced += 1;
      continue;
    }

    if (row.attemptCount >= MAX_SEND_ATTEMPTS) {
      await recordFailure(db, row.id, "FAILED", error);
      summary.failed += 1;
      continue;
    }

    await db
      .update(emailOutbox)
      .set({
        status: "PENDING",
        lockedAt: null,
        nextAttemptAt: nextAttemptAt(now, row.attemptCount),
        lastError: error,
      })
      .where(eq(emailOutbox.id, row.id));
    summary.retrying += 1;
  }

  return summary;
}

/** A terminal outcome: the row is released, keeps its reason, and is not scheduled again. */
async function recordFailure(
  db: Db,
  id: string,
  status: Extract<EmailOutboxStatus, "FAILED" | "BOUNCED">,
  error: string,
): Promise<void> {
  await db
    .update(emailOutbox)
    .set({ status, lockedAt: null, nextAttemptAt: null, lastError: error })
    .where(eq(emailOutbox.id, id));
}
