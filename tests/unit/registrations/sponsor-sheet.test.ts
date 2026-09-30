import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { PROMO_LISTED_STATUSES, sponsorListFileName, sponsorListFormat } from "@/modules/registrations/sponsor-list";
import { buildSponsorListWorkbook, SPONSOR_SHEET_COLUMNS, sponsorSheetHeaders, type SponsorSheetRow, type SponsorSheetWords } from "@/modules/registrations/sponsor-sheet";
import { REGISTRATION_SHEET_HEADERS } from "@/modules/registrations/workbook";
import { readSheet, unzip } from "../../helpers/xlsx";

/**
 * §NNN (amending §570) — the sponsor list as an Excel file with every tick beside the five columns.
 * The owner, 2026-09-30: «trebuie să am Excel cu toate bifele lor».
 */
function wordsOf(catalogue: typeof ro): SponsorSheetWords {
  const sheet = catalogue.Admin.sponsors.sheet;
  return { sheet: sheet.name, yes: sheet.yes, no: sheet.no, columns: sheet.columns, states: sheet.states };
}

const row = (over: Partial<SponsorSheetRow> = {}): SponsorSheetRow => ({
  firstName: "Ana",
  lastName: "Pop",
  email: "ana@example.ro",
  eventTitle: "Crosul toamnei",
  consentedAt: new Date("2026-07-01T10:00:00.000Z"),
  consentNoticeVersion: 4,
  listPublic: true,
  listSocials: false,
  termsVersion: 3,
  termsAcceptedAt: new Date("2026-07-01T10:00:00.000Z"),
  declarationVersion: 7,
  declarationSignedAt: new Date("2026-07-02T08:00:00.000Z"),
  status: "CONFIRMED",
  ...over,
});

/** An Excel serial for a wall-clock moment, as `workbook.test.ts` computes it. */
const serialOf = (utcWall: number) => String(utcWall / (24 * 60 * 60 * 1000) + (70 * 365 + 19));

describe("§NNN the sponsor list's Excel file", () => {
  it("heads the CSV's five columns first, then every consent, in the order the owner named — in both languages", () => {
    expect(sponsorSheetHeaders(wordsOf(ro))).toEqual([
      "Prenume",
      "Nume",
      "Email",
      "Eveniment",
      "Oferte și beneficii (data acordului)",
      "Nota de confidențialitate (versiunea)",
      "Lista publică & rezultate",
      "Rețele pe lista publică",
      "Termeni (versiunea)",
      "Termeni (acceptați la)",
      "Declarația (versiunea)",
      "Declarația (semnată la)",
      "Starea înscrierii",
    ]);
    expect(Object.keys(en.Admin.sponsors.sheet.columns)).toEqual([...SPONSOR_SHEET_COLUMNS]);
    expect(Object.keys(ro.Admin.sponsors.sheet.columns)).toEqual([...SPONSOR_SHEET_COLUMNS]);
    // A state word for every state a listed row can be in, in both languages.
    for (const catalogue of [ro, en]) expect(Object.keys(catalogue.Admin.sponsors.sheet.states).sort()).toEqual([...PROMO_LISTED_STATUSES].sort());
    // Never what a partner's list must not carry: the birth date, the phone, the document, the health note.
    for (const header of [...sponsorSheetHeaders(wordsOf(ro)), ...sponsorSheetHeaders(wordsOf(en))]) {
      expect(header).not.toMatch(/naștere|birth|telefon|phone|identit|document|sănătate|health/i);
    }
  });

  it("writes one sheet «Sponsori», each tick as its own cell: yes or no, the versions as numbers, the moments as dates, the state in words", async () => {
    const buffer = await buildSponsorListWorkbook(wordsOf(ro), [row(), row({ firstName: "Bogdan", listPublic: false, listSocials: true, termsVersion: null, termsAcceptedAt: null, declarationVersion: null, declarationSignedAt: null, status: "WAITLISTED" })]);
    expect(buffer.subarray(0, 2).toString("ascii")).toBe("PK");
    const { rows, sheetName } = readSheet(buffer);
    expect(sheetName).toBe("Sponsori");
    const at = (key: (typeof SPONSOR_SHEET_COLUMNS)[number]) => SPONSOR_SHEET_COLUMNS.indexOf(key);
    const [, ana, bogdan] = rows;
    expect(ana.slice(0, 4)).toEqual(["Ana", "Pop", "ana@example.ro", "Crosul toamnei"]);
    // 10:00Z in July is 13:00 in Brașov (§439), the club's clock like every stamp of the start list.
    expect(ana[at("promoConsentedAt")]).toBe(serialOf(Date.UTC(2026, 6, 1, 13, 0)));
    expect(ana[at("promoNotice")]).toBe("4");
    expect(ana[at("listPublic")]).toBe("Da");
    expect(ana[at("listSocials")]).toBe("Nu");
    expect(ana[at("termsVersion")]).toBe("3");
    expect(ana[at("termsAcceptedAt")]).toBe(serialOf(Date.UTC(2026, 6, 1, 13, 0)));
    expect(ana[at("declarationVersion")]).toBe("7");
    expect(ana[at("declarationSignedAt")]).toBe(serialOf(Date.UTC(2026, 6, 2, 11, 0)));
    expect(ana[at("status")]).toBe("Confirmată");
    expect(bogdan[at("listPublic")]).toBe("Nu");
    expect(bogdan[at("listSocials")]).toBe("Da");
    // Nothing signed, no terms recorded (a desk entry): the cells are not written — never 0.
    expect(bogdan[at("termsVersion")]).toBeUndefined();
    expect(bogdan[at("declarationSignedAt")]).toBeUndefined();
    expect(bogdan[at("status")]).toBe("Pe lista de așteptare");
  });

  it("reads in English for an English reader, and a name is never a formula", async () => {
    const { rows, sheetName } = readSheet(await buildSponsorListWorkbook(wordsOf(en), [row({ firstName: "=HYPERLINK(1)" })]));
    expect(sheetName).toBe("Sponsors");
    expect(rows[0][SPONSOR_SHEET_COLUMNS.indexOf("listPublic")]).toBe("Public list & results");
    expect(rows[1][SPONSOR_SHEET_COLUMNS.indexOf("listPublic")]).toBe("Yes");
    expect(rows[1][SPONSOR_SHEET_COLUMNS.indexOf("status")]).toBe("Confirmed");
    expect(rows[1][0]).toBe("=HYPERLINK(1)");
    expect(unzip(await buildSponsorListWorkbook(wordsOf(en), [row({ firstName: "=1+1" })])).get("xl/worksheets/sheet1.xml")).not.toContain("<f>");
  });

  it("writes a file for an empty list rather than refusing", async () => {
    const { rows } = readSheet(await buildSponsorListWorkbook(wordsOf(ro), []));
    expect(rows).toHaveLength(1);
  });

  it("is named sponsori-<event>-<day>.xlsx, and anything but xlsx asks for the CSV", () => {
    expect(sponsorListFileName("crosul-toamnei", "2026-09-30", "xlsx")).toBe("sponsori-crosul-toamnei-2026-09-30.xlsx");
    expect(sponsorListFileName(null, "2026-09-30", "xlsx")).toBe("sponsori-toate-2026-09-30.xlsx");
    expect(sponsorListFileName("crosul-toamnei", "2026-09-30")).toBe("sponsori-crosul-toamnei-2026-09-30.csv");
    expect(sponsorListFormat("xlsx")).toBe("xlsx");
    for (const other of [null, "", "csv", "XLSX", "pdf"]) expect(sponsorListFormat(other)).toBe("csv");
  });
});

describe("§NNN the full export names the public-list tick", () => {
  it("carries «Public list & results» right after «Socials on the public list»", () => {
    const at = REGISTRATION_SHEET_HEADERS.indexOf("Socials on the public list");
    expect(REGISTRATION_SHEET_HEADERS[at + 1]).toBe("Public list & results");
  });
});
