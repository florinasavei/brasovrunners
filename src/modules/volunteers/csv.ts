import { CSV_BOM } from "@/modules/newsletter/subscribers-csv";
import { csvCell } from "@/modules/registrations/csv";

/**
 * «Descarcă CSV» on an event's «Voluntari» card (§754): one row per volunteer, grouped by the role given in the
 * club's order — the offers nobody has placed first — in the reader's language; since §761 a column for the role
 * given (empty while none) and one for the roles the person offered for, joined by «, ».
 *
 * The registrations export's rules (`registrations/csv.ts`), reused rather than copied: every cell
 * through the one `csvCell`, so a name or a message starting with `=`, `+`, `-` or `@` opens as text and
 * never as a formula, and a comma, a quote or a line break is quoted; CRLF between lines (RFC 4180) and a
 * **BOM** first, because the club opens the file in Excel on Windows (`subscribers-csv.ts` says why).
 * The sign-up's moment is ISO 8601 in UTC (`toISOString`), one unambiguous value whatever the reader's zone.
 *
 * Since §765 six columns after the moment — what the person said about themselves: the age, the sex (the registrations'
 * own English words, `sexCell`), the city, «a mai fost voluntar» and «din grupul clubului» as the reader's yes and no,
 * and the T-shirt's size, empty unless the event gives T-shirts. They are appended, so no earlier column moves.
 */

export type VolunteerCsvRow = {
  /** The role the organizers gave, or "" while none (§761). */
  role: string;
  /** The roles the person said they would do, in the club's order, joined by «, » (§761). */
  choices: string;
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
  /** What the person said about themselves (§765): empty for an unanswered box. */
  age: number | null;
  sex: string;
  city: string | null;
  /** «Da» / «Nu» in the reader's words. */
  volunteeredBefore: string;
  clubMember: string;
  shirtSize: string;
};

export type VolunteerCsvHeader = {
  role: string;
  choices: string;
  name: string;
  email: string;
  phone: string;
  state: string;
  source: string;
  message: string;
  note: string;
  signedUpAt: string;
  age: string;
  sex: string;
  city: string;
  volunteeredBefore: string;
  clubMember: string;
  shirtSize: string;
};

export function buildVolunteersCsv(header: VolunteerCsvHeader, rows: readonly VolunteerCsvRow[]): string {
  const lines = [
    [header.role, header.choices, header.name, header.email, header.phone, header.state, header.source, header.message, header.note, header.signedUpAt, header.age, header.sex, header.city, header.volunteeredBefore, header.clubMember, header.shirtSize]
      .map(csvCell)
      .join(","),
    ...rows.map((row) =>
      [
        row.role,
        row.choices,
        row.name,
        row.email,
        row.phone,
        row.state,
        row.source,
        row.message ?? "",
        row.note ?? "",
        row.signedUpAt.toISOString(),
        row.age === null ? "" : String(row.age),
        row.sex,
        row.city ?? "",
        row.volunteeredBefore,
        row.clubMember,
        row.shirtSize,
      ]
        .map(csvCell)
        .join(","),
    ),
  ];
  return `${CSV_BOM}${lines.join("\r\n")}`;
}

/** The file's name, with the club's date: `voluntari-2026-11-21.csv`. */
export function volunteersCsvFileName(day: string): string {
  return `voluntari-${day}.csv`;
}
