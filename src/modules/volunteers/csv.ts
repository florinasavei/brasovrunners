import { CSV_BOM } from "@/modules/newsletter/subscribers-csv";
import { csvCell } from "@/modules/registrations/csv";

/**
 * «Descarcă CSV» on an event's «Voluntari» card (§754): one row per volunteer, grouped by role in the
 * club's order, in the reader's language.
 *
 * The registrations export's rules (`registrations/csv.ts`), reused rather than copied: every cell
 * through the one `csvCell`, so a name or a message starting with `=`, `+`, `-` or `@` opens as text and
 * never as a formula, and a comma, a quote or a line break is quoted; CRLF between lines (RFC 4180) and a
 * **BOM** first, because the club opens the file in Excel on Windows (`subscribers-csv.ts` says why).
 * The sign-up's moment is ISO 8601 in UTC (`toISOString`), one unambiguous value whatever the reader's zone.
 */

export type VolunteerCsvRow = {
  role: string;
  name: string;
  email: string;
  phone: string;
  /** «Înscris» / «Confirmat» / «Anulat», in the reader's words. */
  state: string;
  /** «Din formular» / «Adăugat de organizator», in the reader's words. */
  source: string;
  message: string | null;
  note: string | null;
  signedUpAt: Date;
};

export type VolunteerCsvHeader = {
  role: string;
  name: string;
  email: string;
  phone: string;
  state: string;
  source: string;
  message: string;
  note: string;
  signedUpAt: string;
};

export function buildVolunteersCsv(header: VolunteerCsvHeader, rows: readonly VolunteerCsvRow[]): string {
  const lines = [
    [header.role, header.name, header.email, header.phone, header.state, header.source, header.message, header.note, header.signedUpAt].map(csvCell).join(","),
    ...rows.map((row) =>
      [row.role, row.name, row.email, row.phone, row.state, row.source, row.message ?? "", row.note ?? "", row.signedUpAt.toISOString()].map(csvCell).join(","),
    ),
  ];
  return `${CSV_BOM}${lines.join("\r\n")}`;
}

/** The file's name, with the club's date: `voluntari-2026-11-21.csv`. */
export function volunteersCsvFileName(day: string): string {
  return `voluntari-${day}.csv`;
}
