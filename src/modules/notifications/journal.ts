import { and, count, desc, eq, gte, inArray, or, type SQL, sql } from "drizzle-orm";
import { emailOutbox, type EmailMessageType, type EmailOutboxStatus } from "@/db/schema/email-outbox";
import { eventVolunteers } from "@/db/schema/event-volunteers";
import { eventTranslations } from "@/db/schema/events";
import { registrations } from "@/db/schema/registrations";
import type { Database } from "@/db/types";
import type { Locale } from "@/i18n/routing";
import { canonicalizeEmail } from "@/modules/participants/domain/canonical-email";
import { listStaffUsers } from "@/modules/staff-identity/repository";
import { startOfClubDay } from "@/modules/translate/budget";
import { CLUB_COPY_FLAG } from "./domain/club-notices";
import type { DepartureRow } from "./domain/departure";
import { recipientRoleOf, STAFF_PERSON_TYPES } from "./domain/email-audience";
import { isPressCause, type PressCause } from "./domain/press-causes";
import { SENT_NOW_FLAG } from "./domain/send-at-once";
import { gmailRoadCondition } from "./outbox";
import { readOutboxRoads } from "./outbox-roads";

/**
 * «Emailuri azi» (the design «telling the owner about every email a staff press sends», slice 1, its section 5):
 * every email of the club's day, with the person's name and address, grouped by the press that queued it — what
 * waits now, then what left today — and who received the same email more than once.
 *
 * **Which rows.** The club's day starts at midnight on its clock (`startOfClubDay`). A row is today's when it left
 * today (`sent_at`), still waits whatever day it was queued (`PENDING`, `PROCESSING`), failed for good having been
 * queued today, or was refused today (`BOUNCED`, `COMPLAINED`, by its `rejected_at`). A message withdrawn before it
 * left is deleted to free its key, so it is not here: it never left, and the page says so.
 *
 * **What is read, and what never is.** The type, the address, the state and its times, the sanitized `last_error` of
 * a failed row (§14.5), the press's `cause` and `press_id`, who pressed — and the person's name from the registration,
 * the volunteer's row (by the payload's `volunteerId`) or the colleague's account. Never the payload's words, a body,
 * a link or the provider's detail. The readers are the Administrator and the Superadministrator alone — they already
 * see these addresses on the list, in the exports and in the queue — asserted by the page (`requireStaffCapability`).
 * An erased person's rows went with them (cascade).
 *
 * **Test rows** (`registrations.kind = 'TEST'`, §12.6) are listed and marked, and left out of every count.
 */

/** Enough for a race day on one page; past it the page says how many more there are. */
export const JOURNAL_ROW_LIMIT = 2000;

/**
 * How many emails one person may get today before each of their lines says the count (the design's marker): the
 * registration journey alone is three — the address, the declaration, the confirmation — so the count is a fact
 * beside the name, never a warning. Counted on what left (`hasLeft`), as the warning below.
 */
export const REPEATED_TODAY = 3;

/**
 * The same email to the same person this many times today is the warning (Critic correction 5 to the design): the
 * volunteers' complaint was one roles email arriving twice. Counted by the canonical address (§10.4), on the
 * person's own mail only — never the club's mailboxes or a colleague's notices — on real rows only, and on rows
 * that left only (`hasLeft`).
 */
export const SAME_EMAIL_REPEATED = 2;

/**
 * Whether a row of the day left the queue — sent, or refused by the person's server after it left (bounced,
 * complained of): what the club did send the person. Never one still waiting: three roles given in three presses
 * queue three rows, held a few minutes after the last (§901), and the sending withdraws (deletes) the ones a later
 * press made stale (`render.ts`, `OutboxMessageWithdrawn`), so the person gets one — «Au primit» counted on the
 * waiting rows would warn of what never arrives. Never a failure: it never left.
 */
function hasLeft(status: EmailOutboxStatus): boolean {
  return status === "SENT" || status === "BOUNCED" || status === "COMPLAINED";
}

/** One row of the day, as the page draws it. Nothing of the message's words. */
export type JournalLine = {
  id: string;
  messageType: EmailMessageType;
  status: EmailOutboxStatus;
  recipientEmail: string;
  /** The person's name, when the row names one: the registration, the volunteer (or their parent), a colleague. */
  personName: string | null;
  /** The event the row is about, in the reader's language, when the registration or the volunteer says which. */
  eventTitle: string | null;
  createdAt: Date;
  sentAt: Date | null;
  rejectedAt: Date | null;
  /** 0 for a message the environment captured (QA's allowlist): it reached nobody. */
  recipientCount: number | null;
  /** Sanitized by the worker (§16.1); on a failed row only. */
  lastError: string | null;
  /** A test registration's row (§12.6): marked, never counted. */
  test: boolean;
  /** How many of the person's own emails of the day left the queue (`hasLeft`; 0 on a waiting, failed, club or colleague line). */
  dayCount: number;
  /** How many of those were this same type (0 on a waiting, failed, club or colleague line). */
  sameTypeCount: number;
  /** The club's copies of this very message (`<key>:club-copy:<address>`), folded under it. */
  copies: JournalClubLine[];
  /** What the waiting judgement needs (`domain/departure.ts`). */
  departure: DepartureRow;
  /**
   * The person's own page in the backoffice, when the line names one (§915): the registration's for a line named
   * from the registration, the volunteer's for the volunteer's own messages and their parent's link. Null for a
   * colleague, an address with no name, and every club line.
   */
  person: JournalPersonLink | null;
};

/** Which backoffice page a person line links to (§915): by id only, the page builds the address. */
export type JournalPersonLink = { kind: "registration" | "volunteer"; id: string };

/** A row to one of the club's own mailboxes: a copy, the declaration's archive, «somebody has confirmed» (§670). */
export type JournalClubLine = { id: string; messageType: EmailMessageType; status: EmailOutboxStatus; recipientEmail: string; sentAt: Date | null };

/** One press's rows in one section: its time, its cause, who pressed, and its lines. */
export type JournalPress = {
  /** The press's id, `staff:<id>` for a row queued by hand before presses were recorded, or `site`. */
  key: string;
  cause: PressCause | null;
  /** Who pressed: the colleague's name, null for a job and for the site. */
  by: string | null;
  /** The earliest row's queueing: the press's moment. */
  at: Date;
  lines: JournalLine[];
  /** The club's rows that copy no line of this press (a bulk send's one copy, an archive, a notice). */
  club: JournalClubLine[];
};

export type JournalRepeat = { personName: string | null; recipientEmail: string; messageType: EmailMessageType; count: number };

export type EmailJournal = {
  dayStart: Date;
  /** What waits now, oldest press first. */
  waiting: JournalPress[];
  /** What left (or failed, or was refused) today, newest press first. */
  departed: JournalPress[];
  /** The day's real rows: left today, waiting now, failed today — test rows never counted. */
  counts: { sent: number; waiting: number; failed: number };
  /** The same email to the same person, `SAME_EMAIL_REPEATED` times or more today, of the rows that left. */
  repeats: JournalRepeat[];
  /** Rows past `JOURNAL_ROW_LIMIT`, not drawn. */
  more: number;
};

/** What one row is read as, before it is grouped. */
export type JournalRowRead = {
  id: string;
  messageType: EmailMessageType;
  status: EmailOutboxStatus;
  recipientEmail: string;
  createdAt: Date;
  sentAt: Date | null;
  rejectedAt: Date | null;
  recipientCount: number | null;
  lastError: string | null;
  attemptCount: number;
  nextAttemptAt: Date | null;
  familyHeld: boolean;
  sentNow: boolean;
  onMailgunRoad: boolean;
  isManualResend: boolean;
  clubCopy: boolean;
  idempotencyKey: string;
  cause: string | null;
  pressId: string | null;
  requestedByStaffUserId: string | null;
  registeredName: string | null;
  test: boolean;
  /** The registration the row is about (`registration_id`), and the volunteer its payload names, when there is one. */
  registrationId: string | null;
  volunteerId: string | null;
  volunteerName: string | null;
  guardianName: string | null;
  eventTitle: string | null;
};

/**
 * The volunteer a row is about: the payload's `volunteerId`, matched as text (§754's rows carry it, the parent's link
 * too). The one predicate «Emailuri azi» joins the volunteers by and a volunteer's own «Emailuri» reads their rows by
 * (`email-history.ts`, §915).
 */
export const VOLUNTEER_OF_ROW: SQL = sql`${eventVolunteers.id}::text = ${emailOutbox.payloadJson} ->> 'volunteerId'`;

/** The volunteer's own messages (§754–§820): the name is the volunteer row's. The parent's link names the parent. */
const VOLUNTEER_PERSON_TYPES: ReadonlySet<EmailMessageType> = new Set([
  "VOLUNTEER_RECEIVED",
  "VOLUNTEER_AGREEMENT_REQUEST",
  "VOLUNTEER_AGREEMENT_ACCEPTED",
  "VOLUNTEER_ROLE_ASSIGNED",
]);

/** A row to the club's own mailboxes (§670): never a person's line, never counted for a person. */
function isClubLine(row: Pick<JournalRowRead, "messageType" | "clubCopy">): boolean {
  const role = recipientRoleOf(row.messageType, row.clubCopy);
  return role === "copy" || role === "archive" || role === "notice";
}

/** The person's own mail: what the repeat counts read (Critic correction 5) — never the club's or a colleague's notices. */
function isPersonsOwnMail(row: Pick<JournalRowRead, "messageType" | "clubCopy">): boolean {
  const role = recipientRoleOf(row.messageType, row.clubCopy);
  return role === "participant" || role === "public" || (role === "staff" && STAFF_PERSON_TYPES.has(row.messageType));
}

/** The address as one identity (§10.4): the versioned canonicalizer, never a raw compare; null for one it refuses. */
function identityOf(address: string): string | null {
  try {
    return canonicalizeEmail(address).canonicalEmail;
  } catch {
    return null;
  }
}

const isWaiting = (status: EmailOutboxStatus) => status === "PENDING" || status === "PROCESSING";

/** The part of a club copy's key that is the copied message's own (`outbox.ts#enqueueClubCopies`). */
export function copiedKey(idempotencyKey: string): string | null {
  const at = idempotencyKey.indexOf(":club-copy:");
  return at > 0 ? idempotencyKey.slice(0, at) : null;
}

/**
 * The rows grouped as the page draws them — pure, so the grouping is tested apart from the database. `staff` is
 * every account's id, name and address: who pressed, and the colleague a row went to.
 */
export function groupEmailJournal(
  rows: readonly JournalRowRead[],
  staff: ReadonlyArray<{ id: string; displayName: string; email: string }>,
  input: { dayStart: Date; counts: EmailJournal["counts"]; more: number },
): EmailJournal {
  const nameById = new Map(staff.map((member) => [member.id, member.displayName]));
  const nameByIdentity = new Map<string, string>();
  for (const member of staff) {
    const identity = identityOf(member.email);
    if (identity) nameByIdentity.set(identity, member.displayName);
  }

  const personNameOf = (row: JournalRowRead): string | null => {
    if (row.messageType === "VOLUNTEER_GUARDIAN_REQUEST") return row.guardianName;
    if (VOLUNTEER_PERSON_TYPES.has(row.messageType)) return row.volunteerName;
    if (row.registeredName) return row.registeredName;
    const identity = identityOf(row.recipientEmail);
    return identity ? (nameByIdentity.get(identity) ?? null) : null;
  };
  // The page of the person the line names, by the same rule as the name: the volunteer's for their own messages and
  // their parent's link, the registration's for a line named from it — never a colleague's notice.
  const personOf = (row: JournalRowRead): JournalPersonLink | null => {
    if (row.messageType === "VOLUNTEER_GUARDIAN_REQUEST" || VOLUNTEER_PERSON_TYPES.has(row.messageType)) {
      return row.volunteerId ? { kind: "volunteer", id: row.volunteerId } : null;
    }
    return row.registrationId && row.registeredName ? { kind: "registration", id: row.registrationId } : null;
  };

  // The person's own real mail that left, by canonical address: how many today, and how many of each type.
  const dayCounts = new Map<string, number>();
  const typeCounts = new Map<string, number>();
  const counted = (row: JournalRowRead): string | null => (!row.test && hasLeft(row.status) && isPersonsOwnMail(row) ? identityOf(row.recipientEmail) : null);
  for (const row of rows) {
    const identity = counted(row);
    if (!identity) continue;
    dayCounts.set(identity, (dayCounts.get(identity) ?? 0) + 1);
    const typeKey = `${identity} ${row.messageType}`;
    typeCounts.set(typeKey, (typeCounts.get(typeKey) ?? 0) + 1);
  }

  const lineOf = (row: JournalRowRead): JournalLine => {
    const identity = counted(row);
    return {
      id: row.id,
      messageType: row.messageType,
      status: row.status,
      recipientEmail: row.recipientEmail,
      personName: personNameOf(row),
      eventTitle: row.eventTitle,
      createdAt: row.createdAt,
      sentAt: row.sentAt,
      rejectedAt: row.rejectedAt,
      recipientCount: row.recipientCount,
      lastError: row.status === "FAILED" ? row.lastError : null,
      test: row.test,
      dayCount: identity ? (dayCounts.get(identity) ?? 0) : 0,
      sameTypeCount: identity ? (typeCounts.get(`${identity} ${row.messageType}`) ?? 0) : 0,
      copies: [],
      departure: {
        status: row.status,
        messageType: row.messageType,
        attemptCount: row.attemptCount,
        nextAttemptAt: row.nextAttemptAt,
        createdAt: row.createdAt,
        lastError: row.lastError,
        familyHeld: row.familyHeld,
        sentNow: row.sentNow,
        onMailgunRoad: row.onMailgunRoad,
        isManualResend: row.isManualResend,
      },
      person: personOf(row),
    };
  };

  const section = (wanted: (row: JournalRowRead) => boolean): JournalPress[] => {
    const presses = new Map<string, JournalPress>();
    const linesByKey = new Map<string, JournalLine>();
    const clubRows: JournalRowRead[] = [];
    const pressKeyOf = (row: JournalRowRead) => row.pressId ?? (row.requestedByStaffUserId ? `staff:${row.requestedByStaffUserId}` : "site");
    const pressOf = (row: JournalRowRead): JournalPress => {
      const key = pressKeyOf(row);
      let press = presses.get(key);
      if (!press) {
        const cause = row.pressId && isPressCause(row.cause) ? row.cause : null;
        press = { key, cause, by: row.requestedByStaffUserId ? (nameById.get(row.requestedByStaffUserId) ?? null) : null, at: row.createdAt, lines: [], club: [] };
        presses.set(key, press);
      }
      if (row.createdAt.getTime() < press.at.getTime()) press.at = row.createdAt;
      return press;
    };
    for (const row of rows) {
      if (!wanted(row)) continue;
      if (isClubLine(row)) {
        clubRows.push(row);
        continue;
      }
      const line = lineOf(row);
      pressOf(row).lines.push(line);
      linesByKey.set(`${pressKeyOf(row)} ${row.idempotencyKey}`, line);
    }
    // A copy folds under the message it copies, in the same press and section; any other club row under its press.
    for (const row of clubRows) {
      const club: JournalClubLine = { id: row.id, messageType: row.messageType, status: row.status, recipientEmail: row.recipientEmail, sentAt: row.sentAt };
      const copied = copiedKey(row.idempotencyKey);
      const line = copied ? linesByKey.get(`${pressKeyOf(row)} ${copied}`) : undefined;
      if (line) line.copies.push(club);
      else pressOf(row).club.push(club);
    }
    for (const press of presses.values()) press.lines.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    return [...presses.values()];
  };

  // Waiting: the oldest press first, as the queue reads. Left: the newest first — what just happened is on top.
  const waiting = section((row) => isWaiting(row.status)).sort((a, b) => a.at.getTime() - b.at.getTime());
  const departed = section((row) => !isWaiting(row.status)).sort((a, b) => b.at.getTime() - a.at.getTime());

  const repeats: JournalRepeat[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const identity = counted(row);
    if (!identity) continue;
    const typeKey = `${identity} ${row.messageType}`;
    const times = typeCounts.get(typeKey) ?? 0;
    if (times < SAME_EMAIL_REPEATED || seen.has(typeKey)) continue;
    seen.add(typeKey);
    repeats.push({ personName: personNameOf(row), recipientEmail: row.recipientEmail, messageType: row.messageType, count: times });
  }
  repeats.sort((a, b) => b.count - a.count);

  return { dayStart: input.dayStart, waiting, departed, counts: input.counts, repeats, more: input.more };
}

/**
 * The day's rows from the database, grouped (`groupEmailJournal`). `locale` is the reader's: the event's title in
 * it, else in Romanian.
 */
export async function readEmailJournal<T extends Record<string, unknown>>(db: Database<T>, now: Date, locale: Locale): Promise<EmailJournal> {
  const dayStart = startOfClubDay(now);
  const since = dayStart.toISOString();
  const today = or(
    gte(emailOutbox.sentAt, dayStart),
    inArray(emailOutbox.status, ["PENDING", "PROCESSING"]),
    and(eq(emailOutbox.status, "FAILED"), gte(emailOutbox.createdAt, dayStart)),
    and(inArray(emailOutbox.status, ["BOUNCED", "COMPLAINED"]), sql`coalesce(${emailOutbox.rejectedAt}, ${emailOutbox.createdAt}) >= ${since}::timestamptz`),
  ) as SQL;
  // The roads as the claim splits them (§442): only a Mailgun-road row waits for Mailgun's stop or hour.
  const roads = await readOutboxRoads(db, now);

  // The event's title in the reader's language, else Romanian (the registrations filter's own rule, §881).
  const own = sql.raw('"event_translations"');
  const eventId = sql`coalesce(${registrations.eventId}, ${eventVolunteers.eventId})`;
  const titleIn = (language: string) => sql`(select ${own}."title" from ${eventTranslations} where ${own}."event_id" = ${eventId} and ${own}."locale" = ${language})`;
  const real = sql`coalesce(${registrations.kind}, 'REAL') <> 'TEST'`;

  const read = await db
    .select({
      id: emailOutbox.id,
      messageType: emailOutbox.messageType,
      status: emailOutbox.status,
      recipientEmail: emailOutbox.recipientEmail,
      createdAt: emailOutbox.createdAt,
      sentAt: emailOutbox.sentAt,
      rejectedAt: emailOutbox.rejectedAt,
      recipientCount: emailOutbox.recipientCount,
      lastError: emailOutbox.lastError,
      attemptCount: emailOutbox.attemptCount,
      nextAttemptAt: emailOutbox.nextAttemptAt,
      // The payload's flags only — the family's hold (§519), a press's «now» (§540), a club copy (§320) — never its words.
      familyHeld: sql<boolean>`coalesce((${emailOutbox.payloadJson} ->> 'sittingHeld') = 'true' or (${emailOutbox.payloadJson} ->> 'familyHeld') = 'true', false)`,
      sentNow: sql<boolean>`coalesce((${emailOutbox.payloadJson} ->> ${SENT_NOW_FLAG}::text) = 'true', false)`,
      onMailgunRoad: roads ? sql<boolean>`not coalesce((${gmailRoadCondition(roads)}), false)` : sql<boolean>`true`,
      isManualResend: emailOutbox.isManualResend,
      clubCopy: sql<boolean>`coalesce((${emailOutbox.payloadJson} ->> ${CLUB_COPY_FLAG}::text) = 'true', false)`,
      idempotencyKey: emailOutbox.idempotencyKey,
      cause: emailOutbox.cause,
      pressId: emailOutbox.pressId,
      requestedByStaffUserId: emailOutbox.requestedByStaffUserId,
      registeredName: registrations.registeredName,
      test: sql<boolean>`coalesce(${registrations.kind} = 'TEST', false)`,
      registrationId: emailOutbox.registrationId,
      volunteerId: eventVolunteers.id,
      volunteerName: eventVolunteers.name,
      guardianName: eventVolunteers.guardianName,
      eventTitle: sql<string | null>`coalesce(${titleIn(locale)}, ${titleIn("ro")})`,
    })
    .from(emailOutbox)
    .leftJoin(registrations, eq(registrations.id, emailOutbox.registrationId))
    .leftJoin(eventVolunteers, VOLUNTEER_OF_ROW)
    .where(today)
    // The newest first, so a day longer than the page keeps its latest rows.
    .orderBy(desc(sql`coalesce(${emailOutbox.sentAt}, ${emailOutbox.createdAt})`), desc(emailOutbox.id))
    .limit(JOURNAL_ROW_LIMIT);

  const [totals] = await db
    .select({
      all: count(),
      sent: count(sql`case when ${emailOutbox.status} = 'SENT' and ${emailOutbox.sentAt} >= ${since}::timestamptz and ${real} then 1 end`),
      waiting: count(sql`case when ${emailOutbox.status} in ('PENDING', 'PROCESSING') and ${real} then 1 end`),
      failed: count(sql`case when ${emailOutbox.status} = 'FAILED' and ${real} then 1 end`),
    })
    .from(emailOutbox)
    .leftJoin(registrations, eq(registrations.id, emailOutbox.registrationId))
    .where(today);

  const staff = await listStaffUsers(db);
  const rows: JournalRowRead[] = read.map((row) => ({
    ...row,
    // A raw `timestamptz` read through `sql` would come back as text; these are the columns' own mappings.
    familyHeld: Boolean(row.familyHeld),
    sentNow: Boolean(row.sentNow),
    onMailgunRoad: Boolean(row.onMailgunRoad),
    clubCopy: Boolean(row.clubCopy),
    test: Boolean(row.test),
  }));
  return groupEmailJournal(rows, staff, {
    dayStart,
    counts: { sent: totals?.sent ?? 0, waiting: totals?.waiting ?? 0, failed: totals?.failed ?? 0 },
    more: Math.max(0, (totals?.all ?? 0) - rows.length),
  });
}
