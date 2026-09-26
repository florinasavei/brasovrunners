import { and, asc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import {
  type EmailMessageType,
  type EmailOutboxStatus,
  emailOutbox,
} from "@/db/schema/email-outbox";
import { registrations } from "@/db/schema/registrations";
import type { Database, Transaction } from "@/db/types";
import type { EmailTransportName, OutgoingEmail } from "@/infrastructure/email/adapter";
import type { EmailSender } from "@/infrastructure/email/delivery";
import { finishJobRun, startJobRun } from "@/modules/jobs/repository";
import { readClubNotices } from "./club-notices";
import {
  BULK_COPY_RECIPIENTS,
  type BulkClubCopyMessage,
  clubCopyPayload,
  clubCopyRecipients,
  isClubCopy,
  isCopiedPerMessage,
  participantMessageBcc,
} from "./domain/club-notices";
import { drainOutboxAfterResponse } from "./drain";
import {
  MAX_SEND_ATTEMPTS,
  nextAllowanceResetAt,
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
 *
 * Async, and given the database, for a reason that is easy to miss: a message that carries an
 * action link needs a token, and §14.5 forbids persisting a token's secret anywhere backups
 * can reach — including here, in `payload_json`. The only place left to generate one is the
 * instant before the message is actually sent, which is exactly when this function runs. A
 * renderer for a token-bearing message type therefore calls `issueActionToken` itself, using
 * the row's `participantId`/`registrationId` and whatever deadline the triggering row (a
 * registration's `hold_expires_at`, for instance) still implies at render time.
 *
 * Takes `now` as its third argument rather than reading the clock — the same rule every other
 * time-dependent function in this codebase follows (`docs/PRACTICES.md`): a renderer that
 * called `new Date()` internally could not be tested for the boundary case that matters here,
 * a token whose borrowed deadline has already passed by the time the batch runs.
 */
export type EmailRenderer = (row: OutboxRow, db: Db, now: Date) => Promise<OutgoingEmail>;

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
 * function does is one INSERT in the caller's transaction — plus, for a participant's message,
 * the read of the club's copy list and one INSERT per club copy, as `enqueueClubCopies`
 * describes — so if the caller rolls back, neither the message nor its copies were queued.
 *
 * Generic over the caller's schema, unlike this file's other functions: a registration-lifecycle
 * transaction (`modules/registrations/service.ts`) enqueues a message as one step among several
 * that also touch `registrations`, `participants` and `legal_documents`, none of which this
 * module knows about. `Transaction<T>` for a shared `T` is what lets one open transaction
 * satisfy every module's requirement at once; a schema fixed to `{ emailOutbox }` here would
 * not structurally match a caller's differently-scoped fixed schema. `Transaction`, not
 * `Database`, is still required — a plain `Database<T>` is not assignable to it, so queuing a
 * message outside a transaction still does not compile (BR-REQ-080-02 criterion 1).
 */
export async function enqueueEmail<T extends Record<string, unknown>>(
  tx: Transaction<T>,
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
      // The participant's own message, exactly as asked for: no club address rides on it (§320).
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

  if (!row) return null;
  // The club's copies ride on the participant's row being new: a trigger already queued was
  // copied when it was queued, and a copy is never queued for a message that was not.
  await enqueueClubCopies(tx, params);
  // A new row is work; send it once this request's response is out (`drain.ts`, §68). The
  // transaction commits before the response does, so the drain sees the row.
  drainOutboxAfterResponse();
  return row;
}

/**
 * The club's copy of a participant's message (2026-09-22; the owner: "să putem seta și unde mai
 * merg în BCC mailurile de înregistrare"), queued here and nowhere else — and, since §320, as
 * rows of its own rather than as a Bcc on the participant's envelope.
 *
 * *Why not the Bcc any more.* A Bcc receives the message byte for byte, and the participant's
 * message carries what only the participant may hold: the single-use links that confirm the
 * address, sign the declaration, take a freed place or cancel (§12.8), the check-in QR, and the
 * signed declaration with the identity document. The GDPR audit of 2026-09-23 found exactly that
 * arriving in the club's mailboxes, where anybody reading them could act for the runner. So each
 * address gets a *club copy*: the same message type, for the same registration, with
 * `participantId` null and `clubCopy: true` in its payload — which `render.ts` reads as "mint no
 * token, attach nothing, say what this is" — and the participant's own row carries no club
 * address at all.
 *
 * *Here*, at enqueue time, because of §244's rule for the declaration's copies: the rows are the
 * record of what was asked for when the message was queued, and a list edited tomorrow must not
 * redirect a message already queued. *One place*, rather than at the twenty call sites, because
 * a message type added tomorrow for a participant must be copied without anybody remembering.
 *
 * Two reads at most, both by primary key, and only when they can matter: the setting is read for
 * a participant's message that has a registration behind it; the registration's `kind` only when
 * the list names somebody other than the participant. A message with no registration — the "my
 * registrations" link, a row a test enqueues by hand — is not copied: without a registration
 * nothing says whether the person is real, and a synthetic runner's mail must reach no club
 * mailbox (§12.6). A `TEST` registration's message is not copied for the same reason.
 *
 * Each copy has its own idempotency key, derived from the participant's and the address, so the
 * same trigger queued twice produces its copies once — and a copy is never itself copied.
 */
async function enqueueClubCopies<T extends Record<string, unknown>>(
  tx: Transaction<T>,
  params: EnqueueEmailParams,
): Promise<void> {
  // Never a message to an address nobody has confirmed, nor one of a bulk send — that gets one copy
  // per send (`enqueueBulkClubCopies`) — however the club's list reads (§419).
  if (!params.registrationId || !isCopiedPerMessage(params.messageType) || isClubCopy(params.payload)) return;
  const recipients = clubCopyRecipients(params.recipientEmail, participantMessageBcc(await readClubNotices(tx)));
  if (recipients.length === 0) return;
  const [registration] = await tx
    .select({ kind: registrations.kind })
    .from(registrations)
    .where(eq(registrations.id, params.registrationId))
    .limit(1);
  if (registration?.kind !== "REAL") return;
  for (const recipient of recipients) {
    await tx
      .insert(emailOutbox)
      .values({
        // No participant on the row: nothing downstream can mint a participant's token for it.
        participantId: null,
        registrationId: params.registrationId,
        messageType: params.messageType,
        // The participant's language first, so the copy reads as the message they received (§96).
        locale: params.locale,
        recipientEmail: recipient,
        payloadJson: clubCopyPayload(params.payload),
        idempotencyKey: `${params.idempotencyKey}:club-copy:${recipient.toLowerCase()}`,
        requestedByStaffUserId: params.requestedByStaffUserId ?? null,
        isManualResend: params.isManualResend ?? false,
        status: "PENDING",
        attemptCount: 0,
        createdAt: params.now,
      })
      .onConflictDoNothing({ target: emailOutbox.idempotencyKey });
  }
}

/**
 * The club's **one** copy of a bulk send (§419; the counsel's review of 2026-09-25, GDPR art.
 * 5(1)(c)): the organizer's message (§364) or the update notice (§331) went to everybody
 * registered, one row each, and until now each of those rows was copied to every club address —
 * a hundred runners, a hundred copies of the same words, each greeting a runner by name.
 *
 * Now one row per club address per send: the same message type and payload, the `clubCopy` flag,
 * the event's id (there is no registration behind it — the renderer reads the event from the
 * payload) and how many real participants the send reached, and nothing about any of them: no
 * registration, no participant, no name. `render.ts` greets the club and says the count.
 *
 * Only when at least one **real** registration was written to: a send that reached test rows alone
 * copies nothing, as a test row's message never was (§12.6). Inside the caller's transaction, like
 * every enqueue, and keyed on the send (`<send key>:club-copy:<address>`), so a retried request
 * queues nothing twice. Returns how many copies were queued.
 */
export async function enqueueBulkClubCopies<T extends Record<string, unknown>>(
  tx: Transaction<T>,
  params: {
    messageType: BulkClubCopyMessage;
    eventId: string;
    /** The payload every recipient's row carries — the words, the changes. */
    payload: Record<string, unknown>;
    /** The send's own key, without the registration: `organizer-message:<send id>`. */
    sendKey: string;
    /** Real registrations this send queued a message for. */
    realRecipients: number;
    requestedByStaffUserId?: string | null;
    now: Date;
  },
): Promise<number> {
  if (params.realRecipients <= 0) return 0;
  // No participant's address to leave out: the copy is about nobody.
  const recipients = clubCopyRecipients("", participantMessageBcc(await readClubNotices(tx)));
  let queued = 0;
  for (const recipient of recipients) {
    const [row] = await tx
      .insert(emailOutbox)
      .values({
        participantId: null,
        registrationId: null,
        messageType: params.messageType,
        // The club's own language; the message is bilingual either way (§96).
        locale: "ro",
        recipientEmail: recipient,
        payloadJson: { ...clubCopyPayload(params.payload), eventId: params.eventId, [BULK_COPY_RECIPIENTS]: params.realRecipients },
        idempotencyKey: `${params.sendKey}:club-copy:${recipient.toLowerCase()}`,
        requestedByStaffUserId: params.requestedByStaffUserId ?? null,
        isManualResend: false,
        status: "PENDING",
        attemptCount: 0,
        createdAt: params.now,
      })
      .onConflictDoNothing({ target: emailOutbox.idempotencyKey })
      .returning({ id: emailOutbox.id });
    if (row) queued += 1;
  }
  if (queued > 0) drainOutboxAfterResponse();
  return queued;
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
  /**
   * Held back because the provider's own allowance is spent, and scheduled for the reset
   * rather than for the ordinary backoff. Counted apart from `retrying` because the two mean
   * opposite things to whoever is watching a registration window: `retrying` is a hiccup,
   * `deferred` is "the club has sent as much as its plan allows today, and the rest goes out
   * tomorrow unless somebody upgrades" (`docs/PLATFORM.md`, limit 1).
   */
  deferred: number;
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
 *
 * The run is recorded in `job_runs`, here rather than in the route, for the same reason
 * `runRegistrationMaintenance` records its own: `/api/health` reads that table to report a
 * stalled scheduler (§12.12, §16.2), and a caller that forgot to write the row would leave the
 * check reporting `never_run` for a job that has been running perfectly every five minutes. It
 * did exactly that until BR-V1.19 — the endpoint recorded nothing, so the health check could
 * never go green, and a health check that is permanently yellow is one people stop reading.
 */
export async function processOutboxBatch(
  db: Db,
  params: {
    sender: EmailSender;
    render: EmailRenderer;
    now: Date;
    batchSize?: number;
    /**
     * The road each row asks for (§NNN, `outbox-sender.ts`): the club's setting for the row's
     * group. Absent — a test's own sender — every message asks for Mailgun, as before.
     */
    route?: (row: OutboxRow) => EmailTransportName;
  },
): Promise<OutboxBatchSummary> {
  const { sender, render, now, batchSize = 20, route } = params;

  const jobRunId = await startJobRun(db, "email-outbox", now);

  const claimed = await claimOutboxBatch(db, { now, batchSize });
  const summary: OutboxBatchSummary = {
    claimed: claimed.length,
    sent: 0,
    retrying: 0,
    deferred: 0,
    failed: 0,
    bounced: 0,
  };

  for (const row of claimed) {
    let message: OutgoingEmail;
    try {
      message = await render(row, db, now);
      if (route) message = { ...message, transport: route(row) };
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
          // Which road carried it (§NNN): Gmail's cap and Mailgun's allowance are counted from this.
          transport: result.transport ?? "mailgun",
          lockedAt: null,
          nextAttemptAt: null,
          lastError: null,
        })
        .where(eq(emailOutbox.id, row.id));
      summary.sent += 1;
      continue;
    }

    const error = sanitizeProviderError(result.error);

    /**
     * The allowance is spent, not the message rejected. Nothing was transmitted.
     *
     * Scheduled for the reset the adapter names, or the next daily one, instead of the
     * one-to-thirty-two-minute backoff below — which would spend all six attempts inside the
     * hour and mark a perfectly good confirmation FAILED. The attempt still counts, so this
     * stays bounded at six days rather than becoming a message that retries forever.
     *
     * Checked before `permanent_failure` only for reading order; the outcomes are disjoint.
     */
    /*
      Held back by Gmail's pace, not refused (§NNN): nothing was tried, so the attempt the claim
      counted is given back, and the row is due again in the few seconds the pace asks for — the
      next drain or job run takes it. Counted as a retry: the mechanism working, not the plan's limit.
    */
    if (result.outcome === "throttled" && result.paced) {
      await db
        .update(emailOutbox)
        .set({
          status: "PENDING",
          lockedAt: null,
          attemptCount: Math.max(0, row.attemptCount - 1),
          nextAttemptAt: result.retryAfter ?? now,
        })
        .where(eq(emailOutbox.id, row.id));
      summary.retrying += 1;
      continue;
    }

    if (result.outcome === "throttled") {
      await db
        .update(emailOutbox)
        .set({
          status: "PENDING",
          lockedAt: null,
          nextAttemptAt: result.retryAfter ?? nextAllowanceResetAt(now),
          lastError: error,
        })
        .where(eq(emailOutbox.id, row.id));
      summary.deferred += 1;
      continue;
    }

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

  // `itemsProcessed` is what was claimed, and `errorCount` the outcomes that need a person: a
  // retry is the mechanism working, a failure or a bounce is not. A deferral is the mechanism
  // working too — the plan's limit, not a fault — so it is not an error; `/devs` shows the
  // volume against the allowance, which is where that belongs.
  await finishJobRun(
    db,
    jobRunId,
    { itemsProcessed: summary.claimed, errorCount: summary.failed + summary.bounced },
    new Date(),
  );

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

/**
 * The Mailgun events a delivery webhook may report, and what each does to the row it names
 * (AGENTS.md §16.5). `delivered`/`opened`/`clicked`/`unsubscribed` update nothing — this schema
 * tracks send outcome, not engagement — and are accepted (not rejected) so Mailgun does not
 * retry a webhook this application has nothing to do with.
 */
export type MailgunEventType =
  | "delivered"
  | "opened"
  | "clicked"
  | "unsubscribed"
  | "permanent_fail"
  | "temporary_fail"
  | "failed"
  | "complained";

/**
 * Apply one delivery event to the outbox row it names, found by the provider message id this
 * application supplied when sending (`SendResult.providerMessageId`).
 *
 * Naturally idempotent: setting `BOUNCED` on an already-`BOUNCED` row, because Mailgun resent
 * the same webhook, changes nothing. No separate dedup table is needed for that reason alone.
 */
export async function applyMailgunEvent(
  db: Db,
  params: {
    providerMessageId: string;
    event: MailgunEventType;
    reason: string | null;
    /**
     * Mailgun's current payload reports one `failed` event and distinguishes the two cases
     * with this field. The legacy `permanent_fail`/`temporary_fail` names are still handled
     * below, so both shapes work and neither has to be guessed at.
     */
    severity?: string | null;
  },
): Promise<void> {
  /**
   * Which failures are final, and why the distinction is not cosmetic.
   *
   * A `failed` event with `severity: temporary` is a greylist or a full mailbox — the
   * provider is still trying. Marking that BOUNCED abandons a message that was about to
   * arrive, and BOUNCED is terminal: this outbox never retries out of it. So `failed` is
   * permanent only when the provider says so, and anything else is left alone.
   */
  const permanent =
    params.event === "permanent_fail" ||
    (params.event === "failed" && params.severity !== "temporary");

  const status: EmailOutboxStatus | null =
    params.event === "complained"
      ? "COMPLAINED"
      : permanent
        ? "BOUNCED"
        : null;

  if (status === null) return;

  /**
   * Both spellings of the id, because rows written before `normalizeProviderMessageId`
   * existed still carry Mailgun's bracketed form. Matching both means a bounce for one of
   * those older messages still lands, and no migration has to rewrite stored provider ids.
   */
  await db
    .update(emailOutbox)
    .set({ status, lockedAt: null, nextAttemptAt: null, lastError: params.reason })
    .where(
      or(
        eq(emailOutbox.providerMessageId, params.providerMessageId),
        eq(emailOutbox.providerMessageId, `<${params.providerMessageId}>`),
      ),
    );
}
