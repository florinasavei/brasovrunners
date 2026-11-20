import { and, asc, desc, eq, gt, gte, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { auditLogs } from "@/db/schema/audit-logs";
import { eventEliteEntries } from "@/db/schema/event-elite-entries";
import { eventResults, type EventResultRow } from "@/db/schema/event-results";
import { events } from "@/db/schema/events";
import { registrations, type RegistrationSex } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import { type AuditAction, recordAuditEvent } from "@/modules/audit/repository";
import { type Deadlines, publicListClosesAt, publicListStillOpen } from "@/modules/deadlines/domain/deadlines";
import { findFirstResultsNameAskNoticeVersion, findFirstResultsNoticeVersion, noticeDescribesResults, termsDescribeResults } from "@/modules/legal-documents/repository";
import { revalidatePublicContent } from "@/modules/public-cache/cache";
import { eliteBibName, eliteLineBibName } from "@/modules/registrations/bib-elite";
import { ageOnRaceDay, dayIn } from "@/modules/registrations/domain/age";
import { RACE_NUMBER_FORMAT } from "@/modules/events/repository";
import { hiddenListShownPublicly } from "@/modules/registrations/domain/hidden-list";
import type { RaceNumberFormat } from "@/modules/registrations/domain/race-number";
import { type SexChoice, sexShown } from "@/modules/registrations/domain/sex";
import { canEnterResults, canPublishResults, canRecordFinishes, canResetResults } from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";
import { isUuid } from "@/shared/ids";
import { ageBandStartsOf, DEFAULT_AGE_BAND_STARTS, isValidAgeBandStarts, sameAgeBandStarts } from "./domain/age-bands";
import { type AwardRules, isValidAwardPlaces } from "./domain/awards";
import { eventTakesResults } from "./domain/event-type";
import {
  type EliteButtonView,
  FINISH_UNDO_WINDOW_MS,
  finishStamp,
  isInstant,
  LINE_TRAIL_ACTIONS,
  type LineTrailRow,
  mayUndo,
  PRESS_TRAIL_ACTIONS,
  pressMeets,
  raceGunMoment,
  raceGunRepeats,
  raceGunWindowOpen,
  type RecentFinisherView,
  type SavedPress,
  savedPressOf,
  undoClosedBy,
  undoOpenUntil,
  undoTrailOf,
} from "./domain/finish-line";
import { type FingerprintedResult, resultLineFingerprint, resultsFingerprint } from "./domain/fingerprint";
import { foldEliteName, horsConcoursBibs, type OutOfRanking } from "./domain/hors-concours";
import { parseResultsCsv } from "./domain/import-csv";
import { publicResultName } from "./domain/public-name";
import { type PublicNameReason, publicNameVerdict } from "./domain/public-name-reason";
import { isResultStatus, type Rankable, RESULTS_MAX, rankResults, type ResultStatus, type Ranked } from "./domain/ranking";
import { isRecordedTime, mayChooseRecordedTime, recordedTimesOf } from "./domain/recorded-times";
import { type ReadRow, type ResultRowProblem, readResultRow } from "./domain/row-input";
import { loadRecordedTimesTrail } from "./recorded-times";
import { type PostedResultRow, resultBox } from "./rows";

/**
 * A race's results, part 1 (§808; the owner, 2026-10-17: «Aș vrea să pot pune și clasament la final după cursă»): the rows entered or
 * imported in the backoffice, ranked, and — only when an Administrator publishes them and the privacy notice in force describes
 * them — read by the event page.
 *
 * **Who.** The Organizer, the Administrator and the Superadministrator enter, import, rank and read (`canEnterResults`); the
 * Administrator and the Superadministrator alone publish (`canPublishResults`) and, before the start, wipe the whole list
 * («Resetează clasamentul», `canResetResults`, §997: `resetEventResults`). The Tehnic role, the Redactor, the desk Volunteer
 * and a member are refused here, whatever the page drew (BR-REQ-060-01) — but for the finish line (§986): every role that works
 * the desk records a finish on «Cronometrare» and undoes its own press for ten minutes (`canRecordFinishes`), and only whoever
 * enters results presses «Start». **Nothing about a registration changes**: a result reads
 * the registration's name, sex and birth date and writes none of them; no state, no place, no number moves.
 *
 * **One race, one list.** Only a `RACE` takes results (`RESULTS_NOT_OPEN` for any other type). A row is a race number: found among
 * the event's **confirmed** registrations (never a test row) it is that runner's, taking the registration's name, sex and age at read;
 * not found, it is a runner the club typed by hand and needs a name — and, to stand **by name** in the public ranking, the staff's tick that
 * the person agreed to it (`name_agreed_at`, §810: the desk's paper declaration has the same shape — the participant agrees, a staff member records it). A number a registration holds that is not confirmed (cancelled,
 * expired) is refused (`bibNotConfirmed`), never attached silently and never a typed name thrown away. A stored result follows its
 * **registration**, not the number it was saved under: when the desk changes a runner's number the row moves with it. «Salvează tot clasamentul» is the whole list — a row left out is a
 * result removed — saved in **one transaction** or not at all: the first refused row refuses the save, naming it (`ResultRowError`,
 * §791's pattern), and a form drawn before another session saved is refused with CONFLICT (`resultsFingerprint`).
 *
 * **Rankings are computed on save and stored** (`domain/ranking.ts`): overall among the finishers by gun time, by sex, and by
 * category — the sex and the age band on the event's day: the platform's bands (`statistics.ts`', §787) or the race's own
 * (`events.result_age_bands`, §850, set on «Clasament» and re-ranking the stored rows). Ties share a position and the next
 * skips. **The page and the public read re-rank from the live answers** (a corrected sex, a moved race day, an erased registration), the
 * stored positions being what the last save, or an erasure, wrote — a cache, rewritten on the next save. One audit row per result created, changed or deleted (`event_result.*`: the number, the state, the times and the names of the
 * boxes that changed, never a name), and the public cache is told once.
 *
 * **Hors concours (§910).** An elite the Administrator left out of the ranking — a registration marked «Elită» with «Apare în clasament»
 * unticked, or a line of the race's elite list unticked, its typed result recognised by the line's number or, for a line with none, by its
 * name (`domain/hors-concours.ts`) — keeps its row here, drawn «în afara clasamentului», and is placed nowhere: every ranking, stored or
 * read, counts the others as if it had not run, and the public results leave it out altogether. The tick ranks the stored rows again in
 * its own transaction (`rerankEventResults`).
 */

type Actor = Pick<StaffUser, "id" | "role">;

/** One row of a save refused (`RESULT_ROW_INVALID`): the runner for the sentence, the problem for the words after it, the boxes to correct. Names and codes only, never a typed value. */
export class ResultRowError extends DomainError {
  readonly problem: ResultRowProblem;
  readonly bibNumber: number | null;
  /** The name the backoffice reads the runner by — the registration's, the typed one — or null when there is none. */
  readonly runnerName: string | null;

  constructor(problem: ResultRowProblem, fields: readonly string[], bibNumber: number | null, runnerName: string | null) {
    super("RESULT_ROW_INVALID", `a result of the form cannot be saved: ${problem}`, fields);
    this.name = "ResultRowError";
    this.problem = problem;
    this.bibNumber = bibNumber;
    this.runnerName = runnerName;
  }
}

/** A registered runner of the event, with the answers a result reads of the registration (never an address, a phone or a document). */
type RegisteredRunner = {
  registrationId: string;
  bibNumber: number;
  displayName: string;
  sex: SexChoice | null;
  birthDate: string | null;
  /**
   * The «Vreau să apar pe lista de participanți & rezultate» tick (`list_opt_out` false) — read as unticked while an Administrator
   * unticked «Apare pe site» on the registration marked «Elită» (§910, `tickedForTheSite`).
   */
  ticked: boolean;
  /** The person ticked, and the club's «Apare pe site» is what reads the tick as off (`siteHiddenByClub`): «Clasament»'s reason only (§985). */
  hiddenByClub: boolean;
  /**
   * The club's two marks on the registration, «Elită» (§897) and «Ambasador» (§948): the backoffice's «Clasament» and «Premii»
   * say them beside the runner, so the club sees whose result it awards. Staff-only — the public read copies neither.
   */
  elite: boolean;
  ambassador: boolean;
  checkedIn: boolean;
  status: string;
  /** Sits «În afara locurilor» (§643): never named on a public list the event does not show its special guests on (§743). */
  outsideCapacity: boolean;
  /** The privacy notice version the registration recorded: a tick under an older notice does not name the runner in the results (§421's line). */
  noticeVersion: number;
  /** «Vreau să apar cu numele în clasament», asked since by an older notice's runner (§879), and the notice in force when asked. */
  resultsNameConsent: boolean;
  resultsConsentVersion: number;
};

/** A line of the race's elite list (§895), as the finish line reads it (§986): its name and its number, if any. */
type EliteLine = { id: string; name: string; bibNumber: number | null };

/**
 * The event's registered runners, by race number and by registration — and the elites the Administrator left out of the ranking (§910,
 * `domain/hors-concours.ts`), read with them so every list ranked from them leaves out the same rows; and the race's elite list's lines
 * (`lines`), the same read, for the finish line's buttons and its typed rows (§986).
 */
type Runners = { byBib: Map<number, RegisteredRunner>; byRegistration: Map<string, RegisteredRunner>; out: OutOfRanking; lines: EliteLine[] };

/**
 * Whether the published results may read the person's own list tick as given (§910): their «Vreau să apar» — and no Administrator
 * unticked «Apare pe site» on the registration while it is marked «Elită» or «Ambasador» (§948). That tick only ever hides: unticked, the runner is
 * «Participant #bib» wherever the ranking still counts them, as one who did not tick; ticked, the person's own answer decides, as before.
 * The public start list reads the same two columns (`registrations/repository.ts#namedOnPublicList`).
 */
function tickedForTheSite(row: { listOptOut: boolean | null; elite: boolean | null; ambassador: boolean | null; eliteHiddenFromSite: boolean | null }): boolean {
  return row.listOptOut === false && !((row.elite === true || row.ambassador === true) && row.eliteHiddenFromSite === true);
}

/**
 * The other half of the same columns, for «Clasament»'s reason alone (§985, `domain/public-name-reason.ts#publicNameReason`): the person
 * ticked, and the club's «Apare pe site», unticked on the registration while it is marked «Elită» or «Ambasador» (§910, §948), is what
 * `tickedForTheSite` reads as off. Kept here, beside the tick, so the mark is read where it already was; the reason takes the boolean.
 * A person who did not tick is their own answer, whatever the club ticked; a typed row's left join reads nulls, and is never this.
 */
function siteHiddenByClub(row: { listOptOut: boolean | null; elite: boolean | null; ambassador: boolean | null; eliteHiddenFromSite: boolean | null }): boolean {
  return row.listOptOut === false && (row.elite === true || row.ambassador === true) && row.eliteHiddenFromSite === true;
}

type EventFacts = {
  id: string;
  type: string;
  startsAt: Date;
  /** The gun as planned, when the race's own start differs from the gathering (`race_starts_at`). */
  raceStartsAt: Date | null;
  /**
   * «Start» as pressed on «Cronometrare» (§986), and by whom; null until pressed. The finish line counts from
   * `raceGunAt ?? raceStartsAt ?? startsAt` (`gunOf`). Read by the backoffice's results alone: the public read never selects it.
   */
  raceGunAt: Date | null;
  raceGunByStaffUserId: string | null;
  endsAt: Date | null;
  /**
   * «Data se anunță» and «Ora se anunță» (§533): while either is on, the public side has no start, so «Clasament» names no hour (§985).
   * Read by `loadEvent`, for the backoffice; the public read leaves them out — the page it serves already has no start then.
   */
  dateToBeAnnounced?: boolean;
  timeToBeAnnounced?: boolean;
  timezone: string;
  resultsPublished: boolean;
  resultsPublishedAt: Date | null;
  hiddenListEnabled: boolean;
  hiddenListPublic: boolean;
  /** How the event writes its race numbers (§735): «Participant #007» on the backoffice's «Pe site» line as on the page. */
  raceNumberFormat: RaceNumberFormat;
  /** The ages the race's categories start at (§850): its own, or the platform's when it chose none (`ageBandStartsOf`). */
  resultAgeBands: readonly number[];
  /** «Premii» (§850): how many places each podium awards, and whether the categories are awarded beside the overall podium by sex. */
  awardPlaces: number;
  awardCategories: boolean;
};

function assertMayEnter(actor: Actor): void {
  if (!canEnterResults(actor.role)) throw new DomainError("FORBIDDEN", `role ${actor.role} may not enter or read a race's results`);
}

/** The finish line's own gate (§986): every role that works the desk records a finish and undoes its own press. */
function assertMayRecord(actor: Actor): void {
  if (!canRecordFinishes(actor.role)) throw new DomainError("FORBIDDEN", `role ${actor.role} may not record a finish`);
}

function assertIds(...ids: string[]): void {
  // A forged form's malformed id is the refusal an unknown one gets, not a database error.
  if (ids.some((id) => !isUuid(id))) throw new DomainError("NOT_FOUND", "the event is not there");
}

async function loadEvent<T extends Record<string, unknown>>(db: Database<T>, eventId: string, lock: boolean): Promise<EventFacts> {
  const query = db
    .select({
      id: events.id,
      type: events.type,
      startsAt: events.startsAt,
      raceStartsAt: events.raceStartsAt,
      raceGunAt: events.raceGunAt,
      raceGunByStaffUserId: events.raceGunByStaffUserId,
      endsAt: events.endsAt,
      dateToBeAnnounced: events.dateToBeAnnounced,
      timeToBeAnnounced: events.timeToBeAnnounced,
      timezone: events.timezone,
      resultsPublished: events.resultsPublished,
      resultsPublishedAt: events.resultsPublishedAt,
      hiddenListEnabled: events.hiddenListEnabled,
      hiddenListPublic: events.hiddenListPublic,
      raceNumberFormat: RACE_NUMBER_FORMAT,
      resultAgeBands: events.resultAgeBands,
      awardPlaces: events.awardPlaces,
      awardCategories: events.awardCategories,
    })
    .from(events)
    .where(eq(events.id, eventId))
    .limit(1);
  const [event] = await (lock ? query.for("no key update") : query);
  if (!event) throw new DomainError("NOT_FOUND", "the event is not there");
  return { ...event, resultAgeBands: ageBandStartsOf(event.resultAgeBands) };
}

/**
 * What «Apare în clasament» leaves out at this event (§910): the registrations marked «Elită» or «Ambasador» (§948) whose tick is off — wherever their number
 * is, never a test row — and the elite list's lines (§895): the unticked ones by number, or by folded name when they have none, and every
 * line's number, so a row its own line holds is never another line's by name.
 */
async function loadOutOfRanking<T extends Record<string, unknown>>(db: Database<T>, eventId: string): Promise<{ out: OutOfRanking; lines: EliteLine[] }> {
  const [hidden, lines] = await Promise.all([
    db
      .select({ id: registrations.id })
      .from(registrations)
      .where(and(eq(registrations.eventId, eventId), eq(registrations.kind, "REAL"), or(eq(registrations.elite, true), eq(registrations.ambassador, true)), eq(registrations.eliteHiddenFromResults, true))),
    db
      .select({ id: eventEliteEntries.id, name: eventEliteEntries.name, bibNumber: eventEliteEntries.bibNumber, inResults: eventEliteEntries.inResults })
      .from(eventEliteEntries)
      .where(eq(eventEliteEntries.eventId, eventId))
      .orderBy(asc(eventEliteEntries.createdAt), asc(eventEliteEntries.id)),
  ]);
  const bibs = new Set<number>();
  const names = new Set<string>();
  const listedBibs = new Set<number>();
  for (const line of lines) {
    if (line.bibNumber !== null) listedBibs.add(line.bibNumber);
    if (line.inResults) continue;
    if (line.bibNumber !== null) bibs.add(line.bibNumber);
    else names.add(foldEliteName(line.name));
  }
  return {
    out: { registrations: new Set(hidden.map((row) => row.id)), bibs, names, listedBibs },
    lines: lines.map((line) => ({ id: line.id, name: line.name, bibNumber: line.bibNumber })),
  };
}

/**
 * What the elites' bibs print where the number goes (§975: `bib-elite.ts#eliteBibName`, `#eliteLineBibName`) — by registration marked
 * «Elită» and by line of the elite list — read for the finish line alone (§986): «Cronometrare»'s buttons and lines say an elite by
 * the label on the bib, as the desk's row does. Its own query, so no other read of the results — the public one least of all — ever
 * selects a label (`tests/unit/registrations/elite-label-never-leaves.test.ts`).
 */
async function loadEliteLabels<T extends Record<string, unknown>>(db: Database<T>, eventId: string): Promise<{ registrations: Map<string, string>; lines: Map<string, string> }> {
  const [marked, lines] = await Promise.all([
    db
      .select({ id: registrations.id, eliteBibLabel: registrations.eliteBibLabel, firstName: registrations.firstName, registeredName: registrations.registeredName })
      .from(registrations)
      .where(and(eq(registrations.eventId, eventId), eq(registrations.kind, "REAL"), eq(registrations.elite, true))),
    db.select({ id: eventEliteEntries.id, name: eventEliteEntries.name, bibLabel: eventEliteEntries.bibLabel }).from(eventEliteEntries).where(eq(eventEliteEntries.eventId, eventId)),
  ]);
  return {
    registrations: new Map(marked.map((row) => [row.id, eliteBibName(row)])),
    lines: new Map(lines.map((line) => [line.id, eliteLineBibName(line.name, line.bibLabel)])),
  };
}

/** The registrations of the event that hold a race number — any state, never a test row — by that number and by registration. */
async function loadRegisteredRunners<T extends Record<string, unknown>>(db: Database<T>, eventId: string): Promise<Runners> {
  const [{ out, lines }, rows] = await Promise.all([
    loadOutOfRanking(db, eventId),
    db
      .select({
        registrationId: registrations.id,
        bibNumber: registrations.bibNumber,
        displayName: registrations.displayName,
        sex: registrations.sex,
        birthDate: registrations.birthDate,
        listOptOut: registrations.listOptOut,
        elite: registrations.elite,
        ambassador: registrations.ambassador,
        eliteHiddenFromSite: registrations.eliteHiddenFromSite,
        checkedInAt: registrations.checkedInAt,
        status: registrations.status,
        outsideCapacity: registrations.outsideCapacity,
        noticeVersion: registrations.privacyNoticeVersion,
        resultsNameConsent: registrations.resultsNameConsent,
        resultsConsentVersion: registrations.resultsConsentVersion,
      })
      .from(registrations)
      .where(and(eq(registrations.eventId, eventId), eq(registrations.kind, "REAL"), isNotNull(registrations.bibNumber))),
  ]);
  const runners: Runners = { byBib: new Map(), byRegistration: new Map(), out, lines };
  for (const row of rows) {
    if (row.bibNumber === null) continue;
    const runner: RegisteredRunner = {
      registrationId: row.registrationId,
      bibNumber: row.bibNumber,
      displayName: row.displayName,
      sex: sexShown(row.sex),
      birthDate: row.birthDate,
      // The person's own tick — read as unticked while the club unticked «Apare pe site» on a marked elite (§910): a staff tick only hides.
      ticked: tickedForTheSite(row),
      hiddenByClub: siteHiddenByClub(row),
      elite: row.elite,
      ambassador: row.ambassador,
      checkedIn: row.checkedInAt !== null,
      status: row.status,
      outsideCapacity: row.outsideCapacity,
      noticeVersion: row.noticeVersion,
      resultsNameConsent: row.resultsNameConsent,
      resultsConsentVersion: row.resultsConsentVersion,
    };
    runners.byBib.set(row.bibNumber, runner);
    runners.byRegistration.set(row.registrationId, runner);
  }
  return runners;
}

/**
 * Which stored row is whose. A row follows its **registration** (`registration_id`), wherever the number it was saved under was —
 * the desk may change a runner's number (§548) — and a row no registered runner holds (typed by hand, or left by a registration
 * that has no number any more) is found by its own number.
 */
type StoredIndex = { byRegistration: Map<string, EventResultRow>; freeByBib: Map<number, EventResultRow> };

function indexStored(stored: readonly EventResultRow[], runners: Runners): StoredIndex {
  const index: StoredIndex = { byRegistration: new Map(), freeByBib: new Map() };
  for (const row of stored) {
    if (row.registrationId !== null && runners.byRegistration.has(row.registrationId)) index.byRegistration.set(row.registrationId, row);
    else index.freeByBib.set(row.bibNumber, row);
  }
  return index;
}

/**
 * The result row of a registered runner, or undefined, and whether the runner is on the page and in the save: a **confirmed**
 * registration always is, taking its own row or else the typed row at its number; one that is not confirmed (cancelled, expired) only
 * when a result was already entered for that very registration — never newly, never by number alone.
 */
function claimOf(runner: RegisteredRunner, index: StoredIndex): { attached: boolean; row: EventResultRow | undefined } {
  const own = index.byRegistration.get(runner.registrationId);
  if (runner.status === "CONFIRMED") return { attached: true, row: own ?? index.freeByBib.get(runner.bibNumber) };
  return { attached: own !== undefined, row: own };
}

async function loadStored<T extends Record<string, unknown>>(db: Database<T>, eventId: string, lock: boolean): Promise<EventResultRow[]> {
  const query = db.select().from(eventResults).where(eq(eventResults.eventId, eventId)).orderBy(asc(eventResults.bibNumber));
  return lock ? query.for("update") : query;
}

const fingerprintOf = (rows: readonly EventResultRow[]) => resultsFingerprint(rows satisfies readonly FingerprintedResult[]);

/** The sex and the age on the race's day a result is ranked and categorised by: the registration's for a registered runner, the row's own for a typed one. */
function answersOf(row: { registrationId: string | null; sex: RegistrationSex | null; birthDate: string | null }, runners: ReadonlyMap<string, RegisteredRunner>, event: EventFacts) {
  const runner = row.registrationId !== null ? runners.get(row.registrationId) : undefined;
  const sex = runner ? runner.sex : sexShown(row.sex);
  const birthDate = runner ? runner.birthDate : row.birthDate;
  return { sex, ageOnRaceDay: ageOnRaceDay(birthDate, event.startsAt, event.timezone) };
}

/**
 * The rankings of a whole list, by the number each row is listed under (`rankResults`), with the answers read as above — the elites the
 * Administrator left out of the ranking (`runners.out`, §910) carried as hors concours: no position, and in nobody else's.
 */
function rankingOf(
  rows: readonly {
    bibNumber: number;
    registrationId: string | null;
    displayName: string | null;
    sex: RegistrationSex | null;
    birthDate: string | null;
    status: ResultStatus;
    gunTimeMs: number | null;
  }[],
  runners: Runners,
  event: EventFacts,
): Map<number, Ranked> {
  const out = horsConcoursBibs(rows, runners.out, (bibNumber) => {
    const holder = runners.byBib.get(bibNumber);
    return holder && holder.status === "CONFIRMED" ? holder.registrationId : null;
  });
  const rankable: Rankable[] = rows.map((row) => ({
    bibNumber: row.bibNumber,
    status: row.status,
    gunTimeMs: row.gunTimeMs,
    ...answersOf(row, runners.byRegistration, event),
    ...(out.has(row.bibNumber) ? { outOfRanking: true } : {}),
  }));
  return rankResults(rankable, event.resultAgeBands);
}

/** The rankings of the event's stored rows read from the live answers — what every page and file shows, whatever the last save stored — by stored number. */
async function loadLiveRanking<T extends Record<string, unknown>>(db: Database<T>, event: EventFacts): Promise<{ ranking: Map<number, Ranked>; runners: Runners }> {
  const [runners, stored] = await Promise.all([loadRegisteredRunners(db, event.id), loadStored(db, event.id, false)]);
  return { ranking: rankingOf(stored, runners, event), runners };
}

// ---- Reading for the backoffice ------------------------------------------------------------------------

/** One runner of the page: a registered one (with or without a result yet) or a row the club typed. */
export type ResultRunner = {
  bibNumber: number;
  /** The registration's display name; a typed runner's name; null for a row with none (an erased registration's). */
  name: string | null;
  registered: boolean;
  /** The registration's tick, null for a typed runner (who has none). */
  ticked: boolean | null;
  /**
   * Whether the published results would name this runner (`publicResultName`): a registered one by their tick, a confirmed registration, not hidden,
   * made under a notice that described the results; a typed one by the staff-recorded agreement, a name to show and a notice that described them.
   */
  named: boolean;
  /** Why the published results would not name this runner, or `named` (`publicNameReason`, from the very input `named` is read from; §985). */
  nameReason: PublicNameReason;
  /** A typed runner: the staff recorded that the person agreed to appear by name (§810); null for a registered runner, whose own tick answers. */
  nameAgreed: boolean | null;
  /**
   * An elite the Administrator left out of the ranking (§910): the line is drawn «în afara clasamentului», without a position, and the
   * published results leave it out. For a registered runner, whether or not a result is entered yet; for a typed one, by its line.
   */
  outOfRanking: boolean;
  /**
   * The registration's marks, «Elită» and «Ambasador» (§948): said beside the runner on this page and at «Premii», so the club sees
   * whom it awards. False for a typed runner, who has no registration. Never on the published results.
   */
  elite: boolean;
  ambassador: boolean;
  checkedIn: boolean;
  sex: SexChoice | null;
  /** A typed runner's birth date, `YYYY-MM-DD` — what the box shows; null for a registered one, whose registration answers. */
  birthDate: string | null;
  ageOnRaceDay: number | null;
  result: {
    status: ResultStatus;
    gunTimeMs: number | null;
    chipTimeMs: number | null;
    note: string | null;
    positionOverall: number | null;
    positionSex: number | null;
    positionCategory: number | null;
    categoryKey: string | null;
    /**
     * Who last wrote the row (§986, `updated_by_staff_user_id`): their display name, or null when that account is gone; and whether
     * it was changed after it was written — «modificat de» — or is as it was first written — «introdus de».
     */
    writtenBy: { name: string | null; changed: boolean };
  } | null;
  /**
   * What this line stored when it was read (§1012, `resultLineFingerprint`): its one row's own columns, or none for a line with no
   * result. «Folosește» posts it back and is refused with CONFLICT only when THIS line changed since — never for another line's write.
   */
  lineFingerprint: string;
};

export type EventResultsView = {
  event: EventFacts;
  /** Registered runners with a race number — the elites first, then the checked-in, then by number — each with its result when it has one. */
  registered: ResultRunner[];
  /** Rows no registration holds the number of: typed by hand, or left nameless by an erased registration's. */
  typed: ResultRunner[];
  /** What the stored rows were when this was read (`resultsFingerprint`): posted back with the form. */
  fingerprint: string;
  /** How many results of each state are stored, for the page's summary. */
  counts: Record<ResultStatus, number>;
  /** The ages the race's categories start at (§850) — `event.resultAgeBands`, named for the page — and whether the race chose them itself. */
  ageBandStarts: readonly number[];
  ageBandsCustom: boolean;
};

/** A stored row as the page and the file show it: its own times and note, **the positions and the category read from the live answers** (`rankingOf`), and who last wrote it. */
function resultOf(row: EventResultRow, ranked: Ranked, staffNames: ReadonlyMap<string, string>): NonNullable<ResultRunner["result"]> {
  return {
    status: row.status,
    gunTimeMs: row.gunTimeMs,
    chipTimeMs: row.chipTimeMs,
    note: row.note,
    positionOverall: ranked.positionOverall,
    positionSex: ranked.positionSex,
    positionCategory: ranked.positionCategory,
    categoryKey: ranked.categoryKey,
    writtenBy: { name: row.updatedByStaffUserId === null ? null : (staffNames.get(row.updatedByStaffUserId) ?? null), changed: row.createdAt.getTime() !== row.updatedAt.getTime() },
  };
}

/**
 * The display names of the staff accounts that wrote the rows (§986): one read for all of them. An account removed since is missing
 * from the answer (`ON DELETE SET NULL` already cleared the row's column, and a stale id finds nothing): the page says «cont șters».
 */
async function staffNamesOf<T extends Record<string, unknown>>(db: Database<T>, ids: Iterable<string | null>): Promise<Map<string, string>> {
  const wanted = [...new Set([...ids].filter((id): id is string => id !== null))];
  if (wanted.length === 0) return new Map();
  const rows = await db.select({ id: staffUsers.id, name: staffUsers.displayName }).from(staffUsers).where(inArray(staffUsers.id, wanted));
  return new Map(rows.map((row) => [row.id, row.name]));
}

/**
 * The page's data (§808), for whoever may enter results: the event, every registered runner that holds a race number — those with a
 * stored result carry it — and every stored row no registration holds the number of. Refuses a role that may not (FORBIDDEN) and an
 * event that is not there (NOT_FOUND); an event that is not a race is read all the same, so the page can say a group run has none.
 * A result is read by its **registration** first and by number second, and its positions come from the live answers, so what the page
 * says is what the public read says.
 */
export async function readEventResults<T extends Record<string, unknown>>(db: Database<T>, actor: Actor, eventId: string): Promise<EventResultsView> {
  assertMayEnter(actor);
  assertIds(eventId);
  const event = await loadEvent(db, eventId, false);
  const [runners, stored, firstResultsNoticeVersion, firstResultsNameAskNoticeVersion] = await Promise.all([
    loadRegisteredRunners(db, eventId),
    loadStored(db, eventId, false),
    findFirstResultsNoticeVersion(db),
    findFirstResultsNameAskNoticeVersion(db),
  ]);
  const index = indexStored(stored, runners);
  const ranking = rankingOf(stored, runners, event);
  const rankedOf = (row: EventResultRow) => ranking.get(row.bibNumber) as Ranked;
  const hiddenShown = hiddenListShownPublicly(event);
  // Who last wrote each row (§986): «introdus de …» / «modificat de …» on its line.
  const staffNames = await staffNamesOf(db, stored.map((row) => row.updatedByStaffUserId));

  const registered: ResultRunner[] = [];
  // The typed rows a registered runner took over: a runner at that number with no result of its own shows the row as its own.
  const taken = new Set<string>();
  const heldBibs = new Set<number>();
  for (const runner of runners.byBib.values()) {
    const { attached, row } = claimOf(runner, index);
    // A runner whose registration did not reach «Confirmat» is on the page only if a result was already entered for that registration.
    if (!attached) continue;
    heldBibs.add(runner.bibNumber);
    if (row && index.byRegistration.get(runner.registrationId) !== row) taken.add(row.id);
    registered.push({
      bibNumber: runner.bibNumber,
      name: runner.displayName,
      registered: true,
      ticked: runner.ticked,
      // `named` — `publicResultName`'s own answer — and, from the same input, why not (§985).
      ...publicNameVerdict({
        registered: true,
        ticked: runner.ticked,
        displayName: runner.displayName,
        confirmed: runner.status === "CONFIRMED",
        hidden: runner.outsideCapacity && !hiddenShown,
        noticeVersion: runner.noticeVersion,
        firstResultsNoticeVersion,
        firstResultsNameAskNoticeVersion,
        resultsNameConsent: runner.resultsNameConsent,
        resultsConsentVersion: runner.resultsConsentVersion,
        typedNameAgreed: false,
        typedDisplayName: null,
        hiddenByClub: runner.hiddenByClub,
      }),
      nameAgreed: null,
      // The registration's own tick (§910): drawn so before a result is typed, and its row, once typed, ranked accordingly.
      outOfRanking: runners.out.registrations.has(runner.registrationId) || (row !== undefined && rankedOf(row).outOfRanking === true),
      elite: runner.elite,
      ambassador: runner.ambassador,
      checkedIn: runner.checkedIn,
      sex: runner.sex,
      birthDate: null,
      ageOnRaceDay: ageOnRaceDay(runner.birthDate, event.startsAt, event.timezone),
      result: row ? resultOf(row, rankedOf(row), staffNames) : null,
      lineFingerprint: resultLineFingerprint(row),
    });
  }
  // The elites first — the owner, 2026-11-19: «aici trebuie să afișez mai întâi elitele» —, then the checked-in, then by number.
  registered.sort((a, b) => Number(b.elite) - Number(a.elite) || Number(b.checkedIn) - Number(a.checkedIn) || a.bibNumber - b.bibNumber);

  const typed: ResultRunner[] = [...index.freeByBib.values()]
    .filter((row) => !taken.has(row.id) && !heldBibs.has(row.bibNumber))
    .sort((a, b) => a.bibNumber - b.bibNumber)
    .map((row) => ({
      bibNumber: row.bibNumber,
      name: row.displayName,
      registered: false,
      ticked: null,
      // `named` — `publicResultName`'s own answer — and, from the same input, why not (§985).
      ...publicNameVerdict({
        registered: false,
        ticked: false,
        displayName: null,
        confirmed: false,
        hidden: false,
        noticeVersion: null,
        firstResultsNoticeVersion,
        firstResultsNameAskNoticeVersion,
        resultsNameConsent: false,
        resultsConsentVersion: null,
        typedNameAgreed: row.nameAgreedAt !== null,
        typedDisplayName: row.displayName,
      }),
      nameAgreed: row.nameAgreedAt !== null,
      // A separate-list elite's line left out (§910), recognised by its number or, for a line with none, by its name (`hors-concours.ts`).
      outOfRanking: rankedOf(row).outOfRanking === true,
      elite: false,
      ambassador: false,
      checkedIn: false,
      sex: sexShown(row.sex),
      birthDate: row.birthDate,
      ageOnRaceDay: ageOnRaceDay(row.birthDate, event.startsAt, event.timezone),
      result: resultOf(row, rankedOf(row), staffNames),
      lineFingerprint: resultLineFingerprint(row),
    }));

  const counts: Record<ResultStatus, number> = { FINISHED: 0, DNF: 0, DNS: 0, DSQ: 0 };
  for (const row of stored) counts[row.status] += 1;
  return { event, registered, typed, fingerprint: fingerprintOf(stored), counts, ageBandStarts: event.resultAgeBands, ageBandsCustom: !sameAgeBandStarts(event.resultAgeBands, DEFAULT_AGE_BAND_STARTS) };
}

// ---- Saving ---------------------------------------------------------------------------------------------

export type SaveResultsRequest = {
  eventId: string;
  rows: readonly PostedResultRow[];
  /** What the stored rows were when the form was drawn (`ResultsView.fingerprint`); null for a caller that does not guard (a script, a test). */
  fingerprint?: string | null;
};

/** What a save did: the results created, changed and deleted (the club's doing), the rows only the rankings moved, and how many finishers are ranked. */
export type SaveResultsResult = { changed: boolean; created: number; updated: number; deleted: number; rewritten: number; ranked: number };

/** The boxes of a typed or registered row, as the form names them, for a refusal. */
function boxesOf(key: string, boxes: readonly string[]): string[] {
  return boxes.map((box) => resultBox(key, box as never));
}

/** Which of a result's own columns differ — by the names the audit records, never the values of the personal ones. */
function changedBoxesOf(before: EventResultRow, after: ReadRow & { registrationId: string | null; displayName: string | null; sex: string | null; birthDate: string | null }): string[] {
  const changed: string[] = [];
  if (before.bibNumber !== after.bibNumber) changed.push("bib");
  if (before.status !== after.status) changed.push("status");
  if (before.gunTimeMs !== after.gunTimeMs) changed.push("time");
  if (before.chipTimeMs !== after.chipTimeMs) changed.push("chip");
  if (before.note !== after.note) changed.push("note");
  if (before.displayName !== after.displayName) changed.push("name");
  if (before.sex !== after.sex) changed.push("sex");
  if (before.birthDate !== after.birthDate) changed.push("birthDate");
  if (before.registrationId !== after.registrationId) changed.push("registration");
  if ((before.nameAgreedAt !== null) !== after.nameAgreed) changed.push("nameAgreed");
  return changed;
}

/**
 * «Salvează tot clasamentul» (§808): the whole list of a race's results, by one staff member, in one transaction.
 *
 * Every row is read first (`readResultRow`) and the first refused one refuses the save with `RESULT_ROW_INVALID` naming that row
 * (`ResultRowError`) and the boxes to correct: a bad number, status, time, chip, note, name, sex or birth date; a number named twice; a
 * runner with no registration and no name (except a row already stored with none — an erased registration's — which may stay
 * nameless). A form drawn before another session saved is refused with CONFLICT. Only then are the rows written: each that differs from
 * the stored one — a result created, changed, or **deleted because the club left it out** — with one audit row each; the rankings are
 * recomputed over the whole list and every row whose positions moved is rewritten, silently (the trail records what the club did, not
 * what followed from it). A save that changes nothing writes and records nothing.
 */
export async function saveEventResults<T extends Record<string, unknown>>(db: Database<T>, actor: Actor, request: SaveResultsRequest, now: Date): Promise<SaveResultsResult> {
  assertMayEnter(actor);
  assertIds(request.eventId);
  if (request.rows.length > RESULTS_MAX + 1000) throw new DomainError("VALIDATION_ERROR", "too many rows in one save");

  const result = await db.transaction(async (tx): Promise<SaveResultsResult> => {
    const event = await loadEvent(tx, request.eventId, true);
    if (!eventTakesResults(event.type)) throw new DomainError("RESULTS_NOT_OPEN", "only a race takes results");
    const [runners, stored] = await Promise.all([loadRegisteredRunners(tx, event.id), loadStored(tx, event.id, true)]);
    if (request.fingerprint != null && request.fingerprint !== fingerprintOf(stored)) {
      throw new DomainError("CONFLICT", "another session changed the results since the form was drawn");
    }
    const index = indexStored(stored, runners);
    const eventDay = dayIn(event.startsAt, event.timezone);

    // ---- 1. Every row read, the first refused one refusing the save -------------------------------------
    // `before` is the stored row the line is the next state of: a registered runner's own, wherever its number was when it was saved.
    type Prepared = ReadRow & { registrationId: string | null; displayName: string | null; sex: SexChoice | null; birthDate: string | null; before: EventResultRow | undefined };
    const prepared = new Map<number, Prepared>();
    for (const posted of request.rows) {
      const registeredKey = posted.key.startsWith("r[");
      const read = readResultRow({ kind: registeredKey ? "registered" : "typed", bib: posted.bib, name: posted.name, sex: posted.sex, birthDate: posted.birthDate, time: posted.time, status: posted.status, chip: posted.chip, note: posted.note, agreed: posted.agreed }, eventDay);
      if (read.kind === "blank") continue;
      if (read.kind === "refused") throw new ResultRowError(read.problem, boxesOf(posted.key, read.boxes), Number(posted.bib) > 0 ? Number(posted.bib) : null, runners.byBib.get(Number(posted.bib))?.displayName ?? null);
      const { row } = read;
      const runner = runners.byBib.get(row.bibNumber);
      const refuse = (problem: ResultRowProblem, ...boxes: string[]): never => {
        throw new ResultRowError(problem, boxesOf(posted.key, boxes), row.bibNumber, runner?.displayName ?? row.name);
      };
      if (prepared.has(row.bibNumber)) refuse("bibDuplicate", registeredKey ? "time" : "bib");
      if (prepared.size >= RESULTS_MAX) refuse("tooMany", registeredKey ? "time" : "bib");
      if (runner) {
        const claim = claimOf(runner, index);
        if (claim.attached) {
          // A number a confirmed registration holds is that runner's: a line typed by hand for it has nowhere to put its name.
          if (!registeredKey) refuse("bibRegistered", "bib");
          // A registered runner's name, sex and birth date are the registration's: nothing typed about them is kept, and a staff mark of agreement
          // is not theirs to give (their name follows their own tick on the form): a typed row a registration takes over loses it here.
          prepared.set(row.bibNumber, { ...row, registrationId: runner.registrationId, displayName: null, sex: null, birthDate: null, nameAgreed: false, before: claim.row });
          continue;
        }
        // A registration that is not confirmed holds the number, and nothing of it is stored: attaching a result would file it under a
        // cancelled person and discard the name typed beside it. Only a typed result already stored under that number may stay.
        if (!index.freeByBib.has(row.bibNumber)) refuse("bibNotConfirmed", registeredKey ? "time" : "bib");
      }
      // A runner no registration holds the number of: typed by hand, so it needs a name — unless the row is already stored with none (an
      // erased registration's), which stays as it is.
      const existing = index.freeByBib.get(row.bibNumber);
      const keepsNoName = existing !== undefined && existing.displayName === null;
      if (row.name === null && !keepsNoName) refuse("nameMissing", registeredKey ? "time" : "name");
      // `readResultRow` already refused an agreement with no name (`agreedNameMissing`), so a row that stands by name has one to show.
      prepared.set(row.bibNumber, { ...row, registrationId: null, displayName: row.name, sex: row.sex, birthDate: row.birthDate, nameAgreed: row.nameAgreed, before: existing });
    }

    // ---- 2. The rankings of the list as it will be ------------------------------------------------------
    const ranking = rankingOf([...prepared.values()], runners, event);

    // ---- 3. The writes: deleted, moved off their numbers, then created, changed and the rows only the rankings moved ----------
    let created = 0;
    let updated = 0;
    let deleted = 0;
    let rewritten = 0;
    const audit = (action: AuditAction, metadata: Record<string, unknown>) =>
      recordAuditEvent(tx, { actorStaffUserId: actor.id, action, entityType: "event", entityId: event.id, metadata, now });

    // Deleted first: a number the club left out may be the one another line now takes.
    const kept = new Set<string>();
    for (const row of prepared.values()) if (row.before) kept.add(row.before.id);
    const gone = stored.filter((row) => !kept.has(row.id));
    if (gone.length > 0) {
      await tx.delete(eventResults).where(inArray(eventResults.id, gone.map((row) => row.id)));
      deleted = gone.length;
      for (const row of gone) await audit("event_result.deleted", { bibNumber: row.bibNumber, status: row.status });
    }
    // A row whose runner's number changed leaves its old number first, so two rows trading numbers never meet at the unique index.
    let parked = 2_000_000_000;
    for (const [bibNumber, row] of prepared) {
      if (row.before && row.before.bibNumber !== bibNumber) await tx.update(eventResults).set({ bibNumber: (parked += 1) }).where(eq(eventResults.id, row.before.id));
    }

    for (const [bibNumber, row] of prepared) {
      const ranked = ranking.get(bibNumber) as Ranked;
      const before = row.before;
      if (!before) {
        await tx.insert(eventResults).values({
          eventId: event.id,
          registrationId: row.registrationId,
          bibNumber,
          displayName: row.displayName,
          sex: row.sex,
          birthDate: row.birthDate,
          nameAgreedAt: row.nameAgreed ? now : null,
          nameAgreedByStaffUserId: row.nameAgreed ? actor.id : null,
          status: row.status,
          gunTimeMs: row.gunTimeMs,
          chipTimeMs: row.chipTimeMs,
          note: row.note,
          positionOverall: ranked.positionOverall,
          positionSex: ranked.positionSex,
          positionCategory: ranked.positionCategory,
          categoryKey: ranked.categoryKey,
          createdAt: now,
          updatedAt: now,
          updatedByStaffUserId: actor.id,
        });
        created += 1;
        // An agreement recorded with the line is named in the trail (who is the audit row's actor, when its time) — never the name.
        await audit("event_result.created", { bibNumber, status: row.status, gunTimeMs: row.gunTimeMs, chipTimeMs: row.chipTimeMs, ...(row.nameAgreed ? { nameAgreed: true } : {}) });
        continue;
      }
      const changedBoxes = changedBoxesOf(before, { ...row, bibNumber });
      // A new name beside a tick that stays on is a new person on an old record: whoever saves it records the agreement again (the moment and
      // the actor are theirs, the trail says so), exactly as a changed number — a new row — already does.
      if (row.nameAgreed && before.nameAgreedAt !== null && changedBoxes.includes("name") && !changedBoxes.includes("nameAgreed")) changedBoxes.push("nameAgreed");
      const rankMoved =
        before.positionOverall !== ranked.positionOverall ||
        before.positionSex !== ranked.positionSex ||
        before.positionCategory !== ranked.positionCategory ||
        before.categoryKey !== ranked.categoryKey;
      if (changedBoxes.length === 0 && !rankMoved) continue;
      await tx
        .update(eventResults)
        .set({
          registrationId: row.registrationId,
          bibNumber,
          displayName: row.displayName,
          sex: row.sex,
          birthDate: row.birthDate,
          // Turned on, or on beside a new name: the moment and the actor; turned off (or the registration took the row): both cleared; unchanged: left as they are.
          ...(changedBoxes.includes("nameAgreed") ? { nameAgreedAt: row.nameAgreed ? now : null, nameAgreedByStaffUserId: row.nameAgreed ? actor.id : null } : {}),
          status: row.status,
          gunTimeMs: row.gunTimeMs,
          chipTimeMs: row.chipTimeMs,
          note: row.note,
          positionOverall: ranked.positionOverall,
          positionSex: ranked.positionSex,
          positionCategory: ranked.positionCategory,
          categoryKey: ranked.categoryKey,
          ...(changedBoxes.length > 0 ? { updatedAt: now, updatedByStaffUserId: actor.id } : {}),
        })
        .where(eq(eventResults.id, before.id));
      if (changedBoxes.length > 0) {
        updated += 1;
        await audit("event_result.updated", {
          bibNumber,
          status: row.status,
          gunTimeMs: row.gunTimeMs,
          chipTimeMs: row.chipTimeMs,
          changed: changedBoxes,
          // The agreement's new state, when it moved or was recorded again for a new name: who recorded it is the audit row's actor, when its time — never the name.
          ...(changedBoxes.includes("nameAgreed") ? { nameAgreed: row.nameAgreed } : {}),
        });
      } else rewritten += 1;
    }

    const ranked = [...ranking.values()].filter((row) => row.positionOverall !== null).length;
    return { changed: created + updated + deleted > 0, created, updated, deleted, rewritten, ranked };
  });

  // The pages that show a list are told once, after the commit — also when only the positions moved (a registration's answer was corrected).
  if (result.changed || result.rewritten > 0) revalidatePublicContent("events", "places");
  return result;
}

/**
 * The row's own «Șterge» (§808, outside the big form like §791's delete): one result removed after a confirmation, the others'
 * positions recomputed, one audit row, the cache told. The number is the one the page drew — a registered runner's current one, wherever
 * its row was saved under — and a number with no stored result is NOT_FOUND (a second press, another session got there first): the
 * page says so and nothing is written.
 */
export async function deleteEventResult<T extends Record<string, unknown>>(db: Database<T>, actor: Actor, request: { eventId: string; bibNumber: number }, now: Date): Promise<void> {
  assertMayEnter(actor);
  assertIds(request.eventId);
  await db.transaction(async (tx) => {
    const event = await loadEvent(tx, request.eventId, true);
    const [runners, stored] = await Promise.all([loadRegisteredRunners(tx, event.id), loadStored(tx, event.id, true)]);
    const index = indexStored(stored, runners);
    const runner = runners.byBib.get(request.bibNumber);
    const target = (runner ? claimOf(runner, index).row : undefined) ?? index.freeByBib.get(request.bibNumber);
    if (!target) throw new DomainError("NOT_FOUND", "there is no result for that number");
    await tx.delete(eventResults).where(eq(eventResults.id, target.id));
    await recordAuditEvent(tx, { actorStaffUserId: actor.id, action: "event_result.deleted", entityType: "event", entityId: event.id, metadata: { bibNumber: target.bibNumber, status: target.status }, now });
    await writeRanking(tx, event, runners, stored.filter((row) => row.id !== target.id));
  });
  revalidatePublicContent("events", "places");
}

/** What «Folosește» posts (§1012): the event, the number of the line, the time chosen among the recorded ones, and that line's own fingerprint. */
export type ChooseRecordedTimeRequest = {
  eventId: string;
  bibNumber: number;
  gunTimeMs: number;
  /**
   * What the chosen line stored when the page was drawn (`ResultRunner.lineFingerprint`, `resultLineFingerprint`) — that line's alone,
   * never the whole list's; null for a caller that does not guard (a script, a test).
   */
  lineFingerprint?: string | null;
};

/** What a «Folosește» did: whether the line's result changed — a time already the line's «Sosit» time changes nothing — and the line's number. */
export type ChooseRecordedTimeOutcome = { changed: boolean; bibNumber: number };

/**
 * «Folosește» under a line's «Timpi la sosire» (§1012, amending §986's «Choosing a duplicate's time with one press on «Clasament»» left
 * undone; the owner, 2026-11-20: «For regular runners, if we submit a big [bib] multiple times we track history and in the end we can choose
 * what time to display»): one of the times «Cronometrare» recorded for a number becomes that line's time.
 *
 * **Its own function, not `saveEventResults` with one row**: the save is the whole list — a row left out is a result deleted — and
 * reads every box as typed, while this verb changes two columns of one row and must check something the save never reads, the
 * trail. A one-row save would delete every other result, or need the whole page's boxes posted with it, unsaved edits and all.
 *
 * **Who** — whoever enters results (`canEnterResults`, FORBIDDEN otherwise); a race only (`RESULTS_NOT_OPEN`). The line is the one
 * the page draws for the number: a registered runner's — its own row, or a typed row at its number it took over — else a typed row.
 * **Never over «Descalificat»** (`mayChooseRecordedTime`): a disqualification stands whatever the page showed, changed by hand in
 * «Stare» — `RESULT_DISQUALIFIED`; the page draws no «Folosește» there. **Nobody writes over what they did not see — of this line**:
 * the button posts the chosen line's own fingerprint (`resultLineFingerprint`), and a line changed since the page was drawn — saved,
 * chosen, deleted or made by another session — is refused with CONFLICT; a press at «Cronometrare» of another number, or a save of
 * another line, refuses nothing, so on race day a choice needs no reload while the line is still recording. (The big save keeps the
 * whole list's fingerprint: it writes the whole list.) A number with no line is NOT_FOUND. **Only a recorded time**: the race's trail
 * is read inside the transaction, under the event row's lock every press takes (`recorded-times.ts#loadRecordedTimesTrail`), and a
 * time that is not one recorded for that number since the last reset is refused (`RESULT_TIME_NOT_RECORDED`), so a forged or stale
 * post never puts a made-up time in the ranking.
 *
 * Then the row's gun time is the time chosen and its state «Sosit» — the chip time and the note untouched; a runner whose result was
 * deleted on «Clasament» gets it again, «Sosit» at that time —, every place is ranked again from the live rows and answers, as a save
 * ranks them (`writeRanking`), and one audit row says it: `event_result.updated` (or `.created` for a result made again) with
 * `{ bibNumber, status, gunTimeMs, chipTimeMs, changed, chosenFromHistory: true }` — the boxes `time`, and `status` when it moved —
 * never a name, which «Istoricul sosirilor» says as «a ales pentru #102 … timpul … dintre cele înregistrate». The public cache is told
 * once, after the commit. A time that is the line's «Sosit» time already writes and records nothing.
 */
export async function chooseRecordedFinishTime<T extends Record<string, unknown>>(db: Database<T>, actor: Actor, request: ChooseRecordedTimeRequest, now: Date): Promise<ChooseRecordedTimeOutcome> {
  assertMayEnter(actor);
  assertIds(request.eventId);
  const { bibNumber, gunTimeMs } = request;
  if (!Number.isInteger(bibNumber) || bibNumber <= 0 || !Number.isInteger(gunTimeMs) || gunTimeMs <= 0) {
    throw new DomainError("RESULT_TIME_NOT_RECORDED", "the time chosen is not one recorded at the line for that number");
  }
  const outcome = await db.transaction(async (tx): Promise<ChooseRecordedTimeOutcome> => {
    const event = await loadEvent(tx, request.eventId, true);
    if (!eventTakesResults(event.type)) throw new DomainError("RESULTS_NOT_OPEN", "only a race takes results");
    // One after another: a transaction is one connection, and a query sent while another runs is one `pg` warns about.
    const runners = await loadRegisteredRunners(tx, event.id);
    const stored = await loadStored(tx, event.id, true);
    const trail = await loadRecordedTimesTrail(tx, event.id);

    // The line the page draws for the number (`readEventResults`): a registered runner's that is on the page, else a typed row's.
    const index = indexStored(stored, runners);
    const runner = runners.byBib.get(bibNumber);
    const claim = runner ? claimOf(runner, index) : undefined;
    const line = runner && claim?.attached ? { row: claim.row, registrationId: runner.registrationId } : index.freeByBib.has(bibNumber) ? { row: index.freeByBib.get(bibNumber), registrationId: null } : null;
    const before = line?.row;
    // A disqualification stands, whatever the page drew: it is changed by hand in «Stare», never by a recorded time.
    if (!mayChooseRecordedTime(before ?? null)) throw new DomainError("RESULT_DISQUALIFIED", "the result is a disqualification: «Folosește» does not change it");
    // What the page drew of THIS line against what it stores now — another line's write, or another number's arrival, refuses nothing.
    if (request.lineFingerprint != null && request.lineFingerprint !== resultLineFingerprint(before)) {
      throw new DomainError("CONFLICT", "another session changed this line since the page was drawn");
    }
    if (!line) throw new DomainError("NOT_FOUND", "there is no line for that number");
    if (!isRecordedTime(recordedTimesOf(trail, bibNumber), gunTimeMs)) throw new DomainError("RESULT_TIME_NOT_RECORDED", "the time chosen is not one recorded at the line for that number");
    if (before && before.status === "FINISHED" && before.gunTimeMs === gunTimeMs) return { changed: false, bibNumber };

    const audit = (action: AuditAction, metadata: Record<string, unknown>) =>
      recordAuditEvent(tx, { actorStaffUserId: actor.id, action, entityType: "event", entityId: event.id, metadata: { ...metadata, chosenFromHistory: true }, now });
    let rows: EventResultRow[];
    if (before) {
      // The time and «Sosit»; the chip time and the note stay — a state but «Sosit» has neither time, so «Sosit» is all it gains.
      const changed = before.status === "FINISHED" ? ["time"] : ["status", "time"];
      const [updated] = await tx.update(eventResults).set({ status: "FINISHED", gunTimeMs, updatedAt: now, updatedByStaffUserId: actor.id }).where(eq(eventResults.id, before.id)).returning();
      rows = stored.map((row) => (row.id === before.id ? updated : row));
      await audit("event_result.updated", { bibNumber, status: "FINISHED", gunTimeMs, chipTimeMs: updated.chipTimeMs, changed });
    } else {
      // A registered runner whose result was deleted on «Clasament»: the time chosen makes it again. A row another registration left at
      // the number — its runner's number changed since — is the big save's to move first.
      if (stored.some((row) => row.bibNumber === bibNumber)) throw new DomainError("CONFLICT", "another result is stored under that number");
      const [inserted] = await tx
        .insert(eventResults)
        .values({ eventId: event.id, registrationId: line.registrationId, bibNumber, status: "FINISHED", gunTimeMs, createdAt: now, updatedAt: now, updatedByStaffUserId: actor.id })
        .returning();
      rows = [...stored, inserted];
      await audit("event_result.created", { bibNumber, status: "FINISHED", gunTimeMs, chipTimeMs: null, changed: ["status", "time"] });
    }
    await writeRanking(tx, event, runners, rows);
    return { changed: true, bibNumber };
  });
  if (outcome.changed) revalidatePublicContent("events", "places");
  return outcome;
}

/** Writes the rankings of `rows` where they differ from what is stored; returns how many rows were rewritten. */
async function writeRanking<T extends Record<string, unknown>>(db: Database<T>, event: EventFacts, runners: Runners, rows: readonly EventResultRow[]): Promise<number> {
  const ranking = rankingOf(rows, runners, event);
  let rewritten = 0;
  for (const row of rows) {
    const ranked = ranking.get(row.bibNumber) as Ranked;
    if (
      row.positionOverall === ranked.positionOverall &&
      row.positionSex === ranked.positionSex &&
      row.positionCategory === ranked.positionCategory &&
      row.categoryKey === ranked.categoryKey
    )
      continue;
    await db
      .update(eventResults)
      .set({ positionOverall: ranked.positionOverall, positionSex: ranked.positionSex, positionCategory: ranked.positionCategory, categoryKey: ranked.categoryKey })
      .where(eq(eventResults.id, row.id));
    rewritten += 1;
  }
  return rewritten;
}

/**
 * Ranks an event's stored results again from the live answers (§808), in the caller's transaction, and returns how many rows changed.
 * **Erasing a registration calls it** (`eraseRegistration`): the row is left nameless by `ON DELETE SET NULL`, and with no registration
 * left to answer for it the sex, the age band and the positions by sex and by category it carried are cleared, and the other runners'
 * places are counted again without it — nothing that describes the erased person stays on their number. An event with no results is a
 * no-op. Every page and file already ranks from the live answers when it reads, so this only keeps what is stored honest. The elite
 * ticks call it too (§910): «Apare în clasament» changed, a line deleted, a mark put on or taken off — whatever moves who runs hors concours.
 */
export async function rerankEventResults<T extends Record<string, unknown>>(db: Database<T>, eventId: string): Promise<number> {
  const stored = await loadStored(db, eventId, true);
  if (stored.length === 0) return 0;
  const event = await loadEvent(db, eventId, false);
  const runners = await loadRegisteredRunners(db, eventId);
  return writeRanking(db, event, runners, stored);
}

/**
 * «Premii» (§850): how many places each podium awards (one to ten) and whether the categories are awarded beside the overall podium by
 * sex — the owner's «for this contest we just award top 5 men and top 5 women». Saved by whoever enters results (FORBIDDEN otherwise), a
 * race only (`RESULTS_NOT_OPEN`), a count outside the column's range refused (VALIDATION_ERROR on `awardPlaces`); one audit row with the
 * two values. Nothing of the results moves: the card reads the rules, the ranking knows nothing of them.
 */
export async function setResultAwards<T extends Record<string, unknown>>(db: Database<T>, actor: Actor, eventId: string, rules: AwardRules, now: Date): Promise<{ changed: boolean }> {
  assertMayEnter(actor);
  assertIds(eventId);
  if (!isValidAwardPlaces(rules.places)) throw new DomainError("VALIDATION_ERROR", "the places awarded must be one to ten", ["awardPlaces"]);
  const outcome = await db.transaction(async (tx) => {
    const event = await loadEvent(tx, eventId, true);
    if (!eventTakesResults(event.type)) throw new DomainError("RESULTS_NOT_OPEN", "only a race has awards");
    if (event.awardPlaces === rules.places && event.awardCategories === rules.categories) return { changed: false };
    await tx.update(events).set({ awardPlaces: rules.places, awardCategories: rules.categories }).where(eq(events.id, event.id));
    await recordAuditEvent(tx, { actorStaffUserId: actor.id, action: "event_results.awards_changed", entityType: "event", entityId: event.id, metadata: { places: rules.places, categories: rules.categories }, now });
    return { changed: true };
  });
  return outcome;
}

// ---- Resetting before the start ---------------------------------------------------------------------------

/** What «Resetează clasamentul» posts: the event, and what its page drew — the results it counted and the gun it saw. */
export type ResetResultsRequest = {
  eventId: string;
  /** How many results the page drew (`EventResultsView.counts`, summed): a page drawn before more arrived is refused (CONFLICT). */
  seenResults: number;
  /** The gun the page drew — null for none, else its instant; `undefined` for a caller that does not guard it (a script, a test). */
  seenGunAtMs?: number | null;
};

/** What a reset did: how many results it deleted and whether it took a gun off; `changed` false — nothing was there, nothing written. */
export type ResetResultsOutcome = { changed: boolean; deleted: number; gunCleared: boolean };

/**
 * «Resetează clasamentul» (§997; the trial runs before a race: a test «Start», a few test finishes): the race's whole list wiped
 * **before the start**, so race day starts from zero.
 *
 * **Who** — the Administrator and the Superadministrator (`canResetResults`, FORBIDDEN otherwise). **What** — a race only
 * (`RESULTS_NOT_OPEN`), and only while its planned gun (`plannedGunOf`: `race_starts_at`, else `starts_at`) is still ahead on the
 * server's clock (`RESULTS_RESET_AFTER_START` at it and after): a test «Start» pressed earlier moves the finish line's gun, never
 * the plan, so it does not close the reset. **Nobody wipes what they did not see**: the page posts how many results it drew and the
 * gun it saw, and a page drawn before another result arrived — or before «Start» was given, moved or taken off — is refused with
 * CONFLICT, nothing written.
 *
 * In **one transaction under the event row's lock** — the lock every press of the line, every save and «Start» take, so none of
 * them lands between the count and the delete: every `event_results` row of the event is deleted (the registered runners' and the
 * runners typed by hand, whatever their state) and `race_gun_at` / `race_gun_by_staff_user_id` are cleared. Nothing else moves: the
 * awards' rules, the age bands, «Clasament public», the elite list and its numbers, the registrations, their numbers and their
 * check-ins stay; nothing is ranked again — nothing is left. One audit row, `event.results_reset` with `{ results, gunCleared }`,
 * never a name; a press a phone made before it is refused after it (`recordFinish`, `RESULT_PRESS_BEFORE_RESET`). A reset that
 * finds nothing to wipe writes and records nothing. The public cache is told once, after the commit.
 */
export async function resetEventResults<T extends Record<string, unknown>>(db: Database<T>, actor: Actor, request: ResetResultsRequest, now: Date): Promise<ResetResultsOutcome> {
  if (!canResetResults(actor.role)) throw new DomainError("FORBIDDEN", `role ${actor.role} may not reset a race's results`);
  assertIds(request.eventId);
  const outcome = await db.transaction(async (tx): Promise<ResetResultsOutcome> => {
    const event = await loadEvent(tx, request.eventId, true);
    if (!eventTakesResults(event.type)) throw new DomainError("RESULTS_NOT_OPEN", "only a race has results to reset");
    if (plannedGunOf(event).getTime() <= now.getTime()) throw new DomainError("RESULTS_RESET_AFTER_START", "the results are reset only before the planned start");
    const stored = await loadStored(tx, event.id, true);
    const gunAtMs = event.raceGunAt?.getTime() ?? null;
    if (request.seenResults !== stored.length || (request.seenGunAtMs !== undefined && request.seenGunAtMs !== gunAtMs)) {
      throw new DomainError("CONFLICT", "results arrived, or the start changed, since the page was drawn");
    }
    const gunCleared = gunAtMs !== null;
    if (stored.length === 0 && !gunCleared) return { changed: false, deleted: 0, gunCleared: false };
    if (stored.length > 0) await tx.delete(eventResults).where(eq(eventResults.eventId, event.id));
    if (gunCleared) await tx.update(events).set({ raceGunAt: null, raceGunByStaffUserId: null }).where(eq(events.id, event.id));
    await recordAuditEvent(tx, { actorStaffUserId: actor.id, action: "event.results_reset", entityType: "event", entityId: event.id, metadata: { results: stored.length, gunCleared }, now });
    return { changed: true, deleted: stored.length, gunCleared };
  });
  if (outcome.changed) revalidatePublicContent("events", "places");
  return outcome;
}

/**
 * Whether «Resetează clasamentul» wiped the race after `sinceMs` (§997): an `event.results_reset` row of the race's trail newer than
 * that instant, `sinceMs` a moment already come on the server's clock. The indexed key (`audit_logs_entity_idx`: the entity type, the
 * id, the time), read from the instant on — a press made now reads the last seconds of the race's trail, a queued one the minutes it
 * waited.
 */
async function resetSince<T extends Record<string, unknown>>(db: Database<T>, eventId: string, sinceMs: number): Promise<boolean> {
  const [row] = await db
    .select({ id: auditLogs.id })
    .from(auditLogs)
    .where(and(eq(auditLogs.entityType, "event"), eq(auditLogs.entityId, eventId), gt(auditLogs.createdAt, new Date(sinceMs)), eq(auditLogs.action, "event.results_reset")))
    .limit(1);
  return row !== undefined;
}

// ---- The finish line --------------------------------------------------------------------------------------

/** A finish refused with what the volunteer at the line needs: the number and the time the gun says, so a refused number is still written down. */
export class FinishError extends DomainError {
  readonly bibNumber: number;
  /** The time since the gun at the press (`RESULT_BIB_UNKNOWN`): written down on paper, typed on «Clasament» later. */
  readonly gunTimeMs: number;

  constructor(code: "RESULT_BIB_UNKNOWN", bibNumber: number, gunTimeMs: number) {
    super(code, `finish refused for number ${bibNumber}`, ["bib"]);
    this.name = "FinishError";
    this.bibNumber = bibNumber;
    this.gunTimeMs = gunTimeMs;
  }
}

/**
 * The gun the finish line counts from (§850, §986): «Start» as pressed on «Cronometrare», else the race's own planned start, else
 * when the event begins. **The results' alone**: every other screen, the public page, the checkpoints' limits, the emails and iCal
 * keep the editor's planned times (`plannedGunOf`).
 */
export function gunOf(event: { startsAt: Date; raceStartsAt: Date | null; raceGunAt?: Date | null }): Date {
  return event.raceGunAt ?? event.raceStartsAt ?? event.startsAt;
}

/** The gun as the editor planned it: what «Start»'s window is counted from, and what the line counts from until «Start» is pressed. */
export function plannedGunOf(event: { startsAt: Date; raceStartsAt: Date | null }): Date {
  return event.raceStartsAt ?? event.startsAt;
}

/** What one press did (§986): recorded — or found recorded already, the same press sent again (its id in the trail; else guessed) — or a number whose row stays as stored. */
export type FinishOutcome =
  | {
      kind: "recorded";
      resultId: string;
      bibNumber: number;
      name: string | null;
      /** An elite's label («Eticheta pe BIB»), or null. */
      label: string | null;
      gunTimeMs: number;
      positionOverall: number | null;
      outOfRanking: boolean;
      /** Nothing was written: the same press sent again — its id in the trail, or, for a press with none, this viewer's row at this very second. */
      again: boolean;
    }
  | {
      /** The number's row stays as stored: «Sosit» already, or a decision of «Clasament» the press must not undo (`storedStatus`). */
      kind: "duplicate";
      resultId: string;
      bibNumber: number;
      name: string | null;
      label: string | null;
      /** This press's own time, in the trail beside the stored one. */
      gunTimeMs: number;
      storedStatus: ResultStatus;
      /** The stored time, which stays; null for a decision with none. */
      storedGunTimeMs: number | null;
      /** Who wrote the stored row — the display name — or null when that account is gone. */
      storedBy: string | null;
    };

/** Whose a number is at the line: a confirmed registration's, or — no confirmed registration holding it — a line of the race's elite list. */
type FinishTarget = { kind: "registration"; runner: RegisteredRunner } | { kind: "line"; line: EliteLine };

function finishTargetOf(runners: Runners, bibNumber: number): FinishTarget | null {
  const runner = runners.byBib.get(bibNumber);
  if (runner && runner.status === "CONFIRMED") return { kind: "registration", runner };
  const line = runners.lines.find((candidate) => candidate.bibNumber === bibNumber);
  return line ? { kind: "line", line } : null;
}

/**
 * A finish at the line — «Cronometrare» (§986, amending §850; «Sosire»'s press before it): one race number, typed or pressed as an
 * elite's button, as the runner crosses, and the time since the gun (`gunOf`) stamped as that runner's «Sosit».
 *
 * **Who** — every role that works the desk (`canRecordFinishes`, FORBIDDEN otherwise). **The time** — the instant the island claims
 * for the press (`claimedAtMs`, on the server's clock), as `domain/finish-line.ts#finishStamp` holds it: a race only
 * (`RESULTS_NOT_OPEN`), after the gun (`RESULT_FINISH_NOT_STARTED` — a claim before it too, never stamped with the arrival's time
 * instead, so a press queued before the gun is no finisher made up when it arrives), within a day of it (`RESULT_FINISH_CLOSED`); the
 * server's own time only for a claim ahead of its clock, or none. A press arriving more than a day and three hours after the gun is
 * refused whatever it claims, so a queue left on a phone for days never adds a finisher to a ranking long published.
 *
 * **Whose number.** A number a **confirmed** registration holds is that runner's, as before; a number none holds but a line of the
 * race's elite list carries is that line's — a **typed** row with the line's name and number, no sex, no birth date and no agreement
 * to be named (the line is ranked, or run hors concours, by `hors-concours.ts`' rule 3); anything else is refused carrying the time
 * (`RESULT_BIB_UNKNOWN`), so the volunteer writes it down and the runner is typed on «Clasament» later.
 *
 * **A press older than «Resetează clasamentul» (§997)** — made during the trial the reset wiped, and sent after it from a phone that
 * found its signal again — is refused (`RESULT_PRESS_BEFORE_RESET`, `resetSince`), before anything else is read: no test finish
 * comes back, and the phone's line says why.
 *
 * **A retry is the same press (the owner asked that the history be exact).** The island sends each press with its own id
 * (`pressId`), which every row of the trail the press writes keeps; a press whose id the trail already holds — the answer lost on the
 * way, the phone sending it again — is answered as it was the first time, from the trail (`loadSavedPress`,
 * `domain/finish-line.ts#savedPressOf`), and writes nothing: no second row, no second line in «Istoricul sosirilor». One whose row is
 * gone since — undone at the line, deleted on «Clasament» — is refused (`RESULT_PRESS_UNDONE`, «anulat între timp — vezi
 * «Clasament»»), never recorded again and never shown saved. A press with no id
 * (the plain form, a page of before) falls back to the guess: the number already «Sosit» from **the same viewer at the same second** is
 * taken for its retry.
 *
 * **The same number twice (the owner: «se poate întâmpla și ca mai mulți voluntari să treacă același număr»).** The first stored wins
 * and nothing about its row changes (`domain/finish-line.ts#pressMeets`). Any other press of a number already «Sosit» — another
 * volunteer, or the same one again — is a duplicate: answered with who stored it and at what time, and its own time written to the
 * trail (`event_result.finish_duplicate`, `{ bibNumber, gunTimeMs, storedGunTimeMs, storedStatus, storedResultId, finishLine: true,
 * pressId }`, the actor the trail's own column), so «Istoricul sosirilor» shows both times. Two presses at once wait on the event's
 * lock, and the unique indexes stand behind it.
 *
 * **A decision of «Clasament» stays.** A runner stored «Descalificat» stays so whoever presses the number — the press's time goes to
 * the trail the same way, `storedStatus: "DSQ"`, for the organizers —, and so does an «Abandon» or a «Neprezentat» written after the
 * moment the press claims: a press queued on a phone without signal, or a second volunteer's, never overwrites a later decision. A
 * runner stored «Abandon» or «Neprezentat» before the moment pressed — written off by mistake — who crosses the line becomes «Sosit»
 * at the stamped time, the chip time and the note kept. One audit row as the save writes it (`event_result.created` or `.updated`,
 * the number and the times with `finishLine: true`, the row's id, `resultId` — the undo's proof the line wrote it —, and the press's
 * `pressId`, never a name); the whole list ranked again; the public cache told, so a published ranking shows the finisher.
 */
export async function recordFinish<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Actor,
  request: { eventId: string; bibNumber: number; claimedAtMs?: number | null; pressId?: string | null },
  now: Date,
): Promise<FinishOutcome> {
  assertMayRecord(actor);
  assertIds(request.eventId);
  if (!Number.isInteger(request.bibNumber) || request.bibNumber <= 0) throw new DomainError("VALIDATION_ERROR", "the race number is not a whole number", ["bib"]);
  const bibNumber = request.bibNumber;
  // The press's own id, as the island sent it; a malformed one is none, and the press is then taken as one without.
  const pressId = typeof request.pressId === "string" && isUuid(request.pressId) ? request.pressId : null;
  const outcome = await db.transaction(async (tx): Promise<FinishOutcome> => {
    const event = await loadEvent(tx, request.eventId, true);
    if (!eventTakesResults(event.type)) throw new DomainError("RESULTS_NOT_OPEN", "only a race takes results");
    // A press a phone made before «Resetează clasamentul» and sent after it (§997) — a trial the reset wiped, waiting on a phone
    // without signal: refused, its line on the phone saying why, so no test finish comes back; its retry too, whatever it was
    // answered then. Read under the event's lock the reset takes, so a press is before it or after it. A press claims its moment;
    // one with none — or one claiming a moment not yet come on the server's clock — is after any reset there was.
    if (isInstant(request.claimedAtMs) && request.claimedAtMs < now.getTime() && (await resetSince(tx, event.id, request.claimedAtMs))) {
      throw new DomainError("RESULT_PRESS_BEFORE_RESET", "the press was made before the results were reset");
    }
    const [runners, stored, labels] = await Promise.all([loadRegisteredRunners(tx, event.id), loadStored(tx, event.id, true), loadEliteLabels(tx, event.id)]);
    const target = finishTargetOf(runners, bibNumber);
    const index = indexStored(stored, runners);
    const before = !target ? undefined : target.kind === "registration" ? (claimOf(target.runner, index).attached ? claimOf(target.runner, index).row : undefined) : index.freeByBib.get(bibNumber);
    const name = !target ? null : target.kind === "registration" ? target.runner.displayName : (before?.displayName ?? target.line.name);
    const label = !target ? null : target.kind === "registration" ? (target.runner.elite ? (labels.registrations.get(target.runner.registrationId) ?? null) : null) : (labels.lines.get(target.line.id) ?? null);
    const writerOf = async (staffId: string | null) => (staffId === null ? null : ((await staffNamesOf(tx, [staffId])).get(staffId) ?? null));

    // A press the trail already holds by its id — the answer lost on the way, the phone sending it again: answered as it was, from
    // the trail, nothing written. Read before the stamp, so a retry arriving after the line closed is still the press it was.
    const saved = pressId === null ? null : await loadSavedPress(tx, event.id, actor.id, pressId, bibNumber);
    if (saved?.kind === "recorded") {
      const row = stored.find((candidate) => candidate.id === saved.resultId);
      // The row the press wrote is gone since — undone at the line, or deleted on «Clasament»: the retry is told so, never recorded again
      // (a runner whose result somebody took away is not put back by a phone that missed the answer) and never shown saved.
      if (!row) throw new DomainError("RESULT_PRESS_UNDONE", "the press's row was undone or deleted since");
      const ranked = rankingOf(stored, runners, event).get(row.bibNumber);
      return { kind: "recorded", resultId: saved.resultId, bibNumber, name, label, gunTimeMs: saved.gunTimeMs, positionOverall: ranked?.positionOverall ?? null, outOfRanking: ranked?.outOfRanking === true, again: true };
    }
    if (saved?.kind === "duplicate") {
      const row = stored.find((candidate) => candidate.id === saved.storedResultId);
      return {
        kind: "duplicate",
        resultId: saved.storedResultId,
        bibNumber,
        name,
        label,
        gunTimeMs: saved.gunTimeMs,
        storedStatus: isResultStatus(saved.storedStatus) ? saved.storedStatus : "FINISHED",
        storedGunTimeMs: saved.storedGunTimeMs,
        storedBy: await writerOf(row?.updatedByStaffUserId ?? null),
      };
    }

    const stamp = finishStamp({ claimedAtMs: request.claimedAtMs ?? null, gunAtMs: gunOf(event).getTime(), nowMs: now.getTime() });
    if (stamp.kind === "notStarted") throw new DomainError("RESULT_FINISH_NOT_STARTED", "the race has not started yet");
    // A day after the gun nobody is crossing a line: a late press is a mistake, and the time would not fit the column anyway (`RESULT_FINISH_CLOSED`).
    if (stamp.kind === "closed") throw new DomainError("RESULT_FINISH_CLOSED", "the finish line closed a day after the gun");
    const gunTimeMs = stamp.gunTimeMs;
    if (!target) throw new FinishError("RESULT_BIB_UNKNOWN", bibNumber, gunTimeMs);
    const audit = (action: AuditAction, metadata: Record<string, unknown>) =>
      recordAuditEvent(tx, { actorStaffUserId: actor.id, action, entityType: "event", entityId: event.id, metadata: pressId === null ? metadata : { ...metadata, pressId }, now });

    // The moment the press stands for: the one it claimed when the stamp took it, else the server's own.
    const pressedAtMs = stamp.claimed && request.claimedAtMs ? request.claimedAtMs : now.getTime();
    const meets = before ? pressMeets(before, { actorId: actor.id, gunTimeMs, atMs: pressedAtMs, identified: pressId !== null }) : null;
    if (before && meets === "retry") {
      // A press with no id of its own, taken for the retry of one that was saved — the same viewer, the same second: shown as saved, nothing written.
      const ranked = rankingOf(stored, runners, event).get(before.bibNumber);
      return { kind: "recorded", resultId: before.id, bibNumber, name, label, gunTimeMs, positionOverall: ranked?.positionOverall ?? null, outOfRanking: ranked?.outOfRanking === true, again: true };
    }
    if (before && (meets === "pressedAgain" || meets === "decided")) {
      // The row stays — the first «Sosit», or «Clasament»'s decision; this press's own time goes to the trail beside it, for the organizers.
      await audit("event_result.finish_duplicate", { bibNumber, gunTimeMs, storedGunTimeMs: before.gunTimeMs, storedStatus: before.status, storedResultId: before.id, finishLine: true });
      return { kind: "duplicate", resultId: before.id, bibNumber, name, label, gunTimeMs, storedStatus: before.status, storedGunTimeMs: before.gunTimeMs, storedBy: await writerOf(before.updatedByStaffUserId) };
    }

    let rows: EventResultRow[];
    let resultId: string;
    if (before) {
      // A runner written off by mistake who crosses the line: the row becomes «Sosit» at the stamped time; the chip time and the note stay.
      const [updated] = await tx
        .update(eventResults)
        .set({ status: "FINISHED", gunTimeMs, bibNumber, updatedAt: now, updatedByStaffUserId: actor.id })
        .where(eq(eventResults.id, before.id))
        .returning();
      rows = stored.map((row) => (row.id === before.id ? updated : row));
      resultId = updated.id;
      await audit("event_result.updated", { bibNumber, status: "FINISHED", gunTimeMs, chipTimeMs: before.chipTimeMs, changed: ["time", "status"], finishLine: true, resultId });
    } else {
      const [inserted] = await tx
        .insert(eventResults)
        .values(
          target.kind === "registration"
            ? { eventId: event.id, registrationId: target.runner.registrationId, bibNumber, status: "FINISHED", gunTimeMs, createdAt: now, updatedAt: now, updatedByStaffUserId: actor.id }
            : // An elite line's runner (§986): a typed row, the line's name and number, nothing else of a person — no agreement to be named.
              { eventId: event.id, registrationId: null, bibNumber, displayName: target.line.name, status: "FINISHED", gunTimeMs, createdAt: now, updatedAt: now, updatedByStaffUserId: actor.id },
        )
        .returning();
      rows = [...stored, inserted];
      resultId = inserted.id;
      await audit("event_result.created", { bibNumber, status: "FINISHED", gunTimeMs, chipTimeMs: null, finishLine: true, resultId });
    }
    await writeRanking(tx, event, runners, rows);
    const ranked = rankingOf(rows, runners, event).get(bibNumber);
    return { kind: "recorded", resultId, bibNumber, name, label, gunTimeMs, positionOverall: ranked?.positionOverall ?? null, outOfRanking: ranked?.outOfRanking === true, again: false };
  });
  if (outcome.kind === "recorded" && !outcome.again) revalidatePublicContent("events", "places");
  return outcome;
}

/**
 * A press of the line the trail already holds by its id (§986), read back as it was answered (`domain/finish-line.ts#savedPressOf`):
 * the actor's own rows of this race a press writes, the id in their metadata. The indexed key first (`audit_logs_entity_idx`: the
 * entity type, the id), so the metadata is read on this race's rows alone; nothing is written.
 */
async function loadSavedPress<T extends Record<string, unknown>>(db: Database<T>, eventId: string, actorId: string, pressId: string, bibNumber: number): Promise<SavedPress | null> {
  const [row] = await db
    .select({ action: auditLogs.action, metadata: auditLogs.metadataJson })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.entityType, "event"),
        eq(auditLogs.entityId, eventId),
        eq(auditLogs.actorStaffUserId, actorId),
        inArray(auditLogs.action, [...PRESS_TRAIL_ACTIONS]),
        sql`${auditLogs.metadataJson} ->> 'pressId' = ${pressId}`,
      ),
    )
    .limit(1);
  return row ? savedPressOf(row, bibNumber) : null;
}

/**
 * The finish line's own rows of the trail since `since` (§986): the presses' `event_result.created` and the presses of a number stored
 * already, which say which row the line wrote and which number was pressed again (`domain/finish-line.ts#undoTrailOf`). The indexed
 * key (`audit_logs_entity_idx`: the entity type, the id, the time), so a read touches the last minutes of this race alone.
 */
async function loadLineTrail<T extends Record<string, unknown>>(db: Database<T>, eventId: string, since: Date): Promise<LineTrailRow[]> {
  return db
    .select({ action: auditLogs.action, actorStaffUserId: auditLogs.actorStaffUserId, metadata: auditLogs.metadataJson })
    .from(auditLogs)
    .where(and(eq(auditLogs.entityType, "event"), eq(auditLogs.entityId, eventId), gte(auditLogs.createdAt, since), inArray(auditLogs.action, [...LINE_TRAIL_ACTIONS])));
}

/**
 * How far before a row's own instant its trail is read: a press waiting on the event's lock wrote its row with the moment it took
 * before the wait, so a press of the same number may carry an instant a little older than the row it found.
 */
const LINE_TRAIL_SLACK_MS = 60_000;

/**
 * «Anulează» at the line (§986, amending §850's «Undo at the line» refusal; the owner: «„Anulează" pe ce a introdus voluntarul, zece
 * minute, pe pagină; altfel la „Clasament"»): the row a press of the viewer's own wrote, deleted — for ten minutes after it was written,
 * only while nobody changed it since and only while nobody pressed its number again (`domain/finish-line.ts#mayUndo`: a «Sosit» row
 * written once, by the viewer, whose `event_result.created` of the line names it, and no `event_result.finish_duplicate` names it
 * since). A row typed or imported on «Clasament», corrected there, a runner written off and turned «Sosit» at the line, and a number
 * another volunteer — or the viewer — pressed after it are refused (`RESULT_UNDO_NOT_ALLOWED`): deleting it would leave the runner
 * with no time when the later press was the right one, and the correction is «Clasament»'s; a row gone already is NOT_FOUND. The
 * others ranked again; one audit row, `event_result.deleted` with `{ bibNumber, status, gunTimeMs, finishLine: true, undo: true }`;
 * the public cache told, as a delete does.
 */
export async function undoFinish<T extends Record<string, unknown>>(db: Database<T>, actor: Actor, request: { eventId: string; resultId: string }, now: Date): Promise<{ bibNumber: number }> {
  assertMayRecord(actor);
  assertIds(request.eventId, request.resultId);
  const undone = await db.transaction(async (tx) => {
    const event = await loadEvent(tx, request.eventId, true);
    if (!eventTakesResults(event.type)) throw new DomainError("RESULTS_NOT_OPEN", "only a race takes results");
    const [runners, stored] = await Promise.all([loadRegisteredRunners(tx, event.id), loadStored(tx, event.id, true)]);
    const target = stored.find((row) => row.id === request.resultId);
    if (!target) throw new DomainError("NOT_FOUND", "there is no such result any more");
    const trail = await loadLineTrail(tx, event.id, new Date(target.createdAt.getTime() - LINE_TRAIL_SLACK_MS));
    if (!mayUndo(target, actor.id, undoTrailOf(target, trail), now.getTime())) {
      throw new DomainError("RESULT_UNDO_NOT_ALLOWED", "only one's own press at the line of the last ten minutes, unchanged and not pressed again since, is undone here");
    }
    await tx.delete(eventResults).where(eq(eventResults.id, target.id));
    await recordAuditEvent(tx, {
      actorStaffUserId: actor.id,
      action: "event_result.deleted",
      entityType: "event",
      entityId: event.id,
      metadata: { bibNumber: target.bibNumber, status: target.status, gunTimeMs: target.gunTimeMs, finishLine: true, undo: true },
      now,
    });
    await writeRanking(tx, event, runners, stored.filter((row) => row.id !== target.id));
    return { bibNumber: target.bibNumber };
  });
  revalidatePublicContent("events", "places");
  return undone;
}

/**
 * «Start» and «Anulează startul» (§986; the owner: «un buton „Start" pe pagină, pe care îl apasă un organizator la pistol; fără el
 * contează „Startul cursei" din editor»): the gun, as an organizer pressed it at the start line. Whoever enters results
 * (`canEnterResults`, FORBIDDEN otherwise), a race only (`RESULTS_NOT_OPEN`), from three hours before the planned gun to six hours after
 * (`RACE_GUN_WINDOW`), and only while no «Sosit» result is stored (`RACE_GUN_FIXED`: after the first finisher the gun is fixed — a
 * correction is «Clasament»'s). The moment is the tap the island claims when the server hears it at most ten seconds after it and it
 * is at most five seconds ahead, else the server's own (`raceGunMoment`); a second press moves it; `clear` takes it off, back to the
 * planned gun. **A press is never doubled into a second «Start»** (the review: a tap again on a slow start-line signal, queued behind
 * the first, moved the gun by the gap and shortened every runner's time): a «Start» of the organizer whose «Start» the gun stands at,
 * heard at most ten seconds after theirs (`domain/finish-line.ts#raceGunRepeats`, read from the gun's own audit rows), is answered with
 * the gun as it stands (`repeated`) and writes nothing — the page's button is busy while its press is on its way, too
 * (`ui/RaceGunPress.tsx`). **A «Start» moves only the gun its page saw** (the integration's review: with two organizers at the start
 * line, the one who pressed seconds later — their page still saying «Start» — moved the first one's gun and shortened every runner's
 * time): the press says the gun its page was drawn with (`seenGunAtMs`: null for none, else its instant), and one whose page saw
 * another than the gun stored — given, moved or taken off since by another press — is refused (`RACE_GUN_CHANGED`), nothing written,
 * the page drawn again saying who gave the start and when; only a «Mută startul acum» from a page that saw the gun as it stands moves
 * it. A caller that says nothing (`undefined`) is not asked. One audit row a change — `event.race_gun_set` with `{ at, previous }`,
 * `event.race_gun_cleared` with `{ previous }`, the instants alone, never a name — and no email. The public cache is not told: nothing
 * public reads the gun. The event's `version` and its «last saved» are untouched — the editor's open form is not refused for it.
 */
export async function setRaceGun<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Actor,
  request: { eventId: string; clear: boolean; claimedAtMs?: number | null; seenGunAtMs?: number | null },
  now: Date,
): Promise<{ changed: boolean; gunAt: Date | null; repeated?: true }> {
  assertMayEnter(actor);
  assertIds(request.eventId);
  return db.transaction(async (tx) => {
    const event = await loadEvent(tx, request.eventId, true);
    if (!eventTakesResults(event.type)) throw new DomainError("RESULTS_NOT_OPEN", "only a race has a gun");
    if (!request.clear && event.raceGunAt !== null && event.raceGunByStaffUserId === actor.id) {
      // The gun stands as this organizer set it: their «Start» heard again within ten seconds is that press sent twice.
      const [last] = await tx
        .select({ action: auditLogs.action, actorStaffUserId: auditLogs.actorStaffUserId, at: auditLogs.createdAt })
        .from(auditLogs)
        .where(and(eq(auditLogs.entityType, "event"), eq(auditLogs.entityId, event.id), inArray(auditLogs.action, ["event.race_gun_set", "event.race_gun_cleared"])))
        .orderBy(desc(auditLogs.createdAt))
        .limit(1);
      if (raceGunRepeats(last, actor.id, now.getTime())) return { changed: false, gunAt: event.raceGunAt, repeated: true };
    }
    // The page saw another gun than the one stored: another organizer gave it, moved it or took it off since — that page's «Start» is
    // a press about a gun that is no more, and moves nothing.
    if (!request.clear && request.seenGunAtMs !== undefined && (event.raceGunAt?.getTime() ?? null) !== request.seenGunAtMs) {
      throw new DomainError("RACE_GUN_CHANGED", "the start was given, moved or taken off since the page was drawn");
    }
    if (!raceGunWindowOpen(plannedGunOf(event).getTime(), now.getTime())) throw new DomainError("RACE_GUN_WINDOW", "the gun is pressed from three hours before the planned start to six hours after");
    const [finished] = await tx
      .select({ id: eventResults.id })
      .from(eventResults)
      .where(and(eq(eventResults.eventId, event.id), eq(eventResults.status, "FINISHED")))
      .limit(1);
    if (finished) throw new DomainError("RACE_GUN_FIXED", "runners have finished: the gun is fixed");
    const previous = event.raceGunAt?.toISOString() ?? null;
    if (request.clear) {
      if (event.raceGunAt === null) return { changed: false, gunAt: null };
      await tx.update(events).set({ raceGunAt: null, raceGunByStaffUserId: null }).where(eq(events.id, event.id));
      await recordAuditEvent(tx, { actorStaffUserId: actor.id, action: "event.race_gun_cleared", entityType: "event", entityId: event.id, metadata: { previous }, now });
      return { changed: true, gunAt: null };
    }
    const gunAt = new Date(raceGunMoment(request.claimedAtMs ?? null, now.getTime()));
    await tx.update(events).set({ raceGunAt: gunAt, raceGunByStaffUserId: actor.id }).where(eq(events.id, event.id));
    await recordAuditEvent(tx, { actorStaffUserId: actor.id, action: "event.race_gun_set", entityType: "event", entityId: event.id, metadata: { at: gunAt.toISOString(), previous }, now });
    return { changed: true, gunAt };
  });
}

/** The gun as the clock's question reads it: the instant counted from, whether «Start» was pressed and by whom, and whether a finisher fixed it. */
export type FinishGunReading = { at: Date; pressed: boolean; byName: string | null; fixed: boolean };

/**
 * The gun the finish line counts from (`gunOf`: «Start» as pressed, else the plan), for the island's clock question (§986): «Start» is
 * pressed on the organizer's phone, so a volunteer's page drawn before it learns of it here — as it wakes, when it is shown again and,
 * while no finisher is stored, every half minute — with who pressed it, for the line to say the gun it counts from, and whether a
 * «Sosit» is stored (`fixed`, as `setRaceGun`'s `RACE_GUN_FIXED` reads it), so a phone that records nobody stops asking from the first
 * finisher anybody records. Whoever records finishes (`canRecordFinishes`); one query — the event's row by its primary key, its
 * presser's name and an `EXISTS` on the race's results by the event's index —, nothing written; null for an id that is no event.
 */
export async function readFinishGun<T extends Record<string, unknown>>(db: Database<T>, actor: Actor, eventId: string): Promise<FinishGunReading | null> {
  assertMayRecord(actor);
  if (!isUuid(eventId)) return null;
  const [row] = await db
    .select({
      startsAt: events.startsAt,
      raceStartsAt: events.raceStartsAt,
      raceGunAt: events.raceGunAt,
      byName: staffUsers.displayName,
      fixed: sql<boolean>`exists (select 1 from ${eventResults} where ${eventResults.eventId} = ${events.id} and ${eventResults.status} = 'FINISHED')`,
    })
    .from(events)
    .leftJoin(staffUsers, eq(staffUsers.id, events.raceGunByStaffUserId))
    .where(eq(events.id, eventId))
    .limit(1);
  return row ? { at: gunOf(row), pressed: row.raceGunAt !== null, byName: row.raceGunAt === null ? null : (row.byName ?? null), fixed: row.fixed === true } : null;
}

/** «Start» as the page says it: the gun counted from, whether it was pressed and by whom, the plan, and whether a finisher fixed it. */
export type RaceGunView = { at: Date; pressed: boolean; byName: string | null; planned: Date; fixed: boolean; windowOpen: boolean };

/** «Cronometrare»'s data (§986): the gun, the latest finishers, the elites' buttons and the two counts. */
export type FinishLineView = {
  event: EventFacts;
  gun: RaceGunView;
  /** «Ultimii sosiți», the latest written first, at most `limit`. */
  recent: RecentFinisherView[];
  /** The elites' buttons, by label (Romanian order). */
  elites: EliteButtonView[];
  /** How many have finished, and how many numbers the line takes: the confirmed registrations' and the elite list's lines' — never one a
   * cancellation retired (§173), which stays on its row so it is never reused. */
  finished: number;
  withNumber: number;
};

/**
 * «Cronometrare»'s data (§986), for whoever records finishes (`canRecordFinishes`): the gun (`gunOf`, pressed or planned), «Ultimii
 * sosiți» — the stored «Sosit» rows, the latest written first: the number or the elite's label, the name as the backoffice reads it,
 * the time, the place from the live answers or «în afara clasamentului», who wrote it («introdus de» / «modificat de», null for an
 * account gone), until when the viewer may undo it (`undoOpenUntil`, from the line's own trail of the last ten minutes) and, for the
 * viewer's own press whose number was pressed again since, by whom (`undoClosedBy`) — the elites' buttons and the counts.
 *
 * **The elites' buttons**: every confirmed real registration marked «Elită» — its label (`eliteBibName`), its full name, its number,
 * none for one with no number yet — and every line of the race's elite list — its label (`eliteLineBibName`), its name and its number,
 * or none; each «Sosit» already with its time; ordered by label in Romanian, then by name. Nothing here is an address: the desk sees
 * the same names.
 */
export async function readFinishLine<T extends Record<string, unknown>>(db: Database<T>, actor: Actor, eventId: string, now: Date, limit: number): Promise<FinishLineView> {
  assertMayRecord(actor);
  assertIds(eventId);
  const event = await loadEvent(db, eventId, false);
  const [runners, stored, labels, unnumberedElites, trail] = await Promise.all([
    loadRegisteredRunners(db, eventId),
    loadStored(db, eventId, false),
    loadEliteLabels(db, eventId),
    db
      .select({ id: registrations.id, displayName: registrations.displayName })
      .from(registrations)
      .where(and(eq(registrations.eventId, eventId), eq(registrations.kind, "REAL"), eq(registrations.status, "CONFIRMED"), eq(registrations.elite, true), isNull(registrations.bibNumber))),
    // The rows a press of the last ten minutes may still undo, and the presses of their numbers since.
    loadLineTrail(db, eventId, new Date(now.getTime() - FINISH_UNDO_WINDOW_MS - LINE_TRAIL_SLACK_MS)),
  ]);
  // The places from the live answers, as every page reads them (`loadLiveRanking`'s rule, from the rows read once here).
  const ranking = rankingOf(stored, runners, event);
  const index = indexStored(stored, runners);
  const finished = stored.filter((row) => row.status === "FINISHED" && row.gunTimeMs !== null);
  const latest = [...finished].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime() || b.bibNumber - a.bibNumber).slice(0, limit);
  const staffNames = await staffNamesOf(db, [...latest.map((row) => row.updatedByStaffUserId), event.raceGunByStaffUserId]);
  const lineByBib = new Map(runners.lines.flatMap((line) => (line.bibNumber === null ? [] : [[line.bibNumber, line] as const])));
  const labelOfLine = (line: EliteLine | undefined) => (line ? (labels.lines.get(line.id) ?? line.name) : null);

  const recent = latest.map((row): RecentFinisherView => {
    const runner = row.registrationId !== null ? runners.byRegistration.get(row.registrationId) : undefined;
    const ranked = ranking.get(row.bibNumber);
    const rowTrail = undoTrailOf(row, trail);
    const until = undoOpenUntil(row, actor.id, rowTrail);
    return {
      resultId: row.id,
      bibNumber: row.bibNumber,
      label: runner ? (runner.elite ? (labels.registrations.get(runner.registrationId) ?? null) : null) : row.registrationId === null ? labelOfLine(lineByBib.get(row.bibNumber)) : null,
      name: runner ? runner.displayName : row.registrationId === null ? row.displayName : null,
      gunTimeMs: row.gunTimeMs as number,
      positionOverall: ranked?.positionOverall ?? null,
      outOfRanking: ranked?.outOfRanking === true,
      by: row.updatedByStaffUserId === null ? null : (staffNames.get(row.updatedByStaffUserId) ?? null),
      changed: row.createdAt.getTime() !== row.updatedAt.getTime(),
      undoUntilMs: until !== null && now.getTime() <= until ? until : null,
      pressedAgain: undoClosedBy(row, actor.id, rowTrail, now.getTime()),
    };
  });

  const finishedTime = (row: EventResultRow | undefined) => (row && row.status === "FINISHED" ? row.gunTimeMs : null);
  const elites: EliteButtonView[] = [];
  for (const runner of runners.byRegistration.values()) {
    if (!runner.elite || runner.status !== "CONFIRMED") continue;
    const claim = claimOf(runner, index);
    elites.push({
      key: `r:${runner.registrationId}`,
      kind: "registration",
      label: labels.registrations.get(runner.registrationId) ?? runner.displayName,
      name: runner.displayName,
      bibNumber: runner.bibNumber,
      entryId: null,
      finishedGunTimeMs: finishedTime(claim.row),
    });
  }
  for (const row of unnumberedElites) {
    elites.push({ key: `r:${row.id}`, kind: "registration", label: labels.registrations.get(row.id) ?? row.displayName, name: row.displayName, bibNumber: null, entryId: null, finishedGunTimeMs: null });
  }
  for (const line of runners.lines) {
    const holder = line.bibNumber === null ? undefined : runners.byBib.get(line.bibNumber);
    // A number a confirmed registration holds is that runner's (rule 2): the line has no button of its own then.
    if (holder && holder.status === "CONFIRMED") continue;
    elites.push({
      key: `l:${line.id}`,
      kind: "line",
      label: labels.lines.get(line.id) ?? line.name,
      name: line.name,
      bibNumber: line.bibNumber,
      // What «Dă-i un număr» posts for a line drawn without a number (§990): the line's id, never shown.
      entryId: line.id,
      finishedGunTimeMs: line.bibNumber === null ? null : finishedTime(index.freeByBib.get(line.bibNumber)),
    });
  }
  elites.sort((a, b) => a.label.localeCompare(b.label, "ro") || a.name.localeCompare(b.name, "ro") || a.key.localeCompare(b.key));

  // «… din N cu număr»: the numbers this line takes (`FinishTarget`) — a confirmed registration's, a line of the elite list's — never a
  // cancelled or expired row's, whose number stays retired on it (§173). The owner, 2026-11-19, of «0 sosiți din 199 cu număr» with
  // 172 runners holding a place: «cum pot să am 199 cu număr?».
  const numbersTaken = new Set<number>();
  for (const runner of runners.byBib.values()) if (runner.status === "CONFIRMED") numbersTaken.add(runner.bibNumber);
  for (const line of runners.lines) if (line.bibNumber !== null) numbersTaken.add(line.bibNumber);

  const gunAt = gunOf(event);
  return {
    event,
    gun: {
      at: gunAt,
      pressed: event.raceGunAt !== null,
      byName: event.raceGunByStaffUserId === null ? null : (staffNames.get(event.raceGunByStaffUserId) ?? null),
      planned: plannedGunOf(event),
      fixed: finished.length > 0,
      windowOpen: raceGunWindowOpen(plannedGunOf(event).getTime(), now.getTime()),
    },
    recent,
    elites,
    finished: finished.length,
    withNumber: numbersTaken.size,
  };
}

/**
 * The name each race number belongs to today, as the backoffice reads it (§986): a confirmed registration's, a typed row's, a line of
 * the elite list's — read live, so «Istoricul sosirilor» may say the name beside a number the trail stores without one.
 */
export async function liveNamesByBib<T extends Record<string, unknown>>(db: Database<T>, eventId: string): Promise<Map<number, string>> {
  const [runners, stored] = await Promise.all([loadRegisteredRunners(db, eventId), loadStored(db, eventId, false)]);
  const names = new Map<number, string>();
  for (const line of runners.lines) if (line.bibNumber !== null) names.set(line.bibNumber, line.name);
  for (const row of stored) if (row.registrationId === null && row.displayName !== null) names.set(row.bibNumber, row.displayName);
  for (const runner of runners.byBib.values()) if (runner.status === "CONFIRMED") names.set(runner.bibNumber, runner.displayName);
  return names;
}

// ---- Publishing -------------------------------------------------------------------------------------------

/**
 * «Clasamentul e public pe pagina evenimentului» (§808): the Administrator's switch, the disclosure itself. Refused for any other role
 * (FORBIDDEN). **Switching it on is refused** for an event that is not a race (`RESULTS_NOT_OPEN`), while the privacy notice in force, in
 * every language, does not name `{{results}}` (`RESULTS_NOTICE`) — the club's approval of the text is what lets a result reach the page, as
 * for the list's states (§396) — and while the terms in force do not (`RESULTS_TERMS`: the older terms promised to ask separately before a
 * named result); switching it off never is. **Before the race it is accepted** (§985, amending §808's refusal; the owner, 2026-11-18:
 * «public from the start»): the tick is set, and nothing is shown before the start — the public read, the section, the listing's chip and
 * the page's hold all wait for `startsAt` (`domain/results-open.ts#resultsOnShow`) — so the answer says `fromStart`. A press that changes
 * nothing writes and records nothing. The moment of the last switching on is kept, and the cache is told.
 */
export async function setResultsPublished<T extends Record<string, unknown>>(db: Database<T>, actor: Actor, eventId: string, on: boolean, now: Date): Promise<{ changed: boolean; fromStart?: true }> {
  if (!canPublishResults(actor.role)) throw new DomainError("FORBIDDEN", `role ${actor.role} may not publish a race's results`);
  assertIds(eventId);
  const outcome = await db.transaction(async (tx) => {
    const event = await loadEvent(tx, eventId, true);
    if (event.resultsPublished === on) return { changed: false };
    if (on) {
      if (!eventTakesResults(event.type)) throw new DomainError("RESULTS_NOT_OPEN", "only a race takes results");
      if (!(await noticeDescribesResults(tx, now))) throw new DomainError("RESULTS_NOTICE", "the privacy notice in force does not describe the results");
      // The terms a runner accepted promised «te vom întreba separat» before any named result: the club approves the new terms first.
      if (!(await termsDescribeResults(tx, now))) throw new DomainError("RESULTS_TERMS", "the terms in force do not describe the results");
    }
    await tx.update(events).set({ resultsPublished: on, resultsPublishedAt: on ? now : null }).where(eq(events.id, event.id));
    await recordAuditEvent(tx, { actorStaffUserId: actor.id, action: on ? "event_results.published" : "event_results.unpublished", entityType: "event", entityId: event.id, metadata: {}, now });
    // Ticked before the race (§985): set now, shown from the start.
    return on && event.startsAt.getTime() > now.getTime() ? { changed: true, fromStart: true as const } : { changed: true };
  });
  if (outcome.changed) revalidatePublicContent("events", "places");
  return outcome;
}

/**
 * «Categorii de vârstă» (§850): the ages the race's categories start at, saved by whoever enters results (FORBIDDEN otherwise), on a race
 * only (`RESULTS_NOT_OPEN`). `null` is the platform's bands — the column forgets the choice. The stored results are **ranked again in the
 * same transaction** (`writeRanking`), so the places by category never describe bands the race no longer has; one audit row names the
 * list and how many rows moved, never a runner. A list the column may not hold is refused (`RESULTS_AGE_BANDS`); a save that changes
 * nothing writes and records nothing.
 */
export async function setResultAgeBands<T extends Record<string, unknown>>(db: Database<T>, actor: Actor, eventId: string, starts: readonly number[] | null, now: Date): Promise<{ changed: boolean; rewritten: number }> {
  assertMayEnter(actor);
  assertIds(eventId);
  if (starts !== null && !isValidAgeBandStarts(starts)) throw new DomainError("RESULTS_AGE_BANDS", "the age bands cannot be stored", ["ageBands"]);
  const outcome = await db.transaction(async (tx) => {
    const event = await loadEvent(tx, eventId, true);
    if (!eventTakesResults(event.type)) throw new DomainError("RESULTS_NOT_OPEN", "only a race has result categories");
    const next = starts ?? DEFAULT_AGE_BAND_STARTS;
    if (sameAgeBandStarts(event.resultAgeBands, next)) return { changed: false, rewritten: 0 };
    await tx.update(events).set({ resultAgeBands: starts === null ? null : [...starts] }).where(eq(events.id, event.id));
    const stored = await loadStored(tx, eventId, true);
    const runners = await loadRegisteredRunners(tx, eventId);
    const rewritten = stored.length === 0 ? 0 : await writeRanking(tx, { ...event, resultAgeBands: next }, runners, stored);
    await recordAuditEvent(tx, {
      actorStaffUserId: actor.id,
      action: "event_results.categories_changed",
      entityType: "event",
      entityId: event.id,
      metadata: { ageBands: starts === null ? null : [...starts], rewritten },
      now,
    });
    return { changed: true, rewritten };
  });
  if (outcome.changed) revalidatePublicContent("events", "places");
  return outcome;
}

// ---- Importing -------------------------------------------------------------------------------------------

/** One row of a CSV, matched: the number, what the file says of it and whether a registration holds that number. */
export type ImportedResultRow = {
  bibNumber: number;
  status: ResultStatus;
  gunTimeMs: number | null;
  chipTimeMs: number | null;
  /** A registration of the event holds the number: the table's own row takes the times. */
  matched: boolean;
  /** That registration's display name, for the sentence that counts the rows; null when unmatched. */
  name: string | null;
};

/**
 * «Importă din CSV» (§808): a CSV or TSV read into rows (`parseResultsCsv`, `bib,time[,chip][,status]`, with a header or without) and
 * matched by race number to the event's confirmed registrations — never a test row. **It writes nothing**: the page puts the rows in
 * the table's boxes, a number no registration holds becomes a row needing a typed name, and «Salvează tot clasamentul» is the one
 * thing that saves. A file with a bad line is refused whole, naming the line (`ResultsCsvError`, `RESULTS_IMPORT_INVALID`).
 */
export async function importResultsCsv<T extends Record<string, unknown>>(db: Database<T>, actor: Actor, eventId: string, text: string): Promise<ImportedResultRow[]> {
  assertMayEnter(actor);
  assertIds(eventId);
  const parsed = parseResultsCsv(text);
  const event = await loadEvent(db, eventId, false);
  if (!eventTakesResults(event.type)) throw new DomainError("RESULTS_NOT_OPEN", "only a race takes results");
  const [runners, stored] = await Promise.all([loadRegisteredRunners(db, eventId), loadStored(db, eventId, false)]);
  const index = indexStored(stored, runners);
  return parsed.map((row) => {
    // The table's own rule (`claimOf`): a confirmed registration's number is matched, a cancelled one's is not — it stays a line that asks
    // for a name and the save says whose number it is.
    const runner = runners.byBib.get(row.bibNumber);
    const matched = runner !== undefined && claimOf(runner, index).attached;
    return { bibNumber: row.bibNumber, status: row.status, gunTimeMs: row.gunTimeMs, chipTimeMs: row.chipTimeMs, matched, name: matched ? (runner?.displayName ?? null) : null };
  });
}

// ---- Exporting and reading for the public --------------------------------------------------------------

/** One row of «Descarcă clasamentul (CSV)»: the backoffice sees every name. */
export type ExportedResultRow = {
  positionOverall: number | null;
  positionSex: number | null;
  positionCategory: number | null;
  bibNumber: number;
  name: string | null;
  sex: SexChoice | null;
  categoryKey: string | null;
  status: ResultStatus;
  gunTimeMs: number | null;
  chipTimeMs: number | null;
  note: string | null;
  /** An elite left out of the ranking (§910): the file says «în afara clasamentului» where the position would be. */
  outOfRanking: boolean;
};

const STATUS_ORDER: Record<ResultStatus, number> = { FINISHED: 0, DNF: 1, DSQ: 2, DNS: 3 };

/**
 * The list in the order a results sheet reads: the finishers by position, then the others by state and number. A finisher with no
 * position — an elite hors concours (§910), in the club's own file only — follows the placed finishers, by time.
 */
function sheetOrder<T extends { status: ResultStatus; positionOverall: number | null; bibNumber: number; gunTimeMs: number | null }>(rows: T[]): T[] {
  const unplaced = Number.MAX_SAFE_INTEGER;
  return rows.sort(
    (a, b) =>
      STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
      (a.positionOverall ?? unplaced) - (b.positionOverall ?? unplaced) ||
      (a.gunTimeMs ?? 0) - (b.gunTimeMs ?? 0) ||
      a.bibNumber - b.bibNumber,
  );
}

/**
 * The race's results as a file's rows (§808), for whoever may enter them — names as the backoffice sees them: the registration's, the
 * typed one, none for a row an erased registration left. The download is recorded (`event_results.exported`: who, how many rows, never
 * a name) because a file that leaves the site is the one copy the retention sweep cannot reach.
 */
export async function exportEventResults<T extends Record<string, unknown>>(db: Database<T>, actor: Actor, eventId: string, now: Date): Promise<{ event: EventFacts; rows: ExportedResultRow[] }> {
  assertMayEnter(actor);
  assertIds(eventId);
  const view = await readEventResults(db, actor, eventId);
  const rows = sheetOrder(
    [...view.registered, ...view.typed].flatMap((runner): ExportedResultRow[] =>
      runner.result
        ? [
            {
              positionOverall: runner.result.positionOverall,
              positionSex: runner.result.positionSex,
              positionCategory: runner.result.positionCategory,
              bibNumber: runner.bibNumber,
              name: runner.name,
              sex: runner.sex,
              categoryKey: runner.result.categoryKey,
              status: runner.result.status,
              gunTimeMs: runner.result.gunTimeMs,
              chipTimeMs: runner.result.chipTimeMs,
              note: runner.result.note,
              outOfRanking: runner.outOfRanking,
            },
          ]
        : [],
    ),
  );
  await recordAuditEvent(db, { actorStaffUserId: actor.id, action: "event_results.exported", entityType: "event", entityId: eventId, metadata: { rows: rows.length }, now });
  return { event: view.event, rows };
}

/** One row of the public results (§808): a number, a name only for a runner who ticked, the times, the positions and the category. Never an address, a phone, a document, a note or a registration's id. */
export type PublicResultRow = {
  bibNumber: number;
  /**
   * The registration's display name — only for a registered runner who ticked the list's box — or the typed name of a runner the club entered by hand
   * **and recorded as having agreed** (§810); null otherwise, and the page says «Participant #bib» (`anonymousResultLabel`).
   */
  name: string | null;
  status: ResultStatus;
  gunTimeMs: number | null;
  chipTimeMs: number | null;
  positionOverall: number | null;
  positionSex: number | null;
  positionCategory: number | null;
  /** The sex and the band, `FEMALE:from30`; null without both answers. */
  categoryKey: string | null;
  /** The sex, from the registration or the typed row; null without one. */
  sex: SexChoice | null;
};

export type PublicEventResults = {
  rows: PublicResultRow[];
  /** When the club switched the results on. */
  publishedAt: Date | null;
  /** When they close by themselves: the public list's period after the event (§421). */
  closesAt: Date;
  /** The ages the race's categories start at (§850), so the page says each category's band in words. */
  ageBandStarts: readonly number[];
};

/**
 * What the event page shows of a race's results (§808) — for the page lane, the public list's rule extended: **nothing** unless the
 * Administrator published them (`events.results_published`), the privacy notice **and** the terms in force describe them
 * (`noticeDescribes`, `termsDescribe`, the cached reads, passed in), the race is a race, **it has started**, and the public list's
 * period has not passed (`publicListStillOpen`, §421, checked here at request time because a date passing is no write). Then every
 * stored row, in the sheet's order, ranked from the live answers, with a name **only** for a runner `publicResultName` names: the
 * public list's own conditions (confirmed, ticked, not a hidden special guest, §743) and a registration made under a notice that
 * described the results (`firstResultsNoticeVersion`, §421's line) — or, made under an older one, whose runner asked since to appear by name
 * under a notice that named the tick (`results_name_consent`, `firstResultsNameAskNoticeVersion`, §879) — or a runner typed by hand whom the staff recorded as agreeing to appear by name
 * under a notice that described the results — everyone else is «Participant #bib». Never an address, a phone
 * number, a document, a note or a registration's id: the select names its columns. An elite left out of the ranking (§910) is not a row
 * of the answer at all, and the positions were counted without it.
 */
export async function readPublicEventResults<T extends Record<string, unknown>>(
  db: Database<T>,
  eventId: string,
  options: {
    now: Date;
    deadlines: Pick<Deadlines, "publicListDays">;
    noticeDescribes: boolean;
    termsDescribe: boolean;
    /** The first approved notice that described the results (`cachedFirstResultsNoticeVersion`); null when none did — then nobody is named. Required, so no caller can forget it. */
    firstResultsNoticeVersion: number | null;
    /** The first approved notice that named «Vreau să apar cu numele în clasament» (`cachedFirstResultsNameAskNoticeVersion`, §879); null — no yes asked since names anybody. Required, like the line above. */
    firstResultsNameAskNoticeVersion: number | null;
  },
): Promise<PublicEventResults | null> {
  if (!isUuid(eventId) || !options.noticeDescribes || !options.termsDescribe) return null;
  const [found] = await db
    .select({
      id: events.id,
      type: events.type,
      startsAt: events.startsAt,
      raceStartsAt: events.raceStartsAt,
      endsAt: events.endsAt,
      timezone: events.timezone,
      resultsPublished: events.resultsPublished,
      resultsPublishedAt: events.resultsPublishedAt,
      hiddenListEnabled: events.hiddenListEnabled,
      hiddenListPublic: events.hiddenListPublic,
      raceNumberFormat: RACE_NUMBER_FORMAT,
      resultAgeBands: events.resultAgeBands,
      awardPlaces: events.awardPlaces,
      awardCategories: events.awardCategories,
    })
    .from(events)
    .where(eq(events.id, eventId))
    .limit(1);
  if (!found || !found.resultsPublished || !eventTakesResults(found.type)) return null;
  // The gun pressed on «Cronometrare» (§986) is the finish line's alone: the public read never selects it, and counts nothing from it.
  const event: EventFacts = { ...found, raceGunAt: null, raceGunByStaffUserId: null, resultAgeBands: ageBandStartsOf(found.resultAgeBands) };
  if (options.now.getTime() < event.startsAt.getTime()) return null;
  if (!publicListStillOpen(event, options.now, options.deadlines)) return null;

  const { ranking, runners } = await loadLiveRanking(db, event);
  const hiddenShown = hiddenListShownPublicly(event);
  const rows = await db
    .select({
      bibNumber: eventResults.bibNumber,
      registrationId: eventResults.registrationId,
      registeredName: registrations.displayName,
      listOptOut: registrations.listOptOut,
      elite: registrations.elite,
      // Read for the site tick alone (`tickedForTheSite`): neither mark is ever copied onto a published row.
      ambassador: registrations.ambassador,
      eliteHiddenFromSite: registrations.eliteHiddenFromSite,
      registrationStatus: registrations.status,
      outsideCapacity: registrations.outsideCapacity,
      noticeVersion: registrations.privacyNoticeVersion,
      resultsNameConsent: registrations.resultsNameConsent,
      resultsConsentVersion: registrations.resultsConsentVersion,
      registeredSex: registrations.sex,
      typedSex: eventResults.sex,
      typedName: eventResults.displayName,
      typedNameAgreedAt: eventResults.nameAgreedAt,
      status: eventResults.status,
      gunTimeMs: eventResults.gunTimeMs,
      chipTimeMs: eventResults.chipTimeMs,
    })
    .from(eventResults)
    .leftJoin(registrations, and(eq(registrations.id, eventResults.registrationId), eq(registrations.kind, "REAL")))
    .where(eq(eventResults.eventId, eventId));

  // An elite the Administrator left out of the ranking (§910) is not on the page at all — not a name, not «Participant #bib», not a time —
  // and the positions the page shows were counted without it (`rankingOf`).
  const onShow = rows.filter((row) => ranking.get(row.bibNumber)?.outOfRanking !== true);
  const shown = onShow.map((row): PublicResultRow => {
    const registered = row.registrationId !== null && row.listOptOut !== null;
    const ranked = ranking.get(row.bibNumber) as Ranked;
    return {
      bibNumber: row.bibNumber,
      name: publicResultName({
        registered,
        // The person's own tick, read as unticked under the club's «Apare pe site» unticked on a marked elite (§910).
        ticked: tickedForTheSite(row),
        displayName: row.registeredName,
        confirmed: row.registrationStatus === "CONFIRMED",
        hidden: row.outsideCapacity === true && !hiddenShown,
        noticeVersion: row.noticeVersion,
        firstResultsNoticeVersion: options.firstResultsNoticeVersion,
        firstResultsNameAskNoticeVersion: options.firstResultsNameAskNoticeVersion,
        // Asked since by an older notice's runner (§879); a typed row's left join reads null, which names nobody.
        resultsNameConsent: row.resultsNameConsent === true,
        resultsConsentVersion: row.resultsConsentVersion,
        // A runner the club typed by hand: the staff-recorded agreement (§810), on a row no registration holds (the database's check says the same)
        // and whose number no confirmed registration has taken since: the backoffice already draws that number as the registered runner's, whose
        // name follows their own tick and never a staff mark, so until the next save re-files the row the line is «Participant #bib».
        typedNameAgreed: row.registrationId === null && row.typedNameAgreedAt !== null && runners.byBib.get(row.bibNumber)?.status !== "CONFIRMED",
        typedDisplayName: row.typedName,
      }),
      status: row.status,
      gunTimeMs: row.gunTimeMs,
      chipTimeMs: row.chipTimeMs,
      positionOverall: ranked.positionOverall,
      positionSex: ranked.positionSex,
      positionCategory: ranked.positionCategory,
      categoryKey: ranked.categoryKey,
      sex: registered ? sexShown(row.registeredSex) : sexShown(row.typedSex),
    };
  });
  return { rows: sheetOrder(shown), publishedAt: event.resultsPublishedAt, closesAt: publicListClosesAt(event, options.deadlines), ageBandStarts: event.resultAgeBands };
}

/** How many results an event has stored, for the editor's summary line and the tasks' rows. */
export async function countEventResults<T extends Record<string, unknown>>(db: Database<T>, eventId: string): Promise<number> {
  const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(eventResults).where(eq(eventResults.eventId, eventId));
  return row?.count ?? 0;
}
