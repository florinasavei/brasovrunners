import { canEditClubTodo, canReadClubTodo } from "@/modules/club-todo/domain/club-todo";
import { DomainError } from "@/shared/errors/domain-error";
import type { StaffRole } from "@/modules/staff-identity/domain/roles";

/**
 * The checkpoints of a route (§NNN; the owner, 2026-10-13: «other things for the route: I need to put
 * checkpoints and limit times») — the pure part: the closed set of what a point offers, what a form
 * may post, what is refused and why, the order the list is read in, the cut-offs measured from the
 * start, and the rows the event page draws.
 *
 * Pure and free of the database and of React, so the rules are unit-tested without either and the
 * three readers — the editor's card, the event page's table, the bib's profile strip — cannot
 * disagree about them. `checkpoints.ts` beside this folder is the writer.
 *
 * **The cut-off is a time of the day in the event's own zone** (the column's comment says why): it
 * is read against the start's time of day — the race's gun when it has one (§71), else the event's
 * start. A cut-off earlier than that is before the start and refused — unless the race ends on the
 * next day (the event's end, «Durata»), when it is the next day's and a night race reads right. One
 * race is shorter than a day; a cut-off a whole day later cannot be said.
 */

/** What a checkpoint can have, most basic first: the order the glyphs and the words are drawn in. */
export const CHECKPOINT_KINDS = ["WATER", "FOOD", "FIRST_AID", "TIMING"] as const;
export type CheckpointKind = (typeof CHECKPOINT_KINDS)[number];

/** A name is a word or two on a table row and a card; the database holds the same bound. */
export const CHECKPOINT_NAME_MAX = 60;
/** The optional note under a name, per language; the database holds the same bound. */
export const CHECKPOINT_NOTE_MAX = 120;
/** More than this on one route is a list nobody reads; the editor refuses the thirty-first. */
export const CHECKPOINTS_MAX = 30;
/** The largest distance a column of `numeric(6,2)` holds. */
export const CHECKPOINT_KM_MAX = 9999.99;

/** One checkpoint as every reader has it: the km a number, the cut-off «HH:MM» or null. */
export type Checkpoint = {
  id: string;
  nameRo: string;
  nameEn: string;
  km: number;
  kinds: readonly CheckpointKind[];
  /** The time of the day in the event's zone, `HH:MM`, or null for no limit. */
  cutoff: string | null;
  noteRo: string | null;
  noteEn: string | null;
};

/** What the editor posts for one row, before any rule is applied: strings as typed. */
export type PostedCheckpoint = {
  /** The row's id when it is a saved one; "" for a new row. */
  id: string;
  nameRo: string;
  nameEn: string;
  km: string;
  kinds: readonly string[];
  cutoff: string;
  noteRo: string;
  noteEn: string;
  /** «Scoate» ticked on a saved row. */
  remove: boolean;
  /** The row's number in the form, for naming a box the refusal is about. */
  index: number;
};

/** A row after the rules, ready to write: no id for a new row. */
export type CheckpointInput = Omit<Checkpoint, "id"> & { id: string | null };

// ---------------------------------------------------------------------------------------------
// Who may read and who may write (BR-REQ-060-01: asserted by the service, not by a hidden button)
// ---------------------------------------------------------------------------------------------

/**
 * Reading the list: every role that opens the event editor — the same set as the editor's to-dos
 * and the club's checklist (§438, §749), by the same function, so moving that boundary moves this one.
 */
export function canReadCheckpoints(role: StaffRole): boolean {
  return canReadClubTodo(role);
}

/**
 * Writing it: the Organizer, the Administrator and the Superadministrator. The Organizer prepares
 * the race on the ground — where the water is, by when the last runner has to pass — which is the
 * preparation §542 left with them rather than the event's settings it took away; the Tehnic and the
 * Redactor read it and ask.
 */
export function canEditCheckpoints(role: StaffRole): boolean {
  return canEditClubTodo(role);
}

// ---------------------------------------------------------------------------------------------
// A refusal, with the reason the form says
// ---------------------------------------------------------------------------------------------

/** The sentences the editor can answer a refusal with: `Admin.errors.<reason>`. */
export const CHECKPOINT_REASONS = [
  "CHECKPOINT_NAME_MISSING",
  "CHECKPOINT_KM_INVALID",
  "CHECKPOINT_KM_BEYOND_ROUTE",
  "CHECKPOINT_KIND_UNKNOWN",
  "CHECKPOINT_CUTOFF_INVALID",
  "CHECKPOINT_CUTOFF_BEFORE_START",
  "CHECKPOINT_CUTOFF_AFTER_LATER",
  "CHECKPOINT_CUTOFF_AFTER_END",
  "CHECKPOINT_NOTE_ONE_LANGUAGE",
  "CHECKPOINT_TOO_MANY",
] as const;
export type CheckpointReason = (typeof CHECKPOINT_REASONS)[number];

/** A placeholder said in each language: a point's name, a kilometre with the language's decimal mark. */
export type RefusalWords = { ro: string; en: string };

/**
 * A validation error that knows which sentence of the catalogue says it and what that sentence
 * needs filled in (`{max}`, `{name}`): the action returns `reason` as the form's error code and
 * `valuesIn(locale)` as its placeholders (`FormOutcome.errorValues`), the boxes it names as its
 * fields. A point's name and a kilometre are carried in both languages, so the English backoffice
 * names the point in English and writes «21.1», the Romanian one «21,1».
 */
export class CheckpointRefusal extends DomainError {
  readonly words: Readonly<Record<string, string | RefusalWords>>;
  constructor(
    readonly reason: CheckpointReason,
    words: Readonly<Record<string, string | RefusalWords>>,
    fields: readonly string[],
  ) {
    super("VALIDATION_ERROR", reason, fields);
    this.name = "CheckpointRefusal";
    this.words = words;
  }

  /** The placeholders in one language. */
  valuesIn(locale: "ro" | "en"): Record<string, string> {
    return Object.fromEntries(Object.entries(this.words).map(([key, value]) => [key, typeof value === "string" ? value : value[locale]]));
  }

  /** The placeholders in Romanian, the platform's default language. */
  get values(): Record<string, string> {
    return this.valuesIn("ro");
  }
}

/** A minute of the day as `HH:MM`, wrapping past midnight. */
export function clockTimeOf(minutes: number): string {
  const wrapped = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(wrapped / 60)).padStart(2, "0")}:${String(wrapped % 60).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------------------------
// The posted row, read
// ---------------------------------------------------------------------------------------------

/** The boxes' names: `cp[3].km` — the row's number in the form, so a refusal links to the box. */
export const checkpointBox = (index: number, field: "id" | "nameRo" | "nameEn" | "km" | "kinds" | "cutoff" | "noteRo" | "noteEn" | "remove"): string =>
  `cp[${index}].${field}`;

/** The whole of a row's text, folded: one line, no run of spaces. */
const oneLine = (value: string): string => value.replace(/\s+/g, " ").trim();

/**
 * A kilometre as typed — «12,5», «12.5», «12.50 km» — read to a number with two decimals, or null.
 * A comma is a Romanian decimal point; anything that is not a plain non-negative number is refused.
 */
export function readKm(value: string): number | null {
  const cleaned = value.trim().replace(/\s*km$/i, "").replace(",", ".");
  if (!/^\d{1,4}(?:\.\d{1,2})?$/.test(cleaned) && !/^\d{1,4}\.$/.test(cleaned)) return null;
  const km = Math.round(Number(cleaned) * 100) / 100;
  return Number.isFinite(km) && km >= 0 && km <= CHECKPOINT_KM_MAX ? km : null;
}

/** A time of the day as `HH:MM`, from `H:MM`, `HH:MM` or the database's `HH:MM:SS`; null for anything else. */
export function readClockTime(value: string): string | null {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d(?:\.\d+)?)?$/.exec(value.trim());
  return match ? `${match[1].padStart(2, "0")}:${match[2]}` : null;
}

/** Minutes since midnight of a `HH:MM` time of day. */
export function clockMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

/** A row nobody typed in: the spare rows at the foot of the card post nothing but their number. */
export function isBlankPosted(row: PostedCheckpoint): boolean {
  return row.id === "" && [row.nameRo, row.nameEn, row.km, row.cutoff, row.noteRo, row.noteEn].every((value) => value.trim() === "") && row.kinds.length === 0;
}

// ---------------------------------------------------------------------------------------------
// What the rules are measured against
// ---------------------------------------------------------------------------------------------

/**
 * What the event says that a checkpoint is measured against: the route's length, the start's time
 * of the day (the gun's, else the event's) and how long the event lasts after it. Each is null when
 * the event does not say — a rule that needs it is then not applied, never guessed.
 */
export type CheckpointContext = {
  /** The route's length in kilometres: the distance the club typed, else the GPX's. */
  routeKm: number | null;
  /** The start's time of the day in the event's zone, in minutes since midnight. */
  startMinutes: number | null;
  /** Minutes from that start to the event's end («Durata»): the time limit the finish row says. */
  limitMinutes: number | null;
};

/**
 * The context an event gives: the route's length in kilometres from the typed distance (§598) or the
 * track's, the start's minute of the day and the span to the event's end — all read on the event's
 * own clock. `wallMinutesOf` is the caller's conversion of an instant to minutes since midnight in
 * the event's zone (`events/domain/zoned-time.ts#toWallTimeInput`), passed in so this stays pure.
 */
export function checkpointContext(input: {
  distanceMeters: number | null;
  gpxMeters: number | null;
  /** The start the cut-offs count from — the gun's, else the event's — or null while its hour is not typed. */
  start: Date | null;
  endsAt: Date | null;
  wallMinutesOf: (instant: Date) => number;
}): CheckpointContext {
  const meters = input.distanceMeters && input.distanceMeters > 0 ? input.distanceMeters : input.gpxMeters && input.gpxMeters > 0 ? input.gpxMeters : null;
  const startMinutes = input.start ? input.wallMinutesOf(input.start) : null;
  let limit: number | null = null;
  if (input.start && input.endsAt && startMinutes !== null) {
    const real = Math.round((input.endsAt.getTime() - input.start.getTime()) / 60_000);
    /*
      On the clock, not in elapsed minutes: the cut-offs are times of the day, so the end is too. On
      the night the clocks go back (or forward) the two differ by the hour moved, and a cut-off after
      the finish closes would otherwise pass (§NNN). The wall-clock span is the one nearest the real
      one whose minute of the day is the end's.
    */
    const drift = (((input.wallMinutesOf(input.endsAt) - startMinutes - real) % 1440) + 1440 + 720) % 1440 - 720;
    limit = real + drift;
  }
  return {
    routeKm: meters === null ? null : meters / 1000,
    startMinutes,
    limitMinutes: limit !== null && limit > 0 ? limit : null,
  };
}

/**
 * How many minutes after the start a cut-off falls, or the time of the day itself while the start is
 * not known (nothing to count from).
 *
 * **A cut-off earlier than the start's time of day is the next day's only for a race that crosses
 * midnight** — one whose end, `limitMinutes` after the start, is on the next day — and a night race
 * says so by its end. For every other event it is before the start: negative, which the rule that asks
 * for a positive offset refuses. One equal to the start's time is zero minutes — a cut-off nobody could
 * meet — and is refused the same way. With no end given the race is taken to end the day it starts.
 */
export function cutoffOffset(cutoff: string, startMinutes: number | null, limitMinutes: number | null = null): number {
  const minutes = clockMinutes(cutoff);
  if (startMinutes === null) return minutes;
  const crossesMidnight = limitMinutes !== null && startMinutes + limitMinutes >= 1440;
  return crossesMidnight ? (((minutes - startMinutes) % 1440) + 1440) % 1440 : minutes - startMinutes;
}

/** The checkpoints by distance, ties in the order they were typed: the order every reader draws. */
export function sortedByKm<T extends { km: number }>(rows: readonly T[]): T[] {
  return rows.map((row, at) => ({ row, at })).sort((a, b) => a.row.km - b.row.km || a.at - b.at).map(({ row }) => row);
}

// ---------------------------------------------------------------------------------------------
// The rules
// ---------------------------------------------------------------------------------------------

function kindsOf(posted: readonly string[]): CheckpointKind[] | null {
  const known = new Set<string>(CHECKPOINT_KINDS);
  if (posted.some((kind) => !known.has(kind))) return null;
  // The closed set's own order, each once, whatever order the boxes were ticked in.
  return CHECKPOINT_KINDS.filter((kind) => posted.includes(kind));
}

/**
 * The posted rows as rows to write, in distance order, or the first thing wrong with them as a
 * `CheckpointRefusal` naming the box. A blank spare row and a row marked «Scoate» are not rows; the
 * rest are held to:
 *
 * - a name in both languages, at most `CHECKPOINT_NAME_MAX` each;
 * - a distance from 0, at most the route's length when the event has one — **a distance beyond the
 *   route is refused with the reason** and the length, in kilometres;
 * - only the closed set's kinds;
 * - a cut-off that is a time of the day, **after the start** (when the event's start has an hour)
 *   and **not after the cut-off of a checkpoint further along** — a runner is held at kilometre 10
 *   no later than at kilometre 20 — and not after the event's end when it has one;
 * - a note in both languages or in neither, at most `CHECKPOINT_NOTE_MAX` each;
 * - at most `CHECKPOINTS_MAX` rows.
 *
 * Refused in order of the rows as typed, so the first box the club reads is the first to fix.
 */
export function prepareCheckpoints(posted: readonly PostedCheckpoint[], context: CheckpointContext): CheckpointInput[] {
  const rows = posted.filter((row) => !isBlankPosted(row) && !row.remove);
  if (rows.length > CHECKPOINTS_MAX) {
    throw new CheckpointRefusal("CHECKPOINT_TOO_MANY", { max: String(CHECKPOINTS_MAX) }, []);
  }
  const prepared: (CheckpointInput & { index: number; label: RefusalWords })[] = [];
  for (const row of rows) {
    const nameRo = oneLine(row.nameRo);
    const nameEn = oneLine(row.nameEn);
    const label = labelOf(nameRo, nameEn, row.km);
    const missing = [nameRo === "" ? checkpointBox(row.index, "nameRo") : null, nameEn === "" ? checkpointBox(row.index, "nameEn") : null].filter(
      (box): box is string => box !== null,
    );
    if (missing.length > 0 || nameRo.length > CHECKPOINT_NAME_MAX || nameEn.length > CHECKPOINT_NAME_MAX) {
      throw new CheckpointRefusal(
        "CHECKPOINT_NAME_MISSING",
        { max: String(CHECKPOINT_NAME_MAX), name: label },
        missing.length > 0 ? missing : [checkpointBox(row.index, nameRo.length > CHECKPOINT_NAME_MAX ? "nameRo" : "nameEn")],
      );
    }
    const km = readKm(row.km);
    if (km === null) throw new CheckpointRefusal("CHECKPOINT_KM_INVALID", { name: label }, [checkpointBox(row.index, "km")]);
    // The route's length is said to the hundredth of a kilometre, rounded up: a distance typed in
    // metres (21 097) must not refuse the 21.10 the finish stands at.
    if (context.routeKm !== null && km > Math.ceil(context.routeKm * 100) / 100) {
      throw new CheckpointRefusal("CHECKPOINT_KM_BEYOND_ROUTE", { name: label, km: kmWords(km), max: kmWords(context.routeKm) }, [checkpointBox(row.index, "km")]);
    }
    const kinds = kindsOf(row.kinds);
    if (kinds === null) throw new CheckpointRefusal("CHECKPOINT_KIND_UNKNOWN", { name: label }, [checkpointBox(row.index, "kinds")]);
    let cutoff: string | null = null;
    if (row.cutoff.trim() !== "") {
      cutoff = readClockTime(row.cutoff);
      if (cutoff === null) throw new CheckpointRefusal("CHECKPOINT_CUTOFF_INVALID", { name: label }, [checkpointBox(row.index, "cutoff")]);
    }
    const noteRo = oneLine(row.noteRo);
    const noteEn = oneLine(row.noteEn);
    if ((noteRo === "") !== (noteEn === "") || noteRo.length > CHECKPOINT_NOTE_MAX || noteEn.length > CHECKPOINT_NOTE_MAX) {
      const emptyBox = noteRo === "" ? "noteRo" : noteEn === "" ? "noteEn" : noteRo.length > CHECKPOINT_NOTE_MAX ? "noteRo" : "noteEn";
      throw new CheckpointRefusal("CHECKPOINT_NOTE_ONE_LANGUAGE", { name: label, max: String(CHECKPOINT_NOTE_MAX) }, [checkpointBox(row.index, emptyBox)]);
    }
    prepared.push({
      id: row.id === "" ? null : row.id,
      nameRo,
      nameEn,
      km,
      kinds,
      cutoff,
      noteRo: noteRo === "" ? null : noteRo,
      noteEn: noteEn === "" ? null : noteEn,
      index: row.index,
      label,
    });
  }

  // The cut-offs, against the start, the end and each other — in the order a runner meets the points.
  const along = sortedByKm(prepared).filter((row) => row.cutoff !== null);
  let previous: { offset: number; name: RefusalWords; index: number } | null = null;
  for (const row of along) {
    const cutoff = row.cutoff as string;
    const offset = cutoffOffset(cutoff, context.startMinutes, context.limitMinutes);
    const name = row.label;
    if (context.startMinutes !== null && offset <= 0) {
      throw new CheckpointRefusal("CHECKPOINT_CUTOFF_BEFORE_START", { name, cutoff, start: clockTimeOf(context.startMinutes) }, [checkpointBox(row.index, "cutoff")]);
    }
    if (context.startMinutes !== null && context.limitMinutes !== null && offset > context.limitMinutes) {
      throw new CheckpointRefusal("CHECKPOINT_CUTOFF_AFTER_END", { name, cutoff, end: clockTimeOf(context.startMinutes + context.limitMinutes) }, [checkpointBox(row.index, "cutoff")]);
    }
    if (previous && offset < previous.offset) {
      // The earlier point's limit is later than this one's: the earlier point's box is the one linked.
      throw new CheckpointRefusal("CHECKPOINT_CUTOFF_AFTER_LATER", { name: previous.name, later: name, laterCutoff: cutoff }, [checkpointBox(previous.index, "cutoff")]);
    }
    previous = { offset, name, index: row.index };
  }
  return sortedByKm(prepared).map((row) => ({
    id: row.id,
    nameRo: row.nameRo,
    nameEn: row.nameEn,
    km: row.km,
    kinds: row.kinds,
    cutoff: row.cutoff,
    noteRo: row.noteRo,
    noteEn: row.noteEn,
  }));
}

/** A kilometre as each language writes it: up to two decimals, a comma in Romanian, a point in English. */
function kmWords(km: number): RefusalWords {
  const said = (locale: "ro" | "en") => new Intl.NumberFormat(locale, { maximumFractionDigits: 2, useGrouping: false }).format(km);
  return { ro: said("ro"), en: said("en") };
}

/**
 * What a refusal calls a row: its name in each language (the other language's while one is empty),
 * else its kilometre as typed — the box the club sees beside it — else «nou», a row with neither.
 */
function labelOf(nameRo: string, nameEn: string, typedKm: string): RefusalWords {
  if (nameRo !== "" || nameEn !== "") return { ro: nameRo || nameEn, en: nameEn || nameRo };
  const km = readKm(typedKm);
  if (km === null) return { ro: "nou", en: "new" };
  const said = kmWords(km);
  return { ro: `km ${said.ro}`, en: `km ${said.en}` };
}

// ---------------------------------------------------------------------------------------------
// What the event page draws
// ---------------------------------------------------------------------------------------------

/** One row of the page's table: a point, or the finish. */
export type CheckpointRow =
  | { kind: "point"; id: string; km: number; nameRo: string; nameEn: string; kinds: readonly CheckpointKind[]; cutoff: string | null; noteRo: string | null; noteEn: string | null }
  | { kind: "finish"; km: number | null; cutoff: string };

/**
 * The table «Puncte de control» as rows (§NNN): the checkpoints by distance and — **the finish as the
 * last row when the event has a time limit**, its limit being the event's end on the event's clock
 * (the `HH:MM` the caller formats from `endsAt`), at the route's length when the event has one.
 * Nothing at all with no checkpoints: the section is not drawn for a finish alone.
 */
export function checkpointRows(checkpoints: readonly Checkpoint[], finish: { km: number | null; limit: string | null }): CheckpointRow[] {
  if (checkpoints.length === 0) return [];
  const rows: CheckpointRow[] = sortedByKm(checkpoints).map((row) => ({
    kind: "point",
    id: row.id,
    km: row.km,
    nameRo: row.nameRo,
    nameEn: row.nameEn,
    kinds: row.kinds,
    cutoff: row.cutoff,
    noteRo: row.noteRo,
    noteEn: row.noteEn,
  }));
  if (finish.limit) rows.push({ kind: "finish", km: finish.km, cutoff: finish.limit });
  return rows;
}

/**
 * What changes a bib's drawing (§750), as one string: every checkpoint's distance, kinds and cut-off,
 * in order — folded into the stamp of what a picture is drawn from (`bib-stamp.ts`), so a new,
 * moved or retimed checkpoint is a new picture address and no old picture is served. The names are
 * not in it: the strip draws no name.
 */
export function checkpointsStampPart(checkpoints: readonly Pick<Checkpoint, "km" | "kinds" | "cutoff">[]): string {
  return sortedByKm(checkpoints)
    .map((row) => `${row.km.toFixed(2)}:${row.kinds.join("+")}:${row.cutoff ?? ""}`)
    .join("|");
}
