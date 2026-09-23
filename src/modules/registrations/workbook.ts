import writeExcelFile from "write-excel-file/node";
import type { RegistrationCsvRow } from "./csv";
import { raceNumberOf } from "./domain/race-number";

/**
 * The start list as a spreadsheet the club can actually work in (§172; the owner: "CSV is
 * stupid! I want excel! and export just for a particular race!").
 *
 * The CSV stays — it is what a script reads, and it is the one format nothing can misinterpret
 * — but it is not what a volunteer opens on race morning. A comma-separated file opened in a
 * Romanian Excel splits on semicolons, renders `07` as `7`, turns a date into whatever the
 * machine's locale thinks, and arrives with no header frozen and every column one character
 * wide. This is the same rows as a real `.xlsx`: a bold, frozen header, columns wide enough to
 * read, dates as dates, and the number column as a number so it sorts as one.
 *
 * `write-excel-file` rather than ExcelJS: 1.8 MB against 21, and this runs in a Vercel function
 * whose whole bundle has a ceiling. It writes; it does not read, which is the other half of
 * what the owner asked for and is the half that needs a reader chosen on its own merits.
 *
 * **Every cell is text unless it is genuinely a number or a date.** A name beginning with `=`
 * is a formula to a spreadsheet, and a start list is exactly the place somebody's name arrives
 * from an untrusted form — `neutralizeCsvValue` exists in `csv.ts` for that reason and the same
 * rule holds here, enforced by typing the cell rather than by a prefix: a text cell is never
 * evaluated, whatever it starts with.
 */

/** A row as the sheet wants it: the same data the CSV carries, with the dates still dates. */
export type RegistrationSheetRow = Omit<
  RegistrationCsvRow,
  "submittedAt" | "confirmedAt" | "checkedInAt" | "fitnessDeclaredAt"
> & {
  /** The registration's own id, so a re-import knows which row it is about — never edited. */
  id: string;
  /** The runner's own club, as typed (§172) — what a start list is sorted by. */
  clubName: string;
  submittedAt: Date | null;
  confirmedAt: Date | null;
  checkedInAt: Date | null;
  fitnessDeclaredAt: Date | null;
  /**
   * The spreadsheet's own columns, not the CSV's (§NNN): what a category ranking, the club's
   * "where do our runners come from" and the kit order read. Optional because a row built
   * without them — a test, a future caller — prints blanks rather than failing.
   */
  sex?: string | null;
  /** Whole years on the event's day (`domain/age.ts#ageOn`): the club has no age bands yet. */
  ageOnRaceDay?: number | null;
  nationality?: string | null;
  city?: string | null;
  tshirtSize?: string | null;
};

const bold = (value: string) => ({ value, fontWeight: "bold" as const });

/**
 * The columns, in the order a start list is read: who, then what they entered as, then the
 * facts race morning needs, then the timestamps nobody sorts by but everybody eventually asks
 * about. `id` is first and narrow: it is the handle a re-import matches on, and it is the one
 * column a club member must not retype.
 */
const COLUMNS: Array<{
  header: string;
  width: number;
  cell: (row: RegistrationSheetRow) => Record<string, unknown>;
}> = [
  { header: "ID", width: 38, cell: (row) => ({ value: row.id, type: String }) },
  // Named as the backoffice names it (§180), and wide enough for the heading rather than the
  // number: a column headed by a truncated word is what makes somebody widen it by hand.
  { header: "Race number (BIB)", width: 18, cell: (row) => ({ value: raceNumberOf({ bibNumber: row.bibNumber ?? null, provisionalBibNumber: row.provisionalBibNumber ?? null })?.value ?? null, type: Number }) },
  // Whether that number is settled (§214): a provisional one is the club's planning figure
  // and not the one to send to the printer, and a sheet has to say which it is looking at.
  { header: "Number settled", width: 16, cell: (row) => ({ value: raceNumberOf({ bibNumber: row.bibNumber ?? null, provisionalBibNumber: row.provisionalBibNumber ?? null })?.settled ? "Yes" : "", type: String }) },
  { header: "Name", width: 28, cell: (row) => ({ value: row.registeredName, type: String }) },
  { header: "First name", width: 18, cell: (row) => ({ value: row.firstName, type: String }) },
  { header: "Last name", width: 18, cell: (row) => ({ value: row.lastName, type: String }) },
  { header: "Club", width: 22, cell: (row) => ({ value: row.clubName, type: String }) },
  /*
    The four the form asks for and the start list does not use (§NNN), on the sheet the club
    works in and deliberately not in the CSV. Never the phone, the emergency contact or the
    health note: those are read on the registration's page and the emergency sheet, audited,
    and a file that leaves the application is exactly where they must not go (`AGENTS.md`
    §15.10; `workbook.test.ts` asserts the absence).
  */
  { header: "Sex", width: 12, cell: (row) => ({ value: row.sex ?? "", type: String }) },
  { header: "Age on race day", width: 14, cell: (row) => ({ value: row.ageOnRaceDay ?? null, type: Number }) },
  { header: "Nationality", width: 12, cell: (row) => ({ value: row.nationality ?? "", type: String }) },
  { header: "City", width: 18, cell: (row) => ({ value: row.city ?? "", type: String }) },
  { header: "T-shirt size", width: 12, cell: (row) => ({ value: row.tshirtSize && row.tshirtSize !== "NONE" ? row.tshirtSize : "", type: String }) },
  { header: "Status", width: 22, cell: (row) => ({ value: row.status, type: String }) },
  { header: "Email", width: 30, cell: (row) => ({ value: row.email, type: String }) },
  { header: "Identity document", width: 18, cell: (row) => ({ value: row.idDocument, type: String }) },
  { header: "Club member (declared)", width: 12, cell: (row) => ({ value: row.clubMemberDeclared, type: Boolean }) },
  { header: "Medically fit (declared)", width: 18, cell: (row) => ({ value: row.fitnessDeclaredAt, type: Date, format: "dd.mm.yyyy hh:mm" }) },
  { header: "Guardian", width: 24, cell: (row) => ({ value: row.guardianName, type: String }) },
  { header: "Strava", width: 30, cell: (row) => ({ value: row.stravaUrl, type: String }) },
  { header: "Instagram", width: 18, cell: (row) => ({ value: row.instagramHandle, type: String }) },
  { header: "Submitted", width: 18, cell: (row) => ({ value: row.submittedAt, type: Date, format: "dd.mm.yyyy hh:mm" }) },
  { header: "Confirmed", width: 18, cell: (row) => ({ value: row.confirmedAt, type: Date, format: "dd.mm.yyyy hh:mm" }) },
  { header: "Checked in", width: 18, cell: (row) => ({ value: row.checkedInAt, type: Date, format: "dd.mm.yyyy hh:mm" }) },
  { header: "Email bounced", width: 12, cell: (row) => ({ value: row.emailBounced, type: Boolean }) },
];

/** The header row, exactly as the export writes it — what a re-import matches its columns by. */
export const REGISTRATION_SHEET_HEADERS = COLUMNS.map((column) => column.header);

export async function buildRegistrationsWorkbook(
  rows: readonly RegistrationSheetRow[],
  sheetName: string,
): Promise<Buffer> {
  const data = [
    COLUMNS.map((column) => bold(column.header)),
    ...rows.map((row) => COLUMNS.map((column) => column.cell(row))),
  ];

  return writeExcelFile(data, {
    // Excel refuses a sheet name over 31 characters or containing any of : \ / ? * [ ].
    sheet: sheetName.replace(/[:\\/?*[\]]/g, " ").slice(0, 31) || "Participants",
    columns: COLUMNS.map((column) => ({ width: column.width })),
    // The header stays on screen while somebody scrolls two hundred runners.
    stickyRowsCount: 1,
    dateFormat: "dd.mm.yyyy hh:mm",
  }).toBuffer();
}
