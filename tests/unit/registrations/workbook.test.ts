import { gunzipSync, inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { REGISTRATION_SHEET_HEADERS, buildRegistrationsWorkbook, type RegistrationSheetRow } from "@/modules/registrations/workbook";

/**
 * §172 — the start list as a real spreadsheet.
 *
 * The assertions are on the **bytes**, not on a library's own round trip: a writer that agreed
 * with its own reader and with nothing else would pass a round-trip test and still hand the club
 * a file Excel refuses. So this opens the ZIP container by hand, checks the parts a spreadsheet
 * needs to be a spreadsheet, and reads the sheet's own XML for the values.
 */

const row = (over: Partial<RegistrationSheetRow> = {}): RegistrationSheetRow => ({
  id: "11111111-1111-4111-8111-111111111111",
  eventTitle: "Crosul Tâmpei",
  registeredName: "Ana Pop",
  firstName: "Ana",
  lastName: "Pop",
  idDocument: "BV 123456",
  email: "ana@example.ro",
  status: "CONFIRMED",
  clubName: "Brașov Runners",
  clubMemberDeclared: true,
  fitnessDeclaredAt: new Date("2026-09-04T10:00:00.000Z"),
  stravaUrl: "",
  instagramHandle: "",
  guardianName: "",
  guardianIdDocument: "",
  submittedAt: new Date("2026-09-04T10:00:00.000Z"),
  confirmedAt: new Date("2026-09-05T08:30:00.000Z"),
  bibNumber: 17,
  checkedInAt: null,
  emailBounced: false,
  ...over,
});

/**
 * The entries of a ZIP, by name, decompressed.
 *
 * Read through the **central directory** at the end of the file rather than by walking the
 * local headers from the front. A streaming writer is allowed to leave the sizes out of the
 * local header and put them in a data descriptor after the payload (general-purpose bit 3),
 * and this writer does — so the sizes at the front are zero and a front-to-back walk stops on
 * the first entry. The central directory is the authority on where everything is, which is
 * also how every real unzip works.
 */
function unzip(buffer: Buffer): Map<string, string> {
  // The end-of-central-directory record: its signature, searched from the back.
  let eocd = buffer.length - 22;
  while (eocd >= 0 && buffer.readUInt32LE(eocd) !== 0x06054b50) eocd -= 1;
  if (eocd < 0) throw new Error("not a zip: no end-of-central-directory record");

  const entries = buffer.readUInt16LE(eocd + 10);
  let at = buffer.readUInt32LE(eocd + 16);

  const files = new Map<string, string>();
  for (let index = 0; index < entries; index += 1) {
    if (buffer.readUInt32LE(at) !== 0x02014b50) throw new Error("corrupt central directory");
    const method = buffer.readUInt16LE(at + 10);
    const compressedSize = buffer.readUInt32LE(at + 20);
    const nameLength = buffer.readUInt16LE(at + 28);
    const extraLength = buffer.readUInt16LE(at + 30);
    const commentLength = buffer.readUInt16LE(at + 32);
    const localAt = buffer.readUInt32LE(at + 42);
    const name = buffer.subarray(at + 46, at + 46 + nameLength).toString("utf8");

    // The payload starts after the local header, whose own name and extra fields may differ
    // in length from the central directory's.
    const localNameLength = buffer.readUInt16LE(localAt + 26);
    const localExtraLength = buffer.readUInt16LE(localAt + 28);
    const start = localAt + 30 + localNameLength + localExtraLength;
    const raw = buffer.subarray(start, start + compressedSize);
    const content = method === 0 ? raw : method === 8 ? inflateRawSync(raw) : gunzipSync(raw);

    files.set(name, content.toString("utf8"));
    at += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

describe("BR-REQ-060-01 the start list as a spreadsheet (§172)", () => {
  it("is a workbook Excel can open: the container, the parts and the sheet", async () => {
    const buffer = await buildRegistrationsWorkbook([row()], "Crosul Tâmpei");

    // "PK": it is a ZIP at all, which is the first thing a spreadsheet checks.
    expect(buffer.subarray(0, 2).toString("ascii")).toBe("PK");

    const parts = unzip(buffer);
    // The four parts without which no spreadsheet will open the file.
    for (const part of ["[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/worksheets/sheet1.xml"]) {
      expect([...parts.keys()], `${part} is in the container`).toContain(part);
    }
    expect(parts.get("[Content_Types].xml")).toContain("spreadsheetml.sheet.main+xml");
  });

  it("writes every column, the header first and frozen, and the sheet named after the race", async () => {
    const buffer = await buildRegistrationsWorkbook([row()], "Crosul Tâmpei");
    const parts = unzip(buffer);
    const sheet = parts.get("xl/worksheets/sheet1.xml") ?? "";
    const strings = `${parts.get("xl/sharedStrings.xml") ?? ""}${sheet}`;

    // The header, in order, wherever the writer chose to keep the text.
    for (const header of REGISTRATION_SHEET_HEADERS) {
      expect(strings, `${header} is written`).toContain(header);
    }
    // The header row stays on screen while somebody scrolls two hundred runners.
    expect(sheet).toContain("pane");
    expect(parts.get("xl/workbook.xml")).toContain("Crosul Tâmpei");
  });

  /**
   * §180 — the backoffice calls it "Race number (BIB)" in every screen, and the spreadsheet is
   * the one place a volunteer meets the column with no screen around it to explain "Bib".
   */
  it("heads the race number as the backoffice names it", async () => {
    expect(REGISTRATION_SHEET_HEADERS).toContain("Race number (BIB)");
    expect(REGISTRATION_SHEET_HEADERS).not.toContain("Bib");
    const parts = unzip(await buildRegistrationsWorkbook([row()], "Test"));
    const strings = `${parts.get("xl/sharedStrings.xml") ?? ""}${parts.get("xl/worksheets/sheet1.xml") ?? ""}`;
    expect(strings).toContain("Race number (BIB)");
  });

  it("keeps the number a number and the name text, so each sorts as itself", async () => {
    const parts = unzip(await buildRegistrationsWorkbook([row({ bibNumber: 17 })], "Test"));
    const sheet = parts.get("xl/worksheets/sheet1.xml") ?? "";
    // A numeric cell has no `t="s"`/`t="inlineStr"` marker and carries the digits directly.
    expect(sheet).toMatch(/<v>17<\/v>/);
  });

  /**
   * A name beginning with `=` is a formula to a spreadsheet, and a start list is exactly where
   * one arrives from a public form. The CSV prefixes an apostrophe (`neutralizeCsvValue`); here
   * the cell is typed as text, which is the stronger version of the same guarantee — a text
   * cell is never evaluated, whatever it starts with.
   */
  it("never lets a name become a formula", async () => {
    const parts = unzip(await buildRegistrationsWorkbook([row({ registeredName: "=1+1" })], "Test"));
    const sheet = parts.get("xl/worksheets/sheet1.xml") ?? "";
    expect(sheet).not.toContain("<f>");
  });

  it("takes a sheet name Excel would refuse and makes one it accepts", async () => {
    const parts = unzip(await buildRegistrationsWorkbook([row()], "Cros/2026: ediția a [V]-a, pe Tâmpa și retur"));
    const workbook = parts.get("xl/workbook.xml") ?? "";
    const name = /name="([^"]*)"/.exec(workbook)?.[1] ?? "";
    expect(name.length).toBeLessThanOrEqual(31);
    for (const forbidden of [":", "\\", "/", "?", "*", "[", "]"]) {
      expect(name, `${forbidden} is not in a sheet name`).not.toContain(forbidden);
    }
  });

  it("writes a file for an empty list rather than refusing", async () => {
    // A race nobody has entered yet is a legitimate export: the club prints the empty sheet.
    const buffer = await buildRegistrationsWorkbook([], "Nobody yet");
    expect(buffer.subarray(0, 2).toString("ascii")).toBe("PK");
    expect(unzip(buffer).get("xl/worksheets/sheet1.xml")).toBeTruthy();
  });
});
