import type { Blob } from "node:buffer";
import type { Stream } from "node:stream";
import writeExcelFile, { type Feature } from "write-excel-file/node";
import { CLUB_TIME_ZONE } from "@/i18n/dates";
import { toWallTimeInput } from "@/modules/events/domain/zoned-time";
import type { RegistrationCsvRow } from "./csv";
import type { RegistrationStatus } from "@/db/schema/registrations";
import type { WorkbookDetails } from "./admin-repository";
import { ageOnRaceDay } from "./domain/age";
import { ROW_DEADLINE_EXPORT_WORDS, type RowDeadlineKind } from "./domain/row-deadline";
import { shirtSizeShown } from "./domain/kit";
import { raceNumberOf } from "./domain/race-number";
import { memberBibExportCell, membershipCell } from "./csv";
import { clubRunnerCell } from "./domain/club-runner";
import { sexCell } from "./domain/sex";
import { colourRules, columnLetters, type ColourRule } from "./sheet-colours";
import { eventLabelsOf, hasSeveralEvents, statisticsCells, statisticsOf, type StatisticsRanges, type StatisticsWords } from "./statistics";

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
  "submittedAt" | "confirmedAt" | "checkedInAt" | "fitnessDeclaredAt" | "termsAcceptedAt" | "declarationSignedAt" | "promoConsentAt" | "deadline" | "deadlineFor"
> & {
  /** «Până când» (§650): the moment the row waits on (`rowDeadlineOf`), a date like the others; null when none. */
  deadline?: Date | null;
  /** What that moment is for (§650): its kind, written out in the sheet's words; null when none. */
  deadlineFor?: RowDeadlineKind | null;
  /** «Oferte și beneficii» (§562): the moment of the yes, a date like the others; null for no. */
  promoConsentAt?: Date | null;
  /** The moment the terms were accepted (§421, §425), a date like the others; null when not recorded. */
  termsAcceptedAt?: Date | null;
  /** The moment the latest declaration was signed (§499); null while none is. */
  declarationSignedAt?: Date | null;
  /** The registration's own id, so a re-import knows which row it is about — never edited. */
  id: string;
  /** The runner's own club, as typed (§172) — what a start list is sorted by. */
  clubName: string;
  submittedAt: Date | null;
  confirmedAt: Date | null;
  checkedInAt: Date | null;
  fitnessDeclaredAt: Date | null;
  /**
   * The spreadsheet's own columns (§322; the age, the country and the city in the CSV too since §660): what a category ranking, the club's
   * "where do our runners come from" and the kit order read. Optional because a row built
   * without them — a test, a future caller — prints blanks rather than failing.
   */
  sex?: string | null;
  /** Whole years on the event's day (`domain/age.ts#ageOnRaceDay`): the club has no age bands yet. */
  ageOnRaceDay?: number | null;
  nationality?: string | null;
  /** The country the person lives in (§510), as its ISO code like the nationality. */
  country?: string | null;
  city?: string | null;
  tshirtSize?: string | null;
  /**
   * «Note interne» (§785): the registration's live notes as the cell's words (`exportNotesCell`), written only
   * when the workbook is built with `notesHeader` — which the route does for a role that may keep notes. Words
   * here, never the table: this file does not import the notes module (`notes-never-leave.test.ts`).
   */
  notes?: string;
  /**
   * The statistics footer's inputs (§787): the event the row belongs to (`eventId`, with `eventLabel` — the title
   * and the day — for a file of several events, whose «Event» column repeats it). Absent reads as one event: a
   * caller that builds no footer never needs them. Whether the row is one of the club's runners
   * (`domain/club-runner.ts#isClubRunner`) is `clubRunner`, from the CSV's row type: it is the «Club runner» column.
   */
  eventId?: string;
  eventLabel?: string;
  eventStartsAt?: Date;
};

/**
 * The spreadsheet's own columns for one row (§322), blank when the row has none: the export route's,
 * here so a test reads what the file will say. The sex in words — an empty cell for no answer, the
 * retired «Prefer să nu spun» included — and the T-shirt only for an event that gives one (§554).
 */
export function workbookExtras(
  details: WorkbookDetails | undefined,
): Pick<RegistrationSheetRow, "sex" | "ageOnRaceDay" | "nationality" | "country" | "city" | "tshirtSize"> {
  if (!details) return {};
  return {
    sex: sexCell(details.sex),
    ageOnRaceDay: ageOnRaceDay(details.birthDate, details.eventStartsAt, details.eventTimezone),
    nationality: details.nationality,
    country: details.country,
    city: details.city,
    tshirtSize: shirtSizeShown(details.eventKitShirt, details.tshirtSize),
  };
}

const bold = (value: string) => ({ value, fontWeight: "bold" as const });

/**
 * A timestamp as the club's clock reads it (§439). An Excel date cell has no zone: the writer
 * turns a `Date` into a serial from its UTC fields, so 19:00 in Brașov opened as 16:00. The cell
 * is handed the club's own wall clock instead, and the format `dd.mm.yyyy hh:mm` shows it on the
 * 24-hour clock — Excel's `hh` is 24-hour whenever the format has no `AM/PM`.
 */
export function onClubClock(at: Date | null): Date | null {
  return at ? new Date(`${toWallTimeInput(at, CLUB_TIME_ZONE)}:00.000Z`) : null;
}

export const STAMP_FORMAT = "dd.mm.yyyy hh:mm";

/** One column of a sheet: its header, its width in characters, and how a row becomes its cell. */
export type SheetColumn<Row> = {
  header: string;
  width: number;
  cell: (row: Row) => Record<string, unknown>;
};

/**
 * The one writer every spreadsheet the backoffice hands out goes through — the start list here, the
 * sponsor list (§581, `sponsor-sheet.ts`): a bold header row kept on screen, the columns' widths,
 * the club's date format, and a sheet name Excel accepts (at most 31 characters, none of `: \ / ? * [ ]`).
 * `footer` is rows of ready cells written under the table (§787, the start list's statistics): none for every
 * other sheet. The sheet declares no autofilter and no table, so nothing here can pull a footer into a sort.
 *
 * Two things the start list adds and the sponsor list never asks for (§787, amended): `rules`, the sheet's
 * conditional formatting (`sheet-colours.ts`), and a footer cell of type `"Formula"` — `value` the formula without its
 * `=`, `cached` the number it comes to today. The writer stores a formula, but not the result beside it; `liveFormulas`
 * adds the `<v>` and asks the workbook to recalculate on open, so a viewer that never recalculates shows the cached
 * number and Excel or LibreOffice recount.
 */
export async function writeSheet<Row>(
  columns: readonly SheetColumn<Row>[],
  rows: readonly Row[],
  sheetName: string,
  fallbackName: string,
  footer: Array<Array<Record<string, unknown>>> = [],
  rules: readonly ColourRule[] = [],
): Promise<Buffer> {
  // Where each formula sits (the header is row 1, the table follows, then the footer) and what it comes to now.
  const cached = new Map<string, number>();
  const footerFrom = rows.length + 2;
  const footerCells = footer.map((cells, rowAt) =>
    cells.map((cell, columnAt) => {
      if (cell.type !== "Formula") return cell;
      const { cached: result, ...rest } = cell;
      cached.set(`${columnLetters(columnAt)}${footerFrom + rowAt}`, Number(result));
      return rest;
    }),
  );
  const data = [columns.map((column) => bold(column.header)), ...rows.map((row) => columns.map((column) => column.cell(row))), ...footerCells];
  return writeExcelFile(
    data,
    {
      sheet: sheetName.replace(/[:\\/?*[\]]/g, " ").slice(0, 31) || fallbackName,
      columns: columns.map((column) => ({ width: column.width })),
      // The header stays on screen while somebody scrolls two hundred runners.
      stickyRowsCount: 1,
      dateFormat: STAMP_FORMAT,
      ...(rules.length > 0 ? { conditionalFormatting: [...rules] } : {}),
    },
    cached.size > 0 ? { features: [liveFormulas(cached)] } : {},
  ).toBuffer();
}

/**
 * The formulas' half the writer leaves out (§787, amended): each `<c r="B13"><f>…</f></c>` gains the `<v>` of the number
 * it counted when the file was written, and the workbook's `calcPr` asks for a full recalculation on load.
 * Without the cached value a viewer that does not recalculate — a phone's preview, Google's — shows an empty cell;
 * without `fullCalcOnLoad` Excel trusts the cache and a number the club changed offline would wait for a keystroke.
 */
function liveFormulas(cached: ReadonlyMap<string, number>): Feature<Stream | Buffer | Blob> {
  return {
    files: {
      transform: {
        "xl/worksheets/sheet{id}.xml": {
          transform: (xml) =>
            xml.replace(/<c r="([A-Z]+\d+)"([^>]*)><f>([\s\S]*?)<\/f><\/c>/g, (cell, reference: string, attributes: string, formula: string) => {
              const result = cached.get(reference);
              return result === undefined ? cell : `<c r="${reference}"${attributes}><f>${formula}</f><v>${result}</v></c>`;
            }),
        },
        "xl/workbook.xml": {
          transformElementAttributes: (tagName, attributes) => (tagName === "calcPr" ? { ...attributes, fullCalcOnLoad: 1 } : attributes),
        },
      },
    },
  };
}

/**
 * The columns, in the order a start list is read: who, then what they entered as, then the
 * facts race morning needs, then the timestamps nobody sorts by but everybody eventually asks
 * about. `id` is first and narrow: it is the handle a re-import matches on, and it is the one
 * column a club member must not retype.
 */
const COLUMNS: Array<SheetColumn<RegistrationSheetRow>> = [
  { header: "ID", width: 38, cell: (row) => ({ value: row.id, type: String }) },
  // Named as the backoffice names it (§180), and wide enough for the heading rather than the
  // number: a column headed by a truncated word is what makes somebody widen it by hand.
  // Empty until the registration is confirmed (§548), as on every screen.
  { header: "Race number (BIB)", width: 18, cell: (row) => ({ value: raceNumberOf({ status: row.status as RegistrationStatus, bibNumber: row.bibNumber ?? null }), type: Number }) },
  { header: "Name", width: 28, cell: (row) => ({ value: row.registeredName, type: String }) },
  { header: "First name", width: 18, cell: (row) => ({ value: row.firstName, type: String }) },
  { header: "Last name", width: 18, cell: (row) => ({ value: row.lastName, type: String }) },
  { header: "Club", width: 22, cell: (row) => ({ value: row.clubName, type: String }) },
  /*
    The ones the form asks for and the start list does not use (§322, the country §510), on the sheet the club
    works in; of them the CSV carries only the age, the country and the city, last (§660). Never the phone, the emergency contact or the
    health note: those are read on the registration's page and the emergency sheet, audited,
    and a file that leaves the application is exactly where they must not go (`AGENTS.md`
    §15.10; `workbook.test.ts` asserts the absence).
  */
  { header: "Sex", width: 12, cell: (row) => ({ value: row.sex ?? "", type: String }) },
  { header: "Age on race day", width: 14, cell: (row) => ({ value: row.ageOnRaceDay ?? null, type: Number }) },
  { header: "Nationality", width: 12, cell: (row) => ({ value: row.nationality ?? "", type: String }) },
  // Where the person lives (§510), right before the city it makes sense of; blank on older rows.
  { header: "Country", width: 12, cell: (row) => ({ value: row.country ?? "", type: String }) },
  { header: "City", width: 18, cell: (row) => ({ value: row.city ?? "", type: String }) },
  { header: "T-shirt size", width: 12, cell: (row) => ({ value: row.tshirtSize && row.tshirtSize !== "NONE" ? row.tshirtSize : "", type: String }) },
  { header: "Status", width: 22, cell: (row) => ({ value: row.status, type: String }) },
  /*
    The list's «Până când» (§650), beside the state it is the deadline of, as on the list: the moment on the
    club's clock, then what it is for in words — the CSV has the two last, as a token. Blank when none.
  */
  { header: "Until when", width: 18, cell: (row) => ({ value: onClubClock(row.deadline ?? null), type: Date, format: STAMP_FORMAT }) },
  { header: "Waiting on", width: 30, cell: (row) => ({ value: row.deadlineFor ? ROW_DEADLINE_EXPORT_WORDS[row.deadlineFor] : "", type: String }) },
  { header: "Email", width: 30, cell: (row) => ({ value: row.email, type: String }) },
  { header: "Identity document", width: 18, cell: (row) => ({ value: row.idDocument, type: String }) },
  // Declared or verified (§662), as the list's chip: "verified", "declared" or blank.
  { header: "Club member", width: 12, cell: (row) => ({ value: membershipCell(row), type: String }) },
  /*
    «Club runner» (§787, amended; the owner: «color codes … dacă sunt membri BVR»): "Da" for one of the club's runners, from the
    one predicate the footer counts by (`isClubRunner`) — written as a cell so the colour rule on the three membership cells
    and the footer's `COUNTIF` read it from the sheet itself, which the typed-club match (§753) could never be as a formula.
  */
  { header: "Club runner", width: 11, cell: (row) => ({ value: clubRunnerCell(row.clubRunner), type: String }) },
  // Beside it (§664): the members' race number — "yes" when it prints, "asked" when the address is no member's, blank.
  { header: "Member bib", width: 11, cell: (row) => ({ value: memberBibExportCell(row), type: String }) },
  { header: "Medically fit (declared)", width: 18, cell: (row) => ({ value: onClubClock(row.fitnessDeclaredAt), type: Date, format: STAMP_FORMAT }) },
  { header: "Guardian", width: 24, cell: (row) => ({ value: row.guardianName, type: String }) },
  // Beside the guardian's name (§330): a minor's declaration carries both documents.
  { header: "Guardian identity document", width: 18, cell: (row) => ({ value: row.guardianIdDocument, type: String }) },
  { header: "Strava", width: 30, cell: (row) => ({ value: row.stravaUrl, type: String }) },
  { header: "Instagram", width: 18, cell: (row) => ({ value: row.instagramHandle, type: String }) },
  // Beside the two (§500): whether the public list prints them. The sheet is matched by header, not position.
  { header: "Socials on the public list", width: 12, cell: (row) => ({ value: row.listSocials ?? false, type: Boolean }) },
  // The public-list tick itself (§143, §570, §581), beside the socials it governs: every tick the person gave has its column.
  { header: "Public list & results", width: 12, cell: (row) => ({ value: row.listPublic ?? false, type: Boolean }) },
  { header: "Submitted", width: 18, cell: (row) => ({ value: onClubClock(row.submittedAt), type: Date, format: STAMP_FORMAT }) },
  { header: "Confirmed", width: 18, cell: (row) => ({ value: onClubClock(row.confirmedAt), type: Date, format: STAMP_FORMAT }) },
  { header: "Checked in", width: 18, cell: (row) => ({ value: onClubClock(row.checkedInAt), type: Date, format: STAMP_FORMAT }) },
  { header: "Email bounced", width: 12, cell: (row) => ({ value: row.emailBounced, type: Boolean }) },
  /*
    The terms the form accepted expressly (§421), the same two columns as the CSV (§425), last so
    every earlier column keeps its place. Blank for a staff or desk entry — the paper carries the
    terms — and for a row sent before the version was recorded. The moment on the club's clock,
    like every other stamp in the sheet (§439), so it reads beside the declaration's (§499).
  */
  { header: "Terms version", width: 10, cell: (row) => ({ value: row.termsVersion ?? null, type: Number }) },
  { header: "Terms accepted", width: 18, cell: (row) => ({ value: onClubClock(row.termsAcceptedAt ?? null), type: Date, format: STAMP_FORMAT }) },
  // The declaration signed, the same two columns as the CSV (§499): the version as a number, the moment on the club's clock.
  { header: "Declaration version", width: 10, cell: (row) => ({ value: row.declarationVersion ?? null, type: Number }) },
  { header: "Declaration signed", width: 18, cell: (row) => ({ value: onClubClock(row.declarationSignedAt ?? null), type: Date, format: STAMP_FORMAT }) },
  // The family marker (§543): the other people on the same address at the event, last like the CSV's.
  { header: "family", width: 30, cell: (row) => ({ value: row.family ?? "", type: String }) },
  // Why the participant cancelled (§558), last like the CSV's: the answer, and the words of «Another reason».
  { header: "Cancellation reason", width: 30, cell: (row) => ({ value: row.cancelReason ?? "", type: String }) },
  // The consent to offers and benefits (§562), last like the CSV's: its moment, blank for no.
  { header: "Offers and benefits", width: 18, cell: (row) => ({ value: onClubClock(row.promoConsentAt ?? null), type: Date, format: STAMP_FORMAT }) },
  // A special guest (§643; §649's name, §647's "Hidden list"), last like the CSV's: true or false.
  { header: "Special guest", width: 12, cell: (row) => ({ value: row.outsideCapacity ?? false, type: Boolean }) },
];

/** The header row, exactly as the export writes it — what a re-import matches its columns by. */
export const REGISTRATION_SHEET_HEADERS = COLUMNS.map((column) => column.header);

/**
 * «Event» (§787, amended), the column a file of several events gets after «Name»: the event's label as the footer's blocks
 * carry it (the title and the day), the string a per-event `COUNTIFS` filters by. The CSV has it first, always; the sheet of
 * one event has no use for it.
 */
const EVENT_COLUMN: SheetColumn<RegistrationSheetRow> = { header: "Event", width: 34, cell: (row) => ({ value: row.eventLabel ?? row.eventTitle, type: String }) };

/**
 * «Note interne» (§785), the one column only some roles get: last, wide, with wrap on so the lines of a cell
 * (one note a line) show as lines. Headed in the reader's language (`notesHeader`, the card's own title) and
 * text-typed like every cell, so a note that begins with `=` is never evaluated.
 */
function notesColumn(header: string): SheetColumn<RegistrationSheetRow> {
  return { header, width: 60, cell: (row) => ({ value: row.notes ?? "", type: String, wrap: true }) };
}

/**
 * The workbook. `notesHeader` adds the «Note interne» column (§785) — passed by the route only for a role that
 * `canKeepRegistrationNotes`; without it the file has no such column, which is every other caller's file.
 * `statistics` adds the footer under the rows (`statistics.ts`).
 *
 * **Live** (§787, amended; the owner, 2026-10-16: «color codes în funcție de status și dacă sunt membri BVR» and
 * «statisticile din Excel trebuie să se actualizeze automat offline, gen să fie formule în Excel»): the rows are
 * coloured by conditional formatting (`sheet-colours.ts`) and the footer's numbers are formulas over the rows'
 * columns, so the file stays right after the club edits it offline. A file of several events — only with a
 * footer to count them — gains an «Event» column after «Name», so a per-event count has something to filter by.
 */
export async function buildRegistrationsWorkbook(
  rows: readonly RegistrationSheetRow[],
  sheetName: string,
  options: { notesHeader?: string; statistics?: StatisticsWords } = {},
): Promise<Buffer> {
  const several = options.statistics !== undefined && hasSeveralEvents(rows);
  // What each row's event is called, one string to one event, for the column and for the footer's blocks alike.
  const labels = several ? eventLabelsOf(rows) : [];
  const sheetRows = several ? rows.map((row, at) => ({ ...row, eventLabel: labels[at] })) : rows;
  const columns = [...COLUMNS];
  if (several) columns.splice(columns.findIndex((column) => column.header === "Name") + 1, 0, EVENT_COLUMN);
  if (options.notesHeader) columns.push(notesColumn(options.notesHeader));
  const at = (header: string) => columns.findIndex((column) => column.header === header);

  /*
    «Statistici» (§787): the counts of these rows under them, after an empty row, for the caller that passes its
    words — the export route, in the reader's language. Every other caller's file is rows only, as it was, and
    so is the CSV, whose readers would take a footer for registrations. The counts are formulas over these
    absolute ranges: the header is row 1, the registrations 2 to N+1, and the footer starts after them.
  */
  const lastRow = Math.max(rows.length + 1, 2);
  const range = (header: string) => `$${columnLetters(at(header))}$2:$${columnLetters(at(header))}$${lastRow}`;
  const ranges: StatisticsRanges = {
    firstRow: rows.length + 2,
    id: range("ID"),
    status: range("Status"),
    clubRunner: range("Club runner"),
    sex: range("Sex"),
    age: range("Age on race day"),
    event: several ? range(EVENT_COLUMN.header) : null,
  };
  const footer = options.statistics ? statisticsCells(statisticsOf(sheetRows, options.statistics), options.statistics, ranges) : [];
  const rules = colourRules({
    statusColumn: at("Status"),
    clubRunnerColumn: at("Club runner"),
    memberColumns: [at("Club member"), at("Member bib")],
    lastColumn: columns.length - 1,
    rowCount: rows.length,
  });
  return writeSheet(columns, sheetRows, sheetName, "Participants", footer, rules);
}
