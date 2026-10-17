/**
 * The names the race's «Clasament» page posts under (§NNN): one form for every runner, so every box carries the row it belongs to.
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

/** The boxes of a registered runner's row and, with the first four, of a typed runner's. */
export const RESULT_ROW_BOXES = ["bib", "name", "sex", "birthDate", "time", "status", "chip", "note"] as const;
export type ResultRowBox = (typeof RESULT_ROW_BOXES)[number];

/** The name one box of one row posts under: `r[101].time`, `n[0].name`. */
export function resultBox(key: string, box: ResultRowBox): string {
  return `${key}.${box}`;
}

/** The box that carries how many blank typed lines «Adaugă un alergător neînscris» asked for, posted with the form so a script-less press can add another. */
export const EXTRA_ROWS = "extraRows";

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
      row = { key, bib: kind === "r" ? match[2] : "", name: "", sex: "", birthDate: "", time: "", status: "", chip: "", note: "" };
      rows.set(key, row);
    }
    const box = match[3] as ResultRowBox;
    // A registered row's number is its key's: a forged `r[101].bib` cannot move the row to another runner.
    if (kind === "r" && box === "bib") continue;
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
