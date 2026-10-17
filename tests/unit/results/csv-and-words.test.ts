import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { categoryLabelOf } from "@/modules/results/category-words";
import { buildResultsCsv, resultsCsvFileName } from "@/modules/results/csv";
import { STATISTICS_AGE_BANDS } from "@/modules/registrations/statistics";
import { eventTakesResults } from "@/modules/results/domain/event-type";
import { resultsFingerprint } from "@/modules/results/domain/fingerprint";

/**
 * §808, BR-REQ-050-02 — the download of a race's results (the registrations export's rules, reused), a category in the Excel footer's own words,
 * which events take results, and the fingerprint the form posts back to refuse a stale save.
 */
const statistics = (locale: "ro" | "en") => (key: string) => (locale === "ro" ? ro : en).Admin.registrations.statistics[key as "category"] as string;

describe("§808 categoryLabelOf — the Excel footer's words", () => {
  it("joins the sex and the band the way the statistics do, in both languages", () => {
    expect(categoryLabelOf("FEMALE:from30", statistics("ro"))).toBe("Feminin, 30-39 ani");
    expect(categoryLabelOf("MALE:under18", statistics("ro"))).toBe("Masculin, sub 18 ani");
    expect(categoryLabelOf("FEMALE:from30", statistics("en"))).toBe("Female, 30-39");
  });

  it("has a word for every band the statistics define, so a category is never blank by a band added later", () => {
    for (const band of STATISTICS_AGE_BANDS) {
      for (const read of [statistics("ro"), statistics("en")]) {
        const label = categoryLabelOf(`MALE:${band.key}`, read);
        expect(label, band.key).not.toContain("undefined");
        expect(label.length, band.key).toBeGreaterThan(6);
      }
    }
  });

  it("is empty for a runner with no category, and the key itself for one this version does not know", () => {
    expect(categoryLabelOf(null, statistics("ro"))).toBe("");
    expect(categoryLabelOf(undefined, statistics("ro"))).toBe("");
    expect(categoryLabelOf("X:y", statistics("ro"))).toBe("X:y");
  });
});

describe("§808 buildResultsCsv", () => {
  const header = { position: "Loc", positionSex: "Loc la sex", positionCategory: "Loc la categorie", bib: "Număr", name: "Nume", sex: "Sex", category: "Categorie", status: "Status", time: "Timp", chip: "Timp cip", note: "Notă" };

  it("writes a BOM, CRLF and one row per result, empty cells for what a runner who did not finish has not", () => {
    const csv = buildResultsCsv(header, [
      { position: 1, positionSex: 1, positionCategory: 1, bib: 102, name: "Bia Marin", sex: "Female", category: "Feminin, 40-49 ani", status: "Sosit", time: "0:45:12", chip: "0:45:10", note: null },
      { position: null, positionSex: null, positionCategory: null, bib: 104, name: null, sex: "", category: "", status: "Abandon", time: "", chip: "", note: "a căzut" },
    ]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv.split("\r\n")).toEqual([
      "﻿Loc,Loc la sex,Loc la categorie,Număr,Nume,Sex,Categorie,Status,Timp,Timp cip,Notă",
      '1,1,1,102,Bia Marin,Female,"Feminin, 40-49 ani",Sosit,0:45:12,0:45:10,',
      ",,,104,,,,Abandon,,,a căzut",
    ]);
  });

  it("neutralises a cell a spreadsheet would run as a formula, and quotes a comma, a quote and a line break", () => {
    const csv = buildResultsCsv(header, [{ position: 1, positionSex: null, positionCategory: null, bib: 1, name: "=HYPERLINK(\"x\")", sex: "", category: "", status: "Sosit", time: "0:10:00", chip: "", note: "a, \"b\"\nc" }]);
    const row = csv.split("\r\n")[1];
    expect(row).toContain("'=HYPERLINK");
    expect(row).toContain('"a, ""b""\nc"');
  });

  it("names the file after the race's day", () => {
    expect(resultsCsvFileName("2026-11-21")).toBe("clasament-2026-11-21.csv");
  });
});

describe("§808 which events take results", () => {
  it("takes only the race", () => {
    expect(eventTakesResults("RACE")).toBe(true);
    for (const type of ["GROUP_RUN", "HIKE", "COFFEE", "MEETUP", "GEAR_TEST", "EXTERNAL", ""]) expect(eventTakesResults(type), type).toBe(false);
  });
});

describe("§808 resultsFingerprint", () => {
  const row = (bibNumber: number, over: Partial<Parameters<typeof resultsFingerprint>[0][number]> = {}) => ({
    bibNumber,
    registrationId: null,
    displayName: null,
    sex: null,
    birthDate: null,
    status: "FINISHED",
    gunTimeMs: 3_000_000,
    chipTimeMs: null,
    note: null,
    ...over,
  });

  it("is a short hash that does not depend on the order of the rows", () => {
    const a = resultsFingerprint([row(1), row(2)]);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(resultsFingerprint([row(2), row(1)])).toBe(a);
  });

  it("moves with every column a person typed, and with nothing else", () => {
    const base = resultsFingerprint([row(1)]);
    for (const change of [{ gunTimeMs: 3_000_001 }, { status: "DNF", gunTimeMs: null }, { chipTimeMs: 1 }, { note: "x" }, { displayName: "Ion" }, { sex: "MALE" }, { birthDate: "1990-01-01" }, { registrationId: "r" }, { nameAgreedAt: new Date("2026-11-23T10:00:00Z") }]) {
      expect(resultsFingerprint([row(1, change as never)]), JSON.stringify(change)).not.toBe(base);
    }
    expect(resultsFingerprint([])).not.toBe(base);
    // The agreement's moment is part of it: a form drawn before a colleague ticked or unticked a typed line is stale.
    const agreed = resultsFingerprint([row(1, { nameAgreedAt: new Date("2026-11-23T10:00:00Z") })]);
    expect(resultsFingerprint([row(1, { nameAgreedAt: new Date("2026-11-23T10:00:01Z") })])).not.toBe(agreed);
    expect(resultsFingerprint([row(1, { nameAgreedAt: null })])).toBe(base);
    // Two rows that differ only in where the field boundary falls are two lists.
    expect(resultsFingerprint([row(1, { displayName: "ab", note: "c" })])).not.toBe(resultsFingerprint([row(1, { displayName: "a", note: "bc" })]));
  });
});
