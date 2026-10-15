import { describe, expect, it } from "vitest";
import { buildRegistrationsCsv, type RegistrationCsvRow } from "@/modules/registrations/csv";
import { EXPORT_NOTES_CELL_MAX, type ExportNote, type ExportNotesWords, exportNotesCell } from "@/modules/registrations/notes";
import { REGISTRATION_SHEET_HEADERS, buildRegistrationsWorkbook, type RegistrationSheetRow } from "@/modules/registrations/workbook";
import { STAFF_ROLES } from "@/modules/staff-identity/domain/roles";
import { STAFF_ROLE_LABEL } from "@/modules/staff-identity/domain/staff-labels";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { readSheet, unzip } from "../../helpers/xlsx";

/**
 * §785 (amends §777, §172, §779; BR-REQ-060-01) — «cum stăm cu coloana de comentarii pentru participanți? asta
 * trebuie de asemenea să fie și în Excel!» (the owner, 2026-10-15): the registrations export's last column
 * «Note interne», the words of one cell, the two writers that carry it, and the words in both languages. What the
 * route asks and for whom is read from a database in `tests/integration/registrations/notes-in-export.test.ts`.
 */
const wordsOf = (catalogue: typeof ro): ExportNotesWords => ({
  roles: catalogue.Admin.registrations.notes.exportRole as ExportNotesWords["roles"],
  authorGone: catalogue.Admin.registrations.notes.exportGone,
  more: catalogue.Admin.registrations.notes.exportMore,
});
const RO = wordsOf(ro);
const EN = wordsOf(en);
const BRASOV = "Europe/Bucharest";

const note = (over: Partial<ExportNote> = {}): ExportNote => ({ createdAt: new Date("2026-10-15T10:30:00.000Z"), authorRole: "MODERATOR", body: "cere tricou S", ...over });

describe("§785 one registration's notes as the export's cell", () => {
  it("is empty for no notes", () => {
    expect(exportNotesCell(undefined, BRASOV, RO)).toBe("");
    expect(exportNotesCell([], BRASOV, RO)).toBe("");
  });

  it("writes «<data> · <rolul autorului>: <text>», the date on the event's clock", () => {
    // 10:30 UTC is 13:30 in Brașov in October (UTC+3).
    expect(exportNotesCell([note()], BRASOV, RO)).toBe("15.10.2026 13:30 · Organizator: cere tricou S");
    // …and a note written late in the evening UTC is already the next day there.
    expect(exportNotesCell([note({ createdAt: new Date("2026-10-15T21:30:00.000Z") })], BRASOV, RO)).toBe("16.10.2026 00:30 · Organizator: cere tricou S");
    // The same moment on another event's clock.
    expect(exportNotesCell([note({ createdAt: new Date("2026-10-15T21:30:00.000Z") })], "Europe/London", RO)).toBe("15.10.2026 22:30 · Organizator: cere tricou S");
  });

  it("names the author's role and never their name — in Română and in English", () => {
    const notes = [note({ authorRole: "ADMIN" }), note({ authorRole: "SUPERADMIN" }), note({ authorRole: "MODERATOR" })];
    expect(exportNotesCell(notes, BRASOV, RO).split("\n").map((line) => /· ([^:]+):/.exec(line)?.[1])).toEqual(["Administrator", "Superadministrator", "Organizator"]);
    expect(exportNotesCell(notes, BRASOV, EN).split("\n").map((line) => /· ([^:]+):/.exec(line)?.[1])).toEqual(["Administrator", "Superadministrator", "Organizer"]);
    // The type has no room for a name: what the reader hands in is a role or null.
    expect(Object.keys(note())).toEqual(["createdAt", "authorRole", "body"]);
  });

  it("says «cont șters» / «account removed» where the author's account is gone", () => {
    expect(exportNotesCell([note({ authorRole: null })], BRASOV, RO)).toContain("· cont șters:");
    expect(exportNotesCell([note({ authorRole: null })], BRASOV, EN)).toContain("· account removed:");
  });

  it("keeps the order it is given (the reader's newest first), one note a line, a note's own line breaks inside", () => {
    const cell = exportNotesCell(
      [
        note({ createdAt: new Date("2026-10-15T12:00:00.000Z"), body: "a doua\nîn două rânduri" }),
        note({ createdAt: new Date("2026-10-15T09:00:00.000Z"), body: "prima" }),
      ],
      BRASOV,
      RO,
    );
    expect(cell).toBe("15.10.2026 15:00 · Organizator: a doua\nîn două rânduri\n15.10.2026 12:00 · Organizator: prima");
    // A stray carriage return from a row written outside the form is one line break, like the card.
    expect(exportNotesCell([note({ body: "una\r\ndoua\rtrei" })], BRASOV, RO)).toContain("una\ndoua\ntrei");
  });

  it("is cut at a note's end below Excel's 32 767, with «… (mai multe note pe pagina înscrierii)» as the last line", () => {
    expect(EXPORT_NOTES_CELL_MAX).toBeLessThan(32_767);
    const long = (n: number) => note({ createdAt: new Date(Date.UTC(2026, 9, 15, 10, 30) - n * 60_000), body: `${n}:${"x".repeat(1_990)}` });
    const notes = Array.from({ length: 40 }, (_, index) => long(index));
    const cell = exportNotesCell(notes, BRASOV, RO);
    expect(cell.length).toBeLessThanOrEqual(EXPORT_NOTES_CELL_MAX);
    const lines = cell.split("\n");
    expect(lines.at(-1)).toBe("… (mai multe note pe pagina înscrierii)");
    // Every note before the closing line is whole, newest first: nothing is cut in the middle of one.
    const kept = lines.slice(0, -1);
    expect(kept.length).toBeGreaterThan(10);
    expect(kept.length).toBeLessThan(40);
    kept.forEach((line, index) => expect(line.endsWith(`${index}:${"x".repeat(1_990)}`)).toBe(true));
    // English closes with its own words.
    expect(exportNotesCell(notes, BRASOV, EN).split("\n").at(-1)).toBe("… (more notes on the registration's page)");
  });

  it("is not cut when every note fits, however many there are", () => {
    const notes = Array.from({ length: 30 }, (_, index) => note({ body: `n${index}` }));
    const lines = exportNotesCell(notes, BRASOV, RO).split("\n");
    expect(lines).toHaveLength(30);
    expect(lines.join("\n")).not.toContain("mai multe note");
  });
});

const sheetRow = (over: Partial<RegistrationSheetRow> = {}): RegistrationSheetRow => ({
  id: "11111111-1111-4111-8111-111111111111",
  eventTitle: "Crosul Tâmpei",
  registeredName: "Ana Pop",
  firstName: "Ana",
  lastName: "Pop",
  idDocument: "",
  email: "ana@example.ro",
  status: "CONFIRMED",
  clubName: "",
  clubMemberDeclared: false,
  memberVerified: false,
  fitnessDeclaredAt: null,
  stravaUrl: "",
  instagramHandle: "",
  guardianName: "",
  guardianIdDocument: "",
  submittedAt: null,
  confirmedAt: null,
  bibNumber: null,
  checkedInAt: null,
  emailBounced: false,
  ...over,
});

const TWO_NOTES = "15.10.2026 15:00 · Administrator: a doua\n15.10.2026 12:00 · Organizator: prima";

describe("§785 the spreadsheet's «Note interne» column", () => {
  it("is the last column, headed with the card's own title, wrapping, one note a line — only when the header is given", async () => {
    const buffer = await buildRegistrationsWorkbook([sheetRow({ notes: TWO_NOTES })], "Test", { notesHeader: ro.Admin.registrations.notes.title });
    const { rows } = readSheet(buffer);
    expect(rows[0].at(-1)).toBe("Note interne");
    expect(rows[0]).toHaveLength(REGISTRATION_SHEET_HEADERS.length + 1);
    expect(rows[1].at(-1)).toBe(TWO_NOTES);
    // Wrap text is on for the cell: a style with `wrapText` exists, and the cell uses a style with it.
    const parts = unzip(buffer);
    expect(parts.get("xl/styles.xml") ?? "").toMatch(/<alignment[^>]*wrapText="1"/);
    // …and the English file is headed in English.
    const english = readSheet(await buildRegistrationsWorkbook([sheetRow()], "Test", { notesHeader: en.Admin.registrations.notes.title }));
    expect(english.rows[0].at(-1)).toBe("Internal notes");
  });

  it("keeps every earlier column where it was: the header row is the old one with one more at the end", async () => {
    const { rows } = readSheet(await buildRegistrationsWorkbook([sheetRow()], "Test", { notesHeader: "Note interne" }));
    expect(rows[0].slice(0, -1)).toEqual(REGISTRATION_SHEET_HEADERS);
  });

  it("has no such column without the header: every other caller's file, and a role without notes rights", async () => {
    const { rows } = readSheet(await buildRegistrationsWorkbook([sheetRow({ notes: TWO_NOTES })], "Test"));
    expect(rows[0]).toEqual(REGISTRATION_SHEET_HEADERS);
    expect(rows[0]).not.toContain("Note interne");
    // …and the words handed to the writer by mistake are not written either.
    expect(JSON.stringify(rows)).not.toContain("prima");
  });

  it("writes an empty cell for a row with no notes, and never lets a note become a formula", async () => {
    const { rows } = readSheet(await buildRegistrationsWorkbook([sheetRow(), sheetRow({ id: "22222222-2222-4222-8222-222222222222", notes: "=1+1" })], "Test", { notesHeader: "Note interne" }));
    expect(rows[1].at(-1) ?? "").toBe("");
    expect(rows[2].at(-1)).toBe("=1+1");
    const parts = unzip(await buildRegistrationsWorkbook([sheetRow({ notes: "=1+1" })], "Test", { notesHeader: "Note interne" }));
    expect(parts.get("xl/worksheets/sheet1.xml") ?? "").not.toContain("<f>");
  });
});

const csvRow = (over: Partial<RegistrationCsvRow> = {}): RegistrationCsvRow => ({
  eventTitle: "Crosul Tâmpei",
  registeredName: "Ana Pop",
  firstName: "Ana",
  lastName: "Pop",
  idDocument: "",
  email: "ana@example.ro",
  status: "CONFIRMED",
  clubMemberDeclared: false,
  memberVerified: false,
  fitnessDeclaredAt: null,
  stravaUrl: "",
  instagramHandle: "",
  guardianName: "",
  guardianIdDocument: "",
  submittedAt: "",
  confirmedAt: "",
  checkedInAt: "",
  emailBounced: false,
  ...over,
});

describe("§785 the CSV's «Note interne» column", () => {
  it("is the last column with the same words, the line breaks kept inside the quoted field", () => {
    const csv = buildRegistrationsCsv([csvRow({ notes: TWO_NOTES }), csvRow({ registeredName: "Fără Note" })], { notesHeader: "Note interne" });
    const header = csv.split("\r\n")[0].split(",");
    expect(header.at(-1)).toBe("Note interne");
    expect(header.at(-2)).toBe("Member bib");
    // The cell is quoted and holds the newline: the file is one header and two records, not four lines.
    expect(csv).toContain(`"${TWO_NOTES}"`);
    const records = csv.split("\r\n");
    expect(records).toHaveLength(3);
    expect(records.at(-1)!.endsWith(",")).toBe(true);
  });

  it("has no such column without the header", () => {
    const csv = buildRegistrationsCsv([csvRow({ notes: TWO_NOTES })]);
    expect(csv).not.toContain("Note interne");
    expect(csv).not.toContain("prima");
    expect(csv.split("\r\n")[0].split(",").at(-1)).toBe("Member bib");
  });
});

describe("§785 the words, in both languages", () => {
  it("has every export key in Română and in English, one role each", () => {
    for (const catalogue of [ro, en]) {
      const notes = catalogue.Admin.registrations.notes;
      expect(Object.keys(notes.exportRole).sort()).toEqual([...STAFF_ROLES].sort());
      for (const text of [notes.exportMore, notes.exportGone, ...Object.values(notes.exportRole)]) expect(text.trim().length).toBeGreaterThan(0);
    }
    expect(ro.Admin.registrations.notes.exportMore).toBe("… (mai multe note pe pagina înscrierii)");
    expect(ro.Admin.registrations.notes.title).toBe("Note interne");
    expect(en.Admin.registrations.notes.title).toBe("Internal notes");
  });

  it("says the roles as the backoffice does: one list of Română words, not two that drift", () => {
    expect(ro.Admin.registrations.notes.exportRole).toEqual(STAFF_ROLE_LABEL);
    expect(ro.Admin.registrations.notes.exportGone).toBe(ro.Admin.person.noteAuthorGone);
    expect(en.Admin.registrations.notes.exportGone).toBe(en.Admin.person.noteAuthorGone);
  });
});
