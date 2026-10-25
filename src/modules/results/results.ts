import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { eventResults, type EventResultRow } from "@/db/schema/event-results";
import { events } from "@/db/schema/events";
import { registrations, type RegistrationSex } from "@/db/schema/registrations";
import type { StaffUser } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import { type AuditAction, recordAuditEvent } from "@/modules/audit/repository";
import { type Deadlines, publicListClosesAt, publicListStillOpen } from "@/modules/deadlines/domain/deadlines";
import { findFirstResultsNoticeVersion, noticeDescribesResults, termsDescribeResults } from "@/modules/legal-documents/repository";
import { revalidatePublicContent } from "@/modules/public-cache/cache";
import { ageOnRaceDay, dayIn } from "@/modules/registrations/domain/age";
import { RACE_NUMBER_FORMAT } from "@/modules/events/repository";
import { hiddenListShownPublicly } from "@/modules/registrations/domain/hidden-list";
import type { RaceNumberFormat } from "@/modules/registrations/domain/race-number";
import { type SexChoice, sexShown } from "@/modules/registrations/domain/sex";
import { canEnterResults, canPublishResults } from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";
import { isUuid } from "@/shared/ids";
import { ageBandStartsOf, DEFAULT_AGE_BAND_STARTS, isValidAgeBandStarts, sameAgeBandStarts } from "./domain/age-bands";
import { type AwardRules, isValidAwardPlaces } from "./domain/awards";
import { eventTakesResults } from "./domain/event-type";
import { type FingerprintedResult, resultsFingerprint } from "./domain/fingerprint";
import { parseResultsCsv } from "./domain/import-csv";
import { publicResultName } from "./domain/public-name";
import { type Rankable, RESULTS_MAX, rankResults, type ResultStatus, type Ranked } from "./domain/ranking";
import { type ReadRow, type ResultRowProblem, readResultRow } from "./domain/row-input";
import { type PostedResultRow, resultBox } from "./rows";

/**
 * A race's results, part 1 (§808; the owner, 2026-10-17: «Aș vrea să pot pune și clasament la final după cursă»): the rows entered or
 * imported in the backoffice, ranked, and — only when an Administrator publishes them and the privacy notice in force describes
 * them — read by the event page.
 *
 * **Who.** The Organizer, the Administrator and the Superadministrator enter, import, rank and read (`canEnterResults`); the
 * Administrator and the Superadministrator alone publish (`canPublishResults`). The Tehnic role, the Redactor, the desk Volunteer
 * and a member are refused here, whatever the page drew (BR-REQ-060-01). **Nothing about a registration changes**: a result reads
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
 * (`events.result_age_bands`, §NNN, set on «Clasament» and re-ranking the stored rows). Ties share a position and the next
 * skips. **The page and the public read re-rank from the live answers** (a corrected sex, a moved race day, an erased registration), the
 * stored positions being what the last save, or an erasure, wrote — a cache, rewritten on the next save. One audit row per result created, changed or deleted (`event_result.*`: the number, the state, the times and the names of the
 * boxes that changed, never a name), and the public cache is told once.
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
  /** The «Vreau să apar pe lista de participanți & rezultate» tick (`list_opt_out` false). */
  ticked: boolean;
  checkedIn: boolean;
  status: string;
  /** Sits «În afara locurilor» (§643): never named on a public list the event does not show its special guests on (§743). */
  outsideCapacity: boolean;
  /** The privacy notice version the registration recorded: a tick under an older notice does not name the runner in the results (§421's line). */
  noticeVersion: number;
};

/** The event's registered runners, by race number and by registration. */
type Runners = { byBib: Map<number, RegisteredRunner>; byRegistration: Map<string, RegisteredRunner> };

type EventFacts = {
  id: string;
  type: string;
  startsAt: Date;
  /** The gun, when the race's own start differs from the gathering (`race_starts_at`); the finish line counts from `raceStartsAt ?? startsAt`. */
  raceStartsAt: Date | null;
  endsAt: Date | null;
  timezone: string;
  resultsPublished: boolean;
  resultsPublishedAt: Date | null;
  hiddenListEnabled: boolean;
  hiddenListPublic: boolean;
  /** How the event writes its race numbers (§735): «Participant #007» on the backoffice's «Pe site» line as on the page. */
  raceNumberFormat: RaceNumberFormat;
  /** The ages the race's categories start at (§NNN): its own, or the platform's when it chose none (`ageBandStartsOf`). */
  resultAgeBands: readonly number[];
  /** «Premii» (§NNN): how many places each podium awards, and whether the categories are awarded beside the overall podium by sex. */
  awardPlaces: number;
  awardCategories: boolean;
};

function assertMayEnter(actor: Actor): void {
  if (!canEnterResults(actor.role)) throw new DomainError("FORBIDDEN", `role ${actor.role} may not enter or read a race's results`);
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
  const [event] = await (lock ? query.for("no key update") : query);
  if (!event) throw new DomainError("NOT_FOUND", "the event is not there");
  return { ...event, resultAgeBands: ageBandStartsOf(event.resultAgeBands) };
}

/** The registrations of the event that hold a race number — any state, never a test row — by that number and by registration. */
async function loadRegisteredRunners<T extends Record<string, unknown>>(db: Database<T>, eventId: string): Promise<Runners> {
  const rows = await db
    .select({
      registrationId: registrations.id,
      bibNumber: registrations.bibNumber,
      displayName: registrations.displayName,
      sex: registrations.sex,
      birthDate: registrations.birthDate,
      listOptOut: registrations.listOptOut,
      checkedInAt: registrations.checkedInAt,
      status: registrations.status,
      outsideCapacity: registrations.outsideCapacity,
      noticeVersion: registrations.privacyNoticeVersion,
    })
    .from(registrations)
    .where(and(eq(registrations.eventId, eventId), eq(registrations.kind, "REAL"), isNotNull(registrations.bibNumber)));
  const runners: Runners = { byBib: new Map(), byRegistration: new Map() };
  for (const row of rows) {
    if (row.bibNumber === null) continue;
    const runner: RegisteredRunner = {
      registrationId: row.registrationId,
      bibNumber: row.bibNumber,
      displayName: row.displayName,
      sex: sexShown(row.sex),
      birthDate: row.birthDate,
      ticked: !row.listOptOut,
      checkedIn: row.checkedInAt !== null,
      status: row.status,
      outsideCapacity: row.outsideCapacity,
      noticeVersion: row.noticeVersion,
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

/** The rankings of a whole list, by the number each row is listed under (`rankResults`), with the answers read as above. */
function rankingOf(
  rows: readonly { bibNumber: number; registrationId: string | null; sex: RegistrationSex | null; birthDate: string | null; status: ResultStatus; gunTimeMs: number | null }[],
  runners: ReadonlyMap<string, RegisteredRunner>,
  event: EventFacts,
): Map<number, Ranked> {
  const rankable: Rankable[] = rows.map((row) => ({ bibNumber: row.bibNumber, status: row.status, gunTimeMs: row.gunTimeMs, ...answersOf(row, runners, event) }));
  return rankResults(rankable, event.resultAgeBands);
}

/** The rankings of the event's stored rows read from the live answers — what every page and file shows, whatever the last save stored — by stored number. */
async function loadLiveRanking<T extends Record<string, unknown>>(db: Database<T>, event: EventFacts): Promise<{ ranking: Map<number, Ranked>; runners: Runners }> {
  const [runners, stored] = await Promise.all([loadRegisteredRunners(db, event.id), loadStored(db, event.id, false)]);
  return { ranking: rankingOf(stored, runners.byRegistration, event), runners };
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
  /** A typed runner: the staff recorded that the person agreed to appear by name (§810); null for a registered runner, whose own tick answers. */
  nameAgreed: boolean | null;
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
  } | null;
};

export type EventResultsView = {
  event: EventFacts;
  /** Registered runners with a race number — checked-in first, then by number — each with its result when it has one. */
  registered: ResultRunner[];
  /** Rows no registration holds the number of: typed by hand, or left nameless by an erased registration's. */
  typed: ResultRunner[];
  /** What the stored rows were when this was read (`resultsFingerprint`): posted back with the form. */
  fingerprint: string;
  /** How many results of each state are stored, for the page's summary. */
  counts: Record<ResultStatus, number>;
  /** The ages the race's categories start at (§NNN) — `event.resultAgeBands`, named for the page — and whether the race chose them itself. */
  ageBandStarts: readonly number[];
  ageBandsCustom: boolean;
};

/** A stored row as the page and the file show it: its own times and note, **the positions and the category read from the live answers** (`rankingOf`). */
function resultOf(row: EventResultRow, ranked: Ranked): NonNullable<ResultRunner["result"]> {
  return {
    status: row.status,
    gunTimeMs: row.gunTimeMs,
    chipTimeMs: row.chipTimeMs,
    note: row.note,
    positionOverall: ranked.positionOverall,
    positionSex: ranked.positionSex,
    positionCategory: ranked.positionCategory,
    categoryKey: ranked.categoryKey,
  };
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
  const [runners, stored, firstResultsNoticeVersion] = await Promise.all([loadRegisteredRunners(db, eventId), loadStored(db, eventId, false), findFirstResultsNoticeVersion(db)]);
  const index = indexStored(stored, runners);
  const ranking = rankingOf(stored, runners.byRegistration, event);
  const rankedOf = (row: EventResultRow) => ranking.get(row.bibNumber) as Ranked;
  const hiddenShown = hiddenListShownPublicly(event);

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
      named:
        publicResultName({
          registered: true,
          ticked: runner.ticked,
          displayName: runner.displayName,
          confirmed: runner.status === "CONFIRMED",
          hidden: runner.outsideCapacity && !hiddenShown,
          noticeVersion: runner.noticeVersion,
          firstResultsNoticeVersion,
          typedNameAgreed: false,
          typedDisplayName: null,
        }) !== null,
      nameAgreed: null,
      checkedIn: runner.checkedIn,
      sex: runner.sex,
      birthDate: null,
      ageOnRaceDay: ageOnRaceDay(runner.birthDate, event.startsAt, event.timezone),
      result: row ? resultOf(row, rankedOf(row)) : null,
    });
  }
  registered.sort((a, b) => Number(b.checkedIn) - Number(a.checkedIn) || a.bibNumber - b.bibNumber);

  const typed: ResultRunner[] = [...index.freeByBib.values()]
    .filter((row) => !taken.has(row.id) && !heldBibs.has(row.bibNumber))
    .sort((a, b) => a.bibNumber - b.bibNumber)
    .map((row) => ({
      bibNumber: row.bibNumber,
      name: row.displayName,
      registered: false,
      ticked: null,
      named:
        publicResultName({
          registered: false,
          ticked: false,
          displayName: null,
          confirmed: false,
          hidden: false,
          noticeVersion: null,
          firstResultsNoticeVersion,
          typedNameAgreed: row.nameAgreedAt !== null,
          typedDisplayName: row.displayName,
        }) !== null,
      nameAgreed: row.nameAgreedAt !== null,
      checkedIn: false,
      sex: sexShown(row.sex),
      birthDate: row.birthDate,
      ageOnRaceDay: ageOnRaceDay(row.birthDate, event.startsAt, event.timezone),
      result: resultOf(row, rankedOf(row)),
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
    const ranking = rankingOf([...prepared.values()], runners.byRegistration, event);

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

/** Writes the rankings of `rows` where they differ from what is stored; returns how many rows were rewritten. */
async function writeRanking<T extends Record<string, unknown>>(db: Database<T>, event: EventFacts, runners: Runners, rows: readonly EventResultRow[]): Promise<number> {
  const ranking = rankingOf(rows, runners.byRegistration, event);
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
 * no-op. Every page and file already ranks from the live answers when it reads, so this only keeps what is stored honest.
 */
export async function rerankEventResults<T extends Record<string, unknown>>(db: Database<T>, eventId: string): Promise<number> {
  const stored = await loadStored(db, eventId, true);
  if (stored.length === 0) return 0;
  const event = await loadEvent(db, eventId, false);
  const runners = await loadRegisteredRunners(db, eventId);
  return writeRanking(db, event, runners, stored);
}

/**
 * «Premii» (§NNN): how many places each podium awards (one to ten) and whether the categories are awarded beside the overall podium by
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

// ---- The finish line --------------------------------------------------------------------------------------

/** A finish refused with what the volunteer at the line needs: the number and the time the gun says, so a refused number is still written down. */
export class FinishError extends DomainError {
  readonly bibNumber: number;
  /** The time since the gun at the press (`RESULT_BIB_UNKNOWN`), or the time already stored (`RESULT_ALREADY_FINISHED`). */
  readonly gunTimeMs: number;

  constructor(code: "RESULT_BIB_UNKNOWN" | "RESULT_ALREADY_FINISHED", bibNumber: number, gunTimeMs: number) {
    super(code, `finish refused for number ${bibNumber}`, ["bib"]);
    this.name = "FinishError";
    this.bibNumber = bibNumber;
    this.gunTimeMs = gunTimeMs;
  }
}

/** How long after the gun «Sosire» still stamps a time: a day. Later, the results are written on «Clasament». */
export const FINISH_WINDOW_MS = 24 * 3_600_000;

export type FinishRecorded = { bibNumber: number; name: string | null; gunTimeMs: number; positionOverall: number | null };

/** The gun the finish line counts from: the race's own start when the club stated one, else when the event begins. */
export function gunOf(event: Pick<EventFacts, "startsAt" | "raceStartsAt">): Date {
  return event.raceStartsAt ?? event.startsAt;
}

/**
 * «Sosire» (§NNN): one race number typed as the runner crosses the line, and the site stamps the time since the gun — `now` minus
 * `raceStartsAt ?? startsAt`, to the millisecond — as that runner's «Sosit». The same rules as a line of «Clasament»: whoever enters results
 * (FORBIDDEN otherwise), a race only (`RESULTS_NOT_OPEN`), after the gun (`RESULT_FINISH_NOT_STARTED`), a number a **confirmed** registration
 * holds (`RESULT_BIB_UNKNOWN` otherwise, carrying the stamped time so the volunteer writes it down and the runner is typed on «Clasament»
 * later), within a day of the gun (`RESULT_FINISH_CLOSED`), not already finished (`RESULT_ALREADY_FINISHED`, carrying the time stored: a correction is «Clasament»'s). A runner stored as
 * «Abandon», «Neprezentat» or «Descalificat» by mistake who crosses the line becomes «Sosit» with the stamped time. One audit row as the
 * save writes it (`event_result.created` or `.updated`, the number and the times, never a name); the whole list is ranked again and
 * the public cache told, so a published ranking shows the finisher at once.
 */
export async function recordFinish<T extends Record<string, unknown>>(db: Database<T>, actor: Actor, request: { eventId: string; bibNumber: number }, now: Date): Promise<FinishRecorded> {
  assertMayEnter(actor);
  assertIds(request.eventId);
  if (!Number.isInteger(request.bibNumber) || request.bibNumber <= 0) throw new DomainError("VALIDATION_ERROR", "the race number is not a whole number", ["bib"]);
  const recorded = await db.transaction(async (tx): Promise<FinishRecorded> => {
    const event = await loadEvent(tx, request.eventId, true);
    if (!eventTakesResults(event.type)) throw new DomainError("RESULTS_NOT_OPEN", "only a race takes results");
    const gun = gunOf(event);
    if (now.getTime() <= gun.getTime()) throw new DomainError("RESULT_FINISH_NOT_STARTED", "the race has not started yet");
    // A day after the gun nobody is crossing a line: a late press is a mistake, and the time would not fit the column anyway (`RESULT_FINISH_CLOSED`).
    if (now.getTime() - gun.getTime() > FINISH_WINDOW_MS) throw new DomainError("RESULT_FINISH_CLOSED", "the finish line closed a day after the gun");
    // Stamped to the second: a line's clock reads seconds, and so does the ranking's time box.
    const gunTimeMs = Math.max(1000, Math.floor((now.getTime() - gun.getTime()) / 1000) * 1000);
    const [runners, stored] = await Promise.all([loadRegisteredRunners(tx, event.id), loadStored(tx, event.id, true)]);
    const runner = runners.byBib.get(request.bibNumber);
    if (!runner || runner.status !== "CONFIRMED") throw new FinishError("RESULT_BIB_UNKNOWN", request.bibNumber, gunTimeMs);
    const claim = claimOf(runner, indexStored(stored, runners));
    const before = claim.attached ? claim.row : undefined;
    if (before && before.status === "FINISHED") throw new FinishError("RESULT_ALREADY_FINISHED", request.bibNumber, before.gunTimeMs ?? gunTimeMs);

    let rows: EventResultRow[];
    if (before) {
      // A runner written off by mistake who crosses the line: the row becomes «Sosit» at the stamped time; the chip time and the note stay.
      const [updated] = await tx
        .update(eventResults)
        .set({ status: "FINISHED", gunTimeMs, bibNumber: request.bibNumber, updatedAt: now, updatedByStaffUserId: actor.id })
        .where(eq(eventResults.id, before.id))
        .returning();
      rows = stored.map((row) => (row.id === before.id ? updated : row));
      await recordAuditEvent(tx, {
        actorStaffUserId: actor.id,
        action: "event_result.updated",
        entityType: "event",
        entityId: event.id,
        metadata: { bibNumber: request.bibNumber, status: "FINISHED", gunTimeMs, chipTimeMs: before.chipTimeMs, changed: ["time", "status"], finishLine: true },
        now,
      });
    } else {
      const [inserted] = await tx
        .insert(eventResults)
        .values({ eventId: event.id, registrationId: runner.registrationId, bibNumber: request.bibNumber, status: "FINISHED", gunTimeMs, createdAt: now, updatedAt: now, updatedByStaffUserId: actor.id })
        .returning();
      rows = [...stored, inserted];
      await recordAuditEvent(tx, {
        actorStaffUserId: actor.id,
        action: "event_result.created",
        entityType: "event",
        entityId: event.id,
        metadata: { bibNumber: request.bibNumber, status: "FINISHED", gunTimeMs, chipTimeMs: null, finishLine: true },
        now,
      });
    }
    await writeRanking(tx, event, runners, rows);
    const ranked = rankingOf(rows, runners.byRegistration, event).get(request.bibNumber);
    return { bibNumber: request.bibNumber, name: runner.displayName, gunTimeMs, positionOverall: ranked?.positionOverall ?? null };
  });
  revalidatePublicContent("events", "places");
  return recorded;
}

/** One line of «Ultimii sosiți»: the number, the name as the backoffice sees it, the time and the overall place from the live answers. */
export type RecentFinisher = { bibNumber: number; name: string | null; gunTimeMs: number; positionOverall: number | null; recordedAt: Date };

export type FinishPageView = {
  event: EventFacts;
  /** The finishers, the latest recorded first, at most `limit`. */
  recent: RecentFinisher[];
  /** How many have finished, and how many registered runners hold a number. */
  finished: number;
  withNumber: number;
};

/** The «Sosire» page's data (§NNN), for whoever may enter results: the event, the latest finishers and the two counts. */
export async function readFinishPage<T extends Record<string, unknown>>(db: Database<T>, actor: Actor, eventId: string, limit: number): Promise<FinishPageView> {
  assertMayEnter(actor);
  assertIds(eventId);
  const event = await loadEvent(db, eventId, false);
  const { ranking, runners } = await loadLiveRanking(db, event);
  const stored = await loadStored(db, eventId, false);
  const finished = stored.filter((row) => row.status === "FINISHED" && row.gunTimeMs !== null);
  const recent = finished
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime() || b.bibNumber - a.bibNumber)
    .slice(0, limit)
    .map((row): RecentFinisher => ({
      bibNumber: row.bibNumber,
      name: row.registrationId !== null ? (runners.byRegistration.get(row.registrationId)?.displayName ?? null) : row.displayName,
      gunTimeMs: row.gunTimeMs as number,
      positionOverall: ranking.get(row.bibNumber)?.positionOverall ?? null,
      recordedAt: row.updatedAt,
    }));
  return { event, recent, finished: finished.length, withNumber: runners.byBib.size };
}

// ---- Publishing -------------------------------------------------------------------------------------------

/**
 * «Clasamentul e public pe pagina evenimentului» (§808): the Administrator's switch, the disclosure itself. Refused for any other role
 * (FORBIDDEN). **Switching it on is refused** until the race has started (`RESULTS_NOT_STARTED`: the notice says the results appear «doar
 * după cursă»), while the privacy notice in force, in every language, does not name `{{results}}` (`RESULTS_NOTICE`) — the club's
 * approval of the text is what lets a result reach the page, as for the list's states (§396) — and while the terms in force do not
 * (`RESULTS_TERMS`: the older terms promised to ask separately before a named result); switching it off never is. A press that changes nothing writes and records nothing. The moment of the last switching on is kept, and the cache is told.
 */
export async function setResultsPublished<T extends Record<string, unknown>>(db: Database<T>, actor: Actor, eventId: string, on: boolean, now: Date): Promise<{ changed: boolean }> {
  if (!canPublishResults(actor.role)) throw new DomainError("FORBIDDEN", `role ${actor.role} may not publish a race's results`);
  assertIds(eventId);
  const outcome = await db.transaction(async (tx) => {
    const event = await loadEvent(tx, eventId, true);
    if (event.resultsPublished === on) return { changed: false };
    if (on) {
      if (!eventTakesResults(event.type)) throw new DomainError("RESULTS_NOT_OPEN", "only a race takes results");
      // The notice promises the results appear only after the race: entering them stays open before the gun, publishing does not.
      if (event.startsAt.getTime() > now.getTime()) throw new DomainError("RESULTS_NOT_STARTED", "the race has not started yet");
      if (!(await noticeDescribesResults(tx, now))) throw new DomainError("RESULTS_NOTICE", "the privacy notice in force does not describe the results");
      // The terms a runner accepted promised «te vom întreba separat» before any named result: the club approves the new terms first.
      if (!(await termsDescribeResults(tx, now))) throw new DomainError("RESULTS_TERMS", "the terms in force do not describe the results");
    }
    await tx.update(events).set({ resultsPublished: on, resultsPublishedAt: on ? now : null }).where(eq(events.id, event.id));
    await recordAuditEvent(tx, { actorStaffUserId: actor.id, action: on ? "event_results.published" : "event_results.unpublished", entityType: "event", entityId: event.id, metadata: {}, now });
    return { changed: true };
  });
  if (outcome.changed) revalidatePublicContent("events", "places");
  return outcome;
}

/**
 * «Categorii de vârstă» (§NNN): the ages the race's categories start at, saved by whoever enters results (FORBIDDEN otherwise), on a race
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
};

const STATUS_ORDER: Record<ResultStatus, number> = { FINISHED: 0, DNF: 1, DSQ: 2, DNS: 3 };

/** The list in the order a results sheet reads: the finishers by position, then the others by state and number. */
function sheetOrder<T extends { status: ResultStatus; positionOverall: number | null; bibNumber: number }>(rows: T[]): T[] {
  return rows.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || (a.positionOverall ?? 0) - (b.positionOverall ?? 0) || a.bibNumber - b.bibNumber);
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
  /** The ages the race's categories start at (§NNN), so the page says each category's band in words. */
  ageBandStarts: readonly number[];
};

/**
 * What the event page shows of a race's results (§808) — for the page lane, the public list's rule extended: **nothing** unless the
 * Administrator published them (`events.results_published`), the privacy notice **and** the terms in force describe them
 * (`noticeDescribes`, `termsDescribe`, the cached reads, passed in), the race is a race, **it has started**, and the public list's
 * period has not passed (`publicListStillOpen`, §421, checked here at request time because a date passing is no write). Then every
 * stored row, in the sheet's order, ranked from the live answers, with a name **only** for a runner `publicResultName` names: the
 * public list's own conditions (confirmed, ticked, not a hidden special guest, §743) and a registration made under a notice that
 * described the results (`firstResultsNoticeVersion`, §421's line), or a runner typed by hand whom the staff recorded as agreeing to appear by name
 * under a notice that described the results — everyone else is «Participant #bib». Never an address, a phone
 * number, a document, a note or a registration's id: the select names its columns.
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
  const event: EventFacts = { ...found, resultAgeBands: ageBandStartsOf(found.resultAgeBands) };
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
      registrationStatus: registrations.status,
      outsideCapacity: registrations.outsideCapacity,
      noticeVersion: registrations.privacyNoticeVersion,
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

  const shown = rows.map((row): PublicResultRow => {
    const registered = row.registrationId !== null && row.listOptOut !== null;
    const ranked = ranking.get(row.bibNumber) as Ranked;
    return {
      bibNumber: row.bibNumber,
      name: publicResultName({
        registered,
        ticked: row.listOptOut === false,
        displayName: row.registeredName,
        confirmed: row.registrationStatus === "CONFIRMED",
        hidden: row.outsideCapacity === true && !hiddenShown,
        noticeVersion: row.noticeVersion,
        firstResultsNoticeVersion: options.firstResultsNoticeVersion,
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
