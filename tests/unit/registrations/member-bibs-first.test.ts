import PDFDocument from "pdfkit";
import { describe, expect, it, vi } from "vitest";
import { type BibDesign, DEFAULT_BIB_DESIGN, DEFAULT_BIB_MEMBER_DESIGN } from "@/modules/registrations/bib-design";
import { type BibSheetInput, type BibSheetRow, renderBibSheet, sheetPages } from "@/modules/registrations/bibs-pdf";

/**
 * §681, BR-REQ-038-01 — the members' race numbers (§664) print first, on pages of their own: a
 * members' bib never shares an A4 page with an ordinary one, an odd members' pile leaves its last
 * page's lower half blank, and the ordinary bibs follow in number order. With no member's bib on
 * the sheet the pages are today's pairs. `part` keeps one pile; the desk's spares stay with the
 * ordinary bibs, where they were.
 */
const member = (bibNumber: number): BibSheetRow => ({ bibNumber, registeredName: `Membru ${bibNumber}`, member: true });
const ordinary = (bibNumber: number): BibSheetRow => ({ bibNumber, registeredName: `Alergător ${bibNumber}`, member: false });
const spare = (bibNumber: number): BibSheetRow => ({ bibNumber, registeredName: null });

/** The pages as numbers, `null` for a blank half. */
const numbers = (pages: ReturnType<typeof sheetPages<BibSheetRow>>) => pages.map((page) => page.map((row) => row?.bibNumber ?? null));

describe("§681 sheetPages — the members' pile first, on its own pages", () => {
  it("with no member's bib, pairs the rows in their order exactly as before", () => {
    const rows = [1, 2, 3, 4, 5].map(ordinary);
    expect(numbers(sheetPages(rows))).toEqual([
      [1, 2],
      [3, 4],
      [5, null],
    ]);
    expect(numbers(sheetPages(rows, { layout: "one" }))).toEqual([[1], [2], [3], [4], [5]]);
    expect(sheetPages([])).toEqual([]);
  });

  it("puts 3 members and 4 ordinary bibs on [m1,m2] [m3,blank] [o1,o2] [o3,o4]", () => {
    // The order the sheet reads them in: the number's, members interleaved with the rest.
    const rows = [ordinary(1), member(2), ordinary(3), member(4), ordinary(5), ordinary(6), member(7)];
    expect(numbers(sheetPages(rows))).toEqual([
      [2, 4],
      [7, null],
      [1, 3],
      [5, 6],
    ]);
  });

  it("never lets a members' bib share a page with an ordinary one, whatever the counts", () => {
    for (let members = 0; members <= 5; members += 1) {
      for (let others = 0; others <= 5; others += 1) {
        const rows = [...Array.from({ length: members }, (_, i) => member(i + 1)), ...Array.from({ length: others }, (_, i) => ordinary(100 + i))];
        for (const page of sheetPages(rows)) {
          const kinds = new Set(page.filter((row) => row !== null).map((row) => row.member === true));
          expect(kinds.size, `${members} members, ${others} others`).toBe(1);
        }
      }
    }
  });

  it("keeps only the members with `members`, and every other bib with `others`", () => {
    const rows = [ordinary(1), member(2), ordinary(3), member(4), ordinary(5), ordinary(6), member(7)];
    expect(numbers(sheetPages(rows, { part: "members" }))).toEqual([
      [2, 4],
      [7, null],
    ]);
    expect(numbers(sheetPages(rows, { part: "others" }))).toEqual([
      [1, 3],
      [5, 6],
    ]);
    // A part with nothing in it is no pages: the renderer prints its «—» page.
    expect(sheetPages([ordinary(1)], { part: "members" })).toEqual([]);
    expect(sheetPages([member(1)], { part: "others" })).toEqual([]);
  });

  it("keeps the spares' place among the ordinary bibs; a spare is never a member's", () => {
    const rows = [ordinary(1), member(2), spare(901), spare(902), ordinary(3)];
    expect(numbers(sheetPages(rows))).toEqual([
      [2, null],
      [1, 901],
      [902, 3],
    ]);
    expect(numbers(sheetPages(rows, { part: "others" }))).toEqual([
      [1, 901],
      [902, 3],
    ]);
    // A spares-only sheet (§444) is the same pages with or without a part.
    const spares = [spare(901), spare(902), spare(903)];
    expect(numbers(sheetPages(spares, { part: "others" }))).toEqual(numbers(sheetPages(spares)));
  });

  it("treats every bib as ordinary while the event's members' switch is off", () => {
    const rows = [ordinary(1), member(2), ordinary(3)];
    expect(numbers(sheetPages(rows, { membersOn: false }))).toEqual([
      [1, 2],
      [3, null],
    ]);
  });

  it("with one per page, prints the members first, one to a page", () => {
    const rows = [ordinary(1), member(2), ordinary(3)];
    expect(numbers(sheetPages(rows, { layout: "one" }))).toEqual([[2], [1], [3]]);
  });
});

describe("§681 the sheet draws the members' pages first", () => {
  const withMembers: BibDesign = { ...DEFAULT_BIB_DESIGN, member: { ...DEFAULT_BIB_MEMBER_DESIGN, enabled: true, bandColour: "#6a1b9a" } };
  const render = (rows: BibSheetRow[], over: Partial<BibSheetInput> = {}) =>
    renderBibSheet({
      rows,
      eventTitle: "Crosul aniversar",
      eventDate: "11 octombrie 2026",
      generatedAt: new Date("2026-09-17T12:00:00Z"),
      design: withMembers,
      ...over,
    });

  /** Which numbers each page of the file carries, read off the drawing calls in their order. */
  async function pagesOf(rows: BibSheetRow[], over: Partial<BibSheetInput> = {}) {
    const addPage = vi.spyOn(PDFDocument.prototype, "addPage");
    const text = vi.spyOn(PDFDocument.prototype, "text");
    const dash = vi.spyOn(PDFDocument.prototype, "dash");
    try {
      const order: Array<{ call: number; kind: "page" | "text" | "cut"; value?: string }> = [];
      await render(rows, over);
      addPage.mock.invocationCallOrder.forEach((call) => order.push({ call, kind: "page" }));
      text.mock.invocationCallOrder.forEach((call, index) => order.push({ call, kind: "text", value: String(text.mock.calls[index][0]) }));
      dash.mock.invocationCallOrder.forEach((call) => order.push({ call, kind: "cut" }));
      order.sort((a, b) => a.call - b.call);
      const pages: Array<{ numbers: number[]; cut: boolean }> = [];
      const wanted = new Set(rows.map((row) => String(row.bibNumber)));
      for (const step of order) {
        if (step.kind === "page") pages.push({ numbers: [], cut: false });
        else if (step.kind === "cut") pages[pages.length - 1].cut = true;
        else if (step.value && wanted.has(step.value)) pages[pages.length - 1].numbers.push(Number(step.value));
      }
      return pages;
    } finally {
      addPage.mockRestore();
      text.mockRestore();
      dash.mockRestore();
    }
  }

  it("draws [m1,m2] [m3] [o1,o2] [o3,o4], the members' odd page still cut", async () => {
    const rows = [ordinary(1), member(2), ordinary(3), member(4), ordinary(5), ordinary(6), member(7)];
    expect(await pagesOf(rows)).toEqual([
      { numbers: [2, 4], cut: true },
      { numbers: [7], cut: true },
      { numbers: [1, 3], cut: true },
      { numbers: [5, 6], cut: true },
    ]);
  });

  it("draws one part only when asked, and the number order with the switch off", async () => {
    const rows = [ordinary(1), member(2), ordinary(3)];
    expect((await pagesOf(rows, { part: "members" })).map((page) => page.numbers)).toEqual([[2]]);
    expect((await pagesOf(rows, { part: "others" })).map((page) => page.numbers)).toEqual([[1, 3]]);
    const off: BibDesign = { ...withMembers, member: { ...withMembers.member, enabled: false } };
    expect((await pagesOf(rows, { design: off })).map((page) => page.numbers)).toEqual([[1, 2], [3]]);
  });

  it("prints a valid file saying «—» for a part with nothing in it", async () => {
    const pdf = await render([ordinary(1)], { part: "members" });
    expect(pdf.toString("latin1").match(/\/Type \/Page\b/g)?.length).toBe(1);
  });
});
