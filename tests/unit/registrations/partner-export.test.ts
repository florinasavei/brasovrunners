import { describe, expect, it } from "vitest";
import { buildRegistrationsCsv, PARTNER_HEADER_DEFAULT, RECONFIRMED_HEADER_DEFAULT, type RegistrationCsvRow } from "@/modules/registrations/csv";
import { REGISTRATION_SHEET_HEADERS, buildRegistrationsWorkbook, type RegistrationSheetRow } from "@/modules/registrations/workbook";
import { readSheet } from "../../helpers/xlsx";

/**
 * «Partener» in the registrations' Excel and CSV (the decision «De la parteneri»): the partner's or sponsor's name on the
 * registration, or an empty cell — in every file, for every role that gets one, after the fixed columns and just before
 * «Note interne», which stays the last. Headed in the reader's language by the route (`partnerHeader`); typed as text, so a
 * name that begins with `=` is never a formula. Made-up partners only.
 */
const PARTNER = "Brutăria Exemplu";

const csvRow = (over: Partial<RegistrationCsvRow> = {}): RegistrationCsvRow => ({
  eventTitle: "Crosul",
  registeredName: "Ana Pop",
  firstName: "Ana",
  lastName: "Pop",
  idDocument: "",
  email: "ana@example.ro",
  status: "CONFIRMED",
  clubMemberDeclared: false,
  memberVerified: false,
  clubRunner: false,
  fitnessDeclaredAt: null,
  stravaUrl: "",
  instagramHandle: "",
  guardianName: "",
  guardianIdDocument: "",
  submittedAt: "2026-11-11T10:00:00.000Z",
  confirmedAt: "",
  checkedInAt: "",
  emailBounced: false,
  ...over,
});

const sheetRow = (over: Partial<RegistrationSheetRow> = {}): RegistrationSheetRow => ({
  id: "11111111-1111-4111-8111-111111111111",
  eventTitle: "Crosul",
  registeredName: "Ana Pop",
  firstName: "Ana",
  lastName: "Pop",
  idDocument: "",
  email: "ana@example.ro",
  status: "CONFIRMED",
  clubName: "",
  clubMemberDeclared: false,
  memberVerified: false,
  clubRunner: false,
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

describe("«Partener» in the CSV", () => {
  it("follows «Club runner» in every file, the name or empty, and the notes stay last", () => {
    const [header, from, plain] = buildRegistrationsCsv([csvRow({ partnerName: PARTNER }), csvRow({ registeredName: "Ion Pop" })], { partnerHeader: "Partener" }).split("\r\n");
    // «Reconfirmat» (the decision «Cere reconfirmarea») follows «Partener» in every file.
    expect(header.split(",").slice(-3)).toEqual(["Club runner", "Partener", RECONFIRMED_HEADER_DEFAULT]);
    expect(from.split(",").at(-2)).toBe(PARTNER);
    expect(plain.split(",").at(-2)).toBe("");
    const withNotes = buildRegistrationsCsv([csvRow({ partnerName: PARTNER, notes: "o notă" })], { partnerHeader: "Partener", notesHeader: "Note interne" }).split("\r\n");
    expect(withNotes[0].split(",").slice(-3)).toEqual(["Partener", RECONFIRMED_HEADER_DEFAULT, "Note interne"]);
    expect(withNotes[1].split(",").slice(-3)).toEqual([PARTNER, "", "o notă"]);
    // Without a header named, the default word.
    expect(buildRegistrationsCsv([csvRow()]).split("\r\n")[0].split(",").at(-2)).toBe(PARTNER_HEADER_DEFAULT);
  });

  it("never lets a name become a formula", () => {
    const [, line] = buildRegistrationsCsv([csvRow({ partnerName: "=HYPERLINK(1)" })]).split("\r\n");
    expect(line.endsWith(",=HYPERLINK(1)")).toBe(false);
  });
});

describe("«Partener» in the Excel", () => {
  it("follows the fixed columns in every file, before «Note interne», which stays last", async () => {
    const { rows } = readSheet(await buildRegistrationsWorkbook([sheetRow({ partnerName: PARTNER, notes: "o notă" }), sheetRow({ id: "22222222-2222-4222-8222-222222222222" })], "Test", { partnerHeader: "Partener", notesHeader: "Note interne" }));
    // «Reconfirmat» (the decision «Cere reconfirmarea») between «Partener» and the notes.
    expect(rows[0]).toEqual([...REGISTRATION_SHEET_HEADERS, "Partener", RECONFIRMED_HEADER_DEFAULT, "Note interne"]);
    expect([rows[1].at(-3), rows[1].at(-1)]).toEqual([PARTNER, "o notă"]);
    expect(rows[2].at(-3) ?? "").toBe("");
    // A file without the notes' header (a role that keeps none) still has «Partener», now just before «Reconfirmat», the last.
    const plain = readSheet(await buildRegistrationsWorkbook([sheetRow({ partnerName: PARTNER })], "Test", { partnerHeader: "Partner" }));
    expect(plain.rows[0].slice(-2)).toEqual(["Partner", RECONFIRMED_HEADER_DEFAULT]);
    expect(plain.rows[1].at(-2)).toBe(PARTNER);
  });

  it("types the name as text: never a formula", async () => {
    const { rows } = readSheet(await buildRegistrationsWorkbook([sheetRow({ partnerName: "=1+1" })], "Test"));
    expect(rows[1].at(-2)).toBe("=1+1");
  });
});
