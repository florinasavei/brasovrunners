import PDFDocument from "pdfkit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type BibDesign, DEFAULT_BIB_DESIGN, readBibDesign } from "@/modules/registrations/bib-design";
import { A4_PAGE, BIB_LAYOUT, BIB_MARGIN, BIB_PAPER } from "@/modules/registrations/bib-geometry";
import { renderBibImage } from "@/modules/registrations/bib-image";
import { BIB_SHEET_CUT, renderBibSheet } from "@/modules/registrations/bibs-pdf";
import { COLOR } from "@/theme/brand";
import { drawnRuns } from "../../helpers/pdf-drawn";

/**
 * §NNN, BR-REQ-038-01 — «Fără linia punctată pe tăietură» (the owner, 2026-11-16: «cand decupez vreau sa arate mai
 * frumos», of the numbers cut from the A4 sheet). One more tick of the bib's design, off until the club makes it: the
 * sheet of two draws no dashed line across the page's middle and keeps the two short marks at the ends of the cut,
 * whether or not «Repere de tăiere pe foaie» is ticked. The sheet is checked through what pdfkit is asked to draw, in
 * the order it is asked; a design saved before the tick, and the sheet of one number a page, draw what they drew.
 */

const design = (overrides: Partial<BibDesign>): BibDesign => ({ ...DEFAULT_BIB_DESIGN, ...overrides });

const SHEET = { eventTitle: "Crosul de test", eventDate: "21 noiembrie 2026", generatedAt: new Date("2026-11-16T12:00:00Z") };
const rows = (count: number) => Array.from({ length: count }, (_, index) => ({ bibNumber: index + 7, registeredName: `Alergător ${index + 1}` }));

/** One call pdfkit was asked for: its name, then its arguments. */
type Op = [name: string, ...args: unknown[]];

/** The path and stroke calls a cut is made of, and `rect` — the one shape a plain bib draws — to see what is drawn over what. */
const TRACED = ["moveTo", "lineTo", "lineWidth", "strokeColor", "dash", "undash", "stroke", "rect"] as const;

/** One sheet as pdfkit was asked to draw it: each page's traced calls in order, and every `text()` run. */
async function sheet(over: Partial<Parameters<typeof renderBibSheet>[0]>) {
  const pages: Op[][] = [];
  const proto = PDFDocument.prototype as unknown as Record<string, (...args: unknown[]) => unknown>;
  const trace = (name: string, log: (args: unknown[]) => void) => {
    const original = proto[name];
    return vi.spyOn(proto, name).mockImplementation(function (this: unknown, ...args: unknown[]) {
      log(args);
      return original.apply(this, args);
    });
  };
  const spies = [trace("addPage", () => pages.push([])), ...TRACED.map((name) => trace(name, (args) => pages[pages.length - 1].push([name, ...args])))];
  try {
    const runs = await drawnRuns(() => renderBibSheet({ rows: rows(3), ...SHEET, ...over }));
    return { pages, runs };
  } finally {
    for (const spy of spies) spy.mockRestore();
  }
}

/** A page's lines: everything traced but the filled shapes. */
const lines = (page: Op[]) => page.filter(([name]) => name !== "rect");

/** The dashed line across the middle of a page of two, call for call as every sheet drew it before the tick (§338). */
const DASHED: Op[] = [
  ["moveTo", 0, BIB_SHEET_CUT],
  ["lineTo", A4_PAGE.width, BIB_SHEET_CUT],
  ["lineWidth", 0.5],
  ["strokeColor", COLOR.inkMuted],
  ["dash", 4, { space: 4 }],
  ["stroke"],
  ["undash"],
];

/** How far a mark runs in from the paper's edge: across the white margin and the card's inset. */
const MARK = BIB_MARGIN + BIB_LAYOUT.inset;

/** «Repere de tăiere pe foaie» at one height (§249): a solid rule at each end, call for call as it was drawn before the tick. */
const marksAt = (y: number): Op[] => [
  ["lineWidth", 0.75],
  ["strokeColor", COLOR.ink],
  ["moveTo", 0, y],
  ["lineTo", MARK, y],
  ["stroke"],
  ["moveTo", A4_PAGE.width - MARK, y],
  ["lineTo", A4_PAGE.width, y],
  ["stroke"],
];

/** The four ways the two ticks can stand. */
const TICKS: Array<{ cutMarks: boolean; hideCutLine: boolean }> = [
  { cutMarks: false, hideCutLine: false },
  { cutMarks: true, hideCutLine: false },
  { cutMarks: false, hideCutLine: true },
  { cutMarks: true, hideCutLine: true },
];

afterEach(() => vi.restoreAllMocks());

describe("§NNN the tick in the design", () => {
  it("is off in the platform's design, and in a design saved before it existed", () => {
    expect(DEFAULT_BIB_DESIGN.hideCutLine).toBe(false);
    expect(readBibDesign({}).hideCutLine).toBe(false);
    expect(readBibDesign(null).hideCutLine).toBe(false);
    // What a save of the release before wrote: the cut marks, and no word about the line.
    const before = readBibDesign({ showName: true, cutMarks: true, numberScale: "large" });
    expect(before).toEqual({ ...DEFAULT_BIB_DESIGN, cutMarks: true, numberScale: "large" });
    expect(before.hideCutLine).toBe(false);
  });

  it("keeps a stored tick, and reads anything that is not a tick as off", () => {
    expect(readBibDesign({ hideCutLine: true }).hideCutLine).toBe(true);
    expect(readBibDesign({ hideCutLine: false }).hideCutLine).toBe(false);
    for (const stored of ["yes", "true", 1, null, [], {}]) expect(readBibDesign({ hideCutLine: stored }).hideCutLine, JSON.stringify(stored)).toBe(false);
    // One nonsense value costs that one setting, never the design beside it.
    expect(readBibDesign({ hideCutLine: "yes", cutMarks: true, showLogo: false })).toEqual({ ...DEFAULT_BIB_DESIGN, cutMarks: true, showLogo: false });
  });

  it("stands apart from the cut marks' tick: either may be on without the other", () => {
    for (const ticks of TICKS) expect(readBibDesign(ticks)).toEqual({ ...DEFAULT_BIB_DESIGN, ...ticks });
  });

  it("lists the key in the default where the reader returns it, beside the cut marks: the event's import compares the two as text", () => {
    // `transfer/import.ts` keeps a design equal to the platform's own as none (null) by comparing their JSON.
    expect(JSON.stringify(readBibDesign({}))).toBe(JSON.stringify(DEFAULT_BIB_DESIGN));
    const read = Object.keys(readBibDesign({ hideCutLine: true, cutMarks: true }));
    const platform = Object.keys(DEFAULT_BIB_DESIGN);
    expect(read).toEqual(platform);
    expect(platform.indexOf("hideCutLine")).toBe(platform.indexOf("cutMarks") + 1);
    expect(read.indexOf("hideCutLine")).toBe(read.indexOf("cutMarks") + 1);
    // A design with the tick is not the platform's own, so an import keeps it.
    expect(JSON.stringify(readBibDesign({ hideCutLine: true }))).not.toBe(JSON.stringify(DEFAULT_BIB_DESIGN));
  });
});

describe("§NNN the sheet of two until the tick is made: the page as it always printed", () => {
  it("draws the dashed line across the middle of every page, and nothing else, with neither tick", async () => {
    const { pages } = await sheet({});
    // Three numbers: two pages, the second with its lower half blank — and its cut all the same.
    expect(pages).toHaveLength(2);
    for (const page of pages) expect(lines(page)).toEqual(DASHED);
  });

  it("draws the dashed line and then the two end marks with «Repere de tăiere pe foaie» alone", async () => {
    const { pages } = await sheet({ design: design({ cutMarks: true }) });
    expect(pages).toHaveLength(2);
    for (const page of pages) expect(lines(page)).toEqual([...DASHED, ...marksAt(BIB_SHEET_CUT)]);
  });

  it("draws a design saved before the tick existed as the platform's own does", async () => {
    const stored = await sheet({ design: readBibDesign({ showName: true, cutMarks: false }) });
    expect(stored).toEqual(await sheet({}));
  });
});

describe("§NNN «Fără linia punctată pe tăietură» on the sheet of two", () => {
  it.each([false, true])("draws no dashed line, and the two end marks once, with «Repere de tăiere pe foaie» %s", async (cutMarks) => {
    const { pages } = await sheet({ design: design({ hideCutLine: true, cutMarks }) });
    expect(pages).toHaveLength(2);
    for (const page of pages) {
      // Nothing dashed and nothing across the page: the marks alone, drawn once whichever ticks ask for them.
      expect(lines(page)).toEqual(marksAt(BIB_SHEET_CUT));
      expect(page.some(([name]) => name === "dash" || name === "undash")).toBe(false);
    }
  });

  it("draws the marks «Repere de tăiere pe foaie» draws: solid, at the cut, from each edge of the paper across the margin", async () => {
    const marked = await sheet({ design: design({ cutMarks: true }) });
    const hidden = await sheet({ design: design({ hideCutLine: true }) });
    // The very calls: what the cut marks' tick adds after the dashed line is all the hidden line leaves.
    expect(hidden.pages.map(lines)).toEqual(marked.pages.map((page) => lines(page).slice(DASHED.length)));
    const starts = lines(hidden.pages[0]).filter(([name]) => name === "moveTo");
    const ends = lines(hidden.pages[0]).filter(([name]) => name === "lineTo");
    // Half-way down the A4 page, the upper number's foot and the lower number's top.
    expect(BIB_SHEET_CUT).toBe(A4_PAGE.height / 2);
    expect(starts).toEqual([["moveTo", 0, BIB_SHEET_CUT], ["moveTo", A4_PAGE.width - 36, BIB_SHEET_CUT]]);
    expect(ends).toEqual([["lineTo", 36, BIB_SHEET_CUT], ["lineTo", A4_PAGE.width, BIB_SHEET_CUT]]);
    // Short: each ends inside the white margin and the card's inset, well clear of the page's middle.
    expect(MARK).toBe(36);
    expect(MARK).toBeLessThan(A4_PAGE.width / 10);
  });

  it("marks the cut of a page whose lower half is blank: the upper number's foot is the cut all the same", async () => {
    const odd = await sheet({ rows: rows(1), design: design({ hideCutLine: true }) });
    expect(odd.pages).toHaveLength(1);
    expect(lines(odd.pages[0])).toEqual(marksAt(BIB_SHEET_CUT));
  });

  it("changes nothing else on the page: the same words in the same places, the same band", async () => {
    for (const cutMarks of [false, true]) {
      const off = await sheet({ rows: rows(2), design: design({ cutMarks }) });
      const on = await sheet({ rows: rows(2), design: design({ cutMarks, hideCutLine: true }) });
      expect(on.runs).toEqual(off.runs);
      const rects = (page: Op[]) => page.filter(([name]) => name === "rect");
      expect(on.pages.map(rects)).toEqual(off.pages.map(rects));
      expect(on.pages.map(rects)[0]).toHaveLength(2);
    }
  });

  it("draws the marks before the numbers, so a band that starts at the cut is drawn over them and no dash is left on its colour", async () => {
    const { pages } = await sheet({ rows: rows(2), design: design({ hideCutLine: true, bandBleed: true }) });
    const [page] = pages;
    // The page opens with its cut: the marks are the first thing drawn.
    expect(page.slice(0, marksAt(BIB_SHEET_CUT).length)).toEqual(marksAt(BIB_SHEET_CUT));
    // The lower number's band from edge to edge starts exactly at the cut, and comes after every stroke of the page.
    const lowerBand = page.findIndex(([name, x, y, width]) => name === "rect" && x === 0 && y === BIB_SHEET_CUT && width === BIB_PAPER.width);
    expect(lowerBand).toBeGreaterThan(-1);
    expect(page.map(([name]) => name).lastIndexOf("stroke")).toBeLessThan(lowerBand);
    expect(page.some(([name]) => name === "dash")).toBe(false);
  });

  it("prints the same number of pages, and a sheet with nothing to print is still its one page with no cut", async () => {
    expect((await sheet({ rows: rows(5), design: design({ hideCutLine: true }) })).pages).toHaveLength(3);
    const empty = await sheet({ rows: [], design: design({ hideCutLine: true, cutMarks: true }) });
    expect(empty.pages).toEqual([[]]);
  });
});

describe("§NNN one number a page (§79) draws what it drew, however the two ticks stand", () => {
  /** The centred A5 number's own top and foot on its A4 page: where the trim guide of §249 goes. */
  const top = (A4_PAGE.height - BIB_PAPER.height) / 2;
  const foot = top + BIB_PAPER.height;

  it.each(TICKS)("with «Repere de tăiere pe foaie» $cutMarks and «Fără linia punctată pe tăietură» $hideCutLine", async (ticks) => {
    const { pages, runs } = await sheet({ rows: rows(2), layout: "one", design: design(ticks) });
    expect(pages).toHaveLength(2);
    // No cut on a page with nothing to cut from, and never a dash: the trim guide at the number's top and foot with the
    // cut marks' tick, nothing at all without it.
    const guide = ticks.cutMarks ? [...marksAt(top), ...marksAt(foot)] : [];
    for (const page of pages) {
      expect(lines(page)).toEqual(guide);
      expect(page.some(([name, , y]) => name === "moveTo" && y === BIB_SHEET_CUT)).toBe(false);
    }
    // The whole page is the one the same design drew before the tick existed.
    const before = await sheet({ rows: rows(2), layout: "one", design: design({ cutMarks: ticks.cutMarks }) });
    expect({ pages, runs }).toEqual(before);
  });
});

describe("§NNN the picture of one number has no cut to draw", () => {
  it("is the same picture, byte for byte, however the two ticks stand — the designer's preview shows one number, never the sheet", async () => {
    const png = async (ticks: Partial<BibDesign>) => {
      const response = await renderBibImage({ bibNumber: 7, registeredName: "Alergător Unu", eventTitle: SHEET.eventTitle, eventDate: SHEET.eventDate, bandColour: null, design: design(ticks) });
      return Buffer.from(await response.arrayBuffer());
    };
    const plain = await png({});
    expect(plain.byteLength).toBeGreaterThan(1000);
    for (const ticks of TICKS) expect((await png(ticks)).equals(plain), JSON.stringify(ticks)).toBe(true);
    // The comparison can tell two pictures apart: a tick the picture does draw changes it.
    expect((await png({ showName: false })).equals(plain)).toBe(false);
  });
});
