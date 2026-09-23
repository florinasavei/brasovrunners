import { describe, expect, it } from "vitest";
import { buildRegistrationsCsv } from "@/modules/registrations/csv";
import { ageOn } from "@/modules/registrations/domain/age";
import { REGISTRATION_SHEET_HEADERS } from "@/modules/registrations/workbook";

/**
 * BR-REQ-031-05 criterion 4 — what leaves the application in a file (§NNN).
 *
 * The phone, the emergency contact and the health note are read on the registration's page and
 * on the emergency sheet, audited, by the people they are for. A downloaded export is the one
 * copy nobody can audit or erase, so none of the three is in either file — asserted on the
 * headers, which is where a column added by habit would show up first. The spreadsheet carries
 * what a category ranking and a kit order need; the CSV does not.
 */
const csvHeader = buildRegistrationsCsv([]).split("\r\n")[0].split(",");

describe("BR-REQ-031-05 criterion 4 the exports leave the emergency details out", () => {
  it.each([
    ["the CSV", csvHeader],
    ["the spreadsheet", REGISTRATION_SHEET_HEADERS],
  ])("%s has no phone, emergency contact or health column", (_name, headers) => {
    // "Medically fit (declared)" stays: it is the statement every entrant makes (§171), not health data.
    for (const header of headers) {
      expect(header, `${header} is an emergency column`).not.toMatch(/phone|telefon|emergency|urgen|health|sănătate|medical note/i);
    }
  });

  it("puts sex, the age on race day, where the runner is from and the t-shirt on the spreadsheet only", () => {
    for (const header of ["Sex", "Age on race day", "Nationality", "City", "T-shirt size"]) {
      expect(REGISTRATION_SHEET_HEADERS, `${header} is on the spreadsheet`).toContain(header);
      expect(csvHeader, `${header} is not in the CSV`).not.toContain(header);
    }
  });
});

describe("§NNN the age column: whole years on the event's day", () => {
  const raceDay = new Date("2026-11-21T09:00:00.000Z");

  it("counts a birthday on the day itself, and not the day before", () => {
    expect(ageOn("1990-11-21", raceDay)).toBe(36);
    expect(ageOn("1990-11-22", raceDay)).toBe(35);
    expect(ageOn("2008-11-21", raceDay)).toBe(18);
  });

  it("is blank for no date, or one that cannot be read", () => {
    expect(ageOn(null, raceDay)).toBeNull();
    expect(ageOn("not-a-date", raceDay)).toBeNull();
  });
});
