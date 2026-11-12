import { desc, eq, inArray, or, type SQL, sql } from "drizzle-orm";
import { type EmailMessageType, type EmailOutboxStatus, emailMessageType, emailOutbox } from "@/db/schema/email-outbox";
import { eventVolunteers } from "@/db/schema/event-volunteers";
import { staffUsers } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import { peekNeonBudgetLevel } from "@/modules/diagnostics/budget-level";
import { governorEffects } from "@/modules/diagnostics/domain/neon-budget";
import { canManageRegistrations, type StaffSubject } from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";
import { isUuid } from "@/shared/ids";
import { CLUB_COPY_FLAG } from "./domain/club-notices";
import { type Departure, departureOf } from "./domain/departure";
import { isClubSide } from "./domain/email-audience";
import { isPressCause, type PressCause } from "./domain/press-causes";
import { isRejectionCause, type RejectionCause } from "./domain/rejection-cause";
import { SENT_NOW_FLAG } from "./domain/send-at-once";
import { copiedKey, type JournalClubLine, VOLUNTEER_OF_ROW } from "./journal";
import { onGmailRoadOf } from "./outbox";
import { readOutboxDelivery } from "./outbox-delivery";
import { readOutboxRoads } from "./outbox-roads";
import { departureContextOf } from "./ui/departure-words";
import { readEmailVolumeToday } from "./volume";

/**
 * A person's «Emailuri» (§915; the owner: «for each person, the list of emails the outbox holds for them, with how many
 * tries each took»): every outbox row of one registration (`registration_id`) or of one volunteer (the payload's
 * `volunteerId`, the journal's own predicate `VOLUNTEER_OF_ROW`), newest first, each with its tries, its next try, what
 * became of it and who caused it — the press and the colleague, a job, the person on the site, or, for a row queued
 * before the outbox recorded presses, nobody it can name.
 *
 * **«De pe site» only where it is known.** A public flow opens no press (`domain/press-causes.ts`), so its rows carry
 * neither a press nor a colleague — but neither does every row queued before `cause` and `press_id` existed (0192): the
 * race's reminders, the maintenance job's expiries and offers, a staff verb that did not stamp its requester. A row with
 * neither is the person's own only when it was queued at or after the outbox's **first recorded press** (read in the
 * same query); before it, or in an outbox that has recorded none, the fold says that nobody was recorded (§915).
 *
 * **What is read, and what never is** — the journal's rule (`journal.ts`): the type, the state and its times, the tries,
 * the provider's facts after it left (`delivered_at`, `rejected_at`, `rejection_cause`), the press's `cause` and
 * `press_id`, who pressed, the resend mark, and the sanitized `last_error` of a FAILED row only (§14.5). Never the
 * payload's words (only its two flags the departure needs and the club-copy flag), a body, a link, the provider's
 * code or words. The club's own rows — a copy of the person's message, the declaration's archive, a notice to the
 * club's people — are the club's: a copy folds under the message it copies, the rest under the list.
 *
 * **Who reads it.** The Administrator and the Superadministrator alone (`canManageRegistrations`, the capability that
 * gates «Emailuri azi»), asserted here on the server (BR-REQ-060-01): every other role is refused with FORBIDDEN, never
 * handed an empty list that reads as «none». An erased person's rows went with them (the cascade; a volunteer's page
 * is a 404 once the row is gone).
 *
 * **One query**, by `email_outbox_registration_created_idx` for a registration; a volunteer's rows are matched on the
 * payload, which no index holds — a volunteer's page is opened rarely and the outbox is small, so no migration
 * (§915). Capped at `EMAIL_HISTORY_LIMIT`; the window count says how many more. A waiting row's departure is judged
 * as the queue and «Emailuri azi» judge it (`domain/departure.ts`), the context read only when a row waits.
 */

/** Enough for a person's whole story; past it the fold says how many more, older, there are. */
export const EMAIL_HISTORY_LIMIT = 200;

export type EmailHistorySubject = { registrationId: string } | { volunteerId: string };

/** One of the person's emails, as the fold draws it. Nothing of the message's words. */
export type EmailHistoryRow = {
  id: string;
  messageType: EmailMessageType;
  status: EmailOutboxStatus;
  createdAt: Date;
  sentAt: Date | null;
  /** 0 for a message the environment captured (QA's allowlist): it reached nobody. */
  recipientCount: number | null;
  /** Tries so far: incremented at each claim (`outbox.ts`), 0 while it has never been tried. */
  attemptCount: number;
  /** When the next try is due — on a PENDING row that was tried already, null otherwise. */
  nextTryAt: Date | null;
  deliveredAt: Date | null;
  rejectedAt: Date | null;
  rejectionCause: RejectionCause | null;
  /** Sanitized by the worker (§16.1); on a FAILED row only. */
  lastError: string | null;
  /** The press or job that queued it; null for the person's own form or link, and for a row nobody was recorded for. */
  cause: PressCause | null;
  /** One id per press: the rows a press queued share it. */
  pressId: string | null;
  /** The colleague who pressed, by name; null for a job, the site, or an account since removed. */
  by: string | null;
  manualResend: boolean;
  /**
   * Queued by the person's own form or link: no press, no colleague, and queued at or after the outbox's first recorded
   * press — before it nothing was stamped, so such a row could as well be a job's or a colleague's (§915).
   */
  fromSite: boolean;
  /** When a waiting row leaves, in the queue's own judgement; null on a row that is not waiting. */
  departure: Departure | null;
  /** The club's copies of this very message (`<key>:club-copy:<address>`), folded under it. */
  copies: JournalClubLine[];
};

export type EmailHistory = {
  /** The person's own emails, newest first. */
  rows: EmailHistoryRow[];
  /** The club's rows that copy no row drawn: the archive, a notice, a copy whose message is past the cap. */
  club: JournalClubLine[];
  /** The person's own emails in all, past the cap included: the fold's count. */
  ownTotal: number;
  /** Rows past `EMAIL_HISTORY_LIMIT`, not drawn. */
  more: number;
};

/** What one row is read as, before it is folded. */
export type EmailHistoryRowRead = {
  id: string;
  messageType: EmailMessageType;
  status: EmailOutboxStatus;
  recipientEmail: string;
  createdAt: Date;
  sentAt: Date | null;
  recipientCount: number | null;
  attemptCount: number;
  nextAttemptAt: Date | null;
  deliveredAt: Date | null;
  rejectedAt: Date | null;
  rejectionCause: string | null;
  /** Read for the departure's pause mark (§605) and a FAILED row's line; drawn on a FAILED row only. */
  lastError: string | null;
  cause: string | null;
  pressId: string | null;
  by: string | null;
  manualResend: boolean;
  clubCopy: boolean;
  familyHeld: boolean;
  sentNow: boolean;
  road: string | null;
  idempotencyKey: string;
};

/** The club's side as SQL: a copy by its flag, or a type the audience map gives the club (`isClubSide`). */
const CLUB_SIDE_TYPES = emailMessageType.enumValues.filter((type) => isClubSide(type, false));
const clubCopySql = sql`coalesce((${emailOutbox.payloadJson} ->> ${CLUB_COPY_FLAG}::text) = 'true', false)`;
const clubSideSql = or(clubCopySql, inArray(emailOutbox.messageType, CLUB_SIDE_TYPES)) as SQL;

const isWaiting = (status: EmailOutboxStatus) => status === "PENDING" || status === "PROCESSING";

/** The Administrator's and the Superadministrator's (BR-REQ-060-01): anybody else is refused, never told «none». */
function assertMayReadEmailHistory(actor: StaffSubject): void {
  if (!canManageRegistrations(actor)) {
    const role = typeof actor === "string" ? actor : actor.role;
    throw new DomainError("FORBIDDEN", `role ${role} may not read a person's email history`);
  }
}

/**
 * The rows folded as the fold draws them — pure, so the folding is tested apart from the database. `departures` holds
 * each waiting row's departure by id (`readEmailHistory` judges them); `pressesSince` is the outbox's first recorded
 * press, null while it has recorded none.
 */
export function foldEmailHistory(
  read: readonly EmailHistoryRowRead[],
  input: { ownTotal: number; total: number; departures?: ReadonlyMap<string, Departure>; pressesSince?: Date | null },
): EmailHistory {
  const pressesSince = input.pressesSince ?? null;
  const rows: EmailHistoryRow[] = [];
  const byKey = new Map<string, EmailHistoryRow>();
  const clubRows: EmailHistoryRowRead[] = [];
  for (const row of read) {
    if (isClubSide(row.messageType, row.clubCopy)) {
      clubRows.push(row);
      continue;
    }
    const line: EmailHistoryRow = {
      id: row.id,
      messageType: row.messageType,
      status: row.status,
      createdAt: row.createdAt,
      sentAt: row.sentAt,
      recipientCount: row.recipientCount,
      attemptCount: row.attemptCount,
      nextTryAt: row.status === "PENDING" && row.attemptCount > 0 ? row.nextAttemptAt : null,
      deliveredAt: row.deliveredAt,
      rejectedAt: row.rejectedAt,
      rejectionCause: isRejectionCause(row.rejectionCause) ? row.rejectionCause : null,
      lastError: row.status === "FAILED" ? row.lastError : null,
      cause: row.pressId && isPressCause(row.cause) ? row.cause : null,
      pressId: row.pressId,
      by: row.by,
      manualResend: row.manualResend,
      fromSite: !row.pressId && !row.by && pressesSince !== null && row.createdAt >= pressesSince,
      departure: isWaiting(row.status) ? (input.departures?.get(row.id) ?? null) : null,
      copies: [],
    };
    rows.push(line);
    byKey.set(row.idempotencyKey, line);
  }
  const club: JournalClubLine[] = [];
  for (const row of clubRows) {
    const clubLine: JournalClubLine = { id: row.id, messageType: row.messageType, status: row.status, recipientEmail: row.recipientEmail, sentAt: row.sentAt };
    const copied = copiedKey(row.idempotencyKey);
    const line = copied ? byKey.get(copied) : undefined;
    if (line) line.copies.push(clubLine);
    else club.push(clubLine);
  }
  return { rows, club, ownTotal: input.ownTotal, more: Math.max(0, input.total - read.length) };
}

/**
 * One person's emails (`EmailHistory`), for the Administrator and the Superadministrator — anybody else is refused
 * (FORBIDDEN). `subject` names the registration or the volunteer; a malformed id has no rows.
 */
export async function readEmailHistory<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: StaffSubject,
  subject: EmailHistorySubject,
  now: Date,
): Promise<EmailHistory> {
  assertMayReadEmailHistory(actor);
  const id = "registrationId" in subject ? subject.registrationId : subject.volunteerId;
  if (!isUuid(id)) return { rows: [], club: [], ownTotal: 0, more: 0 };

  const select = db
    .select({
      id: emailOutbox.id,
      messageType: emailOutbox.messageType,
      status: emailOutbox.status,
      recipientEmail: emailOutbox.recipientEmail,
      createdAt: emailOutbox.createdAt,
      sentAt: emailOutbox.sentAt,
      recipientCount: emailOutbox.recipientCount,
      attemptCount: emailOutbox.attemptCount,
      nextAttemptAt: emailOutbox.nextAttemptAt,
      deliveredAt: emailOutbox.deliveredAt,
      rejectedAt: emailOutbox.rejectedAt,
      rejectionCause: emailOutbox.rejectionCause,
      lastError: emailOutbox.lastError,
      cause: emailOutbox.cause,
      pressId: emailOutbox.pressId,
      by: staffUsers.displayName,
      manualResend: emailOutbox.isManualResend,
      // The payload's flags only — a club copy (§320), a family's hold (§519), a press's «now» (§540) — never its words.
      clubCopy: sql<boolean>`${clubCopySql}`,
      familyHeld: sql<boolean>`coalesce((${emailOutbox.payloadJson} ->> 'sittingHeld') = 'true' or (${emailOutbox.payloadJson} ->> 'familyHeld') = 'true', false)`,
      sentNow: sql<boolean>`coalesce((${emailOutbox.payloadJson} ->> ${SENT_NOW_FLAG}::text) = 'true', false)`,
      road: emailOutbox.road,
      idempotencyKey: emailOutbox.idempotencyKey,
      // Every row of the person, and their own (not the club's), past the cap included: one query, no second count.
      total: sql<number>`count(*) over ()`.mapWith(Number),
      ownTotal: sql<number>`count(*) filter (where not (${clubSideSql})) over ()`.mapWith(Number),
      // The outbox's first recorded press, computed once for the query (an uncorrelated subquery): only from then on
      // is a row with neither press nor colleague the person's own (§915).
      pressesSince: sql<Date | null>`(select min(${emailOutbox.createdAt}) from ${emailOutbox} where ${emailOutbox.pressId} is not null)`.mapWith(
        emailOutbox.createdAt,
      ),
    })
    .from(emailOutbox)
    .leftJoin(staffUsers, eq(staffUsers.id, emailOutbox.requestedByStaffUserId));
  const read =
    "registrationId" in subject
      ? await select
          .where(eq(emailOutbox.registrationId, id))
          .orderBy(desc(emailOutbox.createdAt), desc(emailOutbox.id))
          .limit(EMAIL_HISTORY_LIMIT)
      : await select
          // The journal's own join (`VOLUNTEER_OF_ROW`): the rows whose payload names this volunteer.
          .innerJoin(eventVolunteers, VOLUNTEER_OF_ROW)
          .where(eq(eventVolunteers.id, id))
          .orderBy(desc(emailOutbox.createdAt), desc(emailOutbox.id))
          .limit(EMAIL_HISTORY_LIMIT);

  // The window counts and the first press are the query's, not a row's: `foldEmailHistory` reads them from the first row below.
  const rows: EmailHistoryRowRead[] = read.map((row) => ({
    id: row.id,
    messageType: row.messageType,
    status: row.status,
    recipientEmail: row.recipientEmail,
    createdAt: row.createdAt,
    sentAt: row.sentAt,
    recipientCount: row.recipientCount,
    attemptCount: row.attemptCount,
    nextAttemptAt: row.nextAttemptAt,
    deliveredAt: row.deliveredAt,
    rejectedAt: row.rejectedAt,
    rejectionCause: row.rejectionCause,
    lastError: row.lastError,
    cause: row.cause,
    pressId: row.pressId,
    by: row.by,
    manualResend: row.manualResend,
    clubCopy: Boolean(row.clubCopy),
    familyHeld: Boolean(row.familyHeld),
    sentNow: Boolean(row.sentNow),
    road: row.road,
    idempotencyKey: row.idempotencyKey,
  }));

  // When each waiting row leaves, judged as the queue panel and «Emailuri azi» judge it — read only when one waits.
  const departures = new Map<string, Departure>();
  const waiting = rows.filter((row) => isWaiting(row.status) && !isClubSide(row.messageType, row.clubCopy));
  if (waiting.length > 0) {
    const [roads, volume, delivery] = await Promise.all([
      readOutboxRoads(db, now),
      readEmailVolumeToday(db, now),
      // The governor's floor this instance last heard (as the toast after a press reads it), never a request to Neon.
      readOutboxDelivery(db, now, governorEffects(peekNeonBudgetLevel(now)).jobFloorMinutes),
    ]);
    const context = departureContextOf({ now, delivery, volume });
    for (const row of waiting) {
      departures.set(
        row.id,
        departureOf(
          {
            status: row.status,
            messageType: row.messageType,
            attemptCount: row.attemptCount,
            nextAttemptAt: row.nextAttemptAt,
            createdAt: row.createdAt,
            lastError: row.lastError,
            familyHeld: row.familyHeld,
            sentNow: row.sentNow,
            onMailgunRoad: roads ? !onGmailRoadOf(row, roads) : true,
            isManualResend: row.manualResend,
          },
          context,
        ),
      );
    }
  }

  return foldEmailHistory(rows, { total: read[0]?.total ?? 0, ownTotal: read[0]?.ownTotal ?? 0, departures, pressesSince: read[0]?.pressesSince ?? null });
}
