import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import PDFDocument from "pdfkit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type BadgeDesign, badgeRoleColour, DEFAULT_BADGE_DESIGN } from "@/modules/volunteers/badges/badge-design";
import { badgePaper, badgeSheetGrid } from "@/modules/volunteers/badges/badge-geometry";
import { badgeImageLayout, badgeMarkup, renderBadgeImage } from "@/modules/volunteers/badges/badge-image";
import { badgeSheetOrder, renderBadgeSheet } from "@/modules/volunteers/badges/badges-pdf";
import { COLOR } from "@/theme/brand";

/**
 * §764 — the volunteer badges' two renderers (BR-REQ-050-02): the sheet prints per role, as many badges
 * as asked, packed on as many A4 pages as they take, each badge's words at the layout's sizes, and no
 * volunteer's name anywhere; the picture is the same badge at its own scale.
 *
 * `BADGE_SAMPLE_DIR=<folder>` writes a sample sheet and pictures there, to look at.
 */

const WORDS = { title: "Brașov Trail Race", label: "VOLUNTAR", name: "Nume:", phone: "Coordonator: 0712 345 678" };
const ENTRIES = [
  { role: { name: "Punct de apă", colour: "#c62828" }, count: 5 },
  { role: { name: "Marshal pe traseu", colour: null }, count: 12 },
  { role: { name: "Coordonatorul general al punctelor de control, apă și al tuturor voluntarilor", colour: "#6a1b9a" }, count: 2 },
  { role: null, count: 4 },
];
const total = ENTRIES.reduce((sum, entry) => sum + entry.count, 0);

type Drawn = { text: string; size: number | undefined; page: number };

/** Every `text()` the sheet draws, with the page it was on (counted by `addPage`). */
async function drawn(render: () => Promise<Buffer>): Promise<{ runs: Drawn[]; pages: number; pdf: Buffer }> {
  const runs: Drawn[] = [];
  let pages = 0;
  const text = PDFDocument.prototype.text;
  const addPage = PDFDocument.prototype.addPage;
  vi.spyOn(PDFDocument.prototype, "addPage").mockImplementation(function (this: PDFKit.PDFDocument, ...args: unknown[]) {
    pages += 1;
    return (addPage as (...a: unknown[]) => PDFKit.PDFDocument).apply(this, args);
  });
  vi.spyOn(PDFDocument.prototype, "text").mockImplementation(function (this: PDFKit.PDFDocument, ...args: unknown[]) {
    if (typeof args[0] === "string") runs.push({ text: args[0], size: (this as unknown as { _fontSize?: number })._fontSize, page: pages - 1 });
    return (text as (...a: unknown[]) => PDFKit.PDFDocument).apply(this, args);
  });
  const pdf = await render();
  return { runs, pages, pdf };
}

afterEach(() => vi.restoreAllMocks());

const sheet = (design: BadgeDesign = DEFAULT_BADGE_DESIGN, entries = ENTRIES) =>
  renderBadgeSheet({ design, locale: "ro", words: WORDS, entries, eventTitle: "Brașov Trail Race", generatedAt: new Date("2026-10-14T08:00:00Z") });

describe("§764 the badges' sheet", () => {
  it("prints as many badges as asked, per role, on as many A4 pages as they take", async () => {
    const { runs, pages, pdf } = await drawn(() => sheet());
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    // The file says how many badges it holds, in its own properties.
    expect(pdf.toString("latin1")).toContain(`(${total} badges)`);
    const perSheet = badgeSheetGrid(badgePaper(DEFAULT_BADGE_DESIGN)).perSheet;
    expect(perSheet).toBe(16);
    expect(pages).toBe(Math.ceil(total / perSheet));
    // One «Nume:» per badge: the count of badges.
    expect(runs.filter((run) => run.text === "Nume:")).toHaveLength(total);
    // Each role's name, in capitals, on as many badges as asked; «VOLUNTAR» small on those, alone on the rest.
    expect(runs.filter((run) => run.text === "PUNCT DE APĂ")).toHaveLength(5);
    expect(runs.filter((run) => run.text === "MARSHAL PE TRASEU")).toHaveLength(12);
    expect(runs.filter((run) => run.text === "VOLUNTAR")).toHaveLength(total);
    // The long name is cut, never wrapped.
    const long = runs.filter((run) => run.text.startsWith("COORDONATORUL"));
    expect(long).toHaveLength(2);
    expect(long[0].text.endsWith("…")).toBe(true);
    // The first page holds a full sheet, the last the rest.
    expect(runs.filter((run) => run.text === "Nume:" && run.page === 0)).toHaveLength(perSheet);
  });

  it("carries the club's words and the roles' names only — no volunteer's name is an input or an output", async () => {
    const { runs } = await drawn(() => sheet());
    const allowed = new Set(["Brașov Trail Race", "VOLUNTAR", "Nume:", "Coordonator: 0712 345 678", "PUNCT DE APĂ", "MARSHAL PE TRASEU"]);
    for (const run of runs) expect(allowed.has(run.text) || run.text.startsWith("COORDONATORUL"), run.text).toBe(true);
  });

  it("orders the piles as given and leaves out a pile of none", () => {
    const order = badgeSheetOrder([{ role: { name: "A", colour: null }, count: 2 }, { role: { name: "B", colour: null }, count: 0 }, { role: null, count: 1 }]);
    expect(order.map((role) => role?.name ?? null)).toEqual(["A", "A", null]);
  });

  it("is still a file, saying so, with nothing to print", async () => {
    const { runs, pages } = await drawn(() => sheet(DEFAULT_BADGE_DESIGN, []));
    expect(pages).toBe(1);
    expect(runs.map((run) => run.text)).toEqual(["—"]);
  });

  it("packs the larger strip 14 to a sheet", async () => {
    const design = { ...DEFAULT_BADGE_DESIGN, size: "strip100" as const };
    const { pages, runs } = await drawn(() => sheet(design, [{ role: null, count: 15 }]));
    expect(pages).toBe(2);
    expect(runs.filter((run) => run.text === "Nume:" && run.page === 0)).toHaveLength(14);
  });

  /**
   * The cuts, counted from the PDF's own calls (the bib sheet's «the club's cut marks»): a dashed stroke
   * along every line of the grid that holds badges — one `dash()` per page — and, while «Semne de tăiere
   * pe margine» is ticked, a solid mark in the page's margin at both ends of each. The writing line inside
   * a badge is a stroke too, so a stroke is told apart by where it is: on the dash, or outside the grid.
   */
  describe("the cuts", () => {
    const paper = badgePaper(DEFAULT_BADGE_DESIGN);
    const grid = badgeSheetGrid(paper);
    const outside = (x: number, y: number, rows: number) =>
      x < grid.left || y < grid.top || x > grid.left + grid.columns * paper.width || y > grid.top + rows * paper.height;

    /** Every `moveTo` drawn while the dash is on, and every one outside the grid, with the dashes asked for. */
    async function cuts(design: BadgeDesign, count: number, rows: number) {
      let dashed = false;
      const onDash: Array<[number, number]> = [];
      const marks: Array<[number, number]> = [];
      const dash = PDFDocument.prototype.dash;
      const undash = PDFDocument.prototype.undash;
      const moveTo = PDFDocument.prototype.moveTo;
      const dashes = vi.spyOn(PDFDocument.prototype, "dash").mockImplementation(function (this: PDFKit.PDFDocument, ...args: unknown[]) {
        dashed = true;
        return (dash as (...a: unknown[]) => PDFKit.PDFDocument).apply(this, args);
      });
      vi.spyOn(PDFDocument.prototype, "undash").mockImplementation(function (this: PDFKit.PDFDocument) {
        dashed = false;
        return undash.apply(this);
      });
      vi.spyOn(PDFDocument.prototype, "moveTo").mockImplementation(function (this: PDFKit.PDFDocument, ...args: unknown[]) {
        const [x, y] = args as [number, number];
        if (dashed) onDash.push([x, y]);
        else if (outside(x, y, rows)) marks.push([x, y]);
        return moveTo.call(this, x, y);
      });
      await sheet(design, [{ role: null, count }]);
      return { dashes: dashes.mock.calls.length, onDash, marks };
    }

    it("dashes every line of a full page's grid, and marks both ends of each in the margin", async () => {
      expect(grid).toMatchObject({ columns: 2, rows: 8 });
      const { dashes, onDash, marks } = await cuts({ ...DEFAULT_BADGE_DESIGN, cutMarks: true }, 16, 8);
      expect(dashes).toBe(1);
      // (columns + 1) vertical cuts and (rows + 1) horizontal ones.
      expect(onDash).toHaveLength(grid.columns + 1 + (8 + 1));
      // Each vertical cut starts at the grid's top, each horizontal one at its left.
      expect(onDash.filter(([, y]) => y === grid.top)).toHaveLength(grid.columns + 1 + 1);
      expect(onDash.filter(([x]) => x === grid.left)).toHaveLength(1 + 8 + 1);
      // Two marks per cut line.
      expect(marks).toHaveLength(2 * (grid.columns + 1 + (8 + 1)));
    });

    it("cuts only the rows a part page uses", async () => {
      const { onDash, marks } = await cuts({ ...DEFAULT_BADGE_DESIGN, cutMarks: true }, 3, 2);
      expect(onDash).toHaveLength(grid.columns + 1 + (2 + 1));
      expect(marks).toHaveLength(2 * (grid.columns + 1 + (2 + 1)));
    });

    it("draws no mark in the margin without «Semne de tăiere pe margine», and still every dashed cut", async () => {
      const { dashes, onDash, marks } = await cuts({ ...DEFAULT_BADGE_DESIGN, cutMarks: false }, 20, 8);
      // Two pages: 16 on the first, 4 (two rows) on the second.
      expect(dashes).toBe(2);
      expect(onDash).toHaveLength(grid.columns + 1 + (8 + 1) + (grid.columns + 1 + (2 + 1)));
      expect(marks).toHaveLength(0);
    });
  });

  it("writes a sample to look at, when asked", async () => {
    const folder = process.env.BADGE_SAMPLE_DIR;
    if (!folder) return;
    mkdirSync(folder, { recursive: true });
    writeFileSync(path.join(folder, "badges-sample.pdf"), await sheet({ ...DEFAULT_BADGE_DESIGN, showPhone: true, phone: "0712 345 678", bandColour: "#c62828" }));
    for (const [index, entry] of ENTRIES.entries()) {
      const image = await renderBadgeImage({ design: { ...DEFAULT_BADGE_DESIGN, showPhone: true, phone: "0712 345 678" }, locale: "ro", words: WORDS, role: entry.role });
      writeFileSync(path.join(folder, `badge-${index}.png`), Buffer.from(await image.arrayBuffer()));
    }
  }, 60_000);
});

describe("§764 the badge's picture", () => {
  it("draws the sheet's badge: the same lines, at its own scale, the role's band in its colour", () => {
    const input = { design: DEFAULT_BADGE_DESIGN, locale: "ro" as const, words: WORDS, role: { name: "Punct de apă", colour: "#c62828" } };
    const layout = badgeImageLayout(input);
    expect(layout.roleLine.text).toBe("PUNCT DE APĂ");
    const markup = JSON.stringify(badgeMarkup(input, "data:image/png;base64,"));
    expect(markup).toContain("PUNCT DE APĂ");
    expect(markup).toContain("Nume:");
    expect(markup).toContain(badgeRoleColour("#c62828"));
    expect(markup).toContain("badge-logo");
    // White on the red band (the better of the two), the club's blue on the header band.
    expect(markup).toContain(COLOR.surface);
    expect(markup).toContain(COLOR.blueInk);
  });

  it("draws a badge «fără rol» with «VOLUNTAR» alone, in the theme's colour", () => {
    const markup = JSON.stringify(badgeMarkup({ design: DEFAULT_BADGE_DESIGN, locale: "ro", words: WORDS, role: null }, ""));
    expect(markup).not.toContain("badge-label");
    expect(markup).toContain(badgeRoleColour(null));
  });

  it("renders a PNG of the paper's proportion", async () => {
    const image = await renderBadgeImage({ design: DEFAULT_BADGE_DESIGN, locale: "ro", words: WORDS, role: null });
    const bytes = Buffer.from(await image.arrayBuffer());
    expect(bytes.subarray(1, 4).toString()).toBe("PNG");
    expect(bytes.readUInt32BE(16)).toBe(960);
    expect(bytes.readUInt32BE(20)).toBe(373);
  }, 60_000);
});
