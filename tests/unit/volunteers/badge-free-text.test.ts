import { describe, expect, it } from "vitest";
import { bibFooterWidth } from "@/modules/registrations/bib-footer";
import { bibTitleWidth } from "@/modules/registrations/bib-header";
import {
  BADGE_FREE_TEXT_MAX,
  BADGE_MARKER_LABEL_MAX,
  type BadgeDesign,
  badgeDesignDropped,
  badgeDesignFromQuery,
  badgeWords,
  DEFAULT_BADGE_DESIGN,
  readBadgeDesign,
} from "@/modules/volunteers/badges/badge-design";
import {
  BADGE_BANDS_MIN_SHARE,
  BADGE_CUSTOM_BOUNDS,
  BADGE_INSET,
  BADGE_LAYOUT,
  BADGE_MARKER_GAP,
  BADGE_MARKER_MIN_WIDTH,
  BADGE_NAME_MIN_WIDTH,
  BADGE_WRITING_MIN,
  type BadgeLayoutWords,
  type BadgeSizeChoice,
  badgeLayout,
  badgeLineHeight,
  badgePaper,
  badgeRows,
  badgeSizeRefusal,
} from "@/modules/volunteers/badges/badge-geometry";
import { badgeDesignQuery, readBadgeDesignForm } from "@/modules/volunteers/badges/badge-query";

/**
 * §NNN — the volunteer badge's free-text line and marker area (BR-REQ-050-02), amending §764: both drawn
 * through the one geometry on every size, a size too small for everything ticked refused in words, and
 * the design's two new optional keys read forgivingly (an old design draws as before). Pure.
 */

const MEASURE = { bold: bibTitleWidth, regular: bibFooterWidth };
const STRIP90: BadgeSizeChoice = { size: "strip90", customWidthMm: 0, customHeightMm: 0 };
const STRIP100: BadgeSizeChoice = { size: "strip100", customWidthMm: 0, customHeightMm: 0 };
const custom = (width: number, height: number): BadgeSizeChoice => ({ size: "custom", customWidthMm: width, customHeightMm: height });
const FREE = "Hidratează-te la fiecare punct";
const WORDS: BadgeLayoutWords = { title: "Brașov Trail Race", label: "VOLUNTAR", role: "PUNCT DE APĂ", name: "Nume:", phone: null, free: null, markerLabel: null };
const layoutOf = (size: BadgeSizeChoice, words: Partial<BadgeLayoutWords> = {}, showMarker = false, writingLine = true) =>
  badgeLayout({ ...size, headerPicture: false, showLogo: true, writingLine, showMarker }, { ...WORDS, ...words }, MEASURE);

describe("§NNN both areas fit on the two strips", () => {
  const everything = { free: FREE, markerLabel: "Tură:", phone: "Coordonator: 0712 345 678" };

  it.each([
    ["90 × 35", STRIP90],
    ["100 × 40", STRIP100],
  ])("%s mm: the free-text line, the marker area and the telephone all fit, inside their rows", (_name, size) => {
    const layout = layoutOf(size, everything, true);
    const { content, pad } = layout;
    // The free line sits in its own row, between the role's band and the writing area, nothing overlapping.
    expect(layout.free).not.toBeNull();
    expect(layout.free!.top).toBeCloseTo(layout.role.top + layout.role.height, 6);
    expect(layout.writing.top).toBeCloseTo(layout.free!.top + layout.free!.height, 6);
    expect(layout.freeLine!.top).toBeGreaterThanOrEqual(layout.free!.top - 1e-9);
    expect(layout.freeLine!.top + badgeLineHeight(layout.freeLine!.size)).toBeLessThanOrEqual(layout.free!.top + layout.free!.height + 1e-9);
    expect(MEASURE.regular(layout.freeLine!.text) * layout.freeLine!.size).toBeLessThanOrEqual(content.width - 2 * pad + 1e-9);
    expect(layout.freeLine!.cut).toBe(false);
    // The writing area keeps its least height; every row adds up to the content.
    expect(layout.writing.height).toBeGreaterThanOrEqual(BADGE_WRITING_MIN - 1e-9);
    const total = layout.header.height + layout.role.height + layout.free!.height + layout.writing.height + layout.phone!.height;
    expect(total).toBeCloseTo(content.height, 6);
    // The marker's area is beside the name's: to its right, inside the content, both wide enough.
    const marker = layout.marker!;
    const nameRight = layout.line!.right;
    expect(layout.line!.left).toBeCloseTo(content.left + pad, 6);
    expect(marker.left).toBeCloseTo(nameRight + BADGE_MARKER_GAP, 6);
    expect(marker.left + marker.width).toBeCloseTo(content.left + content.width - pad, 6);
    expect(marker.width).toBeGreaterThanOrEqual(BADGE_MARKER_MIN_WIDTH - 1e-9);
    expect(nameRight - layout.line!.left).toBeGreaterThanOrEqual(BADGE_NAME_MIN_WIDTH - 1e-9);
    // The divider is between the two areas, inside the writing area's height.
    expect(marker.divider.x).toBeGreaterThan(nameRight);
    expect(marker.divider.x).toBeLessThan(marker.left);
    expect(marker.divider.top).toBeGreaterThanOrEqual(layout.writing.top);
    expect(marker.divider.bottom).toBeLessThanOrEqual(layout.writing.top + layout.writing.height);
    // The label at its top left, at «Nume:»'s own height; the line at the name's line, a hand's room under the label.
    expect(marker.label!.left).toBeCloseTo(marker.left, 6);
    expect(marker.label!.top).toBeCloseTo(layout.name.top, 6);
    expect(marker.line.y).toBeCloseTo(layout.line!.y, 6);
    expect(marker.line.y).toBeGreaterThan(marker.label!.top + badgeLineHeight(marker.label!.size));
    expect(marker.line.y).toBeLessThan(layout.writing.top + layout.writing.height);
    expect(marker.line.left).toBeCloseTo(marker.left, 6);
    expect(marker.line.right).toBeCloseTo(marker.left + marker.width, 6);
    // «Nume:» fits its narrower area.
    expect(MEASURE.regular(layout.name.text) * layout.name.size).toBeLessThanOrEqual(nameRight - layout.line!.left + 1e-9);
  });

  it("leaves the bands whole on the strips where only one of the two rows is ticked", () => {
    for (const size of [STRIP90, STRIP100]) {
      const content = badgePaper(size).height - 2 * BADGE_INSET;
      for (const words of [{ free: FREE }, { phone: "Coordonator: 0712 345 678" }]) {
        const layout = layoutOf(size, words);
        expect(layout.header.height).toBeCloseTo(content * BADGE_LAYOUT.headerShare, 6);
        expect(layout.role.height).toBeCloseTo(content * BADGE_LAYOUT.roleShare, 6);
      }
    }
  });

  it("gives the bands up in proportion, never the writing area, when both rows are ticked", () => {
    const rows = badgeRows(badgePaper(STRIP90), true, true);
    expect(rows.writing.height).toBeCloseTo(BADGE_WRITING_MIN, 6);
    expect(rows.squeeze).toBeLessThan(1);
    expect(rows.squeeze).toBeGreaterThanOrEqual(BADGE_BANDS_MIN_SHARE);
    expect(rows.header.height / rows.role.height).toBeCloseTo(BADGE_LAYOUT.headerShare / BADGE_LAYOUT.roleShare, 6);
  });

  it("prints a marker area without a label as a line alone", () => {
    const layout = layoutOf(STRIP90, { markerLabel: null }, true);
    expect(layout.marker).not.toBeNull();
    expect(layout.marker!.label).toBeNull();
    expect(layout.marker!.line.y).toBeCloseTo(layout.line!.y, 6);
  });

  it("keeps the marker's line when the name's own line is off", () => {
    const layout = layoutOf(STRIP90, { markerLabel: "Zona:" }, true, false);
    expect(layout.line).toBeNull();
    expect(layout.marker!.line.right).toBeGreaterThan(layout.marker!.line.left);
  });
});

describe("§NNN at the bounds of the custom size", () => {
  const widths = [BADGE_CUSTOM_BOUNDS.width.min, 90, 133, BADGE_CUSTOM_BOUNDS.width.max];
  const heights = [BADGE_CUSTOM_BOUNDS.height.min, 35, 61, BADGE_CUSTOM_BOUNDS.height.max];
  const cases = widths.flatMap((width) => heights.map((height) => [`${width} × ${height}`, custom(width, height)] as const));

  it.each(cases)("%s mm: the marker's and the name's areas keep their least widths, and every row stays inside the badge", (_name, size) => {
    const layout = layoutOf(size, { free: FREE, markerLabel: "Tură:", phone: "Coordonator: 0712 345 678" }, true);
    const paper = badgePaper(size);
    expect(layout.marker!.width).toBeGreaterThanOrEqual(BADGE_MARKER_MIN_WIDTH - 1e-9);
    expect(layout.line!.right - layout.line!.left).toBeGreaterThanOrEqual(BADGE_NAME_MIN_WIDTH - 1e-9);
    expect(layout.marker!.left + layout.marker!.width).toBeLessThanOrEqual(paper.width - BADGE_INSET + 1e-9);
    expect(layout.writing.height).toBeGreaterThanOrEqual(BADGE_WRITING_MIN - 1e-9);
    const rows = badgeRows(paper, true, true);
    const total = rows.header.height + rows.role.height + (rows.free?.height ?? 0) + rows.writing.height + (rows.phone?.height ?? 0);
    expect(total).toBeCloseTo(paper.height - 2 * BADGE_INSET, 6);
    expect(rows.header.height).toBeGreaterThan(0);
    expect(rows.role.height).toBeGreaterThan(0);
    // The free line's text fits its row's width or is cut to it, at no less than its least size.
    expect(MEASURE.regular(layout.freeLine!.text) * layout.freeLine!.size).toBeLessThanOrEqual(layout.content.width - 2 * layout.pad + 1e-9);
    expect(layout.freeLine!.size).toBeGreaterThanOrEqual(BADGE_LAYOUT.freeMinSize);
  });

  it("keeps the marker's and the name's least widths at the narrowest width, at every height the bounds allow", () => {
    // The bounds' own promise (`BADGE_MARKER_MIN_WIDTH`): if a bound is ever lowered, this is what says the areas no longer fit.
    // The tallest badge has the widest pad (it is a share of the header), so it is the narrowest area.
    for (let height = BADGE_CUSTOM_BOUNDS.height.min; height <= BADGE_CUSTOM_BOUNDS.height.max; height += 1) {
      const layout = layoutOf(custom(BADGE_CUSTOM_BOUNDS.width.min, height), { markerLabel: "Tură:", phone: "Coordonator: 0712 345 678" }, true);
      expect(layout.marker!.width, `60 × ${height}`).toBeGreaterThanOrEqual(BADGE_MARKER_MIN_WIDTH - 1e-9);
      expect(layout.line!.right - layout.line!.left, `60 × ${height}`).toBeGreaterThanOrEqual(BADGE_NAME_MIN_WIDTH - 1e-9);
    }
  });
});

describe("§NNN a size too small for everything ticked", () => {
  it("is refused, naming what does not fit and the height that would, at the smallest custom size", () => {
    const refusal = badgeSizeRefusal(custom(60, 30), { freeText: true, phone: true });
    expect(refusal).not.toBeNull();
    expect(refusal!.what).toEqual(["freeText", "phone"]);
    // The least height named is the first at which the bands keep their share — and one millimetre less does not.
    const at = (height: number) => badgeRows(badgePaper(custom(60, height)), true, true).squeeze;
    expect(at(refusal!.minHeightMm)).toBeGreaterThanOrEqual(BADGE_BANDS_MIN_SHARE - 1e-9);
    expect(at(refusal!.minHeightMm - 1)).toBeLessThan(BADGE_BANDS_MIN_SHARE);
    expect(refusal!.minHeightMm).toBeGreaterThan(30);
    expect(refusal!.minHeightMm).toBeLessThanOrEqual(BADGE_CUSTOM_BOUNDS.height.max);
  });

  it("names only what is ticked", () => {
    // Only two rows take height, and one alone never fits too badly at any size the bounds allow.
    for (const ticked of [{ freeText: true, phone: false }, { freeText: false, phone: true }, { freeText: false, phone: false }]) {
      expect(badgeSizeRefusal(custom(BADGE_CUSTOM_BOUNDS.width.min, BADGE_CUSTOM_BOUNDS.height.min), ticked)).toBeNull();
    }
  });

  it("refuses nothing the two presets or an old design draw today", () => {
    for (const size of [STRIP90, STRIP100]) expect(badgeSizeRefusal(size, { freeText: true, phone: true })).toBeNull();
    for (const height of [30, 31, 35, 40, 60, 100]) expect(badgeSizeRefusal(custom(60, height), { freeText: false, phone: true })).toBeNull();
  });

  it("needs 34 mm with both rows, whatever the width: the height is what they take", () => {
    for (const width of [BADGE_CUSTOM_BOUNDS.width.min, 100, BADGE_CUSTOM_BOUNDS.width.max]) {
      for (let height = BADGE_CUSTOM_BOUNDS.height.min; height <= BADGE_CUSTOM_BOUNDS.height.max; height += 1) {
        const refusal = badgeSizeRefusal(custom(width, height), { freeText: true, phone: true });
        if (height >= 34) expect(refusal, `${width} × ${height}`).toBeNull();
        else expect(refusal?.minHeightMm, `${width} × ${height}`).toBe(34);
      }
    }
  });
});

describe("§NNN the longest marker label in the narrowest marker area", () => {
  it("is fitted inside the area — shrunk to its least size, then cut — on the narrowest custom size and on a strip", () => {
    // Twenty wide capitals and the colon the badge prints after the label: the widest the box allows.
    const text = `${"W".repeat(BADGE_MARKER_LABEL_MAX)}:`;
    for (const size of [custom(BADGE_CUSTOM_BOUNDS.width.min, BADGE_CUSTOM_BOUNDS.height.min), STRIP90]) {
      const layout = layoutOf(size, { markerLabel: text }, true);
      const label = layout.marker!.label!;
      expect(MEASURE.regular(label.text) * label.size, JSON.stringify(size)).toBeLessThanOrEqual(layout.marker!.width + 1e-9);
      expect(label.size, JSON.stringify(size)).toBeGreaterThanOrEqual(Math.min(layout.name.size, BADGE_LAYOUT.phoneMinSize) - 1e-9);
    }
  });
});

describe("§NNN the free line: shrunk, then cut", () => {
  it("keeps its size on a short line and shrinks a longer one before cutting it", () => {
    // On the narrowest strip that takes the line with the telephone (a 60-character line never overflows 90 mm but in wide letters).
    const small = custom(60, 34);
    const short = layoutOf(small, { free: "Apă la km 5" });
    expect(short.freeLine!.cut).toBe(false);
    expect(short.freeLine!.size).toBeCloseTo(short.free!.height * BADGE_LAYOUT.freeSizeShare, 6);
    // A line a little too wide for the largest size and narrow enough for the least: wide letters added until it is.
    const room = short.content.width - 2 * short.pad;
    let middle = "M";
    while (MEASURE.regular(middle) * short.freeLine!.size <= room) middle += "M";
    expect(MEASURE.regular(middle) * BADGE_LAYOUT.freeMinSize).toBeLessThanOrEqual(room);
    expect(middle.length).toBeLessThanOrEqual(BADGE_FREE_TEXT_MAX);
    const longer = layoutOf(small, { free: middle });
    expect(longer.freeLine!.cut).toBe(false);
    expect(longer.freeLine!.size).toBeLessThan(short.freeLine!.size);
  });

  it("is cut with «…» only past its least size, and is never wider than the row", () => {
    const text = "W".repeat(BADGE_FREE_TEXT_MAX);
    const layout = layoutOf(STRIP90, { free: text });
    expect(layout.freeLine!.cut).toBe(true);
    expect(layout.freeLine!.size).toBe(BADGE_LAYOUT.freeMinSize);
    expect(layout.freeLine!.text.endsWith("…")).toBe(true);
    expect(MEASURE.regular(layout.freeLine!.text) * layout.freeLine!.size).toBeLessThanOrEqual(layout.content.width - 2 * layout.pad + 1e-9);
  });
});

describe("§NNN a badge with neither is the badge of before", () => {
  it("adds no row, no line and no marker, and draws the name's line across the whole width as it always did", () => {
    for (const size of [STRIP90, STRIP100, custom(60, 30), custom(200, 100)]) {
      const plain = layoutOf(size);
      expect(plain.free).toBeNull();
      expect(plain.freeLine).toBeNull();
      expect(plain.marker).toBeNull();
      expect(plain.line!.right).toBeCloseTo(plain.content.left + plain.content.width - plain.pad, 6);
      const rows = badgeRows(badgePaper(size), false);
      expect(plain.writing.top).toBeCloseTo(rows.writing.top, 6);
      expect(plain.writing.height).toBeCloseTo(rows.writing.height, 6);
      expect(rows.free).toBeNull();
      expect(rows.squeeze).toBeLessThanOrEqual(1);
    }
  });
});

describe("§NNN the design's two new optional keys", () => {
  it("reads an old design, without them, as before: both off, nothing written, nothing said", () => {
    const old = { size: "strip100", showTitle: false, phone: "0712 345 678", showPhone: true };
    const read = readBadgeDesign(old);
    expect(read).toMatchObject({ size: "strip100", showFreeText: false, freeTextRo: "", freeTextEn: "", showMarker: false, markerLabelRo: "", markerLabelEn: "" });
    expect(badgeDesignDropped(old)).toEqual([]);
    expect(readBadgeDesign(null)).toEqual(DEFAULT_BADGE_DESIGN);
    expect(badgeDesignDropped(null)).toEqual([]);
    expect(badgeDesignDropped([1, 2])).toEqual([]);
  });

  it("drops a value it cannot read — a text that is a number, a tick that is a word — with its word, keeping the rest", () => {
    const stored = { showFreeText: "yes", freeTextRo: 42, freeTextEn: "Water", showMarker: { on: true }, markerLabelRo: ["Tură"], markerLabelEn: null, size: "strip100" };
    const read = readBadgeDesign(stored);
    expect(read.showFreeText).toBe(false);
    expect(read.freeTextRo).toBe("");
    expect(read.freeTextEn).toBe("Water");
    expect(read.showMarker).toBe(false);
    expect(read.markerLabelRo).toBe("");
    expect(read.size).toBe("strip100");
    // Named, so the designer can say it; a null is nothing stored, not an unreadable value.
    expect(badgeDesignDropped(stored).sort()).toEqual(["freeTextRo", "markerLabelRo", "showFreeText", "showMarker"]);
  });

  it("keeps a written design as written, cut at its limits like the other lines", () => {
    const read = readBadgeDesign({
      showFreeText: true,
      freeTextRo: `  ${"a".repeat(BADGE_FREE_TEXT_MAX + 20)}  `,
      freeTextEn: "Water\nat the next point",
      showMarker: true,
      markerLabelRo: "T".repeat(BADGE_MARKER_LABEL_MAX + 10),
      markerLabelEn: "Shift",
    });
    expect(read.showFreeText).toBe(true);
    expect(read.freeTextRo.length).toBeLessThanOrEqual(BADGE_FREE_TEXT_MAX);
    expect(read.freeTextEn).toBe("Water at the next point");
    expect(read.markerLabelRo.length).toBeLessThanOrEqual(BADGE_MARKER_LABEL_MAX);
    expect(read.markerLabelEn).toBe("Shift");
  });

  it("goes from the form to the preview's address and back, the ticks and the pairs together", () => {
    const posted: Record<string, string> = {
      "badge.design.size": "strip90",
      "badge.design.showFreeText": "on",
      "badge.design.freeTextRo": "Bea apă",
      "badge.design.freeTextEn": "Drink water",
      "badge.design.showMarker": "on",
      "badge.design.markerLabelRo": "Tură",
      "badge.design.markerLabelEn": "Shift",
    };
    const values = readBadgeDesignForm((name) => posted[name] ?? null);
    expect(values).toMatchObject({ showFreeText: true, showMarker: true, freeTextRo: "Bea apă", markerLabelEn: "Shift" });
    expect(badgeDesignFromQuery(badgeDesignQuery(values))).toMatchObject({
      showFreeText: true,
      freeTextRo: "Bea apă",
      freeTextEn: "Drink water",
      showMarker: true,
      markerLabelRo: "Tură",
      markerLabelEn: "Shift",
    });
    // A tick that is off posts nothing and reads false.
    const off = readBadgeDesignForm(() => null);
    expect(off).toMatchObject({ showFreeText: false, showMarker: false });
  });
});

describe("§NNN the words a badge prints", () => {
  const defaults = { label: "VOLUNTAR", name: "Nume:", phoneLabel: "Coordonator" };
  const design: BadgeDesign = {
    ...DEFAULT_BADGE_DESIGN,
    showFreeText: true,
    freeTextRo: "Bea apă la fiecare punct",
    freeTextEn: "Drink water at every point",
    showMarker: true,
    markerLabelRo: "Tură",
    markerLabelEn: "Shift:",
  };

  it("speaks the badge's language, the label with its colon", () => {
    expect(badgeWords(design, "ro", "Crosul", defaults)).toMatchObject({ free: "Bea apă la fiecare punct", markerLabel: "Tură:" });
    expect(badgeWords(design, "en", "Crosul", defaults)).toMatchObject({ free: "Drink water at every point", markerLabel: "Shift:" });
  });

  it("says nothing while the tick is off, or when the language has nothing written", () => {
    expect(badgeWords({ ...design, showFreeText: false, showMarker: false }, "ro", "Crosul", defaults)).toMatchObject({ free: null, markerLabel: null });
    expect(badgeWords({ ...design, freeTextEn: "", markerLabelEn: "" }, "en", "Crosul", defaults)).toMatchObject({ free: null, markerLabel: null });
  });
});
