import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { RETIRED_ANSWERS } from "@/modules/registrations/answers";
import { OFFERS_MEMBER_BIB, PRINTS_MEMBER_BIB } from "@/modules/registrations/member-bib";

/**
 * §NNN (the owner, 2026-11-17: «că momentan nu se deosebesc cu nimic») — the members' race number is decided by ONE
 * rule: the event's bib design offers it, the registration's `club_member_declared`, not «Elită». It lives in two
 * twins beside each other — the SQL `registrations/member-bib.ts#PRINTS_MEMBER_BIB` and the TypeScript
 * `registrations/domain/member-bib.ts#printsMemberBib` (`member-bib-declared.test.ts` proves they agree) — and every
 * place that decides which bib a registration prints reads one of them, or the row a reader of them returned. This
 * file reads every caller from disk, so a second rule — or the account lookup and the wish coming back — fails here.
 */
const ROOT = path.resolve(__dirname, "../../..");
const source = (file: string) => readFileSync(path.join(ROOT, file), "utf8");

/** Each place that decides the members' bib, and what of the rule it must read (§NNN's list, the brief's six). */
const CALLERS: Array<{ file: string; what: string; reads: RegExp }> = [
  // The sheet's rows and its members' part (§681): `listBibs` selects the rule into `BibRow.member`.
  { file: "src/modules/registrations/bibs.ts", what: "the sheet's rows", reads: /member:\s*PRINTS_MEMBER_BIB/ },
  // The sheet's route prints `listBibs`' rows, members first by their `member` (`bibs-pdf.ts#sheetPages`).
  { file: "src/app/api/admin/events/[id]/bibs/route.ts", what: "the sheet's route", reads: /listBibs\(/ },
  // The print card's counts and the grid's order on the bibs page: `listBibs`' `member`.
  { file: "src/app/[locale]/admin/events/[id]/bibs/page.tsx", what: "the print card's counts", reads: /bibs\.filter\(\(bib\) => bib\.member\)/ },
  // The bib's picture (the desk's, the bibs page's grid, the registration's): the TypeScript twin over its one row.
  { file: "src/app/api/admin/events/[id]/bibs/preview/route.ts", what: "the preview route", reads: /printsMemberBib\(\{ offered: event\.design\.member\.enabled, declared: row\.clubMemberDeclared, elite: row\.elite \}\)/ },
  // The list's rows (the export reads them), the registration's page and the desk's row: the rule in each query.
  { file: "src/modules/registrations/admin-repository.ts", what: "the admin repository's queries", reads: /memberBib:\s*PRINTS_MEMBER_BIB/g },
  // The desk's picture address (the review of §NNN): the desk row's `memberBib`, so a corrected tick is a fresh picture.
  { file: "src/modules/registrations/ui/DeskRow.tsx", what: "the desk's picture address", reads: /member: row\.memberBib\b/ },
  // The registration's «Număr de membru» line: the detail's `memberBib`.
  { file: "src/app/[locale]/admin/registrations/[id]/page.tsx", what: "the registration's page", reads: /registration\.memberBib\b/ },
  // The export's «Member bib»: the list row's `memberBib`, in the CSV and the workbook through one cell.
  { file: "src/app/api/admin/registrations/export/route.ts", what: "the export's column", reads: /memberBib:\s*row\.memberBib/g },
  { file: "src/modules/registrations/csv.ts", what: "the export's cell", reads: /memberBibCell\(row\.memberBib === true\)/ },
];

/** Every source file under `src/`, repository-relative, the migrations (history) aside. */
function sourceFiles(dir = "src"): string[] {
  return readdirSync(path.join(ROOT, dir)).flatMap((name) => {
    const relative = `${dir}/${name}`;
    if (relative === "src/db/migrations") return [];
    if (statSync(path.join(ROOT, relative)).isDirectory()) return sourceFiles(relative);
    return /\.(ts|tsx)$/.test(name) ? [relative] : [];
  });
}

describe("§NNN one rule for the members' race number, read by every caller", () => {
  it("prints the three facts and nothing else: the design's switch, the member tick, not «Elită»", () => {
    const { sql } = new PgDialect().sqlToQuery(PRINTS_MEMBER_BIB);
    expect(sql).toContain('"registrations"."club_member_declared"');
    expect(sql).toContain('not "registrations"."elite"');
    expect(sql).toContain(`'{member,enabled}'`);
    expect(sql).toContain(new PgDialect().sqlToQuery(OFFERS_MEMBER_BIB).sql);
    // No wish, no account, no kind, no state: a test registration answers like a real one (§30), the sheet's scope decides what prints.
    for (const absent of ["member_bib_wanted", "canonical_email", "staff_users", "participants", '"kind"', '"status"']) expect(sql, absent).not.toContain(absent);
  });

  it("defines the rule once: the SQL in `member-bib.ts`, its TypeScript twin in `domain/member-bib.ts`", () => {
    const defining = sourceFiles().filter((file) => /export (const|function) (PRINTS_MEMBER_BIB|printsMemberBib|OFFERS_MEMBER_BIB)\b/.test(source(file)));
    expect(defining.sort()).toEqual(["src/modules/registrations/domain/member-bib.ts", "src/modules/registrations/member-bib.ts"]);
    // And the switch is read in SQL only there (the editor and the pages read the design through `readBibDesign`).
    const switchInSql = sourceFiles().filter((file) => source(file).includes("'{member,enabled}'"));
    expect(switchInSql).toEqual(["src/modules/registrations/member-bib.ts"]);
  });

  it("is read by every place that decides which bib a registration prints", () => {
    for (const { file, what, reads } of CALLERS) expect(source(file), `${what} (${file})`).toMatch(reads);
    // The three queries of the admin repository — the list's rows, the registration's page, the desk's row — and both files of the export.
    expect(source("src/modules/registrations/admin-repository.ts").match(/memberBib:\s*PRINTS_MEMBER_BIB/g)).toHaveLength(3);
    expect(source("src/app/api/admin/registrations/export/route.ts").match(/memberBib:\s*row\.memberBib/g)).toHaveLength(2);
  });

  it("puts the rule's flag in every address that asks for a registration's picture, so a corrected tick is a fresh picture", () => {
    // The preview keeps an answer an hour (`bibs/preview/route.ts`): an address without the flag would show the old design.
    const asking = sourceFiles().filter((file) => file !== "src/modules/registrations/domain/bib-stamp.ts" && source(file).includes("bibPictureSrc("));
    expect(asking.sort()).toEqual(["src/app/[locale]/admin/events/[id]/bibs/page.tsx", "src/modules/registrations/ui/DeskRow.tsx"]);
    for (const file of asking) {
      const calls = [...source(file).matchAll(/bibPictureSrc\(\{[^}]*\}\)/g)].map((match) => match[0]);
      expect(calls.length, file).toBeGreaterThan(0);
      for (const call of calls) expect(call, file).toMatch(/\bmember: (bib\.member|row\.memberBib)\b/);
    }
  });

  it("reads no member account for a bib any more: the sheet, its route, the picture and the bibs page import nothing of «Echipa»", () => {
    for (const file of [
      "src/modules/registrations/bibs.ts",
      "src/modules/registrations/member-bib.ts",
      "src/modules/registrations/domain/member-bib.ts",
      "src/app/api/admin/events/[id]/bibs/route.ts",
      "src/app/api/admin/events/[id]/bibs/preview/route.ts",
      "src/app/[locale]/admin/events/[id]/bibs/page.tsx",
    ]) {
      const text = source(file);
      expect(text, file).not.toMatch(/member-ticks|memberCanonicalEmails|staffUsers|canonicalEmail/);
    }
    // The asked-but-not-verified count and its filter are gone with the state.
    for (const file of sourceFiles()) expect(source(file), file).not.toMatch(/countUnverifiedMemberBibs|memberBibAsked|memberBibOf\b|memberBibKept|memberBibTickedAtFirst/);
  });

  it("writes «Vreau numărul de membru» false and reads it nowhere: the column, the write, the details' type and the trail's word alone", () => {
    const mentioning = sourceFiles().filter((file) => /memberBibWanted|member_bib_wanted/.test(source(file)));
    expect(mentioning.sort()).toEqual([
      // The column, kept (expand/contract).
      "src/db/schema/registrations.ts",
      // The trail's word for an old correction (`RETIRED_ANSWERS`).
      "src/modules/registrations/answers.ts",
      // The details' type and the insert's default.
      "src/modules/registrations/names.ts",
      "src/modules/registrations/repository.ts",
      // The one write: false.
      "src/modules/registrations/service.ts",
    ]);
    expect(source("src/modules/registrations/service.ts")).toMatch(/memberBibWanted: false,/);
    expect(source("src/modules/registrations/service.ts").match(/memberBibWanted/g)).toHaveLength(1);
    expect(RETIRED_ANSWERS).toEqual(["memberBibWanted"]);
    // No form posts it: no box of that name anywhere.
    for (const file of sourceFiles()) expect(source(file), file).not.toMatch(/name=["{]?["`']?memberBibWanted/);
  });

  it("asks the question in no catalogue: the trail's label is the one word left, in both languages", () => {
    for (const catalogue of [ro, en]) {
      const flat = JSON.stringify(catalogue);
      expect(flat).not.toContain("memberBibWantedHelp");
      expect(flat).not.toContain("memberBibWantedStaffHelp");
      expect(flat).not.toContain("memberUnverified");
      expect(catalogue.Registration).not.toHaveProperty("memberBibWanted");
      expect(catalogue.Admin.registrations.answers.fields).toHaveProperty("memberBibWanted");
    }
    expect(JSON.stringify(ro).match(/Vreau numărul de membru/g)).toHaveLength(1);
    expect(JSON.stringify(en).match(/I want the members' number/g)).toHaveLength(1);
  });
});
