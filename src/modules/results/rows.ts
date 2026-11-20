/**
 * The names the race's «Clasament» page posts under (§808): one form for every runner, so every box carries the row it belongs to.
 *
 * Two kinds of row, both in the one form of «Salvează tot clasamentul»:
 *
 * - `r[<bib>].time` — a runner who registered, found by the race number the registration holds: «Timp», «Status», «Timp cip» and
 *   «Notă». The key is the bib, so a table drawn from the registrations and a CSV matched by bib name the same row.
 * - `n[<i>].bib` — a runner the club types by hand (no registration holds the number): the bib, the name, the sex and the birth date
 *   for a category, then the same four boxes. `<i>` is only the row's place on the page.
 *
 * The dot is the house's own spelling of a numbered row (`roles[<key>].nameRo`, `faq[3].questionEn`); the summary of a refusal links
 * to `#field-<name>`. Pure — no database, no React — so the page that draws the names, the action that reads them and the service that
 * names a refused box all spell them one way.
 */

/**
 * The boxes of a registered runner's row and, with the first four and `agreed`, of a typed runner's. `agreed` is the one tick box of a
 * line — «A acceptat să apară cu numele în clasament» (§810) — posted as `on` when ticked and not at all when not; a registered line
 * draws none and a forged one is ignored.
 */
export const RESULT_ROW_BOXES = ["bib", "name", "sex", "birthDate", "time", "status", "chip", "note", "agreed"] as const;
export type ResultRowBox = (typeof RESULT_ROW_BOXES)[number];

/** The name one box of one row posts under: `r[101].time`, `n[0].name`. */
export function resultBox(key: string, box: ResultRowBox): string {
  return `${key}.${box}`;
}

/** The box that carries how many blank typed lines «Adaugă un alergător neînscris» asked for, posted with the form so a script-less press can add another. */
export const EXTRA_ROWS = "extraRows";

/**
 * «Folosește» under a line's «Timpi la sosire» (§NNN): the page's one hidden form its buttons name with `form=`, as «Șterge»'s do, and
 * the box each button posts — `choice`, `<number>:<milliseconds>:<the line's fingerprint>` (`chosenTimeValue`, read back by
 * `readChosenTime`). Here, in a module with no React, so the page that draws the question, the island that draws the button and the
 * action that reads it spell it one way.
 */
export const CHOOSE_TIME_FORM_ID = "choose-recorded-time";
export const CHOICE_BOX = "choice";

/**
 * What a «Folosește» button posts: the line's number, the time, and what that line stored when the page was drawn
 * (`domain/fingerprint.ts#resultLineFingerprint`) — `101:2717000:3f2a…` —, so the server refuses only a press whose own line changed
 * since, never one another number's arrival made older.
 */
export function chosenTimeValue(bibNumber: number, gunTimeMs: number, lineFingerprint: string): string {
  return `${bibNumber}:${gunTimeMs}:${lineFingerprint}`;
}

/** A posted `choice`, read back: the number, the time and the line's fingerprint, or null for anything the page never draws. */
export function readChosenTime(value: string): { bibNumber: number; gunTimeMs: number; lineFingerprint: string } | null {
  const match = /^(\d{1,6}):(\d{1,9}):([0-9a-f]{16})$/.exec(value.trim());
  return match ? { bibNumber: Number(match[1]), gunTimeMs: Number(match[2]), lineFingerprint: match[3] } : null;
}

/** Where «Clasament» is drawn again after a «Folosește» that went through: at the line of that number (`id` on the line). */
export function resultLineAnchor(bibNumber: number): string {
  return `result-line-${bibNumber}`;
}

/** Where it is drawn again after a refused one: at the page's alert, which says why. */
export const RESULTS_ALERT_ANCHOR = "results-alert";

/** A registered runner's row key, by the race number. */
export function registeredRowKey(bibNumber: number): string {
  return `r[${bibNumber}]`;
}

/** A typed runner's row key, by its place on the page. */
export function typedRowKey(index: number): string {
  return `n[${index}]`;
}

/** One row as the form posted it: its key, and every box by its short name (all strings, as typed). */
export type PostedResultRow = {
  key: string;
  /** The race number: the key's own for a registered row, the box's for a typed one ("" when left empty). */
  bib: string;
  name: string;
  sex: string;
  birthDate: string;
  time: string;
  status: string;
  chip: string;
  note: string;
  /** "on" when a typed line's agreement tick was posted; absent or "" otherwise (a script that does not know the box posts none). */
  agreed?: string;
};

const ROW_NAME = /^(r|n)\[(\d{1,6})\]\.(\w{1,20})$/;
const BOXES: ReadonlySet<string> = new Set(RESULT_ROW_BOXES);

/**
 * Every row of the posted form, in the order its first box appears. A name that is not a row's box is left alone (the form's own
 * hidden fields, the CSV box). Nothing is checked here: a bib that is not a number, a time that is not one, a status nobody knows
 * are the service's refusals, naming the row and the box.
 */
export function postedResultRows(entries: Iterable<readonly [string, unknown]>): PostedResultRow[] {
  const rows = new Map<string, PostedResultRow>();
  for (const [name, value] of entries) {
    const match = ROW_NAME.exec(name);
    if (!match || typeof value !== "string" || !BOXES.has(match[3])) continue;
    const kind = match[1];
    const key = `${kind}[${match[2]}]`;
    let row = rows.get(key);
    if (!row) {
      row = { key, bib: kind === "r" ? match[2] : "", name: "", sex: "", birthDate: "", time: "", status: "", chip: "", note: "", agreed: "" };
      rows.set(key, row);
    }
    const box = match[3] as ResultRowBox;
    // A registered row's number is its key's: a forged `r[101].bib` cannot move the row to another runner.
    if (kind === "r" && box === "bib") continue;
    // The agreement is a typed line's: a registered runner's name follows their own tick, never a staff mark (§810).
    if (kind === "r" && box === "agreed") continue;
    row[box] = value;
  }
  return [...rows.values()];
}

/** The typed rows' indexes a posted form names, from 0 up — how many typed rows the page draws again after a press. */
export function typedRowCountOf(names: Iterable<string>): number {
  let count = 0;
  for (const name of names) {
    const match = /^n\[(\d{1,4})\]\./.exec(name);
    if (match) count = Math.max(count, Number(match[1]) + 1);
  }
  return count;
}
