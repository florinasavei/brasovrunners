import PDFDocument from "pdfkit";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BIB_BAND_FALLBACK, BIB_NAME_SCALES, type BibDesign, DEFAULT_BIB_DESIGN, readBibDesign } from "@/modules/registrations/bib-design";
import {
  BIB_CARD,
  BIB_IMAGE,
  BIB_IMAGE_SCALE,
  BIB_LAYOUT,
  BIB_MARGIN,
  BIB_NAME_STRIPS,
  BIB_PAPER,
  BIB_TEXT_LINE,
  bibNameFit,
  bibNameStrip,
  bibNumberArea,
} from "@/modules/registrations/bib-geometry";
import { bibTitleWidth } from "@/modules/registrations/bib-header";
import { renderBibImage } from "@/modules/registrations/bib-image";
import { renderBibSheet } from "@/modules/registrations/bibs-pdf";
import { drawnRuns } from "../../helpers/pdf-drawn";

/**
 * §NNN, BR-REQ-038-01 — two choices of the bib's designer, each off until the club makes it (the owner, 2026-11-16:
 * «vreau ca numele alergatorului sa fie un pic mai mare», «si banda cu Brasov runners vreau sa fie dintr-un capat in
 * altul, ca si fundal»): «Mărimea numelui» and «Banda dintr-un capăt în altul». The sheet is checked through what
 * pdfkit is asked to draw, the picture through its pixels; a design saved before draws what it drew.
 */

const L = BIB_LAYOUT;
const design = (overrides: Partial<BibDesign>): BibDesign => ({ ...DEFAULT_BIB_DESIGN, ...overrides });
const px = (points: number) => points * BIB_IMAGE_SCALE;

const NAME = "Alergător Unu";
/** Forty-odd letters: whole at «Normală», too long for the card at the two larger sizes. */
const LONG_NAME = "Alexandru-Constantin Popescu-Brașoveanu";
/** Longer than the card holds at any size: cut with «…» at «Normală», as it always was. */
const ENDLESS_NAME = "Maria-Alexandra-Constantina Popescu-Brașoveanu de la Săcele";
const NAME_WIDTH = BIB_CARD.width - 2 * L.inset;

const SHEET = { eventTitle: "Crosul de test", eventDate: "21 noiembrie 2026", generatedAt: new Date("2026-11-16T12:00:00Z") };

type Rect = [number, number, number, number];

/** One sheet's `text()` runs and its `rect()` calls, in the order drawn. */
async function sheet(over: Partial<Parameters<typeof renderBibSheet>[0]>) {
  const rects: Rect[] = [];
  const original = PDFDocument.prototype.rect;
  const spy = vi.spyOn(PDFDocument.prototype, "rect").mockImplementation(function (this: PDFKit.PDFDocument, ...args: unknown[]) {
    rects.push(args.slice(0, 4) as Rect);
    return (original as (...a: unknown[]) => PDFKit.PDFDocument).apply(this, args);
  });
  try {
    const runs = await drawnRuns(() => renderBibSheet({ rows: [{ bibNumber: 7, registeredName: NAME }], ...SHEET, ...over }));
    return { runs, rects, run: (text: string) => runs.find((entry) => entry.text === text)! };
  } finally {
    spy.mockRestore();
  }
}

/** A picture's pixels, and one pixel's colour as `[r, g, b]`. */
async function picture(over: Partial<Parameters<typeof renderBibImage>[0]>) {
  const response = await renderBibImage({ bibNumber: 7, registeredName: NAME, eventTitle: SHEET.eventTitle, eventDate: SHEET.eventDate, bandColour: null, design: DEFAULT_BIB_DESIGN, ...over });
  const { data, info } = await sharp(Buffer.from(await response.arrayBuffer())).raw().toBuffer({ resolveWithObject: true });
  const colour = (x: number, y: number) => Array.from(data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3));
  return { colour, info };
}

const rgb = (hex: string) => [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));
const near = (a: number[], b: number[]) => a.every((part, index) => Math.abs(part - b[index]) <= 6);

afterEach(() => vi.restoreAllMocks());

describe("§NNN the two choices in the design", () => {
  it("reads a design saved before as the name and the band every bib had", () => {
    const before = readBibDesign({ showName: true, namePosition: "below" });
    expect(before.nameScale).toBe("normal");
    expect(before.bandBleed).toBe(false);
    expect(DEFAULT_BIB_DESIGN.nameScale).toBe("normal");
    expect(DEFAULT_BIB_DESIGN.bandBleed).toBe(false);
  });

  it("keeps a stored size and tick, and reads anything else as the default", () => {
    expect(readBibDesign({ nameScale: "large" }).nameScale).toBe("large");
    expect(readBibDesign({ nameScale: "larger" }).nameScale).toBe("larger");
    expect(readBibDesign({ nameScale: "huge" }).nameScale).toBe("normal");
    expect(readBibDesign({ nameScale: 2 }).nameScale).toBe("normal");
    expect(readBibDesign({ bandBleed: true }).bandBleed).toBe(true);
    expect(readBibDesign({ bandBleed: "yes" }).bandBleed).toBe(false);
  });

  it("lists the two keys in the default where the reader returns them: the import compares the two as text", () => {
    // `transfer/import.ts` keeps a design equal to the platform's own as none (null) by comparing their JSON.
    expect(JSON.stringify(readBibDesign({}))).toBe(JSON.stringify(DEFAULT_BIB_DESIGN));
    expect(Object.keys(readBibDesign({ nameScale: "large", bandBleed: true }))).toEqual(Object.keys(DEFAULT_BIB_DESIGN));
  });

  it("has a strip for every size the designer offers, and no other", () => {
    expect(Object.keys(BIB_NAME_STRIPS)).toEqual([...BIB_NAME_SCALES]);
  });
});

describe("§NNN «Mărimea numelui»: the strip of each size", () => {
  it("is the layout's own strip at «Normală», and for anything unknown", () => {
    const normal = { size: L.nameSize, block: L.nameBlock, top: L.nameTop, blankShift: 0 };
    expect(bibNameStrip("normal")).toEqual(normal);
    expect(bibNameStrip(undefined)).toEqual(normal);
    expect(bibNameStrip(null)).toEqual(normal);
    expect(bibNameStrip("enormous")).toEqual(normal);
  });

  it("grows the type and the strip together, the line always inside its strip", () => {
    expect(bibNameStrip("large")).toMatchObject({ size: 30, block: 52, blankShift: 8 });
    expect(bibNameStrip("larger")).toMatchObject({ size: 36, block: 60, blankShift: 16 });
    for (const scale of BIB_NAME_SCALES) {
      const strip = bibNameStrip(scale);
      // The whole line — ascender to descender — ends above the strip's foot.
      expect(strip.top + strip.size * BIB_TEXT_LINE, scale).toBeLessThan(strip.block);
      // A desk spare's rule (§444) keeps its distance from the strip's foot, and its mark still ends inside the strip.
      expect(strip.block - (L.blankLineTop + strip.blankShift), scale).toBe(L.nameBlock - L.blankLineTop);
      expect(L.blankMarkTop + strip.blankShift + L.blankMarkSize * BIB_TEXT_LINE, scale).toBeLessThan(strip.block);
    }
  });

  it("takes what the strip grows by from the number's area, and nothing at «Normală»", () => {
    const area = (scale: string) => bibNumberArea({ footer: 22, name: bibNameStrip(scale).block, sponsors: 0, stripe: 0, extras: 0 });
    expect(area("normal")).toBe(bibNumberArea({ footer: 22, name: L.nameBlock, sponsors: 0, stripe: 0, extras: 0 }));
    expect(area("normal") - area("large")).toBe(8);
    expect(area("normal") - area("larger")).toBe(16);
  });
});

describe("§NNN a long name under a larger size is set smaller, never cut sooner", () => {
  it("sets a name that fits at the strip's own size and top", () => {
    for (const scale of BIB_NAME_SCALES) {
      const strip = bibNameStrip(scale);
      expect(bibNameFit(NAME, strip, NAME_WIDTH, bibTitleWidth), scale).toEqual({ size: strip.size, top: strip.top });
    }
  });

  it("sets a long name at the largest size that holds it whole, centred on the line its strip's size would take", () => {
    // The fixture's premise: whole at «Normală», too long at «Mai mare».
    expect(bibTitleWidth(LONG_NAME) * L.nameSize).toBeLessThanOrEqual(NAME_WIDTH);
    expect(bibTitleWidth(LONG_NAME) * bibNameStrip("large").size).toBeGreaterThan(NAME_WIDTH);
    for (const scale of ["large", "larger"] as const) {
      const strip = bibNameStrip(scale);
      const fit = bibNameFit(LONG_NAME, strip, NAME_WIDTH, bibTitleWidth);
      expect(fit.size, scale).toBeLessThan(strip.size);
      expect(fit.size, scale).toBeGreaterThanOrEqual(L.nameSize);
      expect(bibTitleWidth(LONG_NAME) * fit.size, scale).toBeLessThanOrEqual(NAME_WIDTH);
      // The largest, to half a point: half a point more would not fit.
      expect(bibTitleWidth(LONG_NAME) * (fit.size + 0.5), scale).toBeGreaterThan(NAME_WIDTH);
      expect(fit.top, scale).toBeCloseTo(strip.top + ((strip.size - fit.size) * BIB_TEXT_LINE) / 2, 9);
    }
  });

  it("never goes under «Normală»: a name too long for the card is cut there, as it always was", () => {
    expect(bibTitleWidth(ENDLESS_NAME) * L.nameSize).toBeGreaterThan(NAME_WIDTH);
    for (const scale of BIB_NAME_SCALES) expect(bibNameFit(ENDLESS_NAME, bibNameStrip(scale), NAME_WIDTH, bibTitleWidth).size, scale).toBe(L.nameSize);
    // «Normală» is never fitted at all: every name at the size it always had, at the strip's own top.
    for (const name of [NAME, LONG_NAME, ENDLESS_NAME, ""]) {
      expect(bibNameFit(name, bibNameStrip("normal"), NAME_WIDTH, bibTitleWidth)).toEqual({ size: L.nameSize, top: L.nameTop });
    }
  });
});

describe("§NNN «Mărimea numelui» on the sheet", () => {
  it("prints the name at the size chosen, the strip growing upwards from the same foot", async () => {
    const normal = await sheet({});
    const large = await sheet({ design: design({ nameScale: "large" }) });
    const larger = await sheet({ design: design({ nameScale: "larger" }) });
    expect(normal.run(NAME).size).toBe(L.nameSize);
    expect(large.run(NAME).size).toBe(30);
    expect(larger.run(NAME).size).toBe(36);
    // Under the number (the default place): each strip's top is higher by what the strip grew.
    expect(normal.run(NAME).y! - large.run(NAME).y!).toBeCloseTo(8, 9);
    expect(normal.run(NAME).y! - larger.run(NAME).y!).toBeCloseTo(16, 9);
    // The number is centred on an area that lost those points at its foot: half of them higher.
    expect(normal.run("7").y! - large.run("7").y!).toBeCloseTo(4, 9);
    expect(normal.run("7").y! - larger.run("7").y!).toBeCloseTo(8, 9);
    // And never larger for it.
    expect(large.run("7").size!).toBeLessThanOrEqual(normal.run("7").size!);
    expect(larger.run("7").size!).toBeLessThanOrEqual(large.run("7").size!);
  });

  it("keeps the name's top above the number, and moves the number down by the strip's growth", async () => {
    const normal = await sheet({ design: design({ namePosition: "above" }) });
    const larger = await sheet({ design: design({ namePosition: "above", nameScale: "larger" }) });
    expect(larger.run(NAME).y).toBe(normal.run(NAME).y);
    expect(larger.run(NAME).size).toBe(36);
    // The number's area starts sixteen points lower and is as much shorter: its centre is eight points lower.
    expect(larger.run("7").y! - normal.run("7").y!).toBeCloseTo(8, 9);
  });

  it("sets a long name smaller rather than cutting it, at the fit both renderers share", async () => {
    const rows = [{ bibNumber: 7, registeredName: LONG_NAME }];
    const normal = await sheet({ rows });
    const larger = await sheet({ rows, design: design({ nameScale: "larger" }) });
    const fit = bibNameFit(LONG_NAME, bibNameStrip("larger"), NAME_WIDTH, bibTitleWidth);
    expect(normal.run(LONG_NAME).size).toBe(L.nameSize);
    expect(larger.run(LONG_NAME).size).toBe(fit.size);
    expect(fit.size).toBeGreaterThan(L.nameSize);
    // In the taller strip, sixteen points higher at its top, the smaller line starts lower by half of what it lost.
    expect(normal.run(LONG_NAME).y! - larger.run(LONG_NAME).y!).toBeCloseTo(16 - (fit.top - bibNameStrip("larger").top), 9);
  });

  it("leaves a desk spare's rule and mark where they were on the paper, with more room above them", async () => {
    const rows = [{ bibNumber: 7, registeredName: null }];
    const mark = "înscris la fața locului";
    const normal = await sheet({ rows, blankMark: mark });
    const larger = await sheet({ rows, blankMark: mark, design: design({ nameScale: "larger" }) });
    // Under the number the strip grows upwards and the mark moves down in it by as much: the same point of the paper.
    expect(larger.run(mark).y).toBeCloseTo(normal.run(mark).y!, 9);
    expect(larger.run(mark).size).toBe(L.blankMarkSize);
  });
});

describe("§NNN «Banda dintr-un capăt în altul» on the sheet", () => {
  const band: Rect = [BIB_MARGIN, BIB_MARGIN, BIB_CARD.width, L.bandHeight];
  const bleed: Rect = [0, 0, BIB_PAPER.width, BIB_MARGIN + L.bandHeight];
  const has = (rects: Rect[], want: Rect) => rects.some((rect) => rect.every((part, index) => Math.abs(part - want[index]) < 1e-9));

  it("draws the band inside the margin until ticked, then from the paper's left edge to its right and up to its top", async () => {
    const off = await sheet({});
    const on = await sheet({ design: design({ bandBleed: true }) });
    expect(has(off.rects, band)).toBe(true);
    expect(has(off.rects, bleed)).toBe(false);
    expect(has(on.rects, bleed)).toBe(true);
    expect(has(on.rects, band)).toBe(false);
  });

  it("keeps the band's foot, the race's words and everything under the band where they were", async () => {
    const off = await sheet({});
    const on = await sheet({ design: design({ bandBleed: true }) });
    // The same foot: the margin and the band's height from the paper's top.
    expect(bleed[1] + bleed[3]).toBe(band[1] + band[3]);
    expect(on.runs).toEqual(off.runs);
  });

  it("reaches the cut on the page's lower bib, and each bib's own top when one is printed per page", async () => {
    const rows = [
      { bibNumber: 7, registeredName: NAME },
      { bibNumber: 8, registeredName: "Alergător Doi" },
    ];
    const two = await sheet({ rows, design: design({ bandBleed: true }) });
    expect(has(two.rects, bleed)).toBe(true);
    expect(has(two.rects, [0, BIB_PAPER.height, BIB_PAPER.width, BIB_MARGIN + L.bandHeight])).toBe(true);
    const one = await sheet({ rows, layout: "one", design: design({ bandBleed: true }) });
    const top = BIB_PAPER.height / 2;
    expect(one.rects.filter((rect) => has([rect], [0, top, BIB_PAPER.width, BIB_MARGIN + L.bandHeight]))).toHaveLength(2);
  });
});

describe("§NNN the picture draws both as the sheet does", () => {
  /** A point well inside the white margin, clear of the paper's drawn edge (§338). */
  const MARGIN = 7;
  const bandFoot = Math.round(px(BIB_MARGIN + L.bandHeight));
  const white = [255, 255, 255];
  const club = rgb(BIB_BAND_FALLBACK);

  it("leaves the margin white round the band until ticked", async () => {
    const { colour, info } = await picture({});
    expect(info.width).toBe(BIB_IMAGE.width);
    for (const [x, y] of [[MARGIN, MARGIN], [info.width - 1 - MARGIN, MARGIN], [Math.round(info.width / 2), MARGIN], [MARGIN, bandFoot - 10]]) expect(near(colour(x, y), white), `${x},${y}`).toBe(true);
    // The band itself, inside the margin, in the club's colour.
    expect(near(colour(Math.round(px(BIB_MARGIN)) + 4, bandFoot - 4), club)).toBe(true);
  });

  it("carries the band's colour to the paper's left, right and top edges when ticked, and no lower than the band's foot", async () => {
    const { colour, info } = await picture({ design: design({ bandBleed: true }) });
    for (const [x, y] of [[MARGIN, MARGIN], [info.width - 1 - MARGIN, MARGIN], [Math.round(info.width / 2), MARGIN], [MARGIN, bandFoot - 10], [info.width - 1 - MARGIN, bandFoot - 10]]) {
      expect(near(colour(x, y), club), `${x},${y}`).toBe(true);
    }
    // Under the band's foot the margin is the paper's white again, on both sides.
    for (const x of [MARGIN, info.width - 1 - MARGIN]) expect(near(colour(x, bandFoot + 10), white), `${x}`).toBe(true);
  });

  it("carries the event's own colour, not the club's, when the event has one", async () => {
    const { colour } = await picture({ bandColour: "#1b7f3b", design: design({ bandBleed: true }) });
    expect(near(colour(MARGIN, MARGIN), rgb("#1b7f3b"))).toBe(true);
  });

  /** The rows of the name's strip that carry ink, in the card's middle columns: the capitals' height, in pixels. */
  async function nameInk(scale: BibDesign["nameScale"], name: string) {
    const { colour, info } = await picture({ registeredName: name, design: design({ nameScale: scale }) });
    const strip = bibNameStrip(scale);
    const area = bibNumberArea({ footer: L.footerHeight, name: strip.block, sponsors: 0, stripe: 0, extras: 0 });
    const stripTop = Math.round(px(BIB_MARGIN + L.bandHeight + area));
    const stripFoot = Math.round(px(BIB_MARGIN + L.bandHeight + area + strip.block));
    const rows: number[] = [];
    for (let y = stripTop; y < stripFoot; y++) {
      let ink = false;
      for (let x = Math.round(info.width * 0.2); x < info.width * 0.8 && !ink; x++) ink = colour(x, y)[0] < 110;
      if (ink) rows.push(y);
    }
    return { height: rows.length === 0 ? 0 : rows[rows.length - 1] - rows[0] + 1, first: rows[0], stripTop, stripFoot };
  }

  it("draws the name's capitals a quarter and a half taller, inside the strip the sheet gives them", async () => {
    // Capitals only, no descender: the ink's height is the capitals' — 1456 of Roboto's 2048 units.
    const capitals = (size: number) => px((1456 / 2048) * size);
    for (const scale of BIB_NAME_SCALES) {
      const ink = await nameInk(scale, "HENRI THE TEST");
      expect(Math.abs(ink.height - capitals(bibNameStrip(scale).size)), scale).toBeLessThanOrEqual(2);
      expect(ink.first, scale).toBeGreaterThan(ink.stripTop);
    }
  });

  it("draws a long name at the fitted size too", async () => {
    const fit = bibNameFit("ALEXANDRU-CONSTANTIN POPESCU-BRASOVEANU", bibNameStrip("larger"), NAME_WIDTH, bibTitleWidth);
    expect(fit.size).toBeLessThan(36);
    const ink = await nameInk("larger", "ALEXANDRU-CONSTANTIN POPESCU-BRASOVEANU");
    expect(Math.abs(ink.height - px((1456 / 2048) * fit.size))).toBeLessThanOrEqual(2);
  });
});
