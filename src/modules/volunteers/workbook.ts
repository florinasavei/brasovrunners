import type { Blob } from "node:buffer";
import type { Stream } from "node:stream";
import writeExcelFile, { type CellObject, type Feature, type SheetData } from "write-excel-file/node";
import { columnLetters, type ColourRule } from "@/modules/registrations/sheet-colours";
import { onClubClock, STAMP_FORMAT } from "@/modules/registrations/workbook";
import { SHEET_FRAME, SHEET_TINT } from "@/theme/brand";
import type { VolunteerCsvHeader, VolunteerCsvRow } from "./csv";
import type { VolunteerRoleSheetRow } from "./export";

/**
 * «Descarcă Excel» for the volunteers (§839; the owner, 2026-10-21: «I wanna be able to export volunteers in excel as well»;
 * and §846, 2026-10-22: «La voluntari vreau să descarc și excel formatat frumos, nu doar CSV»): one event's people from its
 * card, or every event's from the «Voluntari» screen, as a workbook laid out to be read and printed, not only parsed.
 *
 * **«Voluntari»**, the people: the CSV's rows (`csv.ts`) in the same words and language, the columns a reader looks for first
 * first — the name, the state, the roles given and offered, then the contact, what the person said about themselves, the
 * guardian and the two free texts last; with several events, «Eveniment» before them all. The header is the club's blue with
 * white words and stays on screen, as does the name; every column has Excel's filter arrow; a hairline grid; the two free
 * texts wrap. Each row takes its state's pale tint (`SHEET_TINT`, as the registrations sheet's, §787) by a rule over its own
 * «Stare» cell, so changing a state in the file recolours the row; a person given no role yet reads «De repartizat», as on
 * the card. The sign-up's moment is on the club's clock in the club's format, the age a number.
 *
 * **«Pe roluri»**, the roles: one line per role in the club's order — its category, how many it needs («fără număr» for
 * none, §784), how many were given it and how many of those confirmed (the card's «N din M», `standingOf`), how many more it
 * needs, tinted amber while it lacks people and green once it has them, and how many offered for it — with a total under
 * each event. A report, so its fills are baked; the people's sheet is the one the club edits.
 *
 * The CSV keeps its order and its plainness (§761): nothing that reads it moves.
 */

/** One event's part of the file: how the event is named in its column, its people and its roles. */
export type VolunteerSheetEvent = { label: string; rows: readonly VolunteerCsvRow[]; roles: readonly VolunteerRoleSheetRow[] };

/** The words the file needs besides the columns' own headings, in the reader's language. */
export type VolunteerSheetWords = {
  /** The two sheets' names: «Voluntari», «Pe roluri». */
  people: string;
  roles: string;
  /** «Eveniment», the first column of a file with several events. */
  event: string;
  /** «De repartizat»: the roles cell of a person given none. */
  unassigned: string;
  /** The «Stare» words, as the rows write them, that each tint follows. */
  confirmed: string;
  registered: string;
  cancelled: string;
  /** «Pe roluri»'s headings and words. */
  category: string;
  role: string;
  needed: string;
  taken: string;
  confirmedCount: string;
  free: string;
  offered: string;
  noNumber: string;
  total: string;
};

type Column<Row> = { header: string; width: number; wrap?: boolean; cell: (row: Row) => CellObject };

/** Every data cell's frame: top-aligned, a hairline all round. */
const FRAME = { alignVertical: "top", borderStyle: "thin", borderColor: SHEET_FRAME.grid } as const;

const headerCell = (value: string): CellObject => ({
  value,
  type: String,
  fontWeight: "bold",
  textColor: SHEET_FRAME.headerInk,
  backgroundColor: SHEET_FRAME.header,
  borderStyle: "thin",
  borderColor: SHEET_FRAME.grid,
  alignVertical: "center",
  wrap: true,
  height: 32,
});

const text = (value: string | null | undefined): CellObject => ({ value: value ?? "", type: String });

/** A formula's text: quotes doubled, as Excel writes a quote inside a string. */
const quoted = (words: string) => `"${words.replace(/"/g, '""')}"`;

/** A sheet's name as Excel takes it: none of `: \ / ? * [ ]`, at most 31 characters. */
const sheetName = (name: string, fallback: string) => name.replace(/[:\\/?*[\]]/g, " ").slice(0, 31) || fallback;

function peopleColumns(header: VolunteerCsvHeader, words: VolunteerSheetWords, withEvent: boolean): Column<VolunteerCsvRow & { event: string }>[] {
  const columns: Column<VolunteerCsvRow & { event: string }>[] = [
    { header: header.name, width: 26, cell: (row) => ({ ...text(row.name), fontWeight: "bold" }) },
    { header: header.state, width: 12, cell: (row) => text(row.state) },
    {
      header: header.role,
      width: 28,
      wrap: true,
      // «De repartizat» while nobody gave a role — never on a cancelled row, which needs none.
      cell: (row) => (row.role === "" && row.state !== words.cancelled ? { ...text(words.unassigned), fontStyle: "italic" } : text(row.role)),
    },
    { header: header.choices, width: 28, wrap: true, cell: (row) => text(row.choices) },
    { header: header.email, width: 30, cell: (row) => text(row.email) },
    { header: header.phone, width: 15, cell: (row) => text(row.phone) },
    { header: header.source, width: 22, cell: (row) => text(row.source) },
    { header: header.signedUpAt, width: 17, cell: (row) => ({ value: onClubClock(row.signedUpAt) ?? undefined, type: Date, format: STAMP_FORMAT }) },
    { header: header.age, width: 8, cell: (row) => ({ value: row.age ?? undefined, type: Number, align: "center" }) },
    { header: header.dateOfBirth, width: 12, cell: (row) => text(row.dateOfBirth) },
    { header: header.sex, width: 8, cell: (row) => text(row.sex) },
    { header: header.city, width: 16, cell: (row) => text(row.city) },
    { header: header.volunteeredBefore, width: 12, cell: (row) => ({ ...text(row.volunteeredBefore), align: "center" }) },
    { header: header.clubMember, width: 12, cell: (row) => ({ ...text(row.clubMember), align: "center" }) },
    { header: header.shirtSize, width: 10, cell: (row) => ({ ...text(row.shirtSize), align: "center" }) },
    { header: header.guardianName, width: 22, cell: (row) => text(row.guardianName) },
    { header: header.guardianEmail, width: 28, cell: (row) => text(row.guardianEmail) },
    { header: header.guardianConsent, width: 11, cell: (row) => ({ ...text(row.guardianConsent), align: "center" }) },
    { header: header.message, width: 40, wrap: true, cell: (row) => text(row.message) },
    { header: header.note, width: 40, wrap: true, cell: (row) => text(row.note) },
  ];
  return withEvent ? [{ header: words.event, width: 28, wrap: true, cell: (row) => text(row.event) }, ...columns] : columns;
}

/** The people's tints: the whole row, by the words in its own «Stare» cell (`colourRules`' way for the registrations, §787). */
function stateRules(stateColumn: number, lastColumn: number, rowCount: number, words: VolunteerSheetWords): ColourRule[] {
  if (rowCount < 1) return [];
  const range = { from: { row: 2, column: 1 }, to: { row: rowCount + 1, column: lastColumn + 1 } };
  const state = `$${columnLetters(stateColumn)}2`;
  return (
    [
      [words.confirmed, SHEET_TINT.success],
      [words.registered, SHEET_TINT.warning],
      [words.cancelled, SHEET_TINT.neutral],
    ] as const
  ).map(([word, fill]) => ({ cellRange: range, condition: { formula: `${state}=${quoted(word)}` }, style: { backgroundColor: fill } }));
}

function rolesSheet(events: readonly VolunteerSheetEvent[], words: VolunteerSheetWords): { data: SheetData; widths: number[] } {
  const withEvent = events.length > 1;
  // «Categorie» only while some role has one (§774): an empty column would only push «S-au oferit» off the printed page.
  const withCategory = events.some((event) => event.roles.some((role) => role.category !== ""));
  const number = (value: number | null, fallback: string): CellObject => (value === null ? { ...text(fallback), align: "center", fontStyle: "italic" } : { value, type: Number, align: "center" });
  const headers = [...(withEvent ? [words.event] : []), ...(withCategory ? [words.category] : []), words.role, words.needed, words.taken, words.confirmedCount, words.free, words.offered];
  const data: SheetData = [headers.map(headerCell)];
  for (const event of events) {
    if (event.roles.length === 0) continue;
    for (const role of event.roles) {
      // Amber while the role lacks people, green once it has them; nothing for a role without a number.
      const free = role.free === null ? number(null, "—") : { ...number(role.free, ""), fontWeight: "bold" as const, backgroundColor: role.free > 0 ? SHEET_TINT.warning : SHEET_TINT.success };
      data.push(
        [
          ...(withEvent ? [text(event.label)] : []),
          ...(withCategory ? [text(role.category)] : []),
          { ...text(role.role), fontWeight: "bold" as const },
          number(role.needed, words.noNumber),
          number(role.taken, ""),
          number(role.confirmed, ""),
          free,
          number(role.offered, ""),
        ].map((cell) => ({ ...FRAME, ...cell })),
      );
    }
    // The event's total: what the numbered roles need and lack; the offers are not summed, since one person may offer for several.
    const sum = (pick: (role: VolunteerRoleSheetRow) => number | null) => event.roles.reduce((total, role) => total + (pick(role) ?? 0), 0);
    const totalCell = (value: number | null): CellObject => (value === null ? text("") : { value, type: Number, align: "center" });
    data.push(
      [
        ...(withEvent ? [text(event.label)] : []),
        ...(withCategory ? [text(words.total), text("")] : [text(words.total)]),
        totalCell(event.roles.some((role) => role.needed !== null) ? sum((role) => role.needed) : null),
        totalCell(sum((role) => role.taken)),
        totalCell(sum((role) => role.confirmed)),
        totalCell(event.roles.some((role) => role.free !== null) ? sum((role) => role.free) : null),
        text(""),
      ].map((cell) => ({ ...FRAME, ...cell, fontWeight: "bold", backgroundColor: SHEET_TINT.neutral, topBorderStyle: "medium", topBorderColor: SHEET_FRAME.header })),
    );
  }
  return { data, widths: [...(withEvent ? [28] : []), ...(withCategory ? [20] : []), 26, 13, 13, 13, 13, 13] };
}

/**
 * What the writer does not draw (§846). On «Voluntari»: Excel's filter arrows on the header (`<autoFilter>`, right after
 * `<sheetData>` where the sheet's schema wants it, before the conditional formatting), and the header row repeated on every
 * printed page — the two defined names Excel keeps for them. On «Pe roluri»: printed one page wide, its seven columns being
 * a report somebody hands round. The sheet's name is quoted as a formula quotes it, and escaped for the XML around it.
 */
function sheetFeature(sheet: string, lastColumn: number, rowCount: number): Feature<Stream | Buffer | Blob> {
  const quotedSheet = `'${sheet.replace(/'/g, "''").replace(/&/g, "&amp;").replace(/</g, "&lt;")}'`;
  const names =
    `<definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">${quotedSheet}!$A$1:$${columnLetters(lastColumn)}$${rowCount + 1}</definedName>` +
    `<definedName name="_xlnm.Print_Titles" localSheetId="0">${quotedSheet}!$1:$1</definedName>`;
  return {
    files: {
      transform: {
        "xl/worksheets/sheet{id}.xml": {
          transform: (xml, _options, { sheetIndex }) =>
            sheetIndex === 0
              ? xml.replace("</sheetData>", `</sheetData><autoFilter ref="A1:${columnLetters(lastColumn)}${rowCount + 1}"/>`)
              : xml.replace(/(<worksheet[^>]*>)/, "$1<sheetPr><pageSetUpPr fitToPage=\"1\"/></sheetPr>").replace("<pageSetup ", '<pageSetup fitToWidth="1" fitToHeight="0" '),
        },
        "xl/workbook.xml": {
          transform: (xml) => (xml.includes("<definedNames>") ? xml.replace("<definedNames>", `<definedNames>${names}`) : xml.replace("</sheets>", `</sheets><definedNames>${names}</definedNames>`)),
        },
      },
    },
  };
}

export async function buildVolunteersWorkbook(header: VolunteerCsvHeader, events: readonly VolunteerSheetEvent[], words: VolunteerSheetWords): Promise<Buffer> {
  const withEvent = events.length > 1;
  const columns = peopleColumns(header, words, withEvent);
  const rows = events.flatMap((event) => event.rows.map((row) => ({ ...row, event: event.label })));
  const people: SheetData = [
    columns.map((column) => headerCell(column.header)),
    ...rows.map((row) => columns.map((column) => ({ ...FRAME, ...(column.wrap ? { wrap: true } : {}), ...column.cell(row) }))),
  ];
  const lastColumn = columns.length - 1;
  const peopleName = sheetName(words.people, "Volunteers");
  const roles = rolesSheet(events, words);
  const rules = stateRules(columns.findIndex((column) => column.header === header.state), lastColumn, rows.length, words);
  return writeExcelFile(
    [
      {
        data: people,
        sheet: peopleName,
        columns: columns.map((column) => ({ width: column.width })),
        // The header and the name stay on screen while somebody scrolls a hundred people and twenty columns.
        stickyRowsCount: 1,
        stickyColumnsCount: withEvent ? 2 : 1,
        orientation: "landscape",
        dateFormat: STAMP_FORMAT,
        // No rule without a row: the writer cannot draw an empty set (as `writeSheet` knows).
        ...(rules.length > 0 ? { conditionalFormatting: rules } : {}),
      },
      { data: roles.data, sheet: sheetName(words.roles, "Roles"), columns: roles.widths.map((width) => ({ width })), stickyRowsCount: 1, orientation: "landscape" },
    ],
    { features: [sheetFeature(peopleName, lastColumn, rows.length)] },
  ).toBuffer();
}

/** The file's name, with the club's date, like the CSV's: `voluntari-2026-11-21.xlsx`, or `voluntari-toate-evenimentele-…` for every event. */
export function volunteersWorkbookFileName(day: string, allEvents = false): string {
  return allEvents ? `voluntari-toate-evenimentele-${day}.xlsx` : `voluntari-${day}.xlsx`;
}
