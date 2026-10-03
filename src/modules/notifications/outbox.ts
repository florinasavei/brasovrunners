import { and, asc, eq, inArray, isNull, lte, not, or, type SQL, sql } from "drizzle-orm";
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
import { revalidatePublicContent } from "@/modules/public-cache/cache";
import { readClubNotices } from "./club-notices";
import {
  BULK_COPY_RECIPIENTS,
  type BulkClubCopyMessage,
  CLUB_COPY_FLAG,
  clubCopyPayload,
  clubCopyRecipients,
  isClubCopy,
  isCopiedPerMessage,
  participantMessageBcc,
} from "./domain/club-notices";
import { readBulkLimit } from "./bulk-budget";
import { readEmailPlan } from "./email-plan";
import { readMailgunHour } from "./hourly-pace";
import { RATE_PAUSE_ERROR_PREFIX } from "./domain/hourly-pace";
import {
  ALLOWANCE_DEFERRED_ERROR_PREFIX,
  FALLBACK_WAITING_ERROR_PREFIX,
  fallbackRetryAt,
  type MailgunStop,
} from "./domain/mailgun-stop";
import { GMAIL_CAP_DEFERRED_ERROR } from "./domain/email-transport";
import { heldByMailgunCondition, readMailgunStop, recordMailgunStop } from "./mailgun-stop";
import { applyDeadlineRebase, type DeadlineRebase, planDeadlineRebase } from "./deadline-rebase";
import { currentDeadlines } from "@/modules/deadlines/deadlines";
import { wakeJobs } from "@/modules/jobs/schedule-cache";
import { BULK_MESSAGE_TYPES, isBulkMessage } from "./domain/bulk";
import { drainOutboxAfterResponse } from "./drain";
import {
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
 *
 * `rebase` is the deadline this send will move (§513, `deadline-rebase.ts`): the renderer states it
 * and mints the link to it, so the message says the deadline the runner will have once it has
 * left, not the one written when it was queued. Absent, the stored deadline, as before.
 */
export type EmailRenderer = (row: OutboxRow, db: Db, now: Date, rebase?: DeadlineRebase | null) => Promise<OutgoingEmail>;

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
  /**
   * Whether this row schedules the after-response drain itself (`drain.ts`), as every row did —
   * `false` for a send that queues hundreds of rows at once (the newsletter, §445) and schedules
   * the one drain itself once they are all written, rather than one per row.
   */
  drainAfter?: boolean;
  /**
   * Not before this instant (§519): a family sitting holds its messages back until «Gata» or the
   * club's window, and a family's confirmation or declaration requests wait for the wizard, as
   * `next_attempt_at` — the column the claim already waits on, so nothing else about the row
   * changes. The club's copies of the message wait with it. Absent: due at once.
   */
  notBefore?: Date;
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
      nextAttemptAt: params.notBefore ?? null,
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
  if (params.drainAfter !== false) drainOutboxAfterResponse();
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
        // Held with the participant's own message (§519): a copy never leaves before it.
        nextAttemptAt: params.notBefore ?? null,
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
    /** The organizer's message and the update notice (§419), and the newsletter's two sends (§445). */
    messageType: BulkClubCopyMessage | (typeof BULK_MESSAGE_TYPES)[number];
    /** The event the send is about; null for a newsletter, which is about none. */
    eventId: string | null;
    /** The payload every recipient's row carries — the words, the changes. */
    payload: Record<string, unknown>;
    /** The send's own key, without the registration: `organizer-message:<send id>`. */
    sendKey: string;
    /** Real registrations this send queued a message for. */
    realRecipients: number;
    requestedByStaffUserId?: string | null;
    now: Date;
    /** As `EnqueueEmailParams.drainAfter`: `false` for a press that sends its own rows now (§540). */
    drainAfter?: boolean;
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
        payloadJson: {
          ...clubCopyPayload(params.payload),
          ...(params.eventId !== null ? { eventId: params.eventId } : {}),
          [BULK_COPY_RECIPIENTS]: params.realRecipients,
        },
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
  if (queued > 0 && params.drainAfter !== false) drainOutboxAfterResponse();
  return queued;
}

/** The worker's batch when the caller names none: twenty rows. */
export const OUTBOX_BATCH_SIZE = 20;

/**
 * Which rows the club sends through Gmail, and how many of them one batch takes (§443 review) —
 * built from the club's setting by `outbox-sender.ts`, the same answer its `route` gives row by row.
 */
export type OutboxRoads = {
  gmailMessageTypes: readonly EmailMessageType[];
  gmailClubCopies: boolean;
  gmailBatchSize: number;
  /**
   * «Gmail preia când Mailgun se oprește» as it acts (§622, `fallbackActive`): while Mailgun's road is
   * stopped, every group's due rows are claimed on Gmail's road. Absent or false, a stop holds Mailgun's
   * rows as before.
   */
  fallbackToGmail?: boolean;
};

/** A row whose road is Gmail, as SQL: a club copy when the club's mail goes by Gmail, or a listed type. */
export function gmailRoadCondition(roads: OutboxRoads): SQL {
  // `::text`: jsonb has `->` for a key and for an index, and an untyped parameter matches both.
  const clubCopy = sql`coalesce(${emailOutbox.payloadJson} -> ${CLUB_COPY_FLAG}::text = 'true'::jsonb, false)`;
  const listed = roads.gmailMessageTypes.length > 0 ? inArray(emailOutbox.messageType, [...roads.gmailMessageTypes]) : sql`false`;
  const participantRow = and(not(clubCopy), listed) as SQL;
  return roads.gmailClubCopies ? (or(clubCopy, participantRow) as SQL) : participantRow;
}

/** The same answer for one claimed row: whether `gmailRoadCondition` put it on Gmail's road. */
function onGmailRoad(row: OutboxRow, roads: OutboxRoads): boolean {
  return isClubCopy(row.payloadJson) ? roads.gmailClubCopies : roads.gmailMessageTypes.includes(row.messageType);
}

/**
 * A renderer's answer that a message has nothing left to say (§445): a new-event alert whose event
 * was cancelled, taken down or has started while the row waited for the allowance
 * (`holdBulkUntilReset`), which may be a day or a month. §331's rule — a cancelled event goes
 * quiet — at the moment of sending, not only at the moment of queueing. The batch deletes the
 * row: nothing was sent, nothing failed, and `/api/health` has nothing to say about it.
 */
export class OutboxMessageWithdrawn extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "OutboxMessageWithdrawn";
  }
}

/** The advisory lock that serialises Mailgun's hourly count with its claim (§605): 'MGHR' as an integer. */
const MAILGUN_HOUR_LOCK_KEY = 0x4d474852;

/**
 * Take ownership of up to `batchSize` messages.
 *
 * `FOR UPDATE SKIP LOCKED` on the SELECT that picks the rows is what makes concurrent workers safe
 * (BR-REQ-080-02 criterion 3): each worker locks the rows it selects and skips rows another
 * worker already holds, so two workers claim disjoint sets and no message is sent twice. The
 * claim commits before any provider call, so a row is never "being sent" and uncommitted at
 * the same time.
 *
 * Rows stuck in PROCESSING past the lock timeout are claimed too — see
 * `PROCESSING_LOCK_TIMEOUT_MS` for why, and for the duplicate-send window that implies.
 *
 * Mailgun's road takes no more than its hourly pace leaves (§605, `hourly-pace.ts`); Gmail's is
 * not held to it. The rest waits, untouched, for the next drain or job run.
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
export async function claimOutboxBatch(db: Db, params: ClaimParams): Promise<OutboxRow[]> {
  return (await claimOutboxBatchWithStop(db, params)).rows;
}

type ClaimParams = Parameters<typeof claimOutboxBatchWithStop>[1];

/**
 * The claim itself, with what it read about Mailgun's road (§622): the stop in force, and whether
 * this claim put every group on Gmail's road for it (`carried`). `claimOutboxBatch` is this, rows only;
 * `processOutboxBatch` needs the rest to send the carried rows by Gmail alone. One claim, one lock.
 */
async function claimOutboxBatchWithStop(
  db: Db,
  params: {
    now: Date;
    batchSize: number;
    roads?: OutboxRoads;
    /**
     * The most newsletter and new-event messages this batch may take on Mailgun's road (§445,
     * `domain/bulk.ts`); `null` or absent is no limit. Either way they come last on each road: every
     * other due message is claimed first, and bulk ones only fill the room left. The limit is
     * Mailgun's allowance less its reserve, so Gmail's road is not held to it — Gmail's pace sizes
     * its claim here, and its own cap is the sender's to keep.
     */
    bulkLimit?: number | null;
    /**
     * Only these rows (§540): a backoffice press that sends its own message now, past the scheduled
     * pass — never the rest of the queue. Still only a row the claim would take (PENDING and due, or a
     * stale PROCESSING): a row already sent, bounced or failed is never sent again by this path (§39).
     */
    ids?: readonly string[];
    /**
     * Mailgun's hourly pace (§605): the most its road may carry in any hour (`PACE_WINDOW_MS`). Absent, the
     * email plan setting's (100 by default); null, no pace. Gmail's road is not held to it.
     */
    hourlyAllowance?: number | null;
  },
): Promise<{ rows: OutboxRow[]; stop: MailgunStop | null; carried: boolean }> {
  const { now, batchSize, roads } = params;
  if (params.ids && params.ids.length === 0) return { rows: [], stop: null, carried: false };
  // The setting once per claim, before the transaction: one primary-key lookup (`readEmailPlan`).
  const hourlyAllowance = params.hourlyAllowance !== undefined ? params.hourlyAllowance : (await readEmailPlan(db)).hourlyAllowance;
  const bulkLimit = params.bulkLimit ?? null;
  const staleBefore = new Date(now.getTime() - PROCESSING_LOCK_TIMEOUT_MS);
  const claimable = or(
    and(eq(emailOutbox.status, "PENDING"), or(isNull(emailOutbox.nextAttemptAt), lte(emailOutbox.nextAttemptAt, now))),
    and(eq(emailOutbox.status, "PROCESSING"), lte(emailOutbox.lockedAt, staleBefore)),
  );
  const due = params.ids ? and(claimable, inArray(emailOutbox.id, [...params.ids])) : claimable;
  const bulk = inArray(emailOutbox.messageType, [...BULK_MESSAGE_TYPES]);

  return db.transaction(async (tx) => {
    /*
      Two statements, never `UPDATE … WHERE id IN (SELECT … LIMIT n FOR UPDATE SKIP LOCKED)` (§644).
      In one statement the planner may put the sub-select on the inner side of a nested-loop semi
      join — it does when the table's statistics say it is nearly empty, as after autovacuum on a
      drained outbox — and re-run it for every outer row; each re-run skips the rows this same
      UPDATE has just changed (they are "updated by this command" to the row lock) and returns the
      next ones, so the claim took four to nine rows under a limit of three, and the batch size, the
      hour's room and the newsletter's cap with it. A SELECT on its own is run once: it locks and
      returns at most `limit` ids, and the UPDATE changes exactly those, already ours.
    */
    const claim = async (where: SQL | undefined, limit: number): Promise<OutboxRow[]> => {
      if (limit <= 0) return [];
      const picked = await tx
        .select({ id: emailOutbox.id })
        .from(emailOutbox)
        .where(where)
        .orderBy(asc(emailOutbox.createdAt))
        .limit(limit)
        .for("update", { skipLocked: true });
      if (picked.length === 0) return [];
      return tx
        .update(emailOutbox)
        .set({
          status: "PROCESSING",
          lockedAt: now,
          attemptCount: sql`${emailOutbox.attemptCount} + 1`,
        })
        .where(inArray(emailOutbox.id, picked.map((row) => row.id)))
        .returning();
    };

    // One road's claim: everything that is not a newsletter first, oldest first; then the
    // newsletter, in the room left and at most `bulkCap` of it (§445).
    const claimRoadWhere = async (where: SQL | undefined, limit: number, bulkCap: number | null = null) => {
      const first = await claim(and(where, not(bulk)), limit);
      const room = limit - first.length;
      const second = await claim(and(where, bulk), bulkCap === null ? room : Math.min(room, bulkCap));
      return { first, second };
    };
    const claimRoad = (road: SQL | undefined, limit: number, bulkCap: number | null) => claimRoadWhere(and(due, road), limit, bulkCap);

    /*
      One claim per road when Gmail carries anything (§443 review). Gmail's rows wait on its pace
      and its cap, and a single oldest-first claim let twenty of them — club copies pile up fast on
      a busy day — stand in front of a runner's link to confirm the address, batch after batch. So
      Mailgun's rows are claimed as if Gmail's were not there, and Gmail's apart, as many as its pace
      lets one batch send.
    */
    const gmailRoad = roads ? gmailRoadCondition(roads) : undefined;
    const mailgunRoad = gmailRoad ? not(gmailRoad) : undefined;
    /*
      Mailgun's hour (§605): no more than the pace leaves — the allowance less what Mailgun carried in
      the trailing window (`PACE_WINDOW_MS`, in recipients) and what another worker holds for it now — oldest first, as always.
      What is not claimed is simply not claimed: its `next_attempt_at` is untouched, and the next drain
      or job run (every fifteen minutes by day) takes it when the hour has room. One query
      (`countMailgunHour`), inside this transaction, and only when a pace is set.
    */
    /*
      Serialised: the count and the claim run in READ COMMITTED, so two workers (two after-response
      drains on registration morning) could read the same room and each claim up to it through
      SKIP LOCKED, together going over the hour — what disables an account on probation. A
      transaction-scoped advisory lock, taken before the count, makes the second claimer wait the
      few milliseconds the first needs to commit; its count then sees the first's PROCESSING rows as
      in flight. Released at commit or rollback. Since §622 taken whether a pace is set or not: the
      stop below is read under it too, so a pause holds the road with no pace as with one.
    */
    await tx.execute(sql`select pg_advisory_xact_lock(${MAILGUN_HOUR_LOCK_KEY})`);
    const hour = hourlyAllowance === null ? null : await readMailgunHour(tx, now, { mailgunRoad, hourlyAllowance });
    /*
      Mailgun said stop (§605, §622): a pause it asked for, or its allowance spent — read from the
      waiting rows' marks and the stop record, in one query under the same lock, **whatever the pace**
      (BR-V2.53 read it only with a pace set, so a club that cleared «Limita pe oră» knocked on through
      a pause). A pause holds Mailgun's whole road — not only the batch the refusal happened in: knocking
      during it is what gets an account on probation disabled for longer.
    */
    const stop = await readMailgunStop(tx, now, mailgunRoad);
    /*
      And while it is stopped, with «Gmail preia când Mailgun se oprește» on, Gmail carries every group
      (§622): Mailgun's road takes nothing, and Gmail's claim takes every due row — Mailgun's held rows
      at once, their `next_attempt_at` being Mailgun's deferral, not the message's turn — as many as
      Gmail's pace lets one batch send. Its cap is the sender's to keep, row by row. With the switch
      off, BR-V2.53's road: a pause holds Mailgun's rows, a spent allowance does not (the provider's own
      refusal defers each row, §40), and Gmail's groups go as ever.
    */
    const carried = stop !== null && roads?.fallbackToGmail === true;
    const paused = stop?.kind === "paused" || hour?.paused === true;
    const mailgunLimit = carried || paused ? 0 : hour === null ? batchSize : Math.min(batchSize, hour.remaining ?? batchSize);
    const mailgun = await claimRoad(mailgunRoad, mailgunLimit, bulkLimit);
    const gmailLimit = Math.min(batchSize, roads?.gmailBatchSize ?? batchSize);
    const heldNow = and(eq(emailOutbox.status, "PENDING"), heldByMailgunCondition(), params.ids ? inArray(emailOutbox.id, [...params.ids]) : undefined);
    const gmail = carried
      ? // The newsletter and the new-event alert stay on Mailgun's road during a stop unless the club routed them to Gmail (§443, §622).
        await claimRoadWhere(and(or(due, heldNow), gmailRoad ? or(not(bulk), gmailRoad) : not(bulk)), gmailLimit)
      : gmailRoad
        ? await claimRoad(gmailRoad, gmailLimit, null)
        : { first: [], second: [] };

    // The picking SELECT orders which rows are claimed; RETURNING has no defined order at all.
    // Sorting here makes the batch oldest-first for the worker too, so a participant who has
    // been waiting longest is not overtaken within a batch — each half on its own, the bulk last.
    const byAge = (a: OutboxRow, b: OutboxRow) => a.createdAt.getTime() - b.createdAt.getTime();
    const rows = [...[...mailgun.first, ...gmail.first].sort(byAge), ...[...mailgun.second, ...gmail.second].sort(byAge)];
    return { rows, stop, carried };
  });
}

/**
 * The newsletter rows this batch had no room for under the reserve (§445, `domain/bulk.ts`), put
 * off until the allowance comes back: no attempt spent, nothing sent, and the job's plan sees the
 * reset as their next turn (`nextOutboxWork`) rather than "due now" on every ping. Only Mailgun's
 * road (`road`) when Gmail carries some of the mail: the reserve is Mailgun's allowance.
 */
async function holdBulkUntilReset(db: Db, now: Date, road: SQL | undefined): Promise<void> {
  await db
    .update(emailOutbox)
    .set({ nextAttemptAt: nextAllowanceResetAt(now) })
    .where(
      and(
        eq(emailOutbox.status, "PENDING"),
        inArray(emailOutbox.messageType, [...BULK_MESSAGE_TYPES]),
        or(isNull(emailOutbox.nextAttemptAt), lte(emailOutbox.nextAttemptAt, now)),
        road,
      ),
    );
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
   * tomorrow unless somebody upgrades" (`docs/PLATFORM.md`, limit 1). Since §605 also a message
   * Mailgun paused for the rate (a 429, the probation), due again in minutes, its attempt given back.
   */
  deferred: number;
  failed: number;
  bounced: number;
  /**
   * Gmail carried for Mailgun in this batch (§622): the stop it carried for, and how many it sent.
   * Absent when no stop was carried — the ordinary batch, whose summary is the six counts above.
   */
  carried?: { stop: MailgunStop; viaGmail: number };
};

/** The six counts of a summary, for the callers that add batches together. */
export const OUTBOX_SUMMARY_COUNTS = ["claimed", "sent", "retrying", "deferred", "failed", "bounced"] as const;

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
     * The road each row asks for (§443, `outbox-sender.ts`): the club's setting for the row's
     * group. Absent — a test's own sender — every message asks for Mailgun, as before.
     */
    route?: (row: OutboxRow) => EmailTransportName;
    /**
     * Which rows are Gmail's, claimed apart from Mailgun's (§443 review, `outbox-sender.ts`).
     * Absent — no Gmail account, or a test's own sender — one claim, oldest first, as before.
     */
    roads?: OutboxRoads;
    /** Only these rows (§540, `claimOutboxBatch`): a backoffice press's own message, sent now. */
    ids?: readonly string[];
    /**
     * Whether this batch is a run of the outbox job (the default). A press's own send (§540,
     * `send-rows-now.ts`) passes `false`: it is not a pass of the scheduler, so it writes no
     * `job_runs` row — the queue panel's «Ultima trecere programată», the next round counted from
     * it (`nextOutboxTick`), `/api/health`'s stall check and the jobs' overview all read that table,
     * and a press would move every one of them without the pinger having run.
     */
    recordRun?: boolean;
  },
): Promise<OutboxBatchSummary> {
  const { sender, render, now, batchSize = OUTBOX_BATCH_SIZE, route, roads, ids, recordRun = true } = params;

  const jobRunId = recordRun ? await startJobRun(db, "email-outbox", now) : null;
  // The batch's clock moved on by the real time elapsed: what the re-base checks an offer against
  // under the event's lock (§513), never an instant older than the allocator's.
  const startedAtMs = Date.now();
  const clock = () => new Date(now.getTime() + (Date.now() - startedAtMs));

  // The newsletter's share of what Mailgun's plan has left (§445): read only when one is due on
  // Mailgun's road — Gmail's rows cost the allowance nothing.
  const mailgunRoad = roads ? not(gmailRoadCondition(roads)) : undefined;
  const bulkLimit = await readBulkLimit(db, now, mailgunRoad);
  const claim = await claimOutboxBatchWithStop(db, { now, batchSize, bulkLimit, ...(roads ? { roads } : {}), ...(ids ? { ids } : {}) });
  const claimed = claim.rows;
  // The reserve is reached: whatever newsletter is still due on Mailgun's road waits for the reset, untouched.
  const mailgunBulk = claimed.filter((row) => isBulkMessage(row.messageType) && !(roads && onGmailRoad(row, roads)));
  // A press's own rows (§540) say nothing about the rest of the queue: the reserve's hold is the job's.
  if (!ids && bulkLimit !== null && mailgunBulk.length >= bulkLimit) {
    await holdBulkUntilReset(db, now, mailgunRoad);
  }
  const summary: OutboxBatchSummary = {
    claimed: claimed.length,
    sent: 0,
    retrying: 0,
    deferred: 0,
    failed: 0,
    bounced: 0,
  };

  /*
    Mailgun asked us to stop (§605: a 429, the probation's "temporarily disabled"): until when, and
    why. The rest of this batch's Mailgun rows are not sent into the same refusal — knocking again
    while an account on probation is told to wait is what gets it disabled — but handed back for
    the same instant, with the same reason and their attempt given back. Gmail's rows still go.
  */
  let mailgunPause: { until: Date; error: string } | null = null;
  // Messages withdrawn in this batch (deleted unsent): they leave the queue the public delay counts (§623).
  let withdrawn = 0;

  /*
    Gmail carries for Mailgun (§622): the stop the claim read, when it put every group on Gmail's road
    — or one Mailgun announces during this batch, with «Gmail preia când Mailgun se oprește» on. While
    it is set, every row of the batch leaves by Gmail alone (`gmailOnly`): Gmail's cap and pace as ever,
    and a row Gmail cannot take now is held for Gmail's room or Mailgun's return, never sent to Mailgun.
  */
  const fallbackOn = roads?.fallbackToGmail === true;
  let viaGmail = 0;
  let carrying: MailgunStop | null = claim.carried ? claim.stop : null;
  // Whether this batch has written the stop it carries for as the record (§622: before a relabel, below).
  let stopKept = false;
  /** Mailgun refused the account (§622): the stop is recorded, and with the switch on Gmail carries the rest. */
  const mailgunStopped = async (stop: MailgunStop): Promise<void> => {
    await recordMailgunStop(db, stop, clock()).catch((error: unknown) => {
      console.error("[email-outbox] the stop could not be recorded", error);
    });
    if (fallbackOn) carrying = carrying && carrying.until > stop.until ? carrying : stop;
  };

  /*
    The Gmail road's one connection for the whole batch (§493) is let go when the batch ends,
    however it ends: a pooled SMTP socket left open would outlive the function's work for nothing.
  */
  try {
    for (const row of claimed) {
      if (!carrying && mailgunPause && !(roads && onGmailRoad(row, roads))) {
        await releaseForPause(db, row, mailgunPause.until, null);
        summary.deferred += 1;
        continue;
      }
      if (carrying && isBulkMessage(row.messageType) && !(roads && onGmailRoad(row, roads))) {
        // Mailgun's stop began mid-batch: a bulk row waits for Mailgun, never a personal Gmail (§443, §622).
        await releaseForPause(db, row, carrying.until, null);
        summary.deferred += 1;
        continue;
      }
      const gmailOnly = carrying;
      let message: OutgoingEmail;
      /*
        The deadline this message starts, counted from its send (§513, «termenul curge de când
        pleacă emailul»): planned before the render, so the words and the link say it, and written
        only below, once the provider has taken the message. A plan that cannot be read is no plan:
        the message leaves with the stored deadline, as it always did, rather than not at all.
      */
      const rebase = await planDeadlineRebase(db, row, now).catch(() => null);
      try {
        message = await render(row, db, now, rebase);
        if (route) message = { ...message, transport: route(row) };
        if (gmailOnly) message = { ...message, transport: "gmail", gmailOnly: true };
        else if (isBulkMessage(row.messageType)) message = { ...message, bulk: true };
      } catch (error) {
        if (error instanceof OutboxMessageWithdrawn) {
          await db.delete(emailOutbox).where(eq(emailOutbox.id, row.id));
          withdrawn += 1;
          continue;
        }
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

      /*
        Mailgun refused the account and the message spilled to Gmail (§622): whatever Gmail answered —
        sent, paced, a refused address, a connection that broke — the stop Mailgun announced still
        closes its road. Recorded before the outcome is handled, so the next claim neither knocks on
        Mailgun during it nor reads an open road because the refused row has left or was closed.
      */
      if (result.mailgunStopped) {
        const announced = result.mailgunStopped;
        await mailgunStopped({ kind: announced.kind, until: announced.until ?? (announced.kind === "paused" ? now : nextAllowanceResetAt(now)) });
        if (announced.kind === "paused" && !fallbackOn) mailgunPause = { until: announced.until ?? now, error: "" };
      }

      if (result.outcome === "sent") {
        const sentValues = {
          status: "SENT",
          /*
            The moment the provider took it (§443 review, §605): Gmail's sender says when; for Mailgun
            it is now, read right after the call returned, on the batch's own clock — never the batch's
            start, which would make a batch's last sends look minutes older than they are and drop
            them out of Mailgun's hour early (`hourly-pace.ts`).
          */
          sentAt: result.acceptedAt ?? clock(),
          providerMessageId: result.providerMessageId,
          // Which road carried it (§443): Gmail's cap and Mailgun's allowance are counted from this.
          transport: result.transport ?? "mailgun",
          // What Google counts against the day (§443): the address and every copy that left; 0 when captured.
          recipientCount: result.recipients ?? null,
          lockedAt: null,
          nextAttemptAt: null,
          lastError: null,
        } as const;
        const markSent = (handle: Pick<typeof db, "update">) => handle.update(emailOutbox).set(sentValues).where(eq(emailOutbox.id, row.id));
        /*
          An offer's move and its SENT mark commit together, under the event's lock (§520): while the
          message was queued the offer was kept past its stored deadline (`awaitingItsFirstEmail`),
          and the mark is what ends that — alone, it would let a count under the lock see a late offer
          as free a moment before the move revives it. Should that transaction fail, the mark is
          written alone: the message is out, and the offer keeps the deadline it was queued with.
        */
        if (rebase?.kind === "offer") {
          const together = await applyDeadlineRebase(db, rebase, clock, (tx) => markSent(tx)).then(
            () => true,
            (error: unknown) => {
              console.error("[email-outbox] deadline re-base failed", error);
              return false;
            },
          );
          if (!together) await markSent(db);
          summary.sent += 1;
          if (carrying && result.transport === "gmail") viaGmail += 1;
          continue;
        }
        await markSent(db);
        summary.sent += 1;
        if (carrying && result.transport === "gmail") viaGmail += 1;
        /*
          A participant's verification email that left starts the club's hours to the next one (§NNN):
          the maintenance job planned its quiet before this send, so it is told when to look — a
          re-sent one too, while the club allows more than one. The plan decides whether anything is
          owed then; a setting that cannot be read wakes nothing, and the daily window finds the work
          a day late at most.
        */
        if (row.messageType === "VERIFY_REGISTRATION_EMAIL" && row.participantId) {
          const retryHours = await currentDeadlines(db).then(
            (settings) => (settings.verificationRetries > 0 ? settings.verificationRetryHours : 0),
            () => 0,
          );
          if (retryHours > 0) wakeJobs("registration-maintenance", new Date(sentValues.sentAt.getTime() + retryHours * 60 * 60_000), clock());
        }
        if (rebase) {
          // The message is out whatever happens here: a write that fails leaves the deadline it was
          // queued with — what every message had before §513 — and never the send unrecorded.
          await applyDeadlineRebase(db, rebase, clock).catch((error: unknown) => {
            console.error("[email-outbox] deadline re-base failed", error);
          });
        }
        continue;
      }

      const error = sanitizeProviderError(result.error);

      /*
        Mailgun is stopped and Gmail could not take this one now (§622): its cap is spent, or it refused
        the connection in this batch. Not a refusal of the message — the attempt is given back — and
        not Mailgun's to try during its stop: the row waits for Gmail's room or a quarter of an hour,
        never past the moment Mailgun's road opens again, where it is Mailgun's once more. Its reason
        is marked, so health counts it as «nothing can carry it» once it has waited ninety minutes, and
        so the claim does not take it back at once as a row Mailgun held. Gmail's pace is the pace
        branch below, as for any Gmail row.
      */
      if (gmailOnly && result.outcome === "throttled" && !result.paced) {
        /*
          The relabel takes the row's pause or allowance mark away — one of the stop's two witnesses
          (`readMailgunStop`). So the stop this batch carries for is written as the record first, once
          a batch: a stop read from the marks alone (a row paused before the record existed, or a
          record write that failed) would otherwise read as an open road at the next claim.
        */
        if (!stopKept) {
          stopKept = true;
          await recordMailgunStop(db, gmailOnly, clock()).catch((recordError: unknown) => {
            console.error("[email-outbox] the stop could not be recorded", recordError);
          });
        }
        await db
          .update(emailOutbox)
          .set({
            status: "PENDING",
            lockedAt: null,
            attemptCount: Math.max(0, row.attemptCount - 1),
            nextAttemptAt: fallbackRetryAt(now, gmailOnly, result.retryAfter),
            lastError: `${FALLBACK_WAITING_ERROR_PREFIX}${error}`.slice(0, 500),
          })
          .where(eq(emailOutbox.id, row.id));
        summary.deferred += 1;
        continue;
      }

      /*
        Paused by Mailgun for the rate (§605): the attempt given back, as for Gmail's pace below, so no
        number of pauses ever spends an attempt — `MAX_SEND_ATTEMPTS` counts refusals of the message,
        and this is not one. The reason stays on the row (marked, for `/api/health`), the row is due
        again when Mailgun said, and the stop is recorded (§622): the batch's other Mailgun rows wait
        with it — and so does every other Mailgun row until then, the claim's own rule — unless the
        club's switch hands them to Gmail, which then carries the rest of this batch and the next
        claim takes this one at once on Gmail's road. Counted as deferred, like the daily allowance:
        the provider said stop.
      */
      if (result.outcome === "throttled" && result.paced && result.rateRefused) {
        const until = result.retryAfter ?? now;
        const marked = `${RATE_PAUSE_ERROR_PREFIX}${error}`.slice(0, 500);
        await mailgunStopped({ kind: "paused", until });
        if (!fallbackOn) mailgunPause = { until, error: marked };
        await releaseForPause(db, row, until, marked);
        summary.deferred += 1;
        continue;
      }

      /*
        Held back by Gmail's pace, not refused (§443): nothing was tried, so the attempt the claim
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

      /**
       * The allowance is spent, not the message rejected. Nothing was transmitted.
       *
       * Scheduled for the reset the adapter names, or the next daily one, instead of the
       * one-to-thirty-two-minute backoff below. Since §622 marked (`ALLOWANCE_DEFERRED_ERROR_PREFIX`)
       * and recorded as Mailgun's stop: with «Gmail preia când Mailgun se oprește» on, the next claim
       * takes it at once on Gmail's road, and the rest of this batch goes by Gmail. A row waiting out
       * Gmail's own cap because the club chose to wait (`GMAIL_CAP_DEFERRED_ERROR`, §493) is the
       * club's choice, not Mailgun's stop, and keeps its reason as it was.
       */
      if (result.outcome === "throttled") {
        const mailgunAllowance = error !== GMAIL_CAP_DEFERRED_ERROR;
        const until = result.retryAfter ?? nextAllowanceResetAt(now);
        if (mailgunAllowance) await mailgunStopped({ kind: "allowance", until });
        await db
          .update(emailOutbox)
          .set({
            status: "PENDING",
            lockedAt: null,
            nextAttemptAt: until,
            lastError: mailgunAllowance ? `${ALLOWANCE_DEFERRED_ERROR_PREFIX}${error}`.slice(0, 500) : error,
          })
          .where(eq(emailOutbox.id, row.id));
        summary.deferred += 1;
        continue;
      }

      if (result.outcome === "permanent_failure") {
        /*
          BR-REQ-080-02 criterion 4: a permanent failure is not retried. Suppressing *further* messages
          to that address needs the provider's webhook verdict (BR-REQ-080-04), which is not built; this
          half — never retrying this message — is. Since §622 only the address's own refusal is BOUNCED:
          a refusal of the account or the message (bad credentials, an unverified or closed domain, a
          malformed message) is FAILED — the club's to fix, then «Reîncearcă emailurile eșuate».
        */
        if (result.notTheAddress) {
          await recordFailure(db, row.id, "FAILED", error);
          summary.failed += 1;
          continue;
        }
        await recordFailure(db, row.id, "BOUNCED", error);
        summary.bounced += 1;
        continue;
      }

      /*
        A transient refusal — a 5xx, a timeout, a dropped connection — is never the end of a message
        (§622, amending §40): a message is the club's promise to a runner, and an outage is the
        provider's problem, not the runner's. Past `MAX_SEND_ATTEMPTS` the row stays PENDING and is
        tried again hourly (the backoff's own ceiling, `MAX_RETRY_DELAY_MS`), its attempt count kept
        for the record; `/api/health`'s «overdue» is the alarm for one that stays stuck. FAILED is for
        a refusal of the message itself, above.
      */
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
  } finally {
    sender.close?.();
  }

  if (carrying) summary.carried = { stop: carrying, viaGmail };

  // `itemsProcessed` is what was claimed, and `errorCount` the outcomes that need a person: a
  // retry is the mechanism working, a failure or a bounce is not. A deferral is the mechanism
  // working too — the plan's limit, not a fault — so it is not an error; `/devs` shows the
  // volume against the allowance, which is where that belongs.
  if (jobRunId) {
    await finishJobRun(
      db,
      jobRunId,
      { itemsProcessed: summary.claimed, errorCount: summary.failed + summary.bounced },
      new Date(),
    );
  }

  /*
    The pages that wait for an email say when the queue is late (§623, `cachedEmailDelay`): once per
    batch that moved it — a send, a pause or a deferral, a message given up on or withdrawn — never per row, and
    nothing for a batch that claimed nothing or only scheduled a retry.
  */
  if (summary.sent + summary.deferred + summary.failed + summary.bounced + withdrawn > 0) revalidatePublicContent("email");

  return summary;
}

/**
 * A row handed back for a provider's pause (§605): waiting again, due at `until`, and the attempt the
 * claim counted given back — a pause is never one of the six. `error` is the reason, written only on
 * the row Mailgun actually refused: its batch-mates are held without it (null), so they never carry
 * the rate-pause mark that `/api/health` reads as «paused by the provider» and the claim reads as the
 * road's stop — they are waiting their turn, not refused.
 */
async function releaseForPause(db: Db, row: OutboxRow, until: Date, error: string | null): Promise<void> {
  await db
    .update(emailOutbox)
    .set({ status: "PENDING", lockedAt: null, attemptCount: Math.max(0, row.attemptCount - 1), nextAttemptAt: until, ...(error === null ? {} : { lastError: error }) })
    .where(eq(emailOutbox.id, row.id));
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
