/**
 * «Istoricul sosirilor» (§986; the owner, 2026-11-18: «când un voluntar introduce numărul și numele, trebuie să pun în istorie și
 * numele voluntarului care a făcut asta, ca să putem corecta pe viitor»): every write of a race's results, read back from the audit
 * trail — never from a table of its own — newest first, one line each: when, who, what, and from where.
 *
 * Pure: the audit rows in, the lines out (`../finish-history.ts#readFinishHistory` reads them). **Tolerant by design**, as
 * «Istoric capacitate» (§911): the rows are chosen by their plain action strings and their metadata is read field by field, so a row
 * written before this screen existed («Sosire»'s, a «Clasament» save's) and a field nobody wrote all render — a value that cannot be
 * read is said as nothing, never guessed.
 *
 * - **What.** A press at the line (`finishLine: true` on `event_result.created` / `.updated`); a press of a number already «Sosit»
 *   (`event_result.finish_duplicate`, both times) — or of a runner «Clasament» wrote off, whose decision stays (the same row, its
 *   `storedStatus` the decision; a row without one is a «Sosit»'s); the line's own «Anulează» (`event_result.deleted` with `undo: true`); a
 *   «Clasament» save's created, changed and deleted rows (the boxes that changed named); «Start» set or taken off; and «Resetează
 *   clasamentul» (§NNN, `event.results_reset`: how many results went and whether a gun went with them), the line that says why
 *   every press and save older than it has no row any more.
 * - **Where.** «Cronometrare» for a press at the line and for «Start» — the old «Sosire» wrote `finishLine` too —, «Clasament» for
 *   the rest.
 * - **Who.** The staff member's display name; «cont șters» for an account removed since (`ON DELETE SET NULL`). The trail stores a
 *   number and never a runner's name: the page may add the name the number belongs to today, read live.
 */

/** Every action the history reads, by its plain string. */
export const FINISH_HISTORY_ACTIONS = [
  "event_result.created",
  "event_result.updated",
  "event_result.deleted",
  "event_result.finish_duplicate",
  "event.race_gun_set",
  "event.race_gun_cleared",
  "event.results_reset",
] as const;

/** How many rows the fold reads, newest first: a race of a few hundred runners, its corrections and its duplicates. */
export const FINISH_HISTORY_LIMIT = 400;

/** One audit row as the reader hands it over. */
export type FinishHistoryRow = { id: string; action: string; at: Date; actorName: string | null; metadata: unknown };

/** The boxes of a «Clasament» line a change names (`results.ts#changedBoxesOf`), each `Admin.results.history.box.<name>`. */
export const HISTORY_BOXES = ["bib", "status", "time", "chip", "note", "name", "sex", "birthDate", "registration", "nameAgreed"] as const;
export type HistoryBox = (typeof HISTORY_BOXES)[number];

/** What a line says happened. */
export type FinishHistoryWhat =
  | { kind: "finish"; bibNumber: number | null; gunTimeMs: number | null; turned: boolean }
  | { kind: "duplicate"; bibNumber: number | null; gunTimeMs: number | null; storedGunTimeMs: number | null; storedStatus: string }
  | { kind: "undo"; bibNumber: number | null; gunTimeMs: number | null }
  | { kind: "created"; bibNumber: number | null; status: string | null; gunTimeMs: number | null }
  | { kind: "updated"; bibNumber: number | null; status: string | null; gunTimeMs: number | null; boxes: HistoryBox[] }
  | { kind: "deleted"; bibNumber: number | null; status: string | null }
  | { kind: "gunSet"; at: Date | null; previous: Date | null }
  | { kind: "gunCleared"; previous: Date | null }
  /** «Resetează clasamentul» (§NNN): how many results went — null for a count that cannot be read — and whether a gun went too. */
  | { kind: "reset"; results: number | null; gunCleared: boolean };

export type FinishHistoryLine = {
  id: string;
  at: Date;
  /** The staff member's display name, or null for an account removed since. */
  who: string | null;
  where: "timing" | "results";
  what: FinishHistoryWhat;
};

const record = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
const whole = (value: unknown): number | null => (typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null);
const text = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);
function instant(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? null : at;
}
const boxesOf = (value: unknown): HistoryBox[] => (Array.isArray(value) ? value.filter((box): box is HistoryBox => (HISTORY_BOXES as readonly unknown[]).includes(box)) : []);

/** One audit row as a line, or null for an action the history does not read. */
export function finishHistoryLine(row: FinishHistoryRow): FinishHistoryLine | null {
  const metadata = record(row.metadata);
  const finishLine = metadata.finishLine === true;
  const bibNumber = whole(metadata.bibNumber);
  const gunTimeMs = whole(metadata.gunTimeMs);
  const base = { id: row.id, at: row.at, who: row.actorName };
  switch (row.action) {
    case "event_result.created":
      return finishLine
        ? { ...base, where: "timing", what: { kind: "finish", bibNumber, gunTimeMs, turned: false } }
        : { ...base, where: "results", what: { kind: "created", bibNumber, status: text(metadata.status), gunTimeMs } };
    case "event_result.updated":
      return finishLine
        ? { ...base, where: "timing", what: { kind: "finish", bibNumber, gunTimeMs, turned: true } }
        : { ...base, where: "results", what: { kind: "updated", bibNumber, status: text(metadata.status), gunTimeMs, boxes: boxesOf(metadata.changed) } };
    case "event_result.deleted":
      return metadata.undo === true
        ? { ...base, where: "timing", what: { kind: "undo", bibNumber, gunTimeMs } }
        : { ...base, where: "results", what: { kind: "deleted", bibNumber, status: text(metadata.status) } };
    case "event_result.finish_duplicate":
      return { ...base, where: "timing", what: { kind: "duplicate", bibNumber, gunTimeMs, storedGunTimeMs: whole(metadata.storedGunTimeMs), storedStatus: text(metadata.storedStatus) ?? "FINISHED" } };
    case "event.race_gun_set":
      return { ...base, where: "timing", what: { kind: "gunSet", at: instant(metadata.at), previous: instant(metadata.previous) } };
    case "event.race_gun_cleared":
      return { ...base, where: "timing", what: { kind: "gunCleared", previous: instant(metadata.previous) } };
    case "event.results_reset":
      // A count of nought is a reset that took only the gun: read as a count, never as nothing.
      return {
        ...base,
        where: "results",
        what: { kind: "reset", results: typeof metadata.results === "number" && Number.isInteger(metadata.results) && metadata.results >= 0 ? metadata.results : null, gunCleared: metadata.gunCleared === true },
      };
    default:
      return null;
  }
}

/** The rows as lines, newest first — by the time written, then by the row's id, as the reader ordered them. */
export function finishHistory(rows: readonly FinishHistoryRow[]): FinishHistoryLine[] {
  return [...rows]
    .sort((a, b) => b.at.getTime() - a.at.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
    .flatMap((row) => finishHistoryLine(row) ?? []);
}

/** The number a line is about, for the name read live beside it; null for «Start» and for a reset, which are about no runner. */
export function historyBibOf(what: FinishHistoryWhat): number | null {
  return what.kind === "gunSet" || what.kind === "gunCleared" || what.kind === "reset" ? null : what.bibNumber;
}
