import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import { registrationStatus } from "@/db/schema/registrations";
import { buildRegistrationsCsv, type RegistrationCsvRow } from "@/modules/registrations/csv";
import { CLUB_RUNNER_YES, clubRunnerCell, isClubRunner } from "@/modules/registrations/domain/club-runner";
import { colourRules, ROW_TINTS, STATUS_TINT, statusesOfTint, TINT_FILL } from "@/modules/registrations/sheet-colours";
import { buildSponsorListWorkbook } from "@/modules/registrations/sponsor-sheet";
import { statisticsCells, statisticsOf, statisticsWordsFrom, type StatisticsWords } from "@/modules/registrations/statistics";
import { buildRegistrationsWorkbook, REGISTRATION_SHEET_HEADERS, writeSheet, type RegistrationSheetRow } from "@/modules/registrations/workbook";
import { contrastRatio } from "@/modules/appearance/domain/tint-contrast";
import { CLUB_NAME, SHEET_TINT } from "@/theme/brand";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { columnLetter, isBoldStyle, rawCells, readSheet, startListRows, unzip } from "../../helpers/xlsx";

/**
 * §787 (amended) — the Excel export, live: the rows coloured by conditional formatting, the statistics footer as
 * formulas. The owner, 2026-10-16: «în excel export aș vrea color codes în funcție de status și dacă sunt membri
 * BVR» and «statisticile din Excel trebuie să se actualizeze automat offline, gen să fie formule în Excel».
 *
 * Read back from the bytes, like every spreadsheet test here (`tests/helpers/xlsx.ts`). The formulas are not only
 * looked for: a small evaluator of the three shapes the footer writes (`COUNTA`, `COUNTIF(S)` and a difference of
 * cells) runs them over the sheet's own cells, so a wrong range, a wrong column or a wrong word fails here rather
 * than in Excel — and an offline edit of a cell is simulated by editing the grid and evaluating again.
 */
const wordsOf = (locale: "ro" | "en"): StatisticsWords => {
  const catalogue = locale === "ro" ? ro : en;
  const t = createTranslator({ locale, messages: catalogue.Admin.registrations.statistics as never });
  return statisticsWordsFrom((key, values) => t(key as never, values as never), CLUB_NAME);
};
const RO = wordsOf("ro");
const EN = wordsOf("en");

let serial = 0;
const sheetRow = (over: Partial<RegistrationSheetRow> = {}): RegistrationSheetRow => {
  serial += 1;
  return {
    id: `00000000-0000-4000-8000-${String(serial).padStart(12, "0")}`,
    eventTitle: "Crosul Tâmpei",
    registeredName: `Alergător ${serial}`,
    firstName: "A",
    lastName: `${serial}`,
    idDocument: "",
    email: `r${serial}@example.org`,
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
    submittedAt: new Date("2026-09-04T10:00:00.000Z"),
    confirmedAt: null,
    bibNumber: null,
    checkedInAt: null,
    emailBounced: false,
    ...over,
  };
};

/** A row as the route builds it: the club flag is `isClubRunner`'s answer for the row's own signals. */
const row = (over: Partial<RegistrationSheetRow> = {}): RegistrationSheetRow => {
  const own = sheetRow(over);
  return { ...own, clubRunner: isClubRunner(own) };
};

/** Every state, the club by each of its three signals and not, two sexes, five bands, one with no age. */
function mixed(): RegistrationSheetRow[] {
  return [
    row({ status: "CONFIRMED", sex: "Female", ageOnRaceDay: 25, clubMemberDeclared: true }),
    row({ status: "CONFIRMED", sex: "Male", ageOnRaceDay: 35, clubName: "BVR" }),
    row({ status: "CONFIRMED", sex: "Female", ageOnRaceDay: 25, clubName: "Alt Club" }),
    row({ status: "PENDING_EMAIL_CONFIRMATION", sex: "Male", ageOnRaceDay: 16, memberVerified: true }),
    row({ status: "PENDING_DECLARATION", sex: "Female", ageOnRaceDay: 61 }),
    row({ status: "WAITLISTED", sex: "Male", ageOnRaceDay: null }),
    row({ status: "WAITLIST_OFFERED", sex: "Female", ageOnRaceDay: 25, clubMemberDeclared: true }),
    row({ status: "CANCELLED", sex: "Male", ageOnRaceDay: 35 }),
    row({ status: "EXPIRED", sex: "Female", ageOnRaceDay: 40, clubName: "Runners Brașov" }),
  ];
}

const build = (rows: RegistrationSheetRow[], words: StatisticsWords | undefined = RO, extra: { notesHeader?: string } = {}) =>
  buildRegistrationsWorkbook(rows, "Crosul Tâmpei", { ...extra, statistics: words });

const unescapeXml = (value: string) => value.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

const letterIndex = (letters: string) => [...letters].reduce((sum, letter) => sum * 26 + (letter.charCodeAt(0) - 64), 0) - 1;
const headerAt = (header: string, headers: readonly string[] = REGISTRATION_SHEET_HEADERS) => headers.indexOf(header);

/** Every formula cell of the sheet: its reference, the formula as written (no `=`) and the value stored beside it. */
function formulasOf(buffer: Buffer): Map<string, { formula: string; cached: string | undefined }> {
  const sheet = unzip(buffer).get("xl/worksheets/sheet1.xml") ?? "";
  const found = new Map<string, { formula: string; cached: string | undefined }>();
  for (const cell of sheet.matchAll(/<c r="([A-Z]+\d+)"[^>]*><f>([\s\S]*?)<\/f>(?:<v>([^<]*)<\/v>)?<\/c>/g)) {
    found.set(cell[1], { formula: unescapeXml(cell[2]), cached: cell[3] });
  }
  return found;
}

type Grid = (string | undefined)[][];

/** A spreadsheet criterion against a cell: `>=n`, `<n`, or whole-text equality (`=text` with `~` shielding a wildcard). */
function matches(value: string | undefined, criterion: string): boolean {
  const operator = /^(>=|<=|<|>|=)/.exec(criterion)?.[1];
  const operand = operator ? criterion.slice(operator.length) : criterion;
  if (operator === ">=" || operator === "<=" || operator === "<" || operator === ">") {
    if (value === undefined || value === "") return false;
    const number = Number(value);
    return operator === ">=" ? number >= Number(operand) : operator === "<=" ? number <= Number(operand) : operator === "<" ? number < Number(operand) : number > Number(operand);
  }
  const wanted = operand.replace(/~(.)/g, "$1");
  return (value ?? "").toLowerCase() === wanted.toLowerCase();
}

/** What a footer formula comes to over the grid — the file's own cells, a formula cell read by evaluating it, never by its cache. */
function evaluate(formula: string, grid: Grid, formulas: ReadonlyMap<string, { formula: string; cached: string | undefined }>): number {
  const cells = (range: string) => {
    const [, column, from, to] = /^\$([A-Z]+)\$(\d+):\$[A-Z]+\$(\d+)$/.exec(range)!;
    return Array.from({ length: Number(to) - Number(from) + 1 }, (_, at) => grid[Number(from) - 1 + at]?.[letterIndex(column)]);
  };
  const reference = (ref: string): number => {
    const known = formulas.get(ref);
    if (known) return evaluate(known.formula, grid, formulas);
    const [, column, rowNumber] = /^([A-Z]+)(\d+)$/.exec(ref)!;
    return Number(grid[Number(rowNumber) - 1]?.[letterIndex(column)] ?? 0);
  };
  let found: RegExpExecArray | null;
  if ((found = /^COUNTA\((\$[A-Z]+\$\d+:\$[A-Z]+\$\d+)\)$/.exec(formula))) return cells(found[1]).filter((value) => value !== undefined && value !== "").length;
  if ((found = /^COUNTIFS?\((.*)\)$/.exec(formula))) {
    const pairs = [...found[1].matchAll(/(\$[A-Z]+\$\d+:\$[A-Z]+\$\d+),"((?:[^"]|"")*)"/g)].map((pair) => ({ values: cells(pair[1]), criterion: pair[2].replace(/""/g, '"') }));
    expect(pairs.map((pair) => `${pair.values.length}`).filter((length, _, all) => length !== all[0])).toEqual([]);
    return pairs[0].values.filter((_, at) => pairs.every((pair) => matches(pair.values[at], pair.criterion))).length;
  }
  if ((found = /^([A-Z]+\d+)-SUM\(([A-Z]+)(\d+):[A-Z]+(\d+)\)$/.exec(formula))) {
    let sum = 0;
    for (let at = Number(found[3]); at <= Number(found[4]); at += 1) sum += reference(`${found[2]}${at}`);
    return reference(found[1]) - sum;
  }
  if ((found = /^([A-Z]+\d+)-([A-Z]+\d+)$/.exec(formula))) return reference(found[1]) - reference(found[2]);
  if ((found = /^([A-Z]+\d+)$/.exec(formula))) return reference(found[1]);
  throw new Error(`a formula this test cannot evaluate: ${formula}`);
}

/** The sheet's grid with its footer cells as the file stores them (a formula cell holds its cache; `evaluate` ignores that). */
const gridOf = (buffer: Buffer): Grid => readSheet(buffer).rows;

/** Every formula of the footer evaluated over the grid, by reference. */
function evaluated(buffer: Buffer, grid: Grid = gridOf(buffer)): Map<string, number> {
  const formulas = formulasOf(buffer);
  return new Map([...formulas.keys()].map((ref) => [ref, evaluate(formulas.get(ref)!.formula, grid, formulas)]));
}

/** The styles part: the fill colour each cell format paints, and the differential formats' fills. */
function stylesOf(buffer: Buffer) {
  const styles = unzip(buffer).get("xl/styles.xml") ?? "";
  const fills = [...(/<fills[^>]*>([\s\S]*?)<\/fills>/.exec(styles)?.[1] ?? "").matchAll(/<fill>([\s\S]*?)<\/fill>/g)].map((fill) => /<fgColor rgb="([0-9A-F]{8})"/.exec(fill[1])?.[1]);
  const formats = [...(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles)?.[1] ?? "").matchAll(/<xf\b([^>]*?)(?:\/>|>[\s\S]*?<\/xf>)/g)];
  const fillOfStyle = (style: number | undefined) => (style === undefined ? undefined : fills[Number(/\bfillId="(\d+)"/.exec(formats[style]?.[1] ?? "")?.[1] ?? 0)]);
  const dxfs = [...(/<dxfs[^>]*>([\s\S]*?)<\/dxfs>/.exec(styles)?.[1] ?? "").matchAll(/<dxf>([\s\S]*?)<\/dxf>/g)].map((dxf) => ({
    fill: /<bgColor rgb="([0-9A-F]{8})"/.exec(dxf[1])?.[1],
    markup: dxf[1],
  }));
  return { fillOfStyle, dxfs };
}

const argb = (hex: string) => `FF${hex.slice(1).toUpperCase()}`;

type Rule = { sqref: string; type: string; dxfId: number; priority: number; formula: string };

/** The conditional-formatting rules of the sheet, as written. */
function rulesOf(buffer: Buffer): Rule[] {
  const sheet = unzip(buffer).get("xl/worksheets/sheet1.xml") ?? "";
  const rules: Rule[] = [];
  for (const block of sheet.matchAll(/<conditionalFormatting sqref="([^"]+)">([\s\S]*?)<\/conditionalFormatting>/g)) {
    for (const rule of block[2].matchAll(/<cfRule type="([^"]+)" dxfId="(\d+)" priority="(\d+)"><formula>([\s\S]*?)<\/formula><\/cfRule>/g)) {
      rules.push({ sqref: block[1], type: rule[1], dxfId: Number(rule[2]), priority: Number(rule[3]), formula: unescapeXml(rule[4]) });
    }
  }
  return rules;
}

const LAST_COLUMN = columnLetter(REGISTRATION_SHEET_HEADERS.length - 1);
const STATUS = columnLetter(headerAt("Status"));
const CLUB_RUNNER = columnLetter(headerAt("Club runner"));

describe("§787 the «Club runner» column: the one predicate, written where a formula and a rule can read it", () => {
  it("sits right after «Club member» in the spreadsheet, and the rest of the header is what it was", () => {
    expect(REGISTRATION_SHEET_HEADERS[headerAt("Club member") + 1]).toBe("Club runner");
    expect(REGISTRATION_SHEET_HEADERS[headerAt("Club runner") + 1]).toBe("Member bib");
    const without = REGISTRATION_SHEET_HEADERS.filter((header) => header !== "Club runner");
    expect(without).toHaveLength(REGISTRATION_SHEET_HEADERS.length - 1);
    expect(new Set(REGISTRATION_SHEET_HEADERS).size).toBe(REGISTRATION_SHEET_HEADERS.length);
  });

  it("says «Yes» exactly when isClubRunner does — by a member, the box or a typed club — and nothing otherwise", async () => {
    const cases: Array<[Partial<RegistrationSheetRow>, boolean]> = [
      [{ memberVerified: true }, true],
      [{ clubMemberDeclared: true }, true],
      [{ clubName: "Brașov Runners" }, true],
      [{ clubName: "Clubul Brașov Runners (BVR)" }, true],
      [{ clubName: "Alt Club" }, false],
      [{ clubName: "Brașov Runners Cluj" }, false],
      [{}, false],
    ];
    const rows = cases.map(([over]) => row(over));
    const { rows: grid } = readSheet(await build(rows));
    const at = headerAt("Club runner");
    cases.forEach(([, expected], index) => {
      expect(isClubRunner(rows[index]), JSON.stringify(cases[index][0])).toBe(expected);
      expect(grid[index + 1]?.[at], JSON.stringify(cases[index][0])).toBe(expected ? CLUB_RUNNER_YES : undefined);
    });
    // The cell is text, so a formula reading it with `"Yes"` finds it; the word itself comes from the one place.
    expect(CLUB_RUNNER_YES).toBe("Yes");
    expect(clubRunnerCell(true)).toBe("Yes");
    expect(clubRunnerCell(false)).toBe("");
  });

  it("is in the CSV too, as the last fixed column (the file's convention, §425/§664), with the same cell", () => {
    const base: RegistrationCsvRow = {
      eventTitle: "Test", registeredName: "Ana", firstName: "Ana", lastName: "Pop", idDocument: "", email: "a@example.ro", status: "CONFIRMED", clubMemberDeclared: false,
      memberVerified: false, clubRunner: false, fitnessDeclaredAt: null, stravaUrl: "", instagramHandle: "", guardianName: "", guardianIdDocument: "", submittedAt: "", confirmedAt: "", checkedInAt: "", emailBounced: false,
    };
    const [header, club, other] = buildRegistrationsCsv([{ ...base, clubRunner: true }, base]).split("\r\n");
    const columns = header.split(",");
    // Last, after «Member bib», as a script that reads by position expects: every earlier column keeps its index.
    expect(columns.at(-1)).toBe("Club runner");
    expect(columns.at(-2)).toBe("Member bib");
    expect(columns.indexOf("Club member") + 1).toBe(columns.indexOf("Medically fit (declared)"));
    const at = columns.indexOf("Club runner");
    expect(club.split(",")[at]).toBe("Yes");
    expect(other.split(",")[at]).toBe("");
    // With «Note interne» the notes stay the very last column.
    const withNotes = buildRegistrationsCsv([base], { notesHeader: "Note interne" }).split("\r\n")[0].split(",");
    expect(withNotes.slice(-2)).toEqual(["Club runner", "Note interne"]);
    // The same rows, no styling and no footer: the legend and the statistics are the spreadsheet's alone.
    expect(buildRegistrationsCsv([base]).split("\r\n")).toHaveLength(2);
    expect(buildRegistrationsCsv([base])).not.toMatch(/Culori|Colours|Statistici|COUNTIF/);
  });
});

describe("§787 the colours are conditional formatting, never a baked fill", () => {
  it("has one differential format per tint, each a solid pale fill from the brand's palette", async () => {
    const buffer = await build(mixed());
    const { dxfs } = stylesOf(buffer);
    expect(dxfs).toHaveLength(ROW_TINTS.length + 1);
    expect(dxfs.map((dxf) => dxf.fill).sort()).toEqual(Object.values(SHEET_TINT).map(argb).sort());
    for (const dxf of dxfs) expect(dxf.markup).toContain('patternType="solid"');
    expect(unzip(buffer).get("xl/styles.xml")).toMatch(/<dxfs count="5">/);
  });

  it("colours a row by its status: one expression rule a tint over exactly the data rows, every status the list knows", async () => {
    const data = mixed();
    const buffer = await build(data);
    const rules = rulesOf(buffer);
    const { dxfs } = stylesOf(buffer);
    const rowRules = rules.filter((rule) => rule.sqref.startsWith("A2:"));
    expect(rowRules).toHaveLength(ROW_TINTS.length);
    for (const rule of rowRules) {
      expect(rule.type).toBe("expression");
      // The whole row, header and footer excluded: row 2 to the last registration, column A to the last column.
      expect(rule.sqref).toBe(`A2:${LAST_COLUMN}${data.length + 1}`);
    }
    // Every status of the enum has a tint, and the rule of its tint reads the status column for its own word.
    for (const status of registrationStatus.enumValues) {
      const tint = STATUS_TINT[status];
      expect(tint, status).toBeDefined();
      const owning = rowRules.filter((rule) => rule.formula.includes(`$${STATUS}2="${status}"`));
      expect(owning, status).toHaveLength(1);
      expect(dxfs[owning[0].dxfId].fill, status).toBe(argb(TINT_FILL[tint!]));
    }
    // Nothing red: the ended states are grey, and the waiting list the sky blue.
    expect(STATUS_TINT.CANCELLED).toBe("neutral");
    expect(STATUS_TINT.EXPIRED).toBe("neutral");
    expect(STATUS_TINT.WAITLISTED).toBe("info");
    expect(STATUS_TINT.CONFIRMED).toBe("success");
    expect(statusesOfTint("warning").sort()).toEqual(["PENDING_DECLARATION", "PENDING_EMAIL_CONFIRMATION", "WAITLIST_OFFERED"]);
    // The rules read the status column's own words and no other column.
    for (const rule of rowRules) expect(rule.formula.replace(/"[A-Z_]+"/g, "").match(/\$[A-Z]+/g)?.every((column) => column === `$${STATUS}`)).toBe(true);
  });

  it("colours the three membership cells blue by the «Club runner» column, and that rule outranks the status tints", async () => {
    const data = mixed();
    const buffer = await build(data);
    const rules = rulesOf(buffer);
    const member = rules.filter((rule) => !rule.sqref.startsWith("A2:"));
    expect(member).toHaveLength(1);
    const first = columnLetter(headerAt("Club member"));
    const last = columnLetter(headerAt("Member bib"));
    expect(member[0].sqref).toBe(`${first}2:${last}${data.length + 1}`);
    expect(member[0].formula).toBe(`$${CLUB_RUNNER}2="Yes"`);
    expect(stylesOf(buffer).dxfs[member[0].dxfId].fill).toBe(argb(SHEET_TINT.member));
    // «Club member», «Club runner» and «Member bib» are side by side, so the one range is exactly those three.
    expect([headerAt("Club member"), headerAt("Club runner"), headerAt("Member bib")]).toEqual([headerAt("Club member"), headerAt("Club member") + 1, headerAt("Club member") + 2]);
    // The lower the number, the higher the priority: the blue wins over the row's tint on those cells.
    for (const rule of rules.filter((rule) => rule.sqref.startsWith("A2:"))) expect(member[0].priority).toBeLessThan(rule.priority);
    expect(new Set(rules.map((rule) => rule.priority)).size).toBe(rules.length);
  });

  it("bakes no fill into a data cell or the header: only the legend's own cells carry one", async () => {
    const data = mixed();
    const buffer = await build(data);
    const { fillOfStyle } = stylesOf(buffer);
    const cells = rawCells(buffer);
    for (const [reference, cell] of cells) {
      const rowNumber = Number(reference.replace(/\D/g, ""));
      if (rowNumber <= data.length + 1) expect(fillOfStyle(cell.style), reference).toBeUndefined();
    }
    // The header keeps its bold and has no fill; the status column still says the state in words.
    expect(isBoldStyle(buffer, cells.get("A1")!.style)).toBe(true);
    const { rows } = readSheet(buffer);
    expect(rows[1]?.[headerAt("Status")]).toBe("CONFIRMED");
    expect(rows[9]?.[headerAt("Status")]).toBe("EXPIRED");
  });

  it("writes the rules for a header without a footer too, and none for a file without rows", async () => {
    const plain = await buildRegistrationsWorkbook(mixed(), "Crosul Tâmpei");
    expect(rulesOf(plain)).toHaveLength(ROW_TINTS.length + 1);
    expect(unzip(plain).get("xl/worksheets/sheet1.xml")).not.toContain("<f>");
    expect(rulesOf(await build([]))).toEqual([]);
    expect(colourRules({ statusColumn: 12, clubRunnerColumn: 19, memberColumns: [18, 20], lastColumn: 38, rowCount: 0 })).toEqual([]);
  });

  it("keeps ink on every tint at AA", () => {
    for (const hex of Object.values(SHEET_TINT)) expect(contrastRatio("#000000", hex), hex).toBeGreaterThanOrEqual(4.5);
    expect(new Set(Object.values(SHEET_TINT)).size).toBe(Object.values(SHEET_TINT).length);
  });
});

describe("§787 the statistics are formulas with today's number cached beside them", () => {
  it("writes every count as a formula cell with a cached value equal to the number statistics.ts computes", async () => {
    const data = mixed();
    const buffer = await build(data);
    const formulas = formulasOf(buffer);
    const { rows } = readSheet(buffer);
    const [block] = statisticsOf(data, RO);
    const at = (label: string) => rows.findIndex((line) => line?.[0] === label);
    const lines: Array<[string, number]> = [
      [RO.total, block.tally.total], [RO.confirmed, block.tally.confirmed], [RO.pendingEmail, block.tally.pendingEmail], [RO.pendingDeclaration, block.tally.pendingDeclaration],
      [RO.waitlisted, block.tally.waitlisted], [RO.waitlistOffered, block.tally.waitlistOffered], [RO.cancelled, block.tally.cancelled], [RO.expired, block.tally.expired],
      [RO.club, block.tally.club], [RO.clubConfirmed, block.tally.clubConfirmed], [RO.notClub, block.tally.total - block.tally.club],
    ];
    expect(lines.map(([, value]) => value)).toEqual([9, 3, 1, 1, 1, 1, 1, 1, 5, 2, 4]);
    for (const [label, value] of lines) {
      const reference = `B${at(label) + 1}`;
      const cell = formulas.get(reference);
      expect(cell, `${label} is a formula`).toBeDefined();
      expect(cell!.cached, `${label} carries its number`).toBe(String(value));
    }
    // The category table too: every number a formula, each with the tally's own number cached.
    const categoryHeader = at(RO.categoryHeader);
    block.categories.forEach((category, index) => {
      const own = categoryHeader + 1 + index;
      expect(rows[own]?.[0]).toBe(category.label);
      [category.tally.total, category.tally.confirmed, category.tally.club, category.tally.clubConfirmed].forEach((value, column) => {
        const reference = `${"BCDE"[column]}${own + 1}`;
        expect(formulas.get(reference), reference).toBeDefined();
        expect(formulas.get(reference)!.cached, reference).toBe(String(value));
      });
    });
  });

  it("writes the words a spreadsheet reads: COUNTA of the ids, COUNTIF of a status, COUNTIFS of a category, over the data rows' absolute ranges", async () => {
    const data = mixed();
    const buffer = await build(data);
    const formulas = formulasOf(buffer);
    const { rows } = readSheet(buffer);
    const last = data.length + 1;
    const range = (header: string) => `$${columnLetter(headerAt(header))}$2:$${columnLetter(headerAt(header))}$${last}`;
    const formulaOf = (label: string, column = "B") => formulas.get(`${column}${rows.findIndex((line) => line?.[0] === label) + 1}`)!.formula;
    expect(formulaOf(RO.total)).toBe(`COUNTA(${range("ID")})`);
    expect(formulaOf(RO.confirmed)).toBe(`COUNTIF(${range("Status")},"CONFIRMED")`);
    expect(formulaOf(RO.pendingEmail)).toBe(`COUNTIF(${range("Status")},"PENDING_EMAIL_CONFIRMATION")`);
    expect(formulaOf(RO.pendingDeclaration)).toBe(`COUNTIF(${range("Status")},"PENDING_DECLARATION")`);
    expect(formulaOf(RO.waitlisted)).toBe(`COUNTIF(${range("Status")},"WAITLISTED")`);
    expect(formulaOf(RO.waitlistOffered)).toBe(`COUNTIF(${range("Status")},"WAITLIST_OFFERED")`);
    expect(formulaOf(RO.cancelled)).toBe(`COUNTIF(${range("Status")},"CANCELLED")`);
    expect(formulaOf(RO.expired)).toBe(`COUNTIF(${range("Status")},"EXPIRED")`);
    expect(formulaOf(RO.club)).toBe(`COUNTIF(${range("Club runner")},"Yes")`);
    expect(formulaOf(RO.clubConfirmed)).toBe(`COUNTIFS(${range("Club runner")},"Yes",${range("Status")},"CONFIRMED")`);
    // Women 18-29 (the first category row): the sex cell's words and the band's two edges — the last band open-ended.
    const women = rows.findIndex((line) => line?.[0] === "Feminin, 18-29 ani");
    expect(formulas.get(`B${women + 1}`)!.formula).toBe(`COUNTIFS(${range("Sex")},"Female",${range("Age on race day")},">=18",${range("Age on race day")},"<30")`);
    const oldest = rows.findIndex((line) => line?.[0] === "Feminin, 60+ ani");
    expect(formulas.get(`B${oldest + 1}`)!.formula).toBe(`COUNTIFS(${range("Sex")},"Female",${range("Age on race day")},">=60")`);
    const youngest = rows.findIndex((line) => line?.[0] === "Masculin, sub 18 ani");
    expect(formulas.get(`B${youngest + 1}`)!.formula).toBe(`COUNTIFS(${range("Sex")},"Male",${range("Age on race day")},">=0",${range("Age on race day")},"<18")`);
    // «No category» is the total less the categories above it, per column — a difference, never a count of its own.
    const none = rows.findIndex((line) => line?.[0] === RO.noCategory);
    const firstCategory = rows.findIndex((line) => line?.[0] === RO.categoryHeader) + 2;
    expect(formulas.get(`B${none + 1}`)!.formula).toBe(`B${rows.findIndex((line) => line?.[0] === RO.total) + 1}-SUM(B${firstCategory}:B${none})`);
    expect(formulas.get(`E${none + 1}`)!.formula).toBe(`B${rows.findIndex((line) => line?.[0] === RO.clubConfirmed) + 1}-SUM(E${firstCategory}:E${none})`);
    // «Others» is the total less the club's.
    expect(formulaOf(RO.notClub)).toBe(`B${rows.findIndex((line) => line?.[0] === RO.total) + 1}-B${rows.findIndex((line) => line?.[0] === RO.club) + 1}`);
  });

  it("evaluates, over the sheet's own cells, to the number cached beside it — every formula of the footer", async () => {
    const buffer = await build(mixed());
    const formulas = formulasOf(buffer);
    const results = evaluated(buffer);
    // Eleven lines and six categories of four numbers each.
    expect(results.size).toBe(11 + 6 * 4);
    for (const [reference, result] of results) expect(String(result), `${reference}: ${formulas.get(reference)!.formula}`).toBe(formulas.get(reference)!.cached);
  });

  it("follows an offline edit: change a status, a sex or an age, or untick membership, and the numbers move with it", async () => {
    const data = mixed();
    const buffer = await build(data);
    const grid = gridOf(buffer);
    const rows = readSheet(buffer).rows;
    const numberAt = (label: string, column = "B", where: Grid = grid) => {
      const found = evaluated(buffer, where).get(`${column}${rows.findIndex((line) => line?.[0] === label) + 1}`);
      expect(found, label).toBeDefined();
      return found!;
    };
    expect(numberAt(RO.confirmed)).toBe(3);
    // The first registration (row 2): confirmed → cancelled.
    const edited = grid.map((line) => (line ? [...line] : line)) as Grid;
    edited[1][headerAt("Status")] = "CANCELLED";
    expect(numberAt(RO.confirmed, "B", edited)).toBe(2);
    expect(numberAt(RO.cancelled, "B", edited)).toBe(2);
    expect(numberAt(RO.total, "B", edited)).toBe(9);
    // …and she was one of the club's, confirmed: both club lines follow, the others' line does not.
    expect(numberAt(RO.clubConfirmed, "B", edited)).toBe(1);
    expect(numberAt(RO.club, "B", edited)).toBe(5);
    // Untick her membership in the «Club runner» cell.
    edited[1][headerAt("Club runner")] = undefined;
    expect(numberAt(RO.club, "B", edited)).toBe(4);
    expect(numberAt(RO.notClub, "B", edited)).toBe(5);
    // A sex and an age put her in another category; the table still adds up through «No category».
    edited[1][headerAt("Age on race day")] = "70";
    const women = rows.findIndex((line) => line?.[0] === "Feminin, 18-29 ani");
    expect(evaluated(buffer, edited).get(`B${women + 1}`)).toBe(2);
    const noCategory = rows.findIndex((line) => line?.[0] === RO.noCategory);
    const categories = [...Array(noCategory - (rows.findIndex((line) => line?.[0] === RO.categoryHeader) + 1)).keys()].map((index) => rows.findIndex((line) => line?.[0] === RO.categoryHeader) + 2 + index);
    const total = (column: string) => categories.reduce((sum, rowNumber) => sum + evaluated(buffer, edited).get(`${column}${rowNumber}`)!, 0) + evaluated(buffer, edited).get(`${column}${noCategory + 1}`)!;
    expect(total("B")).toBe(9);
  });

  it("always holds a «No category» row, so an offline edit that blanks a runner's age or sex still leaves the table adding up", async () => {
    // Every runner is categorised when the file is written: the tally has no «no category» group today.
    const data = [
      row({ status: "CONFIRMED", sex: "Female", ageOnRaceDay: 25, clubMemberDeclared: true }),
      row({ status: "CONFIRMED", sex: "Male", ageOnRaceDay: 35 }),
      row({ status: "PENDING_DECLARATION", sex: "Female", ageOnRaceDay: 45 }),
      row({ status: "WAITLISTED", sex: "Male", ageOnRaceDay: 55 }),
      row({ status: "CONFIRMED", sex: "Male", ageOnRaceDay: 16 }),
    ];
    const buffer = await build(data);
    const rows = readSheet(buffer).rows;
    const formulas = formulasOf(buffer);
    const header = rows.findIndex((line) => line?.[0] === RO.categoryHeader);
    const noCategory = rows.findIndex((line) => line?.[0] === RO.noCategory);
    expect(noCategory).toBeGreaterThan(header);
    // The row is the table's last, a difference of the group's count and the rows above it, cached 0 today.
    const totalRow = rows.findIndex((line) => line?.[0] === RO.total) + 1;
    expect(formulas.get(`B${noCategory + 1}`)).toEqual({ formula: `B${totalRow}-SUM(B${header + 2}:B${noCategory})`, cached: "0" });
    for (const column of "BCDE") expect(formulas.get(`${column}${noCategory + 1}`)?.cached, column).toBe("0");
    for (const [reference, result] of evaluated(buffer)) expect(String(result), reference).toBe(formulas.get(reference)!.cached);

    // The club blanks one age offline: «Total» still counts the runner and the table still adds up, through that row.
    const grid = gridOf(buffer);
    const edited = grid.map((line) => (line ? [...line] : line)) as Grid;
    edited[2][headerAt("Age on race day")] = undefined;
    const after = evaluated(buffer, edited);
    const categoryRows = Array.from({ length: noCategory - header - 1 }, (_, index) => header + 2 + index);
    // Each column's lines above the table: the group's total, confirmed, club and club-confirmed.
    const lineOf = (label: string) => rows.findIndex((line) => line?.[0] === label) + 1;
    const group = { B: lineOf(RO.total), C: lineOf(RO.confirmed), D: lineOf(RO.club), E: lineOf(RO.clubConfirmed) };
    for (const [column, line] of Object.entries(group)) {
      const summed = categoryRows.reduce((sum, rowNumber) => sum + after.get(`${column}${rowNumber}`)!, 0) + after.get(`${column}${noCategory + 1}`)!;
      expect(summed, `column ${column}`).toBe(after.get(`B${line}`));
    }
    expect(after.get(`B${totalRow}`)).toBe(5);
    expect(after.get(`B${noCategory + 1}`)).toBe(1);
    expect(after.get(`C${noCategory + 1}`)).toBe(1);
    // Without a sheet around it (no ranges) the table is the tally's own rows, as before.
    const bare = statisticsCells(statisticsOf(data, RO), RO);
    expect(bare.some((cells) => cells[0] && (cells[0] as { value?: string }).value === RO.noCategory)).toBe(false);
  });

  it("asks the workbook to recalculate on open, and only when there is a formula to recalculate", async () => {
    const parts = unzip(await build(mixed()));
    expect(parts.get("xl/workbook.xml")).toMatch(/<calcPr fullCalcOnLoad="1"\/>/);
    const without = unzip(await buildRegistrationsWorkbook(mixed(), "Crosul Tâmpei"));
    expect(without.get("xl/workbook.xml")).not.toContain("fullCalcOnLoad");
  });

  it("keeps the footer outside the rows a sort takes, the formulas' ranges stopping at the last registration", async () => {
    const data = mixed();
    const buffer = await build(data);
    const { rows } = readSheet(buffer);
    expect(startListRows(rows)).toHaveLength(1 + data.length);
    for (const { formula } of formulasOf(buffer).values()) {
      for (const range of formula.matchAll(/\$[A-Z]+\$(\d+):\$[A-Z]+\$(\d+)/g)) {
        expect([range[1], range[2]]).toEqual(["2", String(data.length + 1)]);
      }
    }
  });

  it("writes a footer for a file with no registrations that evaluates to zeros, never an error", async () => {
    const buffer = await build([]);
    const results = evaluated(buffer);
    expect(results.size).toBeGreaterThan(5);
    for (const result of results.values()) expect(result).toBe(0);
  });

  it("is the same with the notes column and in English", async () => {
    const data = mixed();
    for (const [words, notesHeader] of [[RO, "Note interne"], [EN, "Internal notes"]] as const) {
      const buffer = await build(data, words, { notesHeader });
      const formulas = formulasOf(buffer);
      for (const [reference, result] of evaluated(buffer)) expect(String(result), reference).toBe(formulas.get(reference)!.cached);
      // The colour rules reach the notes column too: the last column of the table.
      expect(rulesOf(buffer).find((rule) => rule.sqref.startsWith("A2:"))!.sqref).toBe(`A2:${columnLetter(REGISTRATION_SHEET_HEADERS.length)}${data.length + 1}`);
    }
  });
});

describe("§787 a file of several events: an «Event» column the per-event counts filter by", () => {
  const event = (id: string, label: string, startsAt: string) => ({ eventId: id, eventLabel: label, eventTitle: "Alergare", eventStartsAt: new Date(startsAt) });
  const several = () => [
    row({ ...event("e1", "Alergare · 18.10.2026", "2026-10-18T08:00:00.000Z"), status: "CONFIRMED", sex: "Female", ageOnRaceDay: 25, clubMemberDeclared: true }),
    row({ ...event("e1", "Alergare · 18.10.2026", "2026-10-18T08:00:00.000Z"), status: "CANCELLED", sex: "Male", ageOnRaceDay: 45 }),
    row({ ...event("e2", "Alergare · 25.10.2026", "2026-10-25T08:00:00.000Z"), status: "CONFIRMED", sex: "Female", ageOnRaceDay: 25 }),
    row({ ...event("e2", "Alergare · 25.10.2026", "2026-10-25T08:00:00.000Z"), status: "WAITLISTED", sex: "Female", ageOnRaceDay: 52, clubName: "BVR" }),
    row({ ...event("e2", "Alergare · 25.10.2026", "2026-10-25T08:00:00.000Z"), status: "CONFIRMED", sex: "Male", ageOnRaceDay: 45, memberVerified: true }),
  ];

  it("adds «Event» after «Name» only to a file of several events with a footer; one event's file is as it was", async () => {
    const { rows } = readSheet(await build(several()));
    const header = rows[0] as string[];
    expect(header[header.indexOf("Name") + 1]).toBe("Event");
    expect(header.filter((cell) => cell !== "Event")).toEqual([...REGISTRATION_SHEET_HEADERS]);
    expect(rows.slice(1, 6).map((line) => line?.[header.indexOf("Event")])).toEqual([
      "Alergare · 18.10.2026", "Alergare · 18.10.2026", "Alergare · 25.10.2026", "Alergare · 25.10.2026", "Alergare · 25.10.2026",
    ]);
    expect(readSheet(await build(mixed())).rows[0]).toEqual([...REGISTRATION_SHEET_HEADERS]);
    // Without a footer to count them, a several-events file has no use for the column either.
    expect(readSheet(await buildRegistrationsWorkbook(several(), "S")).rows[0]).toEqual([...REGISTRATION_SHEET_HEADERS]);
  });

  it("counts per event by the column, then over all of them, and every formula comes to its cached number", async () => {
    const data = several();
    const buffer = await build(data);
    const formulas = formulasOf(buffer);
    const { rows } = readSheet(buffer);
    const results = evaluated(buffer);
    for (const [reference, result] of results) expect(String(result), `${reference}: ${formulas.get(reference)!.formula}`).toBe(formulas.get(reference)!.cached);
    const total = (label: string) => results.get(`B${rows.findIndex((line) => line?.[0] === label) + 2}`);
    expect(total("Alergare · 18.10.2026")).toBe(2);
    expect(total("Alergare · 25.10.2026")).toBe(3);
    expect(total(RO.allEvents)).toBe(5);
    const header = rows[0] as string[];
    const eventRange = `$${columnLetter(header.indexOf("Event"))}$2:$${columnLetter(header.indexOf("Event"))}$6`;
    expect(formulas.get(`B${rows.findIndex((line) => line?.[0] === "Alergare · 25.10.2026") + 2}`)!.formula).toBe(`COUNTIF(${eventRange},"=Alergare · 25.10.2026")`);
    // The all-events block filters by no event.
    expect(formulas.get(`B${rows.findIndex((line) => line?.[0] === RO.allEvents) + 2}`)!.formula).toMatch(/^COUNTA\(/);
  });

  it("matches an event whose label holds a wildcard, a quote or a comparison sign as itself, and tells two same-labelled events apart", async () => {
    const odd = (id: string, label: string) => ({ eventId: id, eventLabel: label, eventTitle: "x", eventStartsAt: new Date("2026-10-18T08:00:00.000Z") });
    const data = [
      row({ ...odd("a", "Cros* ~ \"mare\" · 1"), status: "CONFIRMED" }),
      row({ ...odd("b", "Cros* ~ \"mare\" · 1"), status: "CONFIRMED" }),
      row({ ...odd("b", "Cros* ~ \"mare\" · 1"), status: "WAITLISTED" }),
      row({ ...odd("c", "<5K> · 2"), status: "CONFIRMED" }),
      row({ ...odd("d", "Cross mare"), status: "CONFIRMED" }),
    ];
    const buffer = await build(data);
    const formulas = formulasOf(buffer);
    const { rows } = readSheet(buffer);
    for (const [reference, result] of evaluated(buffer)) expect(String(result), `${reference}: ${formulas.get(reference)!.formula}`).toBe(formulas.get(reference)!.cached);
    // Two events with one label are two groups, the second one told apart — never one count over both.
    const labels = rows.map((line) => line?.[0]);
    expect(labels).toContain("Cros* ~ \"mare\" · 1");
    expect(labels).toContain("Cros* ~ \"mare\" · 1 (2)");
    const results = evaluated(buffer);
    const block = (label: string) => results.get(`B${labels.indexOf(label) + 2}`);
    expect(block("Cros* ~ \"mare\" · 1")).toBe(1);
    expect(block("Cros* ~ \"mare\" · 1 (2)")).toBe(2);
    expect(block("<5K> · 2")).toBe(1);
    // The wildcard did not reach «Cross mare»: «Cros*» matched itself alone.
    expect(block("Cross mare")).toBe(1);
  });

  it("leaves a count a plain number when the event's label is too long for a criterion", async () => {
    const long = "L".repeat(260);
    const data = [row({ eventId: "a", eventLabel: long, eventTitle: "x" }), row({ eventId: "b", eventLabel: "scurt", eventTitle: "y" })];
    const buffer = await build(data);
    const { rows } = readSheet(buffer);
    const at = rows.findIndex((line) => line?.[0] === long);
    expect(at).toBeGreaterThan(0);
    const formulas = formulasOf(buffer);
    for (let line = at + 2; line < at + 12; line += 1) expect(formulas.has(`B${line}`), `B${line}`).toBe(false);
    expect(rows[at + 1]?.[1]).toBe("1");
    // The other event's block is still live.
    expect(formulas.has(`B${rows.findIndex((cells) => cells?.[0] === "scurt") + 2}`)).toBe(true);
  });
});

/** The sheet's data validations as written: each rule's attributes and its inline list, in file order. */
function validationsOf(buffer: Buffer) {
  const sheet = unzip(buffer).get("xl/worksheets/sheet1.xml") ?? "";
  const block = /<dataValidations count="(\d+)">([\s\S]*?)<\/dataValidations>/.exec(sheet);
  const rules = [...(block?.[2] ?? "").matchAll(/<dataValidation ([^>]*)><formula1>([\s\S]*?)<\/formula1><\/dataValidation>/g)].map((rule) => {
    const attributes = Object.fromEntries([...rule[1].matchAll(/(\w+)="([^"]*)"/g)].map((pair) => [pair[1], unescapeXml(pair[2])]));
    return { attributes, list: unescapeXml(rule[2]) };
  });
  return { sheet, count: block ? Number(block[1]) : 0, rules };
}

describe("§790 (amended) «Status» right after the race number, and a drop-down, not free text", () => {
  const PICK = { ro: { title: ro.Admin.registrations.sheetpick.title, error: ro.Admin.registrations.sheetpick.error }, en: { title: en.Admin.registrations.sheetpick.title, error: en.Admin.registrations.sheetpick.error } };
  const buildPick = (rows: RegistrationSheetRow[], locale: "ro" | "en" = "ro", extra: { notesHeader?: string } = {}) =>
    buildRegistrationsWorkbook(rows, "Crosul Tâmpei", { ...extra, statistics: locale === "ro" ? RO : EN, statusPick: PICK[locale] });

  it("puts «Status» third, after «Race number (BIB)» and before «Name»; every other column keeps its relative order", async () => {
    const { rows } = readSheet(await buildPick(mixed()));
    expect((rows[0] as string[]).slice(0, 4)).toEqual(["ID", "Race number (BIB)", "Status", "Name"]);
    expect(REGISTRATION_SHEET_HEADERS.slice(0, 4)).toEqual(["ID", "Race number (BIB)", "Status", "Name"]);
    // Taking «Status» out leaves the columns in the order they had before it moved (§172, §510, §650, §662, §787).
    expect(REGISTRATION_SHEET_HEADERS.filter((header) => header !== "Status").slice(0, 14)).toEqual([
      "ID", "Race number (BIB)", "Name", "First name", "Last name", "Club", "Sex", "Age on race day", "Nationality", "Country", "City", "T-shirt size", "Until when", "Waiting on",
    ]);
    // The cells say what they said: the state's word, in the new column.
    expect(rows.slice(1, 10).map((line) => line?.[2])).toEqual(mixed().map((data) => data.status));
    expect(rows[0]?.filter((header) => header === "Status")).toHaveLength(1);
  });

  it("leaves the CSV's header exactly as it was: scripts read it by position", () => {
    const base: RegistrationCsvRow = {
      eventTitle: "Test", registeredName: "Ana", firstName: "Ana", lastName: "Pop", idDocument: "", email: "a@example.ro", status: "CONFIRMED", clubMemberDeclared: false,
      memberVerified: false, clubRunner: false, fitnessDeclaredAt: null, stravaUrl: "", instagramHandle: "", guardianName: "", guardianIdDocument: "", submittedAt: "", confirmedAt: "", checkedInAt: "", emailBounced: false,
    };
    expect(buildRegistrationsCsv([base]).split("\r\n")[0]).toBe(
      "Event,Name,First name,Last name,Identity document,Email,Status,Club member,Medically fit (declared),Strava,Instagram,Socials on the public list,Public list & results,Guardian,Guardian identity document,Submitted,Confirmed,Race number (BIB),Checked in,Email bounced,Terms version,Terms accepted,Declaration version,Declaration signed,family,Cancellation reason,Offers and benefits,Special guest,Until when,Waiting on,Age on race day,Country,City,Member bib,Club runner",
    );
  });

  it("reads the status column at the letter the header puts it: every formula range, every colour rule, in every shape of file", async () => {
    const several = [
      row({ eventId: "e1", eventLabel: "A · 18.10.2026", eventTitle: "A", eventStartsAt: new Date("2026-10-18T08:00:00.000Z"), status: "CONFIRMED", sex: "Female", ageOnRaceDay: 25 }),
      row({ eventId: "e2", eventLabel: "B · 25.10.2026", eventTitle: "B", eventStartsAt: new Date("2026-10-25T08:00:00.000Z"), status: "CANCELLED", sex: "Male", ageOnRaceDay: 45 }),
    ];
    for (const [name, buffer, data] of [
      ["one event", await buildPick(mixed()), mixed()],
      ["several events", await buildPick(several), several],
      ["with the notes column", await buildPick(mixed(), "en", { notesHeader: "Internal notes" }), mixed()],
    ] as const) {
      const header = readSheet(buffer).rows[0] as string[];
      const letter = columnLetter(header.indexOf("Status"));
      expect(letter, name).toBe("C");
      // Every footer formula that counts a status word names the status column, and no other column's letter stands for it.
      const counting = [...formulasOf(buffer).values()].map((cell) => cell.formula).filter((formula) => registrationStatus.enumValues.some((status) => formula.includes(`"${status}"`)));
      expect(counting.length, name).toBeGreaterThan(0);
      for (const formula of counting) {
        const ranges = [...formula.matchAll(/(\$[A-Z]+\$2:\$[A-Z]+\$\d+),"([A-Z_]+)"/g)].filter((pair) => (registrationStatus.enumValues as readonly string[]).includes(pair[2]));
        expect(ranges.length, formula).toBeGreaterThan(0);
        for (const [, range] of ranges) expect(range, formula).toBe(`$${letter}$2:$${letter}$${data.length + 1}`);
      }
      // …and every colour rule that tests a status word reads `$<letter>2`.
      const tinting = rulesOf(buffer).filter((rule) => rule.sqref.startsWith("A2:"));
      expect(tinting, name).toHaveLength(ROW_TINTS.length);
      for (const rule of tinting) {
        const tests = [...rule.formula.matchAll(/(\$[A-Z]+\d+)="([A-Z_]+)"/g)];
        expect(tests.length, rule.formula).toBeGreaterThan(0);
        for (const [, reference] of tests) expect(reference, rule.formula).toBe(`$${letter}2`);
      }
      // The validation sits on the same column.
      expect(validationsOf(buffer).rules[0].attributes.sqref, name).toBe(`${letter}2:${letter}${data.length + 1}`);
    }
  });

  it("puts one list validation over exactly the data rows of the status column, and none on the header or the footer", async () => {
    const data = mixed();
    const buffer = await buildPick(data);
    const { sheet, count, rules } = validationsOf(buffer);
    expect(count).toBe(1);
    expect(rules).toHaveLength(1);
    const [{ attributes, list }] = rules;
    expect(attributes).toMatchObject({ type: "list", allowBlank: "0", showErrorMessage: "1", sqref: `C2:C${data.length + 1}` });
    // showDropDown="1" would HIDE the arrow in Excel: it must stay out of the rule.
    expect(attributes).not.toHaveProperty("showDropDown");
    // Row 1 is the header and everything after the last registration is the footer: outside the range.
    expect(Number(/^C2:C(\d+)$/.exec(attributes.sqref)![1])).toBe(readSheet(buffer).rows.findIndex((line) => line?.[0] === RO.title) - 1);
    // The list is a quoted, comma-separated string holding every state a cell can carry, in the filter's order, and fits Excel's 255.
    expect(list).toBe(`"${registrationStatus.enumValues.join(",")}"`);
    expect(list.length - 2).toBeLessThanOrEqual(255);
    expect(list.slice(1, -1).split(",")).toEqual([...registrationStatus.enumValues]);
    // One list: the words the colours and the legend know are the words the drop-down offers.
    expect(Object.keys(STATUS_TINT).sort()).toEqual([...registrationStatus.enumValues].sort());
    // Every status the mixed rows carry is in the list, so no existing cell is invalid.
    for (const status of new Set(data.map((entry) => entry.status))) expect(list.slice(1, -1).split(",")).toContain(status);
    // Where the schema wants it: after the last conditionalFormatting, before anything that follows, inside the worksheet.
    expect(sheet.lastIndexOf("</conditionalFormatting>")).toBeLessThan(sheet.indexOf("<dataValidations"));
    expect(sheet.indexOf("</sheetData>")).toBeLessThan(sheet.indexOf("<dataValidations"));
    expect(sheet.indexOf("</dataValidations>")).toBeLessThan(sheet.indexOf("</worksheet>"));
    expect(sheet.match(/<dataValidations/g)).toHaveLength(1);
  });

  it.each([
    ["ro", "Alege o stare din listă."],
    ["en", "Pick a status from the list."],
  ] as const)("says what is wrong in the reader's language (%s)", async (locale, error) => {
    const { attributes } = validationsOf(await buildPick(mixed(), locale)).rules[0];
    expect(attributes.error).toBe(error);
    expect(attributes.errorTitle).toBe(PICK[locale].title);
    // Excel's own ceilings on the box: 32 characters of title, 255 of message.
    expect(attributes.errorTitle.length).toBeLessThanOrEqual(32);
    expect(attributes.error.length).toBeLessThanOrEqual(255);
  });

  it("escapes what the box says, and refuses a list that would not fit inline or holds a comma", async () => {
    const odd = await buildRegistrationsWorkbook(mixed(), "S", { statusPick: { title: 'A & "B"', error: "<x> & y" } });
    const { attributes } = validationsOf(odd).rules[0];
    expect(attributes.errorTitle).toBe('A & "B"');
    expect(attributes.error).toBe("<x> & y");
    expect(unzip(odd).get("xl/worksheets/sheet1.xml")).toContain('errorTitle="A &amp; &quot;B&quot;"');
    const one = [{ header: "H", width: 5, cell: () => ({ value: "x", type: String }) }];
    await expect(writeSheet(one, [1], "S", "S", [], [], { column: 0, words: ["a,b"], title: "t", error: "e" })).rejects.toThrow(/comma/);
    await expect(writeSheet(one, [1], "S", "S", [], [], { column: 0, words: ["x".repeat(200), "y".repeat(100)], title: "t", error: "e" })).rejects.toThrow(/255/);
  });

  it("writes no drop-down for a file without rows, or for a caller that asks for none — the cells are then plain text", async () => {
    expect(validationsOf(await buildPick([])).count).toBe(0);
    expect(unzip(await buildPick([])).get("xl/worksheets/sheet1.xml")).not.toContain("dataValidation");
    expect(unzip(await build(mixed())).get("xl/worksheets/sheet1.xml")).not.toContain("dataValidation");
    expect(unzip(await buildRegistrationsWorkbook(mixed(), "S")).get("xl/worksheets/sheet1.xml")).not.toContain("dataValidation");
  });

  it("changes nothing else: the same cells, rules, formulas and cached numbers with and without the drop-down", async () => {
    const data = mixed();
    const withPick = await buildPick(data);
    const without = await build(data);
    expect(readSheet(withPick).rows).toEqual(readSheet(without).rows);
    expect(rulesOf(withPick)).toEqual(rulesOf(without));
    expect(formulasOf(withPick)).toEqual(formulasOf(without));
    expect(unzip(withPick).get("xl/styles.xml")).toBe(unzip(without).get("xl/styles.xml"));
    expect(unzip(withPick).get("xl/workbook.xml")).toBe(unzip(without).get("xl/workbook.xml"));
    expect(unzip(withPick).get("xl/worksheets/sheet1.xml")!.replace(/<dataValidations[\s\S]*?<\/dataValidations>/, "")).toBe(unzip(without).get("xl/worksheets/sheet1.xml"));
  });

  it("is a drop-down with the footer's numbers still live after an edit that picks another state", async () => {
    const buffer = await buildPick(mixed());
    const grid = gridOf(buffer);
    const rows = readSheet(buffer).rows;
    const edited = grid.map((line) => (line ? [...line] : line)) as Grid;
    edited[1][headerAt("Status")] = "CANCELLED";
    const confirmed = evaluated(buffer, edited).get(`B${rows.findIndex((line) => line?.[0] === RO.confirmed) + 1}`);
    expect(confirmed).toBe(2);
  });
});

describe("§787 the sponsor list's sheet is untouched by it", () => {
  it("has no colour rule, no formula and no recalculation request: the shared writer adds them only when asked", async () => {
    const sheet = ro.Admin.sponsors.sheet;
    const buffer = await buildSponsorListWorkbook(
      { sheet: sheet.name, yes: sheet.yes, no: sheet.no, columns: sheet.columns, states: sheet.states },
      [
        {
          firstName: "Ana", lastName: "Pop", email: "ana@example.ro", eventTitle: "Crosul toamnei", consentedAt: new Date("2026-07-01T10:00:00.000Z"), consentNoticeVersion: 4, listPublic: true,
          listSocials: false, termsVersion: 3, termsAcceptedAt: new Date("2026-07-01T10:00:00.000Z"), declarationVersion: 7, declarationSignedAt: new Date("2026-07-02T08:00:00.000Z"), status: "CONFIRMED",
        },
      ],
    );
    const parts = unzip(buffer);
    expect(parts.get("xl/worksheets/sheet1.xml")).not.toMatch(/<f>|conditionalFormatting|dataValidation/);
    expect(parts.get("xl/styles.xml")).not.toContain("<dxfs");
    expect(parts.get("xl/workbook.xml")).not.toContain("fullCalcOnLoad");
  });
});

describe("§787 the legend of the colours, under the statistics, in both languages", () => {
  it.each([
    ["ro", RO, ro.Admin.registrations.statistics],
    ["en", EN, en.Admin.registrations.statistics],
  ] as const)("says what each tint stands for, its own cell carrying the fill (%s)", async (_locale, words, catalogue) => {
    const buffer = await build(mixed(), words);
    const { rows } = readSheet(buffer);
    const cells = rawCells(buffer);
    const { fillOfStyle } = stylesOf(buffer);
    const title = rows.findIndex((line) => line?.[0] === catalogue.legendTitle);
    expect(title).toBeGreaterThan(0);
    expect(isBoldStyle(buffer, cells.get(`A${title + 1}`)!.style)).toBe(true);
    // After the definitions, which come before it.
    expect(rows.findIndex((line) => line?.[0] === words.notes[0])).toBeLessThan(title);
    const lines = [
      [catalogue.legendConfirmed, "success", ["CONFIRMED"]],
      [catalogue.legendPending, "warning", ["PENDING_EMAIL_CONFIRMATION", "PENDING_DECLARATION", "WAITLIST_OFFERED"]],
      [catalogue.legendWaitlist, "info", ["WAITLISTED"]],
      [catalogue.legendEnded, "neutral", ["CANCELLED", "EXPIRED"]],
    ] as const;
    lines.forEach(([label, tint, statuses], index) => {
      const text = rows[title + 1 + index]?.[0] ?? "";
      expect(text.startsWith(label), text).toBe(true);
      for (const status of statuses) expect(text, text).toContain(status);
      expect(fillOfStyle(cells.get(`A${title + 2 + index}`)!.style), text).toBe(argb(TINT_FILL[tint]));
    });
    const member = title + 1 + lines.length;
    expect(rows[member]?.[0]).toBe(catalogue.legendMember);
    expect(fillOfStyle(cells.get(`A${member + 1}`)!.style)).toBe(argb(SHEET_TINT.member));
    // The legend is the last thing in the file, and one line a tint.
    expect(rows).toHaveLength(member + 1);
    // Its fills are baked — a key, static by nature — while the rows above carry none.
    expect(new Set(lines.map(([, tint]) => TINT_FILL[tint])).size).toBe(4);
  });

  it("is worded in both catalogues with the same keys and no sentence over two hundred characters", () => {
    const legend = ["legendTitle", "legendConfirmed", "legendPending", "legendWaitlist", "legendEnded", "legendMember"] as const;
    for (const catalogue of [ro, en]) {
      for (const key of legend) {
        const word = catalogue.Admin.registrations.statistics[key];
        expect(word, key).not.toBe("");
        expect(word.length, key).toBeLessThanOrEqual(200);
        expect(word, key).not.toMatch(/\{|\}/);
      }
    }
    expect(ro.Admin.registrations.statistics.legendTitle).toBe("Culori");
    expect(en.Admin.registrations.statistics.legendTitle).toBe("Colours");
    expect(Object.values(RO.legend)).toEqual(legend.map((key) => ro.Admin.registrations.statistics[key]));
  });

  it("is not in a file without a footer", async () => {
    const { rows } = readSheet(await buildRegistrationsWorkbook(mixed(), "Crosul Tâmpei"));
    expect(JSON.stringify(rows)).not.toMatch(/Culori|Colours/);
  });
});
