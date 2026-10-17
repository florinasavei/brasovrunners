import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { eventResults, type EventResultRow } from "@/db/schema/event-results";
import { events } from "@/db/schema/events";
import { registrations, type RegistrationSex } from "@/db/schema/registrations";
import type { StaffUser } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import { type AuditAction, recordAuditEvent } from "@/modules/audit/repository";
import { type Deadlines, publicListClosesAt, publicListStillOpen } from "@/modules/deadlines/domain/deadlines";
import { noticeDescribesResults } from "@/modules/legal-documents/repository";
import { revalidatePublicContent } from "@/modules/public-cache/cache";
import { ageOnRaceDay, dayIn } from "@/modules/registrations/domain/age";
import { type SexChoice, sexShown } from "@/modules/registrations/domain/sex";
import { canEnterResults, canPublishResults } from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";
import { isUuid } from "@/shared/ids";
import { eventTakesResults } from "./domain/event-type";
import { type FingerprintedResult, resultsFingerprint } from "./domain/fingerprint";
import { parseResultsCsv } from "./domain/import-csv";
import { publicResultName } from "./domain/public-name";
import { type Rankable, RESULTS_MAX, rankResults, type ResultStatus, type Ranked } from "./domain/ranking";
import { type ReadRow, type ResultRowProblem, readResultRow } from "./domain/row-input";
import { type PostedResultRow, resultBox } from "./rows";

/**
 * A race's results, part 1 (§NNN; the owner, 2026-10-17: «Aș vrea să pot pune și clasament la final după cursă»): the rows entered or
 * imported in the backoffice, ranked, and — only when an Administrator publishes them and the privacy notice in force describes
 * them — read by the event page.
 *
 * **Who.** The Organizer, the Administrator and the Superadministrator enter, import, rank and read (`canEnterResults`); the
 * Administrator and the Superadministrator alone publish (`canPublishResults`). The Tehnic role, the Redactor, the desk Volunteer
 * and a member are refused here, whatever the page drew (BR-REQ-060-01). **Nothing about a registration changes**: a result reads
 * the registration's name, sex and birth date and writes none of them; no state, no place, no number moves.
 *
 * **One race, one list.** Only a `RACE` takes results (`RESULTS_NOT_OPEN` for any other type). A row is a race number: found among
 * the event's registrations (any state, never a test row) it is that runner's, taking the registration's name, sex and age at read;
 * not found, it is a runner the club typed by hand and needs a name. «Salvează tot clasamentul» is the whole list — a row left out is a
 * result removed — saved in **one transaction** or not at all: the first refused row refuses the save, naming it (`ResultRowError`,
 * §791's pattern), and a form drawn before another session saved is refused with CONFLICT (`resultsFingerprint`).
 *
 * **Rankings are computed on save and stored** (`domain/ranking.ts`): overall among the finishers by gun time, by sex, and by
 * category — the sex and the age band on the event's day, `statistics.ts`' own bands (§787). Ties share a position and the next
 * skips. One audit row per result created, changed or deleted (`event_result.*`: the number, the state, the times and the names of the
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
};

type EventFacts = { id: string; type: string; startsAt: Date; endsAt: Date | null; timezone: string; resultsPublished: boolean; resultsPublishedAt: Date | null };

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
      endsAt: events.endsAt,
      timezone: events.timezone,
      resultsPublished: events.resultsPublished,
      resultsPublishedAt: events.resultsPublishedAt,
    })
    .from(events)
    .where(eq(events.id, eventId))
    .limit(1);
  const [event] = await (lock ? query.for("no key update") : query);
  if (!event) throw new DomainError("NOT_FOUND", "the event is not there");
  return event;
}

/** The registrations of the event that hold a race number — any state, never a test row — by that number. */
async function loadRegisteredRunners<T extends Record<string, unknown>>(db: Database<T>, eventId: string): Promise<Map<number, RegisteredRunner>> {
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
    })
    .from(registrations)
    .where(and(eq(registrations.eventId, eventId), eq(registrations.kind, "REAL"), isNotNull(registrations.bibNumber)));
  const runners = new Map<number, RegisteredRunner>();
  for (const row of rows) {
    if (row.bibNumber === null) continue;
    runners.set(row.bibNumber, {
      registrationId: row.registrationId,
      bibNumber: row.bibNumber,
      displayName: row.displayName,
      sex: sexShown(row.sex),
      birthDate: row.birthDate,
      ticked: !row.listOptOut,
      checkedIn: row.checkedInAt !== null,
      status: row.status,
    });
  }
  return runners;
}

async function loadStored<T extends Record<string, unknown>>(db: Database<T>, eventId: string, lock: boolean): Promise<EventResultRow[]> {
  const query = db.select().from(eventResults).where(eq(eventResults.eventId, eventId)).orderBy(asc(eventResults.bibNumber));
  return lock ? query.for("update") : query;
}

const fingerprintOf = (rows: readonly EventResultRow[]) => resultsFingerprint(rows satisfies readonly FingerprintedResult[]);

/** The sex and the age on the race's day a result is ranked and categorised by: the registration's for a registered runner, the row's own for a typed one. */
function answersOf(row: { registrationId: string | null; sex: RegistrationSex | null; birthDate: string | null; bibNumber: number }, runners: ReadonlyMap<number, RegisteredRunner>, event: EventFacts) {
  const runner = row.registrationId !== null ? runners.get(row.bibNumber) : undefined;
  const sex = runner ? runner.sex : sexShown(row.sex);
  const birthDate = runner ? runner.birthDate : row.birthDate;
  return { sex, ageOnRaceDay: ageOnRaceDay(birthDate, event.startsAt, event.timezone) };
}

/** The rankings of a whole list, by bib (`rankResults`), with the answers read as above. */
function rankingOf(
  rows: readonly { bibNumber: number; registrationId: string | null; sex: RegistrationSex | null; birthDate: string | null; status: ResultStatus; gunTimeMs: number | null }[],
  runners: ReadonlyMap<number, RegisteredRunner>,
  event: EventFacts,
): Map<number, Ranked> {
  const rankable: Rankable[] = rows.map((row) => ({ bibNumber: row.bibNumber, status: row.status, gunTimeMs: row.gunTimeMs, ...answersOf(row, runners, event) }));
  return rankResults(rankable);
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
  /** Rows no registration holds the number of: typed by hand, or left nameless by an erased registration. */
  typed: ResultRunner[];
  /** What the stored rows were when this was read (`resultsFingerprint`): posted back with the form. */
  fingerprint: string;
  /** How many results of each state are stored, for the page's summary. */
  counts: Record<ResultStatus, number>;
};

function resultOf(row: EventResultRow): NonNullable<ResultRunner["result"]> {
  return {
    status: row.status,
    gunTimeMs: row.gunTimeMs,
    chipTimeMs: row.chipTimeMs,
    note: row.note,
    positionOverall: row.positionOverall,
    positionSex: row.positionSex,
    positionCategory: row.positionCategory,
    categoryKey: row.categoryKey,
  };
}

/**
 * The page's data (§NNN), for whoever may enter results: the event, every registered runner that holds a race number — those with a
 * stored result carry it — and every stored row no registration holds the number of. Refuses a role that may not (FORBIDDEN) and an
 * event that is not there (NOT_FOUND); an event that is not a race is read all the same, so the page can say a group run has none.
 */
export async function readEventResults<T extends Record<string, unknown>>(db: Database<T>, actor: Actor, eventId: string): Promise<EventResultsView> {
  assertMayEnter(actor);
  assertIds(eventId);
  const event = await loadEvent(db, eventId, false);
  const [runners, stored] = await Promise.all([loadRegisteredRunners(db, eventId), loadStored(db, eventId, false)]);
  const storedByBib = new Map(stored.map((row) => [row.bibNumber, row]));

  const registered: ResultRunner[] = [];
  for (const runner of runners.values()) {
    const row = storedByBib.get(runner.bibNumber) ?? null;
    // A runner whose registration did not reach «Confirmat» is on the page only if a result was already entered for the number.
    if (runner.status !== "CONFIRMED" && row === null) continue;
    registered.push({
      bibNumber: runner.bibNumber,
      name: runner.displayName,
      registered: true,
      ticked: runner.ticked,
      checkedIn: runner.checkedIn,
      sex: runner.sex,
      birthDate: null,
      ageOnRaceDay: ageOnRaceDay(runner.birthDate, event.startsAt, event.timezone),
      result: row ? resultOf(row) : null,
    });
  }
  registered.sort((a, b) => Number(b.checkedIn) - Number(a.checkedIn) || a.bibNumber - b.bibNumber);

  const typed: ResultRunner[] = stored
    .filter((row) => !runners.has(row.bibNumber))
    .map((row) => ({
      bibNumber: row.bibNumber,
      name: row.displayName,
      registered: false,
      ticked: null,
      checkedIn: false,
      sex: sexShown(row.sex),
      birthDate: row.birthDate,
      ageOnRaceDay: ageOnRaceDay(row.birthDate, event.startsAt, event.timezone),
      result: resultOf(row),
    }));

  const counts: Record<ResultStatus, number> = { FINISHED: 0, DNF: 0, DNS: 0, DSQ: 0 };
  for (const row of stored) counts[row.status] += 1;
  return { event, registered, typed, fingerprint: fingerprintOf(stored), counts };
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
  if (before.status !== after.status) changed.push("status");
  if (before.gunTimeMs !== after.gunTimeMs) changed.push("time");
  if (before.chipTimeMs !== after.chipTimeMs) changed.push("chip");
  if (before.note !== after.note) changed.push("note");
  if (before.displayName !== after.displayName) changed.push("name");
  if (before.sex !== after.sex) changed.push("sex");
  if (before.birthDate !== after.birthDate) changed.push("birthDate");
  if (before.registrationId !== after.registrationId) changed.push("registration");
  return changed;
}

/**
 * «Salvează tot clasamentul» (§NNN): the whole list of a race's results, by one staff member, in one transaction.
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
    const storedByBib = new Map(stored.map((row) => [row.bibNumber, row]));
    const eventDay = dayIn(event.startsAt, event.timezone);

    // ---- 1. Every row read, the first refused one refusing the save -------------------------------------
    type Prepared = ReadRow & { registrationId: string | null; displayName: string | null; sex: SexChoice | null; birthDate: string | null };
    const prepared = new Map<number, Prepared>();
    for (const posted of request.rows) {
      const registeredKey = posted.key.startsWith("r[");
      const read = readResultRow({ kind: registeredKey ? "registered" : "typed", bib: posted.bib, name: posted.name, sex: posted.sex, birthDate: posted.birthDate, time: posted.time, status: posted.status, chip: posted.chip, note: posted.note }, eventDay);
      if (read.kind === "blank") continue;
      if (read.kind === "refused") throw new ResultRowError(read.problem, boxesOf(posted.key, read.boxes), Number(posted.bib) > 0 ? Number(posted.bib) : null, runners.get(Number(posted.bib))?.displayName ?? null);
      const { row } = read;
      const runner = runners.get(row.bibNumber);
      const refuse = (problem: ResultRowProblem, ...boxes: string[]): never => {
        throw new ResultRowError(problem, boxesOf(posted.key, boxes), row.bibNumber, runner?.displayName ?? row.name);
      };
      if (prepared.has(row.bibNumber)) refuse("bibDuplicate", registeredKey ? "time" : "bib");
      if (prepared.size >= RESULTS_MAX) refuse("tooMany", registeredKey ? "time" : "bib");
      if (runner) {
        // A registered runner's name, sex and birth date are the registration's: nothing typed about them is kept.
        prepared.set(row.bibNumber, { ...row, registrationId: runner.registrationId, displayName: null, sex: null, birthDate: null });
        continue;
      }
      // A runner no registration holds the number of: typed by hand, so it needs a name — unless the row is already stored with none (an
      // erased registration's), which stays as it is.
      const existing = storedByBib.get(row.bibNumber);
      const keepsNoName = existing !== undefined && existing.registrationId === null && existing.displayName === null;
      if (row.name === null && !keepsNoName) refuse("nameMissing", registeredKey ? "time" : "name");
      prepared.set(row.bibNumber, { ...row, registrationId: null, displayName: row.name, sex: row.sex, birthDate: row.birthDate });
    }

    // ---- 2. The rankings of the list as it will be ------------------------------------------------------
    const ranking = rankingOf([...prepared.values()], runners, event);

    // ---- 3. The writes: created, changed, deleted, and the rows only the rankings moved ------------------
    let created = 0;
    let updated = 0;
    let deleted = 0;
    let rewritten = 0;
    const audit = (action: AuditAction, metadata: Record<string, unknown>) =>
      recordAuditEvent(tx, { actorStaffUserId: actor.id, action, entityType: "event", entityId: event.id, metadata, now });

    for (const [bibNumber, row] of prepared) {
      const ranked = ranking.get(bibNumber) as Ranked;
      const before = storedByBib.get(bibNumber);
      if (!before) {
        await tx.insert(eventResults).values({
          eventId: event.id,
          registrationId: row.registrationId,
          bibNumber,
          displayName: row.displayName,
          sex: row.sex,
          birthDate: row.birthDate,
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
        await audit("event_result.created", { bibNumber, status: row.status, gunTimeMs: row.gunTimeMs, chipTimeMs: row.chipTimeMs });
        continue;
      }
      const changedBoxes = changedBoxesOf(before, row);
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
          displayName: row.displayName,
          sex: row.sex,
          birthDate: row.birthDate,
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
        await audit("event_result.updated", { bibNumber, status: row.status, gunTimeMs: row.gunTimeMs, chipTimeMs: row.chipTimeMs, changed: changedBoxes });
      } else rewritten += 1;
    }
    const gone = stored.filter((row) => !prepared.has(row.bibNumber));
    if (gone.length > 0) {
      await tx.delete(eventResults).where(inArray(eventResults.id, gone.map((row) => row.id)));
      deleted = gone.length;
      for (const row of gone) await audit("event_result.deleted", { bibNumber: row.bibNumber, status: row.status });
    }

    const ranked = [...ranking.values()].filter((row) => row.positionOverall !== null).length;
    return { changed: created + updated + deleted > 0, created, updated, deleted, rewritten, ranked };
  });

  // The pages that show a list are told once, after the commit — also when only the positions moved (a registration's answer was corrected).
  if (result.changed || result.rewritten > 0) revalidatePublicContent("events", "places");
  return result;
}

/**
 * The row's own «Șterge» (§NNN, outside the big form like §791's delete): one result removed after a confirmation, the others'
 * positions recomputed, one audit row, the cache told. A number with no stored result is NOT_FOUND (a second press, another session
 * got there first) — the page says so and nothing is written.
 */
export async function deleteEventResult<T extends Record<string, unknown>>(db: Database<T>, actor: Actor, request: { eventId: string; bibNumber: number }, now: Date): Promise<void> {
  assertMayEnter(actor);
  assertIds(request.eventId);
  await db.transaction(async (tx) => {
    const event = await loadEvent(tx, request.eventId, true);
    const [runners, stored] = await Promise.all([loadRegisteredRunners(tx, event.id), loadStored(tx, event.id, true)]);
    const target = stored.find((row) => row.bibNumber === request.bibNumber);
    if (!target) throw new DomainError("NOT_FOUND", "there is no result for that number");
    await tx.delete(eventResults).where(eq(eventResults.id, target.id));
    await recordAuditEvent(tx, { actorStaffUserId: actor.id, action: "event_result.deleted", entityType: "event", entityId: event.id, metadata: { bibNumber: target.bibNumber, status: target.status }, now });
    const rest = stored.filter((row) => row.id !== target.id);
    const ranking = rankingOf(rest, runners, event);
    for (const row of rest) {
      const ranked = ranking.get(row.bibNumber) as Ranked;
      if (
        row.positionOverall === ranked.positionOverall &&
        row.positionSex === ranked.positionSex &&
        row.positionCategory === ranked.positionCategory &&
        row.categoryKey === ranked.categoryKey
      )
        continue;
      await tx
        .update(eventResults)
        .set({ positionOverall: ranked.positionOverall, positionSex: ranked.positionSex, positionCategory: ranked.positionCategory, categoryKey: ranked.categoryKey })
        .where(eq(eventResults.id, row.id));
    }
  });
  revalidatePublicContent("events", "places");
}

// ---- Publishing -------------------------------------------------------------------------------------------

/**
 * «Clasamentul e public pe pagina evenimentului» (§NNN): the Administrator's switch, the disclosure itself. Refused for any other role
 * (FORBIDDEN). **Switching it on is refused (`RESULTS_NOTICE`) while the privacy notice in force, in every language, does not name
 * `{{results}}`** — the club's approval of the text is what lets a result reach the page, as for the list's states (§396); switching it
 * off never is. A press that changes nothing writes and records nothing. The moment of the last switching on is kept, and the cache is told.
 */
export async function setResultsPublished<T extends Record<string, unknown>>(db: Database<T>, actor: Actor, eventId: string, on: boolean, now: Date): Promise<{ changed: boolean }> {
  if (!canPublishResults(actor.role)) throw new DomainError("FORBIDDEN", `role ${actor.role} may not publish a race's results`);
  assertIds(eventId);
  const outcome = await db.transaction(async (tx) => {
    const event = await loadEvent(tx, eventId, true);
    if (event.resultsPublished === on) return { changed: false };
    if (on) {
      if (!eventTakesResults(event.type)) throw new DomainError("RESULTS_NOT_OPEN", "only a race takes results");
      if (!(await noticeDescribesResults(tx, now))) throw new DomainError("RESULTS_NOTICE", "the privacy notice in force does not describe the results");
    }
    await tx.update(events).set({ resultsPublished: on, resultsPublishedAt: on ? now : null }).where(eq(events.id, event.id));
    await recordAuditEvent(tx, { actorStaffUserId: actor.id, action: on ? "event_results.published" : "event_results.unpublished", entityType: "event", entityId: event.id, metadata: {}, now });
    return { changed: true };
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
 * «Importă din CSV» (§NNN): a CSV or TSV read into rows (`parseResultsCsv`, `bib,time[,chip][,status]`, with a header or without) and
 * matched by race number to the event's registrations — any state, never a test row. **It writes nothing**: the page puts the rows in
 * the table's boxes, a number no registration holds becomes a row needing a typed name, and «Salvează tot clasamentul» is the one
 * thing that saves. A file with a bad line is refused whole, naming the line (`ResultsCsvError`, `RESULTS_IMPORT_INVALID`).
 */
export async function importResultsCsv<T extends Record<string, unknown>>(db: Database<T>, actor: Actor, eventId: string, text: string): Promise<ImportedResultRow[]> {
  assertMayEnter(actor);
  assertIds(eventId);
  const parsed = parseResultsCsv(text);
  const event = await loadEvent(db, eventId, false);
  if (!eventTakesResults(event.type)) throw new DomainError("RESULTS_NOT_OPEN", "only a race takes results");
  const runners = await loadRegisteredRunners(db, eventId);
  return parsed.map((row) => {
    const runner = runners.get(row.bibNumber);
    return { bibNumber: row.bibNumber, status: row.status, gunTimeMs: row.gunTimeMs, chipTimeMs: row.chipTimeMs, matched: runner !== undefined, name: runner?.displayName ?? null };
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
 * The race's results as a file's rows (§NNN), for whoever may enter them — names as the backoffice sees them: the registration's, the
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

/** One row of the public results (§NNN): a number, a name only for a runner who ticked, the times, the positions and the category. Never an address, a phone, a document, a note or a registration's id. */
export type PublicResultRow = {
  bibNumber: number;
  /** The registration's display name — only for a registered runner who ticked the list's box; null otherwise, and the page says «Participant #bib» (`anonymousResultLabel`). */
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
};

/**
 * What the event page shows of a race's results (§NNN) — for the page lane, the public list's rule extended: **nothing** unless the
 * Administrator published them (`events.results_published`), the privacy notice in force describes them (`noticeDescribes`, the cached
 * read, passed in), the race is a race and the public list's period has not passed (`publicListStillOpen`, §421, checked here at
 * request time because a date passing is no write). Then every stored row, in the sheet's order, with a name **only** for a registered
 * runner whose tick is on (`publicResultName`) — the same tick as the list's, withdrawn the same way — and never an address, a phone
 * number, a document, a note or a registration's id: the select names its columns.
 */
export async function readPublicEventResults<T extends Record<string, unknown>>(
  db: Database<T>,
  eventId: string,
  options: { now: Date; deadlines: Pick<Deadlines, "publicListDays">; noticeDescribes: boolean },
): Promise<PublicEventResults | null> {
  if (!isUuid(eventId) || !options.noticeDescribes) return null;
  const [event] = await db
    .select({ type: events.type, startsAt: events.startsAt, endsAt: events.endsAt, resultsPublished: events.resultsPublished, resultsPublishedAt: events.resultsPublishedAt })
    .from(events)
    .where(eq(events.id, eventId))
    .limit(1);
  if (!event || !event.resultsPublished || !eventTakesResults(event.type)) return null;
  if (!publicListStillOpen(event, options.now, options.deadlines)) return null;

  const rows = await db
    .select({
      bibNumber: eventResults.bibNumber,
      registrationId: eventResults.registrationId,
      registeredName: registrations.displayName,
      listOptOut: registrations.listOptOut,
      registeredSex: registrations.sex,
      typedSex: eventResults.sex,
      status: eventResults.status,
      gunTimeMs: eventResults.gunTimeMs,
      chipTimeMs: eventResults.chipTimeMs,
      positionOverall: eventResults.positionOverall,
      positionSex: eventResults.positionSex,
      positionCategory: eventResults.positionCategory,
      categoryKey: eventResults.categoryKey,
    })
    .from(eventResults)
    .leftJoin(registrations, and(eq(registrations.id, eventResults.registrationId), eq(registrations.kind, "REAL")))
    .where(eq(eventResults.eventId, eventId));

  const shown = rows.map((row): PublicResultRow => {
    const registered = row.registrationId !== null && row.listOptOut !== null;
    return {
      bibNumber: row.bibNumber,
      name: publicResultName({ registered, ticked: row.listOptOut === false, displayName: row.registeredName }),
      status: row.status,
      gunTimeMs: row.gunTimeMs,
      chipTimeMs: row.chipTimeMs,
      positionOverall: row.positionOverall,
      positionSex: row.positionSex,
      positionCategory: row.positionCategory,
      categoryKey: row.categoryKey,
      sex: registered ? sexShown(row.registeredSex) : sexShown(row.typedSex),
    };
  });
  return { rows: sheetOrder(shown), publishedAt: event.resultsPublishedAt, closesAt: publicListClosesAt(event, options.deadlines) };
}

/** How many results an event has stored, for the editor's summary line and the tasks' rows. */
export async function countEventResults<T extends Record<string, unknown>>(db: Database<T>, eventId: string): Promise<number> {
  const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(eventResults).where(eq(eventResults.eventId, eventId));
  return row?.count ?? 0;
}
