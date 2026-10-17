import { CSV_BOM } from "@/modules/newsletter/subscribers-csv";
import { csvCell } from "@/modules/registrations/csv";

/**
 * «Descarcă clasamentul (CSV)» (§808): a race's results as a file, for the club's own use — names as the backoffice sees them, the
 * words of the page it was downloaded from, one row per result in the sheet's order (the finishers by position, then the others).
 *
 * The registrations export's rules (`registrations/csv.ts`), reused rather than copied, as the volunteers' file does (§754): every
 * cell through the one `csvCell`, so a name or a note starting with `=`, `+`, `-` or `@` opens as text and never as a formula, and a
 * comma, a quote or a line break is quoted; CRLF between lines (RFC 4180) and a **BOM** first, because the club opens the file in
 * Excel on Windows (`subscribers-csv.ts` says why). The times are `h:mm:ss`, the shape the page's boxes and the import read back, so
 * a file downloaded here can be imported again.
 */

export type ResultsCsvHeader = {
  position: string;
  positionSex: string;
  positionCategory: string;
  bib: string;
  name: string;
  sex: string;
  category: string;
  status: string;
  time: string;
  chip: string;
  note: string;
};

export type ResultsCsvRow = {
  position: number | null;
  positionSex: number | null;
  positionCategory: number | null;
  bib: number;
  name: string | null;
  /** The sex in the reader's words, or "". */
  sex: string;
  /** The category in the reader's words, or "". */
  category: string;
  /** The state in the reader's words. */
  status: string;
  /** `h:mm:ss`, or "" (`formatResultTime`). */
  time: string;
  chip: string;
  note: string | null;
};

export function buildResultsCsv(header: ResultsCsvHeader, rows: readonly ResultsCsvRow[]): string {
  const number = (value: number | null) => (value === null ? "" : String(value));
  const lines = [
    [header.position, header.positionSex, header.positionCategory, header.bib, header.name, header.sex, header.category, header.status, header.time, header.chip, header.note].map(csvCell).join(","),
    ...rows.map((row) =>
      [number(row.position), number(row.positionSex), number(row.positionCategory), String(row.bib), row.name ?? "", row.sex, row.category, row.status, row.time, row.chip, row.note ?? ""].map(csvCell).join(","),
    ),
  ];
  return `${CSV_BOM}${lines.join("\r\n")}`;
}

/** The file's name, with the race's day: `clasament-2026-11-21.csv`. */
export function resultsCsvFileName(day: string): string {
  return `clasament-${day}.csv`;
}
