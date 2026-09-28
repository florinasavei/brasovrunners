/**
 * CSV export for the backoffice (AGENTS.md §15.10, BR-REQ-060-01): whoever may read the
 * registrations (`canReadRegistrations`, §289) — the Organizer, the Administrator and the
 * Superadministrator. It carries identity documents while the database does, which is why the
 * privacy notice says the file is deleted within seven days of the event (§418).
 *
 * The one rule that matters here: a cell that would open as a formula in the spreadsheet
 * software the club actually uses must not be allowed to. `=`, `+`, `-` and `@` are the four
 * characters every major spreadsheet treats as "this cell is a formula", so any of them
 * starting a cell is prefixed with a leading apostrophe, which every one of those programs
 * treats as "the rest of this is literal text" and does not print.
 */

import type { RegistrationStatus } from "@/db/schema/registrations";
import { raceNumberOf } from "./domain/race-number";

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
  /**
   * The participant's own identity document — the adult's, or since a minor signs too (§330) the
   * minor's — empty once cleared, seven days after the event (§95). `identityDocumentsOf` decides.
   */
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
  /** Their identity document, beside the minor's (§330); empty for an adult, and once cleared. */
  guardianIdDocument: string;
  submittedAt: string;
  confirmedAt: string;
  /** The race number, drawn at the confirmation (BR-REQ-038-01, §NNN); empty before it, never 0. */
  bibNumber?: number | null;
  /** Race day and the provider's verdict, the two columns an organizer sorts by afterwards (§83). */
  checkedInAt: string;
  emailBounced: boolean;
  /**
   * The club's terms the form accepted expressly (§421): the version in force when it was sent,
   * and the moment (§425). Empty for a staff or desk entry — the paper carries the terms — and for
   * a row sent before the version was recorded; §316's window is the answer for those.
   */
  termsVersion?: number | null;
  termsAcceptedAt?: string;
  /**
   * The declaration the registration's latest acceptance was signed against (§499): its version
   * and the moment, online or recorded from paper at the desk (§67). Empty while nothing is signed.
   */
  declarationVersion?: number | null;
  declarationSignedAt?: string;
  /**
   * Whether the public list prints the socials beside the name (§500): "Yes" or empty, like the
   * member claim — an empty cell is "not ticked", or ticked where it could not be kept.
   */
  listSocials?: boolean;
  /**
   * The family marker (§543): the other people registered on the same address at the event,
   * «; »-joined, or empty — so a spreadsheet shows who came together.
   */
  family?: string;
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
  // Beside the two (§500), as on the spreadsheet: whether the public list prints them.
  "Socials on the public list",
  "Guardian",
  // Beside the guardian's name (§330): the kit goes to that person (§108), against this document.
  "Guardian identity document",
  "Submitted",
  "Confirmed",
  // "Race number (BIB)", not "Bib": the club calls it that everywhere else in the backoffice
  // (§180), and a spreadsheet column is the one place a volunteer meets the word cold.
  "Race number (BIB)",
  "Checked in",
  "Email bounced",
  // Last (§425), so a script that reads the columns by position still finds every earlier one.
  "Terms version",
  "Terms accepted",
  // After the terms (§499), last for the same reason.
  "Declaration version",
  "Declaration signed",
  // Last (§543), for the same reason: the other people on the same address.
  "family",
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
        row.listSocials ? "Yes" : "",
        row.guardianName,
        row.guardianIdDocument,
        row.submittedAt,
        row.confirmedAt,
        // Empty until the registration is confirmed (§NNN): the one helper every screen reads.
        String(raceNumberOf({ status: row.status as RegistrationStatus, bibNumber: row.bibNumber ?? null }) ?? ""),
        row.checkedInAt,
        row.emailBounced ? "Yes" : "",
        String(row.termsVersion ?? ""),
        row.termsAcceptedAt ?? "",
        String(row.declarationVersion ?? ""),
        row.declarationSignedAt ?? "",
        row.family ?? "",
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
