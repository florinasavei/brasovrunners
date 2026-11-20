import { and, count, desc, eq, inArray, isNull, type SQL, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { auditLogs } from "@/db/schema/audit-logs";
import { eventVolunteers } from "@/db/schema/event-volunteers";
import { events, eventTranslations } from "@/db/schema/events";
import { type RegistrationStatus, registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import type { Locale } from "@/i18n/routing";
import { RACE_NUMBER_FORMAT } from "@/modules/events/repository";
import { CHECKED_IN_BY_SELF } from "@/modules/registrations/checked-in-by";
import { formatRaceNumber, raceNumberOf, type RaceNumberFormat } from "@/modules/registrations/domain/race-number";
import { canReadRaceDayJournal } from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";
import { isUuid } from "@/shared/ids";
import {
  JOURNAL_LINES_MAX,
  type JournalAccount,
  type JournalKind,
  type JournalLine,
  type JournalSummaryRow,
  type JournalTally,
  type JournalWho,
  journalReads,
  journalSummary,
  knownAccount,
  mergeJournalLines,
  RUNNER_JOURNAL_ACTIONS,
  runnerKindOf,
} from "./domain/journal";

/*
  «Ziua cursei» → «Jurnal» (§996; the owner, 2026-11-19: «vreau si tracing pentru voluntarim [voluntari] gen cine a scanat, cine a
  marcat prezent»), the reads: one event's scans, check-ins and undos of its registrations, the raffle marks taken off or put back
  on them (§NNN: who decided that a runner does not take part — at the desk, asked first, or by the organizers' tick), and «Prezent»
  ticks of its volunteers, newest first, with how many each staff account did. The organizers' alone (`canReadRaceDayJournal`), and so never imported by a
  page of the desk: the scanned page's «Scanat înainte» reads the same scan rows through the desk's own module
  (`registrations/code-scans.ts`), which reads nothing else.

  **Nothing new is stored but the scan** (`registration.code_scanned`, `admin-service.ts#recordCodeScan`): the desk's check-ins
  and undos were audited with their actor all along, and so was every «Prezent» on a volunteer (`volunteer.edited`, `fields:
  ["present"]`) and every raffle mark of a registration (`registration.raffle_excluded` / `raffle_included`, `raffle-mark.ts`,
  their `door` the desk's or none — read here by the action alone, whichever door wrote it). The participant's own «Am ajuns» writes no audit row: it is read from the registration itself — checked in, no
  staff account, and no staff check-in row at that very moment (a staff check-in writes its row with the instant it sets,
  `checkInByStaff`), so an account deleted since is never mistaken for the person. A registration erased since is gone from the
  log with its row (the erase scrubs its audit rows of whom, `scrubRegistrationsFromAudit`), and so is a volunteer deleted since.

  **Reads indexed, a fixed number of queries whatever the rows.** The runners' rows are joined from the event's registrations
  (`registrations.event_id`) into `audit_logs_entity_idx` (entity type and id); the volunteers' are the event's own rows on the same
  index (entity `event`, the event's id). Three grouped counts (the summary), then the three reads of lines, each the newest
  `JOURNAL_LINES_MAX` with its own total (`count(*) over ()`), merged in `domain/journal.ts`.
*/

type Actor = Pick<StaffUser, "id" | "role">;

/** The event the log is about, as its page heads it: its title in the reader's language, its day and clock, how it writes a number. */
export type JournalEvent = { id: string; title: string | null; startsAt: Date; timezone: string; raceNumberFormat: RaceNumberFormat };

export type RaceDayJournal = {
  event: JournalEvent;
  /** One line per account that acted, real registrations' rows counted (`journalSummary`). */
  summary: JournalSummaryRow[];
  /** The accounts the filter offers: everyone the event's log names, a rehearsal on test rows included. */
  accounts: JournalWho[];
  /** The filter as it was applied: an account the log does not name reads as everybody. */
  account: JournalAccount;
  kind: JournalKind | null;
  lines: JournalLine[];
  /** How many lines the filter holds beyond the ones shown. */
  more: number;
};

/** The event by id, for the log's head, or null for an id nobody has. */
export async function findJournalEvent<T extends Record<string, unknown>>(db: Database<T>, eventId: string, locale: Locale): Promise<JournalEvent | null> {
  if (!isUuid(eventId)) return null;
  const [row] = await db
    .select({ id: events.id, startsAt: events.startsAt, timezone: events.timezone, raceNumberFormat: RACE_NUMBER_FORMAT, title: eventTranslations.title })
    .from(events)
    .leftJoin(eventTranslations, and(eq(eventTranslations.eventId, events.id), eq(eventTranslations.locale, locale)))
    .where(eq(events.id, eventId))
    .limit(1);
  return row ?? null;
}

const actorOf = alias(staffUsers, "journal_actor");

/** The volunteers' «Prezent» rows of one event: its own rows on `audit_logs_entity_idx`, the one verb that ticks or unticks it. */
const presentTickRows = (eventId: string): SQL =>
  and(
    eq(auditLogs.entityType, "event"),
    eq(auditLogs.entityId, eventId),
    eq(auditLogs.action, "volunteer.edited"),
    sql`(${auditLogs.metadataJson} -> 'fields') @> '["present"]'::jsonb`,
    sql`jsonb_typeof(${auditLogs.metadataJson} -> 'present') = 'boolean'`,
  ) as SQL;

/** The audit row's volunteer is one of the event's volunteers still on its list: the join that names whom. */
const ofTheEventsVolunteer = (eventId: string): SQL =>
  and(eq(eventVolunteers.eventId, eventId), sql`${eventVolunteers.id}::text = (${auditLogs.metadataJson} ->> 'volunteerId')`) as SQL;

/** The registration's runner audit rows of these actions, joined on `audit_logs_entity_idx`. */
const ofTheRegistration = (actions: readonly string[]): SQL =>
  and(eq(auditLogs.entityType, "registration"), eq(auditLogs.entityId, registrations.id), inArray(auditLogs.action, [...actions])) as SQL;

/** The filter's account on an audit row's actor: one account, or none (deleted since); nothing for everybody. */
function actorCondition(account: JournalAccount): SQL | undefined {
  if (account.kind === "staff") return eq(auditLogs.actorStaffUserId, account.id);
  if (account.kind === "removed") return isNull(auditLogs.actorStaffUserId);
  return undefined;
}

function whoOf(actorId: string | null, actorName: string | null): JournalWho {
  return actorId !== null && actorName !== null ? { kind: "staff", id: actorId, name: actorName } : { kind: "removed" };
}

/**
 * The log of one event (§996), for the Organizer, the Administrator and the Superadministrator (`canReadRaceDayJournal`, asserted
 * here as on the page, BR-REQ-060-01): the summary per account, the accounts the filter offers, and the newest lines the filter
 * holds — at most `JOURNAL_LINES_MAX` — with how many more. Six queries, whatever the rows: three grouped counts, three reads.
 */
export async function readRaceDayJournal<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Actor,
  input: { event: JournalEvent; account: JournalAccount; kind: JournalKind | null; locale: Locale },
): Promise<RaceDayJournal> {
  if (!canReadRaceDayJournal(actor.role)) throw new DomainError("FORBIDDEN", `role ${actor.role} may not read the race-day log`);
  const { event } = input;
  const eventId = event.id;
  const allRunnerActions = Object.values(RUNNER_JOURNAL_ACTIONS);

  // The counts, every account and every kind, the test rows apart: what the summary says and what the account select offers.
  const [runnerTallies, volunteerTallies, selfTallies] = await Promise.all([
    db
      .select({ actorId: auditLogs.actorStaffUserId, actorName: actorOf.displayName, action: auditLogs.action, kind: registrations.kind, n: count() })
      .from(registrations)
      .innerJoin(auditLogs, ofTheRegistration(allRunnerActions))
      .leftJoin(actorOf, eq(actorOf.id, auditLogs.actorStaffUserId))
      .where(eq(registrations.eventId, eventId))
      .groupBy(auditLogs.actorStaffUserId, actorOf.displayName, auditLogs.action, registrations.kind),
    db
      .select({ actorId: auditLogs.actorStaffUserId, actorName: actorOf.displayName, n: count() })
      .from(auditLogs)
      .innerJoin(eventVolunteers, ofTheEventsVolunteer(eventId))
      .leftJoin(actorOf, eq(actorOf.id, auditLogs.actorStaffUserId))
      .where(presentTickRows(eventId))
      .groupBy(auditLogs.actorStaffUserId, actorOf.displayName),
    db
      .select({ kind: registrations.kind, n: count() })
      .from(registrations)
      .where(and(eq(registrations.eventId, eventId), CHECKED_IN_BY_SELF))
      .groupBy(registrations.kind),
  ]);
  const tallies: JournalTally[] = [
    ...runnerTallies.flatMap((row) => {
      const kind = runnerKindOf(row.action);
      return kind ? [{ actorId: row.actorId, actorName: row.actorName, kind, count: row.n, test: row.kind === "TEST" }] : [];
    }),
    ...volunteerTallies.map((row) => ({ actorId: row.actorId, actorName: row.actorName, kind: "volunteerTicks" as const, count: row.n, test: false })),
    ...selfTallies.map((row) => ({ actorId: null, actorName: null, kind: "selfCheckIn" as const, count: row.n, test: row.kind === "TEST" })),
  ];
  const { rows: summary, accounts } = journalSummary(tallies, input.locale);
  const account = knownAccount(input.account, accounts);
  const reads = journalReads(input.kind, account);
  const byActor = actorCondition(account);

  // The lines: each read the newest `JOURNAL_LINES_MAX` it holds, with its own total before the limit.
  const [runnerLines, volunteerLines, selfLines] = await Promise.all([
    reads.runnerKinds.length === 0
      ? Promise.resolve([])
      : db
          .select({
            id: auditLogs.id,
            at: auditLogs.createdAt,
            action: auditLogs.action,
            actorId: auditLogs.actorStaffUserId,
            actorName: actorOf.displayName,
            registrationId: registrations.id,
            name: registrations.registeredName,
            status: registrations.status,
            bibNumber: registrations.bibNumber,
            kind: registrations.kind,
            total: sql<number>`count(*) over ()`.mapWith(Number),
          })
          .from(registrations)
          .innerJoin(auditLogs, ofTheRegistration(reads.runnerKinds.map((kind) => RUNNER_JOURNAL_ACTIONS[kind])))
          .leftJoin(actorOf, eq(actorOf.id, auditLogs.actorStaffUserId))
          .where(and(eq(registrations.eventId, eventId), byActor))
          .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
          .limit(JOURNAL_LINES_MAX),
    reads.volunteerTicks.length === 0
      ? Promise.resolve([])
      : db
          .select({
            id: auditLogs.id,
            at: auditLogs.createdAt,
            actorId: auditLogs.actorStaffUserId,
            actorName: actorOf.displayName,
            volunteerId: eventVolunteers.id,
            name: eventVolunteers.name,
            present: sql<boolean>`((${auditLogs.metadataJson} ->> 'present') = 'true')`.mapWith(Boolean),
            total: sql<number>`count(*) over ()`.mapWith(Number),
          })
          .from(auditLogs)
          .innerJoin(eventVolunteers, ofTheEventsVolunteer(eventId))
          .leftJoin(actorOf, eq(actorOf.id, auditLogs.actorStaffUserId))
          .where(
            and(
              presentTickRows(eventId),
              byActor,
              reads.volunteerTicks.length === 1 ? sql`((${auditLogs.metadataJson} ->> 'present') = ${reads.volunteerTicks[0] ? "true" : "false"})` : undefined,
            ),
          )
          .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
          .limit(JOURNAL_LINES_MAX),
    !reads.selfCheckIns
      ? Promise.resolve([])
      : db
          .select({
            registrationId: registrations.id,
            at: registrations.checkedInAt,
            name: registrations.registeredName,
            status: registrations.status,
            bibNumber: registrations.bibNumber,
            kind: registrations.kind,
            total: sql<number>`count(*) over ()`.mapWith(Number),
          })
          .from(registrations)
          .where(and(eq(registrations.eventId, eventId), CHECKED_IN_BY_SELF))
          .orderBy(desc(registrations.checkedInAt), desc(registrations.id))
          .limit(JOURNAL_LINES_MAX),
  ]);

  const number = (row: { status: RegistrationStatus; bibNumber: number | null }) => {
    const value = raceNumberOf(row);
    return value === null ? null : formatRaceNumber(value, event.raceNumberFormat);
  };
  const totalOf = (rows: readonly { total: number }[]) => rows[0]?.total ?? 0;
  const merged = mergeJournalLines([
    {
      total: totalOf(runnerLines),
      lines: runnerLines.flatMap((row): JournalLine[] => {
        const kind = runnerKindOf(row.action);
        if (!kind) return [];
        return [
          {
            id: row.id,
            at: row.at,
            kind,
            who: whoOf(row.actorId, row.actorName),
            whom: { kind: "registration", id: row.registrationId, name: row.name, number: number(row), test: row.kind === "TEST" },
          },
        ];
      }),
    },
    {
      total: totalOf(volunteerLines),
      lines: volunteerLines.map((row): JournalLine => ({
        id: row.id,
        at: row.at,
        kind: row.present ? "volunteerPresent" : "volunteerAbsent",
        who: whoOf(row.actorId, row.actorName),
        whom: { kind: "volunteer", id: row.volunteerId, name: row.name },
      })),
    },
    {
      total: totalOf(selfLines),
      lines: selfLines.flatMap((row): JournalLine[] =>
        row.at === null
          ? []
          : [
              {
                // The registration's own fact, not an audit row: its id, marked so it never meets an audit row's.
                id: `self:${row.registrationId}`,
                at: row.at,
                kind: "checkedIn",
                who: { kind: "participant" },
                whom: { kind: "registration", id: row.registrationId, name: row.name, number: number(row), test: row.kind === "TEST" },
              },
            ],
      ),
    },
  ]);
  return { event, summary, accounts, account, kind: input.kind, lines: merged.lines, more: merged.more };
}
