/**
 * CSV export for the backoffice (AGENTS.md §15.10, BR-REQ-060-01: Administrator only).
 *
 * The one rule that matters here: a cell that would open as a formula in the spreadsheet
 * software the club actually uses must not be allowed to. `=`, `+`, `-` and `@` are the four
 * characters every major spreadsheet treats as "this cell is a formula", so any of them
 * starting a cell is prefixed with a leading apostrophe, which every one of those programs
 * treats as "the rest of this is literal text" and does not print.
 */

const FORMULA_PREFIXES = ["=", "+", "-", "@"];

export function neutralizeCsvValue(value: string): string {
  return FORMULA_PREFIXES.some((prefix) => value.startsWith(prefix)) ? `'${value}` : value;
}

function csvCell(value: string): string {
  const neutralized = neutralizeCsvValue(value);
  const needsQuoting = /[",\n\r]/.test(neutralized);
  const escaped = neutralized.replaceAll('"', '""');
  return needsQuoting ? `"${escaped}"` : escaped;
}

export type RegistrationCsvRow = {
  eventTitle: string;
  registeredName: string;
  /** The two halves as registered, for the organiser who hands kits out by identity card (§95). */
  firstName: string;
  lastName: string;
  idDocument: string;
  email: string;
  status: string;
  /**
   * BR-REQ-031-06. "Yes" or empty, never "No".
   *
   * The column is a claim somebody made about themselves, and an empty cell says so: a person
   * who never opened the optional section and a person who is not in the club produce the same
   * `false`, and printing "No" against both would turn a missing answer into a stated one. The
   * volunteer sorting this at a start line reads a column of "Yes" and blanks, which is what
   * the data actually is.
   */
  clubMemberDeclared: boolean;
  /** When the entrant ticked "I am medically fit" (§171); empty for a desk or phone entry. */
  fitnessDeclaredAt: string | null;
  /** The optional socials (§106), empty when not given. */
  stravaUrl: string;
  instagramHandle: string;
  /** The parent or guardian of a minor (§108), empty for an adult. */
  guardianName: string;
  submittedAt: string;
  confirmedAt: string;
  /** The race number, once assigned (BR-REQ-038-01); empty until then, never 0. */
  bibNumber?: number | null;
  /** Race day and the provider's verdict, the two columns an organizer sorts by afterwards (§83). */
  checkedInAt: string;
  emailBounced: boolean;
};

const HEADER = [
  "Event",
  "Name",
  "First name",
  "Last name",
  "Identity document",
  "Email",
  "Status",
  "Club member (declared)",
  "Medically fit (declared)",
  "Strava",
  "Instagram",
  "Guardian",
  "Submitted",
  "Confirmed",
  "Bib",
  "Checked in",
  "Email bounced",
];

export function buildRegistrationsCsv(rows: readonly RegistrationCsvRow[]): string {
  const lines = [
    // Through the same cell function as the data. No header needs quoting today; one added
    // later with a comma in it would silently split every row into an extra column.
    HEADER.map(csvCell).join(","),
    ...rows.map((row) =>
      [
        row.eventTitle,
        row.registeredName,
        row.firstName,
        row.lastName,
        row.idDocument,
        row.email,
        row.status,
        row.clubMemberDeclared ? "Yes" : "",
        row.fitnessDeclaredAt ?? "",
        row.stravaUrl,
        row.instagramHandle,
        row.guardianName,
        row.submittedAt,
        row.confirmedAt,
        row.bibNumber ? String(row.bibNumber) : "",
        row.checkedInAt,
        row.emailBounced ? "Yes" : "",
      ]
        .map(csvCell)
        .join(","),
    ),
  ];
  // CRLF: the format RFC 4180 specifies and what spreadsheet software expects on Windows,
  // which is what every volunteer running this export is doing (CLAUDE.md: "Windows
  // development machine").
  return lines.join("\r\n");
}
