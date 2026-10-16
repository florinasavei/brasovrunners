import { durationShort } from "@/i18n/dates";
import { canEditClubTodo, canReadClubTodo } from "@/modules/club-todo/domain/club-todo";
import { DURATION_MAX_MINUTES, DURATION_MINUTES_CONSTRAINTS, joinDuration } from "@/modules/content/events/duration";
import { DomainError } from "@/shared/errors/domain-error";
import type { StaffRole } from "@/modules/staff-identity/domain/roles";

/**
 * The checkpoints of a route (§757; the owner, 2026-10-13: «other things for the route: I need to put
 * checkpoints and limit times») — the pure part: the closed set of what a point offers, what a form
 * may post, what is refused and why, the order the list is read in, the cut-offs measured from the
 * start, and the rows the event page draws.
 *
 * Pure and free of the database and of React, so the rules are unit-tested without either and the
 * three readers — the editor's card, the event page's table, the bib's profile strip — cannot
 * disagree about them. `checkpoints.ts` beside this folder is the writer.
 *
 * **The cut-off is a time limit, minutes from the start** (§770, reversing §757's first answer; the
 * column's comment says why): hours and minutes as the race's own «Timp limită» boxes take them,
 * counted from the race's gun when it has one (§71), else the event's start, the same instant the
 * event's own «Timp limită» counts from — so a point's limit is held against the event's as minutes
 * against minutes, with no clock arithmetic and no day to wrap. The clock a limit closes at is derived
 * from the start (`start.ts#cutoffClockOf`), never stored, and a time of day is read only from an
 * old file or an old row (`start.ts#minutesFromClock`).
 */

/**
 * What a checkpoint can have, most basic first: the order the glyphs and the words are drawn in.
 * «Direcționare» (§770) is last: a volunteer who shows the way at a junction, not something a runner takes.
 */
export const CHECKPOINT_KINDS = ["WATER", "FOOD", "FIRST_AID", "TIMING", "DIRECTION"] as const;
export type CheckpointKind = (typeof CHECKPOINT_KINDS)[number];

/** A name is a word or two on a table row and a card; the database holds the same bound. */
export const CHECKPOINT_NAME_MAX = 60;
/** The optional note under a name, per language; the database holds the same bound. */
export const CHECKPOINT_NOTE_MAX = 120;
/** More than this on one route is a list nobody reads; the editor refuses the thirty-first. */
export const CHECKPOINTS_MAX = 30;
/** The largest distance a column of `numeric(6,2)` holds. */
export const CHECKPOINT_KM_MAX = 9999.99;

/** One checkpoint as every reader has it: the km a number, the time limit in minutes from the start or null. */
export type Checkpoint = {
  id: string;
  nameRo: string;
  nameEn: string;
  km: number;
  kinds: readonly CheckpointKind[];
  /** Minutes from the start (the gun on a race that has one) by which the last runner has to be here, or null for no limit (§770). */
  cutoffMinutes: number | null;
  /**
   * The clock that limit closes at, `HH:MM` in the event's zone, read against the start the event has
   * now (`start.ts#cutoffClockOf`); null with no limit or while the start has no date or hour. Derived,
   * never stored: it follows the start.
   */
  cutoffClock: string | null;
  noteRo: string | null;
  noteEn: string | null;
  /** Whether the route's elevation profile draws this point (§802); the table lists it either way. */
  onProfile: boolean;
};

/** What the editor posts for one row, before any rule is applied: strings as typed. */
export type PostedCheckpoint = {
  /** The row's id when it is a saved one; "" for a new row. */
  id: string;
  nameRo: string;
  nameEn: string;
  km: string;
  kinds: readonly string[];
  /** «Timp limită», the race's own two boxes: hours and minutes as typed, both empty for no limit. */
  cutoffHours: string;
  cutoffMinutesPart: string;
  noteRo: string;
  noteEn: string;
  /**
   * «Arată pe profilul traseului» ticked (§802): a box that posts nothing when it is not, so the form also posts a marker
   * that it drew the box (`cp[i].onProfileShown`). **Null when the form did not carry the box** — a page drawn before the
   * tick existed, saved after it: the service then keeps what the point had (a new point: on), never reads «not posted» as
   * «unticked».
   */
  onProfile: boolean | null;
  /** «Scoate» ticked on a saved row. */
  remove: boolean;
  /** The row's number in the form, for naming a box the refusal is about. */
  index: number;
};

/** A row after the rules, ready to write: no id for a new row, no derived clock. */
export type CheckpointInput = Omit<Checkpoint, "id" | "cutoffClock"> & { id: string | null };

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
 * Redactor read it and ask. §757 amends §542 for this one list, and `roles.ts#canEditEventFields`
 * names it as the exception: the list reaches the public page and the bib, and every change is audited.
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
  "CHECKPOINT_CUTOFF_NO_START",
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

// ---------------------------------------------------------------------------------------------
// The posted row, read
// ---------------------------------------------------------------------------------------------

/** The boxes' names: `cp[3].km` — the row's number in the form, so a refusal links to the box. */
export const checkpointBox = (
  index: number,
  field: "id" | "nameRo" | "nameEn" | "km" | "kinds" | "cutoffHours" | "cutoffMinutesPart" | "noteRo" | "noteEn" | "onProfile" | "onProfileShown" | "remove",
): string => `cp[${index}].${field}`;

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

/**
 * «Timp limită» as the two boxes were typed (§770) — the race's own boxes, joined the way the race's are
 * (`duration.ts#joinDuration`): null for both empty (no limit), the minutes for a whole positive time of
 * at most a week, and `"hours"` / `"minutes"` for the box that is not one — sixty minutes or more, a
 * letter, a zero or a limit past the week — so a refusal names the box to fix.
 */
export function readTimeLimit(hours: string, minutes: string): number | null | "hours" | "minutes" {
  const joined = joinDuration(hours, minutes);
  if (joined === "") return null;
  const m = minutes.trim();
  // Only the minutes box left behind, a zero («1 h 0 min» with the hours cleared): the limit is removed, not a «0».
  if (hours.trim() === "" && /^0+$/.test(m)) return null;
  if (m !== "" && (!/^\d+$/.test(m) || Number(m) > (DURATION_MINUTES_CONSTRAINTS.max ?? 59))) return "minutes";
  if (!/^\d+$/.test(joined)) return "hours";
  const total = Number(joined);
  return total >= 1 && total <= DURATION_MAX_MINUTES ? total : "hours";
}

/** A row nobody typed in: the spare rows at the foot of the card post nothing but their number. */
export function isBlankPosted(row: PostedCheckpoint): boolean {
  return (
    row.id === "" &&
    [row.nameRo, row.nameEn, row.km, row.cutoffHours, row.cutoffMinutesPart, row.noteRo, row.noteEn].every((value) => value.trim() === "") &&
    row.kinds.length === 0
  );
}

// ---------------------------------------------------------------------------------------------
// What the rules are measured against
// ---------------------------------------------------------------------------------------------

/**
 * What the event says that a checkpoint is measured against: the route's length, whether the start
 * has a date and an hour to count a limit from (the gun's, else the event's) and how long the event
 * lasts after it. Each is null or false when the event does not say — a rule that needs it is then not
 * applied, never guessed; a limit with no start to count from is refused (§770).
 */
export type CheckpointContext = {
  /** The route's length in kilometres: the distance the club typed, else the GPX's. */
  routeKm: number | null;
  /** The start has a date and an hour: a time limit counts from it, and the clock it closes at can be said. */
  startKnown: boolean;
  /** Minutes from that start to the event's end («Timp limită» of a race, «Durata» of the rest): the longest limit a point may have. */
  limitMinutes: number | null;
  /**
   * Each saved point's limit by id. A row posted with the limit it already has keeps it while the start
   * is unknown — the club who marks the hour «se anunță mai târziu» can still save a note — and only a
   * new or changed limit is refused for want of a start.
   */
  savedMinutes?: ReadonlyMap<string, number | null>;
};

/**
 * The context an event gives: the route's length in kilometres from the typed distance (§598) or the
 * track's, whether the start is known, and the event's «Timp limită» in minutes. The limit is a
 * duration, so it is true with or without an hour on the start (`duration.ts#savedDurationMinutes` from
 * `durationBase`, or the file's own minutes): a point's limit is held to it even while the hour is to be
 * announced. Minutes are elapsed minutes, the same measure the race's «Timp limită» is stored in, so a
 * night the clocks change moves no limit and no comparison.
 */
export function checkpointContext(input: {
  distanceMeters: number | null;
  gpxMeters: number | null;
  /** The start the limits count from — the gun's, else the event's — or null while its hour is not typed. */
  start: Date | null;
  /** The event's «Timp limită» in minutes — known whether or not the start has an hour — or null when it has none. */
  limitMinutes: number | null;
  savedMinutes?: ReadonlyMap<string, number | null>;
}): CheckpointContext {
  const meters = input.distanceMeters && input.distanceMeters > 0 ? input.distanceMeters : input.gpxMeters && input.gpxMeters > 0 ? input.gpxMeters : null;
  return {
    routeKm: meters === null ? null : meters / 1000,
    startKnown: input.start !== null,
    limitMinutes: input.limitMinutes !== null && input.limitMinutes > 0 ? input.limitMinutes : null,
    savedMinutes: input.savedMinutes,
  };
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
 * - a time limit (§770): hours and minutes as the race's own boxes read them, positive; **needing a
 *   start to count from** (a new or changed limit with no date or hour on the start is refused), **not
 *   longer than the event's own «Timp limită»** and **not longer than the limit of a checkpoint
 *   further along** — a runner is held at kilometre 10 no later than at kilometre 20;
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
    const limit = readTimeLimit(row.cutoffHours, row.cutoffMinutesPart);
    if (limit === "hours" || limit === "minutes") {
      throw new CheckpointRefusal("CHECKPOINT_CUTOFF_INVALID", { name: label }, [checkpointBox(row.index, limit === "hours" ? "cutoffHours" : "cutoffMinutesPart")]);
    }
    // A limit counts from the start: with no date or hour on it there is nothing to count from — unless this row keeps the limit it had.
    if (limit !== null && !context.startKnown && !(row.id !== "" && context.savedMinutes?.get(row.id) === limit)) {
      throw new CheckpointRefusal("CHECKPOINT_CUTOFF_NO_START", { name: label }, [checkpointBox(row.index, "cutoffHours")]);
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
      cutoffMinutes: limit,
      noteRo: noteRo === "" ? null : noteRo,
      noteEn: noteEn === "" ? null : noteEn,
      onProfile: row.onProfile ?? true,
      index: row.index,
      label,
    });
  }

  // The limits, against the event's own and each other — in the order a runner meets the points: minutes against minutes.
  const along = sortedByKm(prepared).filter((row) => row.cutoffMinutes !== null);
  let previous: { minutes: number; name: RefusalWords; index: number } | null = null;
  for (const row of along) {
    const minutes = row.cutoffMinutes as number;
    const name = row.label;
    if (context.limitMinutes !== null && minutes > context.limitMinutes) {
      throw new CheckpointRefusal("CHECKPOINT_CUTOFF_AFTER_END", { name, cutoff: durationShort(minutes), limit: durationShort(context.limitMinutes) }, [
        checkpointBox(row.index, "cutoffHours"),
      ]);
    }
    if (previous && minutes < previous.minutes) {
      // The earlier point's limit is longer than this one's: the earlier point's box is the one linked.
      throw new CheckpointRefusal(
        "CHECKPOINT_CUTOFF_AFTER_LATER",
        { name: previous.name, cutoff: durationShort(previous.minutes), later: name, laterCutoff: durationShort(minutes) },
        [checkpointBox(previous.index, "cutoffHours")],
      );
    }
    previous = { minutes, name, index: row.index };
  }
  return sortedByKm(prepared).map((row) => ({
    id: row.id,
    nameRo: row.nameRo,
    nameEn: row.nameEn,
    km: row.km,
    kinds: row.kinds,
    cutoffMinutes: row.cutoffMinutes,
    noteRo: row.noteRo,
    noteEn: row.noteEn,
    onProfile: row.onProfile,
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
  | {
      kind: "point";
      id: string;
      km: number;
      nameRo: string;
      nameEn: string;
      kinds: readonly CheckpointKind[];
      cutoffMinutes: number | null;
      cutoffClock: string | null;
      noteRo: string | null;
      noteEn: string | null;
    }
  | { kind: "finish"; km: number | null; cutoffMinutes: number; cutoffClock: string };

/**
 * The table «Puncte de control» as rows (§757): the checkpoints by distance and — **the finish as the
 * last row when the event has a time limit**, its limit being the event's «Timp limită» in minutes and
 * the clock it closes at, the event's end on the event's clock (§770), at the route's length when the
 * event has one. Nothing at all with no checkpoints: the section is not drawn for a finish alone.
 */
export function checkpointRows(
  checkpoints: readonly Checkpoint[],
  finish: { km: number | null; limit: string | null; minutes: number | null },
): CheckpointRow[] {
  if (checkpoints.length === 0) return [];
  const rows: CheckpointRow[] = sortedByKm(checkpoints).map((row) => ({
    kind: "point",
    id: row.id,
    km: row.km,
    nameRo: row.nameRo,
    nameEn: row.nameEn,
    kinds: row.kinds,
    cutoffMinutes: row.cutoffMinutes,
    cutoffClock: row.cutoffClock,
    noteRo: row.noteRo,
    noteEn: row.noteEn,
  }));
  if (finish.limit && finish.minutes) rows.push({ kind: "finish", km: finish.km, cutoffMinutes: finish.minutes, cutoffClock: finish.limit });
  return rows;
}

/**
 * The checkpoints the elevation profile pins (§802; the owner, 2026-10-16: «select which ones to show on the elevation
 * profile»): the ones the club left ticked «Arată pe profilul traseului», by distance, each with its name in the page's
 * language. A row without the flag — a copy of the list kept by the public cache before the column existed — is on, as the
 * column's default is. The table «Puncte de control» never uses this: it lists every point.
 */
export function profileMarkers(
  checkpoints: readonly (Pick<Checkpoint, "km" | "kinds" | "nameRo" | "nameEn"> & { onProfile?: boolean })[],
  locale: "ro" | "en",
): { km: number; kinds: readonly CheckpointKind[]; name: string }[] {
  return sortedByKm(checkpoints.filter((row) => row.onProfile !== false)).map((row) => ({ km: row.km, kinds: row.kinds, name: locale === "ro" ? row.nameRo : row.nameEn }));
}

/**
 * What changes a bib's drawing (§750), as one string: every checkpoint's distance, kinds, time limit
 * and the clock it closes at, in order — folded into the stamp of what a picture is drawn from
 * (`bib-stamp.ts`), so a new, moved or retimed checkpoint, or a moved start that moves the clock the
 * strip prints, is a new picture address and no old picture is served. The names are not in it: the
 * strip draws no name.
 */
export function checkpointsStampPart(checkpoints: readonly Pick<Checkpoint, "km" | "kinds" | "cutoffMinutes" | "cutoffClock">[]): string {
  return sortedByKm(checkpoints)
    .map((row) => `${row.km.toFixed(2)}:${row.kinds.join("+")}:${row.cutoffMinutes ?? ""}@${row.cutoffClock ?? ""}`)
    .join("|");
}
