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
  email: string;
  status: string;
  submittedAt: string;
  confirmedAt: string;
};

const HEADER = ["Event", "Name", "Email", "Status", "Submitted", "Confirmed"];

export function buildRegistrationsCsv(rows: readonly RegistrationCsvRow[]): string {
  const lines = [
    HEADER.join(","),
    ...rows.map((row) =>
      [row.eventTitle, row.registeredName, row.email, row.status, row.submittedAt, row.confirmedAt]
        .map(csvCell)
        .join(","),
    ),
  ];
  // CRLF: the format RFC 4180 specifies and what spreadsheet software expects on Windows,
  // which is what every volunteer running this export is doing (CLAUDE.md: "Windows
  // development machine").
  return lines.join("\r\n");
}
