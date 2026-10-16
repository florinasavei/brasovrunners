import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import { isClubRunner } from "@/modules/registrations/domain/club-runner";
import { sexOfCell } from "@/modules/registrations/domain/sex";
import { ageBandOf, statisticsOf, statisticsWordsFrom, type StatisticsWords } from "@/modules/registrations/statistics";
import { buildRegistrationsWorkbook, REGISTRATION_SHEET_HEADERS, type RegistrationSheetRow } from "@/modules/registrations/workbook";
import { CLUB_NAME } from "@/theme/brand";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { isBoldStyle, rawCells, readSheet, startListRows, unzip } from "../../helpers/xlsx";

/**
 * §787 (amends §172 and §581) — «the Excel should have a statistics footer so that I can show „how many Brașov
 * Runners”, how many active, etc., grouped by category» (the owner, 2026-10-15): the counts under the rows of the
 * registrations spreadsheet, read back from the bytes. What the route asks and for whom is in
 * `tests/integration/registrations/statistics-footer.test.ts`; the real download is `tests/e2e/statistics-footer.spec.ts`.
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

/** Nine registrations of one race: every state, the club by each of its three signals and not, two sexes, five bands, one with no age. */
function mixed(): RegistrationSheetRow[] {
  return [
    sheetRow({ status: "CONFIRMED", sex: "Female", ageOnRaceDay: 25, clubMemberDeclared: true, clubRunner: true }),
    sheetRow({ status: "CONFIRMED", sex: "Male", ageOnRaceDay: 35, clubName: "BVR", clubRunner: true }),
    sheetRow({ status: "CONFIRMED", sex: "Female", ageOnRaceDay: 25, clubName: "Alt Club" }),
    sheetRow({ status: "PENDING_EMAIL_CONFIRMATION", sex: "Male", ageOnRaceDay: 16, memberVerified: true, clubRunner: true }),
    sheetRow({ status: "PENDING_DECLARATION", sex: "Female", ageOnRaceDay: 61 }),
    sheetRow({ status: "WAITLISTED", sex: "Male", ageOnRaceDay: null }),
    sheetRow({ status: "WAITLIST_OFFERED", sex: "Female", ageOnRaceDay: 25, clubMemberDeclared: true, clubRunner: true }),
    sheetRow({ status: "CANCELLED", sex: "Male", ageOnRaceDay: 35 }),
    sheetRow({ status: "EXPIRED", sex: "Female", ageOnRaceDay: 40, clubName: "Runners Brașov", clubRunner: true }),
  ];
}

const build = (rows: RegistrationSheetRow[], words: StatisticsWords | undefined = RO, extra: { notesHeader?: string } = {}) => buildRegistrationsWorkbook(rows, "Crosul Tâmpei", { ...extra, statistics: words });

/** The rows of the sheet from the footer's title on, empty rows kept as `[]` so the layout reads as it looks. */
function footerOf(rows: (string | undefined)[][], title = "Statistici"): (string | undefined)[][] {
  const at = rows.findIndex((row) => row?.[0] === title);
  expect(at, `the «${title}» row`).toBeGreaterThan(0);
  return Array.from({ length: rows.length - at }, (_, index) => rows[at + index] ?? []);
}

describe("§787 the footer's numbers, for a mixed fixture", () => {
  it("counts every row once, by state, so the states add up to the total", async () => {
    const { rows } = readSheet(await build(mixed()));
    const footer = footerOf(rows);
    expect(footer.slice(0, 16)).toEqual([
      ["Statistici"],
      ["Total", "9"],
      ["Confirmați (activi)", "3"],
      ["Așteaptă confirmarea adresei", "1"],
      ["Așteaptă semnarea declarației", "1"],
      ["Pe lista de așteptare", "1"],
      ["Au o ofertă de loc", "1"],
      ["Anulați", "1"],
      ["Expirați", "1"],
      [CLUB_NAME, "5"],
      [`${CLUB_NAME}, confirmați`, "2"],
      // The tick alone (§NNN): two of the five club runners ticked the box.
      [`Au bifat că sunt membri ${CLUB_NAME}`, "2"],
      [`Alții, nu ${CLUB_NAME}`, "4"],
      // The special guests (§643): none in this fixture, so the confirmed part of the places line is all the confirmed (§615).
      ["Invitați speciali", "0"],
      ["Invitați speciali, confirmați", "0"],
      ["Confirmați care ocupă un loc", "3"],
    ]);
    // 3 + 1 + 1 + 1 + 1 + 1 + 1: nothing counted twice, nothing dropped.
    expect(3 + 1 + 1 + 1 + 1 + 1 + 1).toBe(9);
  });

  it("counts «Brașov Runners» by the member, the ticked box and the typed club — and not another club", () => {
    expect(isClubRunner({ clubMemberDeclared: false, memberVerified: true, clubName: "" })).toBe(true);
    expect(isClubRunner({ clubMemberDeclared: true, memberVerified: false, clubName: "" })).toBe(true);
    for (const typed of ["Brașov Runners", "brasov runners", "Runners Brașov", "BVR", "Clubul Brașov Runners (BVR)"]) {
      expect(isClubRunner({ clubMemberDeclared: false, memberVerified: false, clubName: typed }), typed).toBe(true);
    }
    for (const typed of ["", "Alt Club", "Brașov Runners Cluj", "Runners", "Cluj Runners", null]) {
      expect(isClubRunner({ clubMemberDeclared: false, memberVerified: false, clubName: typed }), String(typed)).toBe(false);
    }
  });

  it("groups by category — the sex and the age band — one row each, youngest first, women first, none last", async () => {
    const { rows } = readSheet(await build(mixed()));
    const footer = footerOf(rows);
    const at = footer.findIndex((row) => row[0] === "Categorie");
    expect(footer[at - 1]).toEqual([]);
    expect(footer.slice(at, at + 7)).toEqual([
      ["Categorie", "Total", "Confirmați (activi)", CLUB_NAME, `${CLUB_NAME}, confirmați`],
      ["Feminin, 18-29 ani", "3", "2", "2", "1"],
      ["Feminin, 40-49 ani", "1", "0", "1", "0"],
      ["Feminin, 60+ ani", "1", "0", "0", "0"],
      ["Masculin, sub 18 ani", "1", "0", "1", "0"],
      ["Masculin, 30-39 ani", "2", "1", "1", "1"],
      ["Fără categorie", "1", "0", "0", "0"],
    ]);
    // The category rows add up to the total too.
    const sum = footer.slice(at + 1, at + 7).reduce((total, row) => total + Number(row[1]), 0);
    expect(sum).toBe(9);
  });

  it("puts a row with a sex but no birth date, or a birth date but no sex, under «no category»", () => {
    const blocks = statisticsOf([sheetRow({ sex: "Male", ageOnRaceDay: null }), sheetRow({ sex: "", ageOnRaceDay: 30 }), sheetRow({ sex: null, ageOnRaceDay: undefined })], RO);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].categories.map((category) => [category.label, category.tally.total])).toEqual([[RO.noCategory, 3]]);
  });

  it("reads the age bands at their edges", () => {
    expect([13, 14, 17, 18, 29, 30, 39, 40, 49, 50, 59, 60, 99].map((age) => ageBandOf(age))).toEqual([
      "under18", "under18", "under18", "from18", "from18", "from30", "from30", "from40", "from40", "from50", "from50", "from60", "from60",
    ]);
    expect(ageBandOf(null)).toBeNull();
    expect(ageBandOf(undefined)).toBeNull();
    expect(ageBandOf(-1)).toBeNull();
    expect(sexOfCell("Male")).toBe("MALE");
    expect(sexOfCell("Female")).toBe("FEMALE");
    expect(sexOfCell("")).toBeNull();
    expect(sexOfCell(undefined)).toBeNull();
  });
});

describe("§787 the footer's place and typing in the file", () => {
  it("starts after one empty row, under the table's first column, outside the rows a sort or a filter takes", async () => {
    const data = mixed();
    const buffer = await build(data);
    const { rows } = readSheet(buffer);
    // Header, nine registrations, then a row nobody wrote, then the footer.
    expect(rows[0]?.[0]).toBe("ID");
    expect(rows[10]).toBeUndefined();
    expect(rows[11]).toEqual(["Statistici"]);
    expect(startListRows(rows)).toHaveLength(1 + 9);
    expect(startListRows(rows).every((row) => /^0000/.test(row![0] ?? "") || row![0] === "ID")).toBe(true);
    // The sheet declares no autofilter and no table: the header is only kept on screen, so the empty row is the separation.
    const raw = unzip(buffer);
    expect(raw.get("xl/worksheets/sheet1.xml")).not.toMatch(/autoFilter|tablePart/);
    expect([...raw.keys()].some((name) => name.startsWith("xl/tables/"))).toBe(false);
    expect(raw.get("xl/worksheets/sheet1.xml")).toContain("pane");
    // Every footer row starts in column A (the labels) and none is wider than the table.
    const cells = rawCells(buffer);
    const footerReferences = [...cells.keys()].filter((reference) => Number(reference.replace(/\D/g, "")) >= 12);
    for (const reference of footerReferences) expect(["A", "B", "C", "D", "E"]).toContain(reference.replace(/\d/g, ""));
    expect(footerReferences.length).toBeGreaterThan(0);
  });

  it("writes the labels bold in the header's own style and every count as a number cell, never text", async () => {
    const buffer = await build(mixed());
    const cells = rawCells(buffer);
    const header = cells.get("A1")!;
    expect(isBoldStyle(buffer, header.style)).toBe(true);
    // «Statistici» is the header's own bold style; the counts (B12..) carry no text type.
    const title = cells.get("A12")!;
    expect(title.style).toBe(header.style);
    expect(isBoldStyle(buffer, title.style)).toBe(true);
    const { rows } = readSheet(buffer);
    const categoryHeaderAt = rows.findIndex((row) => row?.[0] === "Categorie");
    let numbers = 0;
    for (let index = 12; index < rows.length; index += 1) {
      const row = rows[index];
      if (!row || index === categoryHeaderAt) continue;
      // Beside a label, a count: a number cell with an integer in it, never a string.
      for (let column = 1; column < row.length; column += 1) {
        const reference = `${"ABCDE"[column]}${index + 1}`;
        const cell = cells.get(reference)!;
        expect(cell.type, `${reference} is a number`).toBeUndefined();
        expect(Number.isInteger(Number(cell.value)), reference).toBe(true);
        numbers += 1;
      }
    }
    expect(numbers).toBeGreaterThan(30);
    // The category header's labels are bold too.
    const categoryRow = rows.findIndex((row) => row?.[0] === "Categorie") + 1;
    for (const column of "ABCDE") expect(isBoldStyle(buffer, cells.get(`${column}${categoryRow}`)!.style), `${column}${categoryRow}`).toBe(true);
    // Every label with a count beside it (column A of each footer row after the title) is bold, not plain text.
    for (let index = 12; index < rows.length; index += 1) {
      const row = rows[index];
      if (!row || row.length < 2) continue;
      expect(isBoldStyle(buffer, cells.get(`A${index + 1}`)!.style), `A${index + 1} «${row[0]}» is bold`).toBe(true);
    }
    // A count is not text: B13 is «Total», 9.
    expect(cells.get("B13")).toEqual({ type: undefined, style: cells.get("B13")!.style, value: "9" });
  });

  it("is the footer of the workbook with the notes column too, still under the first columns", async () => {
    const buffer = await build(mixed(), RO, { notesHeader: "Note interne" });
    const { rows } = readSheet(buffer);
    expect(rows[0]?.at(-1)).toBe("Note interne");
    expect(rows[11]).toEqual(["Statistici"]);
    expect(rows[12]).toEqual(["Total", "9"]);
  });

  it("is not written for a caller that passes no words: the file is the rows, as before", async () => {
    const buffer = await buildRegistrationsWorkbook(mixed(), "Crosul Tâmpei");
    const { rows } = readSheet(buffer);
    expect(rows).toHaveLength(1 + 9);
    expect(JSON.stringify(rows)).not.toContain("Statistici");
    expect(rows[0]).toEqual([...REGISTRATION_SHEET_HEADERS]);
  });

  it("writes a footer of zeros for a file with no registrations, never an error", async () => {
    const { rows } = readSheet(await build([]));
    expect(rows[0]?.[0]).toBe("ID");
    expect(rows[2]).toEqual(["Statistici"]);
    expect(rows[3]).toEqual(["Total", "0"]);
    expect(JSON.stringify(rows)).not.toContain("Categorie");
  });

  it("keeps a formula-looking label a label: the cells are text-typed", async () => {
    const buffer = await build([sheetRow({ sex: "Male", ageOnRaceDay: 30 })], { ...RO, club: "=HYPERLINK(1)" });
    const { rows } = readSheet(buffer);
    const at = rows.findIndex((row) => row?.[0] === "=HYPERLINK(1)");
    expect(at).toBeGreaterThan(0);
    // Stored as text (a shared or inline string), never as a formula.
    const cell = rawCells(buffer).get(`A${at + 1}`)!;
    expect(["s", "inlineStr"]).toContain(cell.type);
    // The label's own cell holds no formula; the counts beside the labels are the footer's formulas (§787, amended).
    const sheet = unzip(buffer).get("xl/worksheets/sheet1.xml") ?? "";
    expect(new RegExp(`<c r="A${at + 1}"[^>]*>(?:(?!</c>)[\\s\\S])*</c>`).exec(sheet)?.[0]).not.toContain("<f>");
  });
});

describe("§787 several events: per event first, the categories inside, all of them at the end", () => {
  const event = (id: string, label: string) => ({ eventId: id, eventLabel: label, eventTitle: "Alergare" });

  it("groups by event id, so two events with one title are two groups, each with its own categories", async () => {
    const data = [
      sheetRow({ ...event("e1", "Alergare · 18.10.2026"), status: "CONFIRMED", sex: "Female", ageOnRaceDay: 25, clubRunner: true }),
      sheetRow({ ...event("e1", "Alergare · 18.10.2026"), status: "CANCELLED", sex: "Male", ageOnRaceDay: 45 }),
      sheetRow({ ...event("e2", "Alergare · 25.10.2026"), status: "CONFIRMED", sex: "Female", ageOnRaceDay: 25 }),
      sheetRow({ ...event("e2", "Alergare · 25.10.2026"), status: "WAITLISTED", sex: "Female", ageOnRaceDay: 52, clubRunner: true }),
      sheetRow({ ...event("e2", "Alergare · 25.10.2026"), status: "CONFIRMED", sex: "Male", ageOnRaceDay: 45, clubRunner: true }),
    ];
    const { rows } = readSheet(await build(data));
    const footer = footerOf(rows);
    const labels = footer.map((row) => row[0]);
    // The title once, then each event's label, then all events — in that order.
    expect(labels.filter((label) => label === "Statistici")).toHaveLength(1);
    const order = ["Alergare · 18.10.2026", "Alergare · 25.10.2026", "Toate evenimentele"].map((label) => labels.indexOf(label));
    expect(order.every((at) => at > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    const block = (label: string) => {
      const from = labels.indexOf(label);
      const end = [...order, labels.length].filter((at) => at > from).sort((a, b) => a - b)[0];
      return footer.slice(from, end).filter((row) => row.length > 0);
    };
    expect(block("Alergare · 18.10.2026").slice(0, 3)).toEqual([["Alergare · 18.10.2026"], ["Total", "2"], ["Confirmați (activi)", "1"]]);
    expect(block("Alergare · 18.10.2026").find((row) => row[0] === CLUB_NAME)).toEqual([CLUB_NAME, "1"]);
    expect(block("Alergare · 18.10.2026").filter((row) => /ani$/.test(row[0] ?? "")).map((row) => row.slice(0, 2))).toEqual([["Feminin, 18-29 ani", "1"], ["Masculin, 40-49 ani", "1"]]);
    expect(block("Alergare · 25.10.2026").slice(0, 3)).toEqual([["Alergare · 25.10.2026"], ["Total", "3"], ["Confirmați (activi)", "2"]]);
    expect(block("Alergare · 25.10.2026").filter((row) => /ani$/.test(row[0] ?? "")).map((row) => row.slice(0, 2))).toEqual([
      ["Feminin, 18-29 ani", "1"],
      ["Feminin, 50-59 ani", "1"],
      ["Masculin, 40-49 ani", "1"],
    ]);
    // …and across both: five registrations, three confirmed, the club's two of them.
    expect(block("Toate evenimentele").slice(0, 3)).toEqual([["Toate evenimentele"], ["Total", "5"], ["Confirmați (activi)", "3"]]);
    expect(block("Toate evenimentele").find((row) => row[0] === CLUB_NAME)).toEqual([CLUB_NAME, "3"]);
    // The start list above it is untouched: seven rows' worth is five.
    expect(startListRows(rows)).toHaveLength(1 + 5);
  });

  it("orders the events by the day they start, whatever order the list is sorted in", () => {
    const later = { eventId: "b", eventLabel: "B · 25.10.2026", eventStartsAt: new Date("2026-10-25T08:00:00.000Z") };
    const earlier = { eventId: "a", eventLabel: "A · 18.10.2026", eventStartsAt: new Date("2026-10-18T08:00:00.000Z") };
    const blocks = statisticsOf([sheetRow(later), sheetRow(earlier), sheetRow(later)], RO);
    expect(blocks.map((block) => [block.label, block.tally.total])).toEqual([["A · 18.10.2026", 1], ["B · 25.10.2026", 2], [RO.allEvents, 3]]);
  });

  it("groups one event unlabelled and has no all-events block", () => {
    const blocks = statisticsOf([sheetRow({ eventId: "e1", eventLabel: "A · 01.01.2027" }), sheetRow({ eventId: "e1", eventLabel: "A · 01.01.2027" })], RO);
    expect(blocks.map((block) => block.label)).toEqual([null]);
    expect(blocks[0].tally.total).toBe(2);
  });

  it("falls back to the title when a row has no id, so rows built without one still group", () => {
    const blocks = statisticsOf([sheetRow({ eventTitle: "A" }), sheetRow({ eventTitle: "B" })], RO);
    expect(blocks.map((block) => block.label)).toEqual(["A", "B", RO.allEvents]);
  });
});

describe("§787 the footer's words, in both languages", () => {
  it("says the same things in English with the club's name from the one constant", async () => {
    const { rows } = readSheet(await build(mixed(), EN));
    const footer = footerOf(rows, "Statistics");
    expect(footer.slice(0, 13).map((row) => row[0])).toEqual([
      "Statistics",
      "Total",
      "Confirmed (active)",
      "Waiting for the address to be confirmed",
      "Waiting for the declaration to be signed",
      "On the waiting list",
      "Offered a place",
      "Cancelled",
      "Expired",
      CLUB_NAME,
      `${CLUB_NAME}, confirmed`,
      `Ticked as members of ${CLUB_NAME}`,
      `Others, not ${CLUB_NAME}`,
    ]);
    expect(footer.map((row) => row[0])).toContain("Female, 18-29");
    expect(footer.map((row) => row[0])).toContain("Male, under 18");
    expect(footer.map((row) => row[0])).toContain("No category");
    expect(footer.find((row) => row[0] === "Category")).toEqual(["Category", "Total", "Confirmed (active)", CLUB_NAME, `${CLUB_NAME}, confirmed`]);
    // The same numbers as Română gives.
    expect(footer[1]).toEqual(["Total", "9"]);
  });

  it("has every word in both catalogues, no placeholder left over and no sentence over two hundred characters", () => {
    for (const words of [RO, EN]) {
      const everything = [
        words.title, words.total, words.confirmed, words.pendingEmail, words.pendingDeclaration, words.waitlisted, words.waitlistOffered, words.cancelled,
        words.expired, words.club, words.clubConfirmed, words.clubTicked, words.notClub, words.specialGuests, words.specialGuestsConfirmed, words.confirmedInPlaces, words.allEvents, words.categoryHeader, words.noCategory,
        ...Object.values(words.sex), ...Object.values(words.bands), ...words.notes, ...Object.values(words.legend),
      ];
      for (const word of everything) {
        expect(word, "a word").not.toBe("");
        expect(word).not.toMatch(/\{|\}|Admin\.registrations/);
        expect(word.length).toBeLessThanOrEqual(200);
      }
      expect(words.category).toBe("{sex}, {band}");
      // note7 (§NNN) joined the six: the tick's own line has its sentence.
      expect(words.notes).toHaveLength(7);
      expect(words.club).toBe(CLUB_NAME);
    }
    const keys = (catalogue: typeof ro) => Object.keys(catalogue.Admin.registrations.statistics).sort();
    expect(keys(ro)).toEqual(keys(en));
    expect(JSON.stringify(ro.Admin.registrations.statistics)).not.toContain(CLUB_NAME);
    expect(JSON.stringify(en.Admin.registrations.statistics)).not.toContain(CLUB_NAME);
  });

  it("tells the reader what «active» and «Brașov Runners» mean, in a sentence of its own", async () => {
    const { rows } = readSheet(await build(mixed(), RO));
    const all = rows.filter((row) => row?.[0]).map((row) => row![0]!);
    // The definitions are followed by the legend of the colours (§787, amended), so they are found by their first words.
    const first = all.indexOf("Activi sunt cei confirmați: au declarația semnată; cei care ocupă un loc sunt la «Confirmați care ocupă un loc».");
    expect(first).toBeGreaterThan(0);
    const [, second, third, fourth] = all.slice(first, first + 4);
    expect(second).toContain(`«${CLUB_NAME}»`);
    expect(third).toContain("se numără toate stările");
    expect(fourth).toContain("Înscrierile de test nu se numără");
  });
});
