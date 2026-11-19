import PDFDocument from "pdfkit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { bibTitleWidth } from "@/modules/registrations/bib-header";
import { BADGE_ROLE_FALLBACK, type BadgeDesign, badgeWords, DEFAULT_BADGE_DESIGN } from "@/modules/volunteers/badges/badge-design";
import { type BadgeLayout, badgePaper, badgeSheetSlots } from "@/modules/volunteers/badges/badge-geometry";
import { badgeImageLayout } from "@/modules/volunteers/badges/badge-image";
import { namedBadgeColour } from "@/modules/volunteers/badges/badge-named";
import { type BadgeSheetEntry, renderBadgeSheet } from "@/modules/volunteers/badges/badges-pdf";
import { BIB_COLOURS, COLOR } from "@/theme/brand";

/**
 * §NNN — «Ecusoane cu nume» drawn (BR-REQ-050-02; the hotfixes of 2026-11-19, amending §764's «no name is printed»): a badge of the
 * list carries its own word on the band, in capitals, its first name printed large in ink where «Nume:» and the marker's line would be,
 * and its own band colour when the line named one that reads at AA — else the design's band, and the club's orange for a colour no
 * word reads on. Nothing to write on: no «Nume:», no line, no marker's area. With «Logo-ul clubului jos, ca filigran» (§965) the name
 * stands above the watermark, where «Nume:» goes, at up to three quarters of that room; when the logo leaves less than a third of the
 * writing area above it — the default size's lockup leaves 27 %, a larger or raised one (§969) less — the name keeps the area's middle.
 * Read from pdfkit's own calls, at the layout both renderers draw (`badgeImageLayout`).
 */

const RO = { label: "VOLUNTAR", name: "Nume:", phoneLabel: "Coordonator" };
const TITLE = "Brașov Trail Race";
const AT = new Date("2026-11-19T08:00:00.000Z");
const wordsOf = (design: BadgeDesign) => badgeWords(design, "ro", TITLE, RO);
const hexOf = (key: (typeof BIB_COLOURS)[number]["key"]) => BIB_COLOURS.find((colour) => colour.key === key)!.hex;
/** No margin marks: a solid stroke outside the dashed cuts is then a faint line inside a badge — the name's, the marker's, its divider. */
const PLAIN: BadgeDesign = { ...DEFAULT_BADGE_DESIGN, cutMarks: false };
/** Every line and area the writing area can have: the name's line, the marker's area with its label. */
const WRITING: BadgeDesign = { ...PLAIN, writingLine: true, showMarker: true, markerLabelRo: "Tură", markerLabelEn: "Shift" };

type Call = { name: string; args: unknown[]; size?: number };
const DRAWING = ["text", "font", "fillColor", "rect", "fill", "stroke", "image", "opacity", "dash", "undash"] as const;

/** Every drawing call the sheet makes to pdfkit, in order — a text with the size it was set at — and the file. */
async function sheetCalls(design: BadgeDesign, entries: readonly BadgeSheetEntry[]): Promise<{ calls: Call[]; pdf: Buffer }> {
  const calls: Call[] = [];
  const prototype = PDFDocument.prototype as unknown as Record<string, (...args: unknown[]) => unknown>;
  for (const name of DRAWING) {
    const original = prototype[name];
    vi.spyOn(prototype, name).mockImplementation(function (this: { _fontSize?: number }, ...args: unknown[]) {
      calls.push({ name, args, size: name === "text" ? this._fontSize : undefined });
      return original.apply(this, args);
    });
  }
  try {
    const pdf = await renderBadgeSheet({ design, locale: "ro", words: wordsOf(design), entries, eventTitle: TITLE, generatedAt: AT });
    return { calls, pdf };
  } finally {
    vi.restoreAllMocks();
  }
}

const texts = (calls: Call[]) => calls.filter((call) => call.name === "text").map((call) => call.args[0] as string);
/** The name's text: where pdfkit was asked to set it, at which size, with which options. */
function nameCall(calls: Call[], name: string) {
  const call = calls.find((one) => one.name === "text" && one.args[0] === name);
  if (!call) throw new Error(`«${name}» was not drawn`);
  const [, left, top, options] = call.args as [string, number, number, Record<string, unknown>];
  return { left, top, size: call.size!, options, at: calls.indexOf(call) };
}
/** The faint strokes drawn outside the dashed cuts: the writing area's lines. */
function faintStrokes(calls: Call[]): number {
  let dashed = false;
  let count = 0;
  for (const call of calls) {
    if (call.name === "dash") dashed = true;
    else if (call.name === "undash") dashed = false;
    else if (call.name === "stroke" && !dashed) count += 1;
  }
  return count;
}
/** The colour the role's band was filled with on the badge at `slot`: the fill that follows the rectangle at the band's corner. */
function bandColour(calls: Call[], slot: { x: number; y: number }, layout: BadgeLayout): string {
  const near = (value: unknown, expected: number) => Math.abs((value as number) - expected) < 1e-9;
  const at = calls.findIndex((call) => call.name === "rect" && near(call.args[0], slot.x + layout.content.left) && near(call.args[1], slot.y + layout.role.top));
  const fill = calls.slice(at + 1).find((call) => call.name === "fill");
  if (at < 0 || !fill) throw new Error("no role band drawn");
  return fill.args[0] as string;
}
/** The watermark's top on the sheet: the picture drawn right after its opacity is set. */
function watermarkTop(calls: Call[]): number {
  const at = calls.findIndex((call) => call.name === "opacity");
  const image = calls[at + 1];
  expect(image?.name).toBe("image");
  return image.args[2] as number;
}
/** The layout of a badge of the list, as the sheet lays it out: no role, the line's own word on its band. */
const layoutOf = (design: BadgeDesign, label: string) => badgeImageLayout({ design, locale: "ro", words: { ...wordsOf(design), label }, role: null });
const firstSlot = (design: BadgeDesign) => badgeSheetSlots(1, badgePaper(design))[0];
const named = (label: string, printedName: string, colour?: string): BadgeSheetEntry => ({ role: null, count: 1, label, printedName, ...(colour ? { colour } : {}) });

afterEach(() => vi.restoreAllMocks());

describe("§NNN a badge of the list", () => {
  it("draws its own word on the band in capitals and its first name — never «Nume:», the line for the name or the marker's area", async () => {
    const { calls, pdf } = await sheetCalls(WRITING, [named("Fotografă", "Amalia"), named("Organizator", "Dany")]);
    expect(texts(calls)).toEqual([TITLE, "FOTOGRAFĂ", "Amalia", TITLE, "ORGANIZATOR", "Dany"]);
    expect(faintStrokes(calls)).toBe(0);
    // The file says how many badges it holds, as every sheet does.
    expect(pdf.toString("latin1")).toContain("(2 badges)");
    // The same design's badge with «Nume:» draws it, its line, the marker's label, its divider and its line: what the list leaves out.
    const plain = await sheetCalls(WRITING, [{ role: null, count: 1 }]);
    expect(texts(plain.calls)).toEqual([TITLE, "VOLUNTAR", "Nume:", "Tură:"]);
    expect(faintStrokes(plain.calls)).toBe(3);
  });

  it("prints the first name bold, in ink, as one line that never wraps — shrunk to the band's width, never cut", async () => {
    const long = "Maximiliana-Alexandra Constantinescu";
    const { calls } = await sheetCalls(PLAIN, [named("Voluntar", "Ana"), named("Voluntar", long)]);
    const short = nameCall(calls, "Ana");
    const wide = nameCall(calls, long);
    for (const drawn of [short, wide]) {
      expect(drawn.options).toMatchObject({ lineBreak: false });
      const before = calls.slice(0, drawn.at);
      expect(before.findLast((call) => call.name === "font")?.args[0]).toBe("bold");
      expect(before.findLast((call) => call.name === "fillColor")?.args[0]).toBe(COLOR.ink);
    }
    // The long one whole, smaller, and no wider than the band's width less its pad.
    const layout = layoutOf(PLAIN, "Voluntar");
    expect(wide.size).toBeLessThan(short.size);
    expect(wide.size * bibTitleWidth(long)).toBeLessThanOrEqual(layout.content.width - 2 * layout.pad + 1e-6);
  });

  it("draws no name for a line with a word and no name: the word alone, and still nothing to write on", async () => {
    const { calls } = await sheetCalls(WRITING, [named("Fotograf", "")]);
    expect(texts(calls)).toEqual([TITLE, "FOTOGRAF"]);
    expect(faintStrokes(calls)).toBe(0);
  });

  it("keeps the coordinator's telephone on a badge of the list, under the name", async () => {
    const design: BadgeDesign = { ...PLAIN, showPhone: true, phone: "0712 345 678" };
    const { calls } = await sheetCalls(design, [named("Fotograf", "Amalia")]);
    expect(texts(calls)).toEqual([TITLE, "FOTOGRAF", "Amalia", "Coordonator: 0712 345 678"]);
  });

  it("lays out each word on its own: two words on one sheet are two badges, never the first one's twice", async () => {
    const { calls } = await sheetCalls(PLAIN, [named("Fotograf", "Amalia"), named("Organizator", "Dany"), named("Fotograf", "Ion")]);
    expect(texts(calls).filter((text) => text !== TITLE)).toEqual(["FOTOGRAF", "Amalia", "ORGANIZATOR", "Dany", "FOTOGRAF", "Ion"]);
  });
});

describe("§NNN the band of a badge of the list", () => {
  const slots = (design: BadgeDesign, count: number) => badgeSheetSlots(count, badgePaper(design));

  it("takes the colour its line named, checked at AA like a role's", async () => {
    const purple = namedBadgeColour("mov")!;
    const green = namedBadgeColour("verde")!;
    const { calls } = await sheetCalls(PLAIN, [named("Organizator", "Dany", purple), named("Fotograf", "Amalia", green), named("Voluntar", "Ion", "#C62828")]);
    const [first, second, third] = slots(PLAIN, 3);
    expect(bandColour(calls, first, layoutOf(PLAIN, "Organizator"))).toBe(hexOf("purple"));
    expect(bandColour(calls, second, layoutOf(PLAIN, "Fotograf"))).toBe(COLOR.kindSpecialInk);
    // A code typed in capitals prints as the same colour.
    expect(bandColour(calls, third, layoutOf(PLAIN, "Voluntar"))).toBe(hexOf("red"));
  });

  it("gives a typed colour no word reads on the club's orange, never unreadable words", async () => {
    const { calls } = await sheetCalls(PLAIN, [named("Fotograf", "Amalia", "#808080"), named("Fotograf", "Dany", hexOf("green"))]);
    const [first, second] = slots(PLAIN, 2);
    expect(bandColour(calls, first, layoutOf(PLAIN, "Fotograf"))).toBe(BADGE_ROLE_FALLBACK);
    // The bibs' green reads at 4.4 : 1: typed as a code, it is refused the same way.
    expect(bandColour(calls, second, layoutOf(PLAIN, "Fotograf"))).toBe(BADGE_ROLE_FALLBACK);
    expect(BADGE_ROLE_FALLBACK).toBe(COLOR.orange);
  });

  it("wears the design's own band when its line named none: the one badge's colour, or the club's orange per role", async () => {
    const single: BadgeDesign = { ...PLAIN, mode: "single", singleColour: hexOf("teal") };
    const one = await sheetCalls(single, [named("Fotograf", "Amalia"), named("Fotograf", "Dany", namedBadgeColour("negru")!)]);
    const [first, second] = slots(single, 2);
    expect(bandColour(one.calls, first, layoutOf(single, "Fotograf"))).toBe(hexOf("teal"));
    // A line's own colour wins over the design's.
    expect(bandColour(one.calls, second, layoutOf(single, "Fotograf"))).toBe(hexOf("black"));
    const perRole: BadgeDesign = { ...PLAIN, mode: "perRole", singleColour: hexOf("teal") };
    const per = await sheetCalls(perRole, [named("Fotograf", "Amalia")]);
    expect(bandColour(per.calls, firstSlot(perRole), layoutOf(perRole, "Fotograf"))).toBe(COLOR.orange);
  });
});

describe("§NNN the printed name and «Logo-ul clubului jos, ca filigran» (§965)", () => {
  /** The writing area and the watermark of the sheet's first badge, in the page's points. */
  const areaOf = (design: BadgeDesign) => {
    const layout = layoutOf(design, "Fotograf");
    const slot = firstSlot(design);
    return { layout, top: slot.y + layout.writing.top, height: layout.writing.height };
  };

  it.each([
    ["the default strip, a fifth of its width", { footerLogoSizePct: 20 }],
    ["100 × 40 mm, a sixth of its width", { size: "strip100" as const, footerLogoSizePct: 16 }],
    ["a tall badge, a seventh of its width", { size: "custom" as const, customWidthMm: 90, customHeightMm: 60, footerLogoSizePct: 15 }],
  ])("stands above the watermark where «Nume:» goes, centred in that room at up to three quarters of it — %s", async (_name, sized) => {
    for (const level of ["faint", "medium", "strong"] as const) {
      const design: BadgeDesign = { ...PLAIN, ...sized, footerLogo: level };
      const area = areaOf(design);
      const { calls } = await sheetCalls(design, [named("Fotograf", "Amalia")]);
      const mark = watermarkTop(calls);
      // The case: the logo leaves a third of the writing area or more above it.
      const above = mark - area.top;
      expect(above / area.height).toBeGreaterThanOrEqual(1 / 3);
      const name = nameCall(calls, "Amalia");
      // The name's box ends above the watermark's top, and starts inside the writing area.
      expect(name.top).toBeGreaterThanOrEqual(area.top - 1e-9);
      expect(name.top + name.size).toBeLessThanOrEqual(mark + 1e-9);
      expect(name.size).toBeLessThanOrEqual(above * 0.75 + 1e-9);
      // A short name takes the whole three quarters, and the room left is shared above and below it.
      expect(name.size).toBeCloseTo(above * 0.75, 9);
      expect(name.top - area.top).toBeCloseTo(mark - (name.top + name.size), 9);
    }
  });

  it.each([
    ["at the default size, whose lockup leaves 27 % of the area above it", {}],
    ["at a size the club typed that fills the area", { footerLogoSizePct: 100 }],
    ["with the logo moved to the area's top", { footerLogoOffsetYMm: -100 }],
  ])("keeps the writing area's middle, at up to half its height, when the logo leaves less than a third above it — %s", async (_name, placed) => {
    const design: BadgeDesign = { ...PLAIN, ...placed, footerLogo: "medium" };
    const area = areaOf(design);
    const { calls } = await sheetCalls(design, [named("Fotograf", "Amalia")]);
    expect((watermarkTop(calls) - area.top) / area.height).toBeLessThan(1 / 3);
    const name = nameCall(calls, "Amalia");
    expect(name.size).toBeCloseTo(area.height / 2, 9);
    expect(name.top + name.size / 2).toBeCloseTo(area.top + area.height / 2, 9);
  });

  it("is centred in the writing area at up to half its height while the logo is off", async () => {
    const area = areaOf(PLAIN);
    const { calls } = await sheetCalls(PLAIN, [named("Fotograf", "Amalia")]);
    expect(calls.some((call) => call.name === "opacity")).toBe(false);
    const name = nameCall(calls, "Amalia");
    expect(name.size).toBeCloseTo(area.height / 2, 9);
    expect(name.top + name.size / 2).toBeCloseTo(area.top + area.height / 2, 9);
  });

  it("draws the watermark under the name: the logo first, the name after it", async () => {
    const design: BadgeDesign = { ...PLAIN, footerLogo: "strong", footerLogoSizePct: 20 };
    const { calls } = await sheetCalls(design, [named("Fotograf", "Amalia")]);
    expect(calls.findIndex((call) => call.name === "opacity")).toBeLessThan(nameCall(calls, "Amalia").at);
  });
});
