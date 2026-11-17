import PDFDocument from "pdfkit";
import { isValidElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { catalogueOf } from "@/i18n/catalogue";
import { diffConfigs, FIELD_LABELS } from "@/modules/content/events/transfer/diff";
import { type EventConfig, eventConfigSchema } from "@/modules/content/events/transfer/file-format";
import { bibFooterWidth } from "@/modules/registrations/bib-footer";
import { bibTitleWidth } from "@/modules/registrations/bib-header";
import {
  BADGE_DRAWING_VERSION,
  type BadgeDesign,
  type BadgeFaceRole,
  badgeDesignDropped,
  badgeDesignFromQuery,
  badgeLayoutWords,
  badgePhoneRow,
  badgePictureStamp,
  badgeWords,
  DEFAULT_BADGE_DESIGN,
  readBadgeDesign,
} from "@/modules/volunteers/badges/badge-design";
import {
  BADGE_BANDS_MIN_SHARE,
  BADGE_CATEGORY_SEPARATOR,
  BADGE_CUSTOM_BOUNDS,
  BADGE_INSET,
  BADGE_LAYOUT,
  BADGE_MARKER_MIN_WIDTH,
  BADGE_NAME_MIN_WIDTH,
  BADGE_NAME_SPACE,
  BADGE_WRITING_MIN,
  type BadgeLayout,
  type BadgeRow,
  type BadgeSizeChoice,
  type BadgeTextLine,
  badgeBandsScale,
  badgeFooterLogoOf,
  badgeImageSize,
  badgeLayout,
  badgeLineHeight,
  badgePaper,
  badgeRows,
  badgeSizeRefusal,
  DEFAULT_BADGE_NAME_SPACE,
  isBadgeNameSpace,
} from "@/modules/volunteers/badges/badge-geometry";
import { badgeImageLayout, badgeMarkup, renderBadgeImage } from "@/modules/volunteers/badges/badge-image";
import { badgeDesignQuery, badgePreviewUrl, isBadgeDesignInput, readBadgeDesignForm } from "@/modules/volunteers/badges/badge-query";
import { BadgeSizeRefusal, parseBadgeDesignPost } from "@/modules/volunteers/badges/badges";
import { renderBadgeSheet } from "@/modules/volunteers/badges/badges-pdf";
import { DomainError } from "@/shared/errors/domain-error";

/**
 * §972 — «Spațiul pentru nume (% din înălțime)» (BR-REQ-050-02; the owner, 2026-11-17, at 90 × 100 mm, then trying 90 × 130: «vreau un
 * spațiu mai mare pt nume aici»). The design's one new key, a whole number from 43 to 80, 43 by default — the badge as it always was: the
 * share of the content's height the writing area takes before the free-text line and the telephone take theirs, the header and the role's
 * band sharing what it leaves in their own 27 : 30. Its reading, the form, the preview's address, the save, the event file; the rows at
 * every size the bounds allow at 43, 60 and 80 %; the bands' words shrinking with their bands, inside them, never cut where the default
 * does not cut; the sheet and the picture drawing the same badge. That 43 draws every badge as before, byte for byte, is
 * `badge-type-unchanged.test.ts`.
 */

const MEASURE = { bold: bibTitleWidth, regular: bibFooterWidth };
const RO = { label: "VOLUNTAR", name: "Nume:", phoneLabel: "Coordonator" };
const EN = { label: "VOLUNTEER", name: "Name:", phoneLabel: "Coordinator" };
const AT = new Date("2026-11-17T08:00:00.000Z");
const STRIP90: BadgeSizeChoice = { size: "strip90", customWidthMm: 90, customHeightMm: 35 };
const STRIP100: BadgeSizeChoice = { size: "strip100", customWidthMm: 90, customHeightMm: 35 };
const custom = (width: number, height: number): BadgeSizeChoice => ({ size: "custom", customWidthMm: width, customHeightMm: height });

/** Every size «Altă dimensiune» allows in 10 mm steps — the tallest, 287 mm, among them — and the two strips. */
const SIZES: BadgeSizeChoice[] = [STRIP90, STRIP100];
for (let width = BADGE_CUSTOM_BOUNDS.width.min; width <= BADGE_CUSTOM_BOUNDS.width.max; width += 10) {
  for (const height of [...Array.from({ length: 26 }, (_, index) => BADGE_CUSTOM_BOUNDS.height.min + 10 * index), BADGE_CUSTOM_BOUNDS.height.max]) {
    SIZES.push(custom(width, height));
  }
}
const SHARES = [43, 60, 80] as const;
const TICKS = [
  { phone: false, free: false },
  { phone: true, free: false },
  { phone: false, free: true },
  { phone: true, free: true },
] as const;
type Tick = (typeof TICKS)[number];

const LONGEST_CATEGORY = "Activități de start și sosire, punctele de hidratare și de control de pe traseul";
const LONG_TITLE = "Maratonul Internațional al Munților Bucegi — ediția a XX-a";
/** The roles a badge is drawn for: a role, a long one (cut), one under a short category and one under the longest, and «fără rol». */
const FACES: Array<[string, BadgeFaceRole | null]> = [
  ["a role", { name: "Punct de apă", colour: null }],
  ["a long role", { name: "Coordonatorul general al punctelor de control, apă și al tuturor voluntarilor", colour: null }],
  ["a category beside «VOLUNTAR»", { name: "Foto/Video", colour: "#c62828", category: "Pe Traseu" }],
  ["the longest category", { name: "Direcționare", colour: null, category: LONGEST_CATEGORY }],
  ["«fără rol»", null],
];

/** A design with every row a club may tick, the marker's space and the watermark, at a size and a space for the name. */
const designOf = (size: BadgeSizeChoice, tick: Tick, nameSpacePct: number, title = LONG_TITLE): BadgeDesign => ({
  ...DEFAULT_BADGE_DESIGN,
  ...size,
  mode: "perRole",
  titleRo: title,
  titleEn: title,
  showPhone: tick.phone,
  phone: tick.phone ? "0712 345 678" : "",
  showFreeText: tick.free,
  freeTextRo: tick.free ? "Hidratează-te la fiecare punct" : "",
  freeTextEn: tick.free ? "Drink at every point" : "",
  showMarker: true,
  markerLabelRo: "Tură",
  markerLabelEn: "Shift",
  footerLogo: "medium",
  nameSpacePct,
});

/** One badge's layout as both renderers lay it out: the design's choice, the words through `badgeLayoutWords`. */
function layoutOf(design: BadgeDesign, face: BadgeFaceRole | null, locale: "ro" | "en" = "ro"): BadgeLayout {
  const words = badgeWords(design, locale, "Brașov Trail Race", locale === "ro" ? RO : EN);
  return badgeLayout({ ...design, showPhone: badgePhoneRow(design), headerPicture: false }, badgeLayoutWords(design, words, locale, face), MEASURE);
}

const bottom = (row: { top: number; height: number }) => row.top + row.height;
const EPSILON = 1e-9;

/**
 * What every badge must be, at every space for the name — each broken rule in words, so a grid of thousands of badges asks one `expect`:
 * the rows edge to edge inside the border, the writing area's least height, the header's and the role band's words inside their bands —
 * one under another, never wider than their room — «Nume:», its line and the marker's space at their least widths, the watermark and the
 * two small rows' words inside their own rows.
 */
function problemsOf(layout: BadgeLayout, where: string): string[] {
  const problems: string[] = [];
  const check = (ok: boolean, what: string) => {
    if (!ok) problems.push(`${where}: ${what}`);
  };
  /** A line of text inside a row: its box between the row's top and foot, at a size above nothing. */
  const inside = (line: BadgeTextLine, row: BadgeRow, what: string) => {
    check(line.top >= row.top - EPSILON && line.top + badgeLineHeight(line.size) <= bottom(row) + EPSILON, `${what} out of its row`);
    check(line.size > 0, `${what} at no size`);
  };
  const { content, pad } = layout;
  const rows = [layout.header, layout.role, layout.free, layout.writing, layout.phone].filter((row): row is BadgeRow => row !== null);
  check(Math.abs(rows[0].top - content.top) < 1e-9, "the header not at the content's top");
  for (let index = 1; index < rows.length; index++) check(Math.abs(rows[index].top - bottom(rows[index - 1])) < 1e-9, `row ${index} not under the one above`);
  check(Math.abs(bottom(rows[rows.length - 1]) - (content.top + content.height)) < 1e-9, "the last row not at the content's foot");
  check(rows.every((row) => row.height > 0), "a row of no height");
  check(layout.writing.height >= BADGE_WRITING_MIN - EPSILON, "the writing area under its least height");
  // The header: the logo inside its height; the title inside it and clear of the logo.
  if (layout.logo) check(layout.logo.top >= layout.header.top - EPSILON && bottom(layout.logo) <= bottom(layout.header) + EPSILON, "the logo out of the header");
  if (layout.title) {
    inside(layout.title, layout.header, "the title");
    const left = layout.logo ? layout.logo.left + layout.logo.width + pad : content.left + pad;
    // Never wider than its room — but beside a logo as wide as a narrow, tall badge's header makes it, the room may not hold even «…»:
    // the title is then «…» alone, as the default has always drawn it there (§764's rule, untouched).
    const fits = MEASURE.bold(layout.title.text) * layout.title.size <= layout.title.right - left + EPSILON;
    check(fits || (layout.title.text === "…" && layout.title.cut), "the title wider than its room");
  }
  // The role's band: «VOLUNTAR» (and the category beside it), the role's name, the category under it — stacked, inside the band.
  const band = [layout.label, layout.roleLine, layout.categoryLine].filter((line): line is BadgeTextLine => Boolean(line));
  for (const [index, line] of band.entries()) {
    inside(line, layout.role, `the band's line ${index}`);
    if (index > 0) check(line.top >= band[index - 1].top + badgeLineHeight(band[index - 1].size) - EPSILON, `the band's line ${index} over the one above`);
    check(MEASURE.bold(line.text) * line.size <= content.width - 2 * pad + EPSILON, `the band's line ${index} wider than the band`);
  }
  // The writing area: «Nume:», its line, the marker's space at their least widths, the watermark — all inside it.
  inside(layout.name, layout.writing, "«Nume:»");
  if (layout.line) {
    check(layout.line.y > layout.writing.top && layout.line.y < bottom(layout.writing), "the name's line out of the writing area");
    check(layout.line.right - layout.line.left >= BADGE_NAME_MIN_WIDTH - EPSILON, "the name's area under its least width");
  }
  if (layout.marker) {
    check(layout.marker.width >= BADGE_MARKER_MIN_WIDTH - EPSILON, "the marker's area under its least width");
    check(layout.marker.left + layout.marker.width <= content.left + content.width + EPSILON, "the marker's area out of the badge");
    check(layout.marker.divider.top >= layout.writing.top - EPSILON && layout.marker.divider.bottom <= bottom(layout.writing) + EPSILON, "the divider out of the writing area");
    if (layout.marker.label) inside(layout.marker.label, layout.writing, "the marker's label");
  }
  if (layout.footerLogo) check(layout.footerLogo.top >= layout.writing.top - EPSILON && bottom(layout.footerLogo) <= bottom(layout.writing) + EPSILON, "the watermark out of the writing area");
  if (layout.freeLine && layout.free) inside(layout.freeLine, layout.free, "the free line");
  if (layout.phoneLine && layout.phone) inside(layout.phoneLine, layout.phone, "the telephone");
  return problems;
}

/** The same, asked of one badge. */
const holds = (layout: BadgeLayout, where: string) => expect(problemsOf(layout, where)).toEqual([]);

afterEach(() => vi.restoreAllMocks());

describe("§972 the design's key «Spațiul pentru nume (% din înălțime)»", () => {
  it("is a whole number from 43 to 80, 43 by default — the writing area's share as it always was, the bands' 27 and 30 the rest", () => {
    expect(BADGE_NAME_SPACE).toEqual({ min: 43, max: 80 });
    expect(DEFAULT_BADGE_NAME_SPACE).toBe(43);
    expect(DEFAULT_BADGE_NAME_SPACE).toBe(Math.round(100 * (1 - BADGE_LAYOUT.headerShare - BADGE_LAYOUT.roleShare)));
    expect(DEFAULT_BADGE_DESIGN.nameSpacePct).toBe(43);
    expect(readBadgeDesign(null).nameSpacePct).toBe(43);
    // The reader's answer is the default design to the last key and in its order: an import compares the two as JSON (`import.ts`).
    expect(JSON.stringify(readBadgeDesign(null))).toBe(JSON.stringify(DEFAULT_BADGE_DESIGN));
    expect([43, 60, 80].every(isBadgeNameSpace)).toBe(true);
    expect([42, 81, 60.5, Number.NaN, "60", null].some(isBadgeNameSpace)).toBe(false);
  });

  it("reads a design saved before it as 43, never named as unreadable", () => {
    const before: Record<string, unknown> = { ...DEFAULT_BADGE_DESIGN, size: "custom", customWidthMm: 90, customHeightMm: 100 };
    delete before.nameSpacePct;
    expect(readBadgeDesign(before)).toEqual({ ...DEFAULT_BADGE_DESIGN, size: "custom", customWidthMm: 90, customHeightMm: 100 });
    expect(badgeDesignDropped(before)).toEqual([]);
    expect(readBadgeDesign({ size: "strip100", showPhone: true, phone: "0712 345 678" }).nameSpacePct).toBe(43);
  });

  it("keeps every whole number from 43 to 80, and reads anything else as 43 — said beside its section, never refused on read", () => {
    for (let pct = BADGE_NAME_SPACE.min; pct <= BADGE_NAME_SPACE.max; pct += 1) {
      expect(readBadgeDesign({ ...DEFAULT_BADGE_DESIGN, nameSpacePct: pct }).nameSpacePct).toBe(pct);
      expect(badgeDesignDropped({ nameSpacePct: pct })).toEqual([]);
    }
    for (const unreadable of [42, 81, 0, 100, -60, 60.5, "60", true, { pct: 60 }, [60], Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(readBadgeDesign({ ...DEFAULT_BADGE_DESIGN, nameSpacePct: unreadable }).nameSpacePct, String(unreadable)).toBe(43);
      expect(badgeDesignDropped({ nameSpacePct: unreadable }), String(unreadable)).toEqual(["nameSpacePct"]);
    }
    // Nothing stored is not an unreadable value.
    expect(badgeDesignDropped({ nameSpacePct: null })).toEqual([]);
  });

  it("travels in the event file under `badges.design`: a file made before it reads 43, and the diff names it in both languages", () => {
    const badgesOf = eventConfigSchema.shape.badges;
    expect(badgesOf.parse({ design: { size: "strip100" } }).design.nameSpacePct).toBe(43);
    expect(badgesOf.parse({ design: { size: "strip100", nameSpacePct: 70 } }).design.nameSpacePct).toBe(70);
    expect(badgesOf.parse({ design: { nameSpacePct: 90 } }).design.nameSpacePct).toBe(43);
    expect(FIELD_LABELS).toContain("badges.design.nameSpacePct");
    const config = (nameSpacePct: number) => ({ badges: { design: { ...DEFAULT_BADGE_DESIGN, nameSpacePct } } }) as unknown as EventConfig;
    expect(diffConfigs(config(60), config(43))).toEqual([
      { key: "badges.design.nameSpacePct", label: "badges.design.nameSpacePct", locale: null, from: { type: "text", value: "43" }, to: { type: "text", value: "60" } },
    ]);
    expect(diffConfigs(config(60), config(60))).toEqual([]);
    expect((catalogueOf("ro").Admin.eventJson.fields.badges.design as Record<string, string>).nameSpacePct).toBe("Ecuson: spațiul pentru nume (% din înălțime)");
    expect((catalogueOf("en").Admin.eventJson.fields.badges.design as Record<string, string>).nameSpacePct).toBe("Badge: the space for the name (% of the height)");
  });
});

describe("§972 the form, the preview's address and the save", () => {
  const BASE = { "badge.design.mode": "single", "badge.design.size": "strip90", "badge.design.writingLine": "on" };
  const posted = (fields: Record<string, string>) => readBadgeDesignForm((name) => fields[name] ?? null);

  it("reads the box as typed: a number, no number for an empty box, and nothing for a form from before it", () => {
    expect(isBadgeDesignInput("badge.design.nameSpacePct")).toBe(true);
    expect(posted({ ...BASE, "badge.design.nameSpacePct": "60" }).nameSpacePct).toBe(60);
    expect(posted({ ...BASE, "badge.design.nameSpacePct": " 80 " }).nameSpacePct).toBe(80);
    expect(posted({ ...BASE, "badge.design.nameSpacePct": "" }).nameSpacePct).toBeNaN();
    expect(posted(BASE).nameSpacePct).toBeNull();
  });

  it("goes from the form to the preview's address and back, so the preview follows the unsaved value", () => {
    for (const pct of [43, 55, 60, 80]) {
      const values = posted({ ...BASE, "badge.design.nameSpacePct": String(pct) });
      expect(badgeDesignQuery(values).get("nameSpacePct")).toBe(String(pct));
      expect(badgeDesignFromQuery(badgeDesignQuery(values)).nameSpacePct).toBe(pct);
      const url = new URL(badgePreviewUrl({ eventId: "e", locale: "ro", role: "none", design: values }), "http://preview.test");
      expect(badgeDesignFromQuery(url.searchParams).nameSpacePct).toBe(pct);
    }
    // The stored design's own address — the first picture the page draws — carries it too.
    expect(badgeDesignFromQuery(badgeDesignQuery({ ...DEFAULT_BADGE_DESIGN, nameSpacePct: 70 })).nameSpacePct).toBe(70);
    // An address without it, or with a value out of the bounds or no number (a box typed into, not yet saved), is the default.
    expect(badgeDesignFromQuery(new URLSearchParams("size=strip100")).nameSpacePct).toBe(43);
    expect(badgeDesignFromQuery(new URLSearchParams("nameSpacePct=95")).nameSpacePct).toBe(43);
    expect(badgeDesignQuery(posted({ ...BASE, "badge.design.nameSpacePct": "" })).has("nameSpacePct")).toBe(false);
    expect(badgeDesignQuery(posted(BASE)).has("nameSpacePct")).toBe(false);
  });

  it("saves every whole number from 43 to 80, and a form from before the box as 43", () => {
    for (const pct of [43, 44, 60, 79, 80]) expect(parseBadgeDesignPost(posted({ ...BASE, "badge.design.nameSpacePct": String(pct) })).nameSpacePct).toBe(pct);
    expect(parseBadgeDesignPost(posted(BASE)).nameSpacePct).toBe(43);
  });

  it.each(["42", "81", "0", "100", "60.5", "", "șaizeci"])("refuses %j, naming its box — never kept as 43 behind the person's back", (typed) => {
    let refusal: unknown;
    try {
      parseBadgeDesignPost(posted({ ...BASE, "badge.design.nameSpacePct": typed }));
    } catch (error) {
      refusal = error;
    }
    expect(refusal).toBeInstanceOf(DomainError);
    expect(refusal).toMatchObject({ code: "VALIDATION_ERROR", fields: ["badge.design.nameSpacePct"] });
  });

  it("still says the least height when the free-text line and the telephone do not fit, read at the share the design chose", () => {
    const smallest = { ...BASE, "badge.design.size": "custom", "badge.design.customWidthMm": "60", "badge.design.customHeightMm": "30" };
    const extras = { "badge.design.showPhone": "on", "badge.design.phone": "0712 345 678", "badge.design.showFreeText": "on", "badge.design.freeTextRo": "Bea apă", "badge.design.freeTextEn": "Drink water" };
    const refusalAt = (pct: string) => {
      try {
        parseBadgeDesignPost(posted({ ...smallest, ...extras, "badge.design.nameSpacePct": pct }));
      } catch (error) {
        return error;
      }
      return null;
    };
    // 34 mm at the default (§776); 32 mm at 45 %, where the bands have less to give; at 60 % they give nothing and 30 mm is kept.
    expect(refusalAt("43")).toBeInstanceOf(BadgeSizeRefusal);
    expect(refusalAt("43")).toMatchObject({ code: "BADGE_SIZE_TOO_SMALL", what: ["freeText", "phone"], heightMm: 30, minHeightMm: 34, fields: ["badge.design.customHeightMm"] });
    expect(refusalAt("45")).toMatchObject({ code: "BADGE_SIZE_TOO_SMALL", minHeightMm: 32 });
    expect(refusalAt("60")).toBeNull();
  });
});

describe("§972 the rows at a space for the name", () => {
  it("are today's rows at 43, to the last bit — with the key and without it — and only a space for the name is shared anew", () => {
    for (const size of SIZES) {
      const paper = badgePaper(size);
      for (const tick of TICKS) expect(badgeRows(paper, tick.phone, tick.free, 43)).toEqual(badgeRows(paper, tick.phone, tick.free));
    }
    expect(badgeBandsScale(43)).toBeNull();
    expect(badgeBandsScale(undefined)).toBeNull();
    // A value no design can hold is the default too, never a band of no height or of more than the badge.
    for (const outside of [42, 81, 0, 100, 60.5, Number.NaN]) expect(badgeBandsScale(outside), String(outside)).toBeNull();
    expect(badgeBandsScale(60)).toBeCloseTo(0.4 / 0.57, 12);
    expect(badgeBandsScale(80)).toBeCloseTo(0.2 / 0.57, 12);
  });

  it("give the two bands (100 − share) % of the content in their 27 : 30, the name's space the share, the two small rows their own", () => {
    for (const size of SIZES) {
      const paper = badgePaper(size);
      const content = paper.height - 2 * BADGE_INSET;
      for (const share of [60, 80]) {
        const where = `${size.size} ${size.customWidthMm}×${size.customHeightMm} at ${share} %`;
        const rows = badgeRows(paper, false, false, share);
        // There is room at every size: nothing is squeezed past 43 % but a few millimetres above it (the test below).
        expect(rows.squeeze, where).toBe(1);
        expect(rows.header.height + rows.role.height, where).toBeCloseTo((content * (100 - share)) / 100, 9);
        expect(rows.writing.height, where).toBeCloseTo((content * share) / 100, 9);
        expect(rows.header.height / rows.role.height, where).toBeCloseTo(BADGE_LAYOUT.headerShare / BADGE_LAYOUT.roleShare, 9);
        // The telephone's and the free-text rows are what they are at 43: the writing area gives them their share.
        const both = badgeRows(paper, true, true, share);
        const today = badgeRows(paper, true, true);
        expect(both.phone!.height, where).toBe(today.phone!.height);
        expect(both.free!.height, where).toBe(today.free!.height);
        expect(both.writing.height, where).toBeCloseTo((content * share) / 100 - both.phone!.height - both.free!.height, 9);
      }
    }
  });

  it.each(SHARES)("keep the writing area's least height and lie edge to edge at every size and tick, at %i %", (share) => {
    for (const size of SIZES) {
      const paper = badgePaper(size);
      for (const tick of TICKS) {
        const where = `${size.customWidthMm}×${size.customHeightMm} ${JSON.stringify(tick)} at ${share} %`;
        const rows = badgeRows(paper, tick.phone, tick.free, share);
        expect(rows.writing.height, where).toBeGreaterThanOrEqual(BADGE_WRITING_MIN - EPSILON);
        const list = [rows.header, rows.role, rows.free, rows.writing, rows.phone].filter((row): row is BadgeRow => row !== null);
        expect(list[0].top).toBeCloseTo(BADGE_INSET, 9);
        for (let index = 1; index < list.length; index++) expect(list[index].top, where).toBeCloseTo(bottom(list[index - 1]), 9);
        expect(bottom(list[list.length - 1]), where).toBeCloseTo(paper.height - BADGE_INSET, 9);
        expect(rows.header.height, where).toBeGreaterThan(0);
        expect(rows.role.height, where).toBeGreaterThan(0);
        // More space for the name never gives the bands more, nor the writing area less.
        const today = badgeRows(paper, tick.phone, tick.free);
        expect(rows.writing.height, where).toBeGreaterThanOrEqual(today.writing.height - EPSILON);
        expect(rows.header.height, where).toBeLessThanOrEqual(today.header.height + EPSILON);
      }
    }
  });

  it("squeeze the bands from their new, lower height where a small badge still needs it, and the save's refusal reads that height", () => {
    const both = { freeText: true, phone: true };
    // At 45 % a 60 × 30 mm badge with both rows still leaves the writing area less than its least height: the bands give up part of theirs.
    const paper = badgePaper(custom(60, 30));
    const content = paper.height - 2 * BADGE_INSET;
    const rows = badgeRows(paper, true, true, 45);
    expect(rows.writing.height).toBeCloseTo(BADGE_WRITING_MIN, 9);
    expect(rows.squeeze).toBeCloseTo((content * (1 - 2 * BADGE_LAYOUT.phoneShare) - BADGE_WRITING_MIN) / (content * 0.55), 9);
    expect(rows.header.height / rows.role.height).toBeCloseTo(BADGE_LAYOUT.headerShare / BADGE_LAYOUT.roleShare, 9);
    // The least height named is the first at which the bands keep four fifths of their height at that share — and a millimetre less does not.
    for (const share of [43, 44, 45, 48]) {
      const refusal = badgeSizeRefusal({ ...custom(60, 30), nameSpacePct: share }, both);
      expect(refusal, `${share} %`).not.toBeNull();
      const at = (height: number) => badgeRows(badgePaper(custom(60, height)), true, true, share).squeeze;
      expect(at(refusal!.minHeightMm), `${share} %`).toBeGreaterThanOrEqual(BADGE_BANDS_MIN_SHARE - EPSILON);
      expect(at(refusal!.minHeightMm - 1), `${share} %`).toBeLessThan(BADGE_BANDS_MIN_SHARE);
    }
    expect(badgeSizeRefusal({ ...custom(60, 30), nameSpacePct: 45 }, both)).toEqual({ what: ["freeText", "phone"], minHeightMm: 32 });
    // Never refused where the default is not: the more the name takes, the less the bands have to give.
    for (let height = BADGE_CUSTOM_BOUNDS.height.min; height <= 60; height += 1) {
      for (const tick of [both, { freeText: false, phone: true }, { freeText: true, phone: false }]) {
        const today = badgeSizeRefusal(custom(60, height), tick);
        for (let share = 44; share <= BADGE_NAME_SPACE.max; share += 1) {
          const then = badgeSizeRefusal({ ...custom(60, height), nameSpacePct: share }, tick);
          if (today === null) expect(then, `60×${height} at ${share} %`).toBeNull();
          else if (then !== null) expect(then.minHeightMm).toBeLessThanOrEqual(today.minHeightMm);
        }
      }
    }
  });
});

describe("§972 the badge at 43, 60 and 80 %, at every size the bounds allow", () => {
  /** The grid's badges, each laid out once for the tests below. */
  const laidOut = new Map<string, BadgeLayout>();
  const gridLayout = (size: BadgeSizeChoice, tick: Tick, face: number, share: number) => {
    const key = JSON.stringify([size, tick, face, share]);
    let layout = laidOut.get(key);
    if (!layout) {
      layout = layoutOf(designOf(size, tick, share), FACES[face][1]);
      laidOut.set(key, layout);
    }
    return layout;
  };

  it.each(SHARES)("holds at %i %: rows, the writing area, the bands' words inside their bands, the areas' least widths", (share) => {
    const problems: string[] = [];
    let checked = 0;
    for (const size of SIZES) {
      for (const tick of TICKS) {
        for (const [face, [name]] of FACES.entries()) {
          problems.push(...problemsOf(gridLayout(size, tick, face, share), `${name} at ${size.customWidthMm}×${size.customHeightMm} ${JSON.stringify(tick)} at ${share} %`));
          checked += 1;
        }
      }
    }
    expect(problems.slice(0, 20)).toEqual([]);
    expect(checked).toBe(SIZES.length * TICKS.length * FACES.length);
  });

  it("names in the designer the watermark's box the sheet draws, at every space for the name", () => {
    // «Logo-ul clubului (filigran)»'s closed line says the size from `badgeFooterLogoOf`, which lays the rows out as the sheet does —
    // with the space for the name — so the size named is the size printed at 60 and 80 % too.
    const problems: string[] = [];
    let named = 0;
    for (const size of SIZES) {
      for (const tick of TICKS) {
        for (const share of SHARES) {
          const design = designOf(size, tick, share);
          const drawn = gridLayout(size, tick, 0, share).footerLogo ?? null;
          const box = badgeFooterLogoOf(design, { phone: badgePhoneRow(design), free: tick.free }) ?? null;
          if (JSON.stringify(box) !== JSON.stringify(drawn)) problems.push(`${size.customWidthMm}×${size.customHeightMm} ${JSON.stringify(tick)} at ${share} %`);
          if (box) named += 1;
        }
      }
    }
    expect(problems.slice(0, 20)).toEqual([]);
    expect(named).toBeGreaterThan(SIZES.length);
  });

  it("cuts no line at 60 or 80 % that the default does not cut, and prints the category whole", () => {
    const problems: string[] = [];
    for (const size of SIZES) {
      for (const tick of TICKS) {
        for (const [index, [name, face]] of FACES.entries()) {
          const today = gridLayout(size, tick, index, 43);
          for (const share of [60, 80]) {
            const where = `${name} at ${size.customWidthMm}×${size.customHeightMm} ${JSON.stringify(tick)} at ${share} %`;
            const then = gridLayout(size, tick, index, share);
            if (today.title && !today.title.cut && then.title?.cut) problems.push(`${where}: the title cut`);
            if (today.label && !today.label.cut && then.label?.cut) problems.push(`${where}: «VOLUNTAR» cut`);
            if (!today.roleLine.cut && then.roleLine.cut) problems.push(`${where}: the role cut`);
            if (face?.category) {
              const category = face.category.toLocaleUpperCase("ro");
              const printed = then.categoryLine ? then.categoryLine : then.label!;
              if (printed.text !== (then.categoryLine ? category : `VOLUNTAR${BADGE_CATEGORY_SEPARATOR}${category}`) || printed.cut) problems.push(`${where}: the category not whole`);
            }
          }
        }
      }
    }
    expect(problems.slice(0, 20)).toEqual([]);
  });

  it("shrinks the bands' words with the bands at 80 % on the smallest badges — under their least sizes of before, never out of their band", () => {
    for (const [size, tick] of [
      [custom(60, 30), TICKS[0]],
      [custom(60, 30), TICKS[3]],
      [custom(60, 34), TICKS[3]],
      [STRIP90, TICKS[0]],
      [STRIP90, TICKS[3]],
      [custom(200, 30), TICKS[1]],
    ] as const) {
      for (const [name, face] of FACES) {
        const where = `${name} at ${size.customWidthMm}×${size.customHeightMm} ${JSON.stringify(tick)}`;
        const layout = layoutOf(designOf(size, tick, 80), face);
        holds(layout, where);
        // The band is lower than a line at the least size of before could stand in: the line came down with it rather than spill over.
        expect(layout.role.height, where).toBeLessThan(badgeLineHeight(BADGE_LAYOUT.roleMinSize) * 2);
        expect(layout.roleLine.size, where).toBeLessThan(BADGE_LAYOUT.roleMinSize);
        expect(layout.title!.size, where).toBeLessThan(BADGE_LAYOUT.titleMinSize);
        // The single badge's «VOLUNTAR», alone and large, inside the band too.
        if (face === null) expect(layout.label).toBeNull();
      }
    }
    // The one badge for everyone, in English, the same.
    const single = { ...designOf(custom(60, 30), TICKS[0], 80), mode: "single" as const };
    holds(layoutOf(single, null, "en"), "the one badge, 60 × 30 at 80 %");
  });

  it("gives a 90 × 130 mm badge at 60 % the owner's room: the bands 40 % of it, the name's space 60 %, every line inside", () => {
    const design = designOf(custom(90, 130), TICKS[0], 60);
    const layout = layoutOf(design, FACES[0][1]);
    const content = badgePaper(design).height - 2 * BADGE_INSET;
    expect(layout.header.height + layout.role.height).toBeCloseTo(content * 0.4, 9);
    expect(layout.writing.height).toBeCloseTo(content * 0.6, 9);
    expect(layout.writing.height).toBeGreaterThan(layoutOf({ ...design, nameSpacePct: 43 }, FACES[0][1]).writing.height * 1.39);
    holds(layout, "90 × 130 at 60 %");
  });
});

/** Every text the sheet draws for its badges, with the size it is set at, in order. */
async function sheetRuns(render: () => Promise<Buffer>): Promise<Array<[string, number]>> {
  const runs: Array<[string, number]> = [];
  const text = PDFDocument.prototype.text;
  vi.spyOn(PDFDocument.prototype, "text").mockImplementation(function (this: PDFKit.PDFDocument, ...args: unknown[]) {
    if (typeof args[0] === "string") runs.push([args[0], (this as unknown as { _fontSize: number })._fontSize]);
    return (text as (...a: unknown[]) => PDFKit.PDFDocument).apply(this, args);
  });
  await render();
  vi.restoreAllMocks();
  return runs;
}

/** Every rectangle the sheet fills — the header band's, then the role band's — as [left, top, width, height] in points. */
async function sheetRects(render: () => Promise<Buffer>): Promise<number[][]> {
  const rects: number[][] = [];
  const rect = PDFDocument.prototype.rect;
  vi.spyOn(PDFDocument.prototype, "rect").mockImplementation(function (this: PDFKit.PDFDocument, ...args: unknown[]) {
    rects.push(args as number[]);
    return (rect as (...a: unknown[]) => PDFKit.PDFDocument).apply(this, args);
  });
  await render();
  vi.restoreAllMocks();
  return rects;
}

/** Every line the picture draws, by its test id, with its words and its size in points (the picture's pixels over its scale). */
function pictureRuns(node: ReactNode, scale: number, found: Array<[string, string, number]> = []): Array<[string, string, number]> {
  if (Array.isArray(node)) {
    for (const child of node) pictureRuns(child, scale, found);
    return found;
  }
  if (!isValidElement(node)) return found;
  const props = node.props as { children?: ReactNode; style?: { fontSize?: number }; "data-testid"?: string };
  if (typeof props.children === "string" && props.style?.fontSize !== undefined) found.push([props["data-testid"] ?? "", props.children, props.style.fontSize / scale]);
  else pictureRuns(props.children, scale, found);
  return found;
}

/** The picture's box of a test id: its top and height in points. */
function pictureBox(node: ReactNode, id: string, scale: number): { top: number; height: number } | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = pictureBox(child, id, scale);
      if (found) return found;
    }
    return null;
  }
  if (!isValidElement(node)) return null;
  const props = node.props as { children?: ReactNode; style?: { top?: number; height?: number }; "data-testid"?: string };
  if (props["data-testid"] === id && props.style?.top !== undefined && props.style.height !== undefined) return { top: props.style.top, height: props.style.height / scale };
  return pictureBox(props.children, id, scale);
}

/** The lines a layout prints, in the order both renderers draw them, with their sizes. */
const layoutRuns = (layout: BadgeLayout): Array<[string, number]> =>
  [layout.title, layout.label, layout.roleLine, layout.categoryLine, layout.freeLine, layout.name, layout.marker?.label, layout.phoneLine]
    .filter((line): line is BadgeTextLine => Boolean(line))
    .map((line) => [line.text, line.size]);

describe("§972 the sheet and the picture draw the same badge at a space for the name", () => {
  const cases: Array<[string, BadgeDesign, "ro" | "en", BadgeFaceRole | null]> = [
    ["90 × 100 mm at 60 %, every row ticked, a role under a category", designOf(custom(90, 100), TICKS[3], 60), "ro", FACES[2][1]],
    ["90 × 130 mm at 80 %, the one badge for everyone, in English", { ...designOf(custom(90, 130), TICKS[1], 80), mode: "single" }, "en", null],
    ["60 × 30 mm at 80 %, the longest category", designOf(custom(60, 30), TICKS[0], 80), "ro", FACES[3][1]],
    ["the default strip at 55 %, a long role", designOf(STRIP90, TICKS[2], 55, "Brașov Trail Race"), "ro", FACES[1][1]],
  ];

  it.each(cases)("%s: the same words at the same sizes, and the same bands, from the one layout", async (_name, design, locale, face) => {
    const words = badgeWords(design, locale, "Brașov Trail Race", locale === "ro" ? RO : EN);
    const layout = badgeImageLayout({ design, locale, words, role: face });
    // The picture's layout is the share's: its rows are `badgeRows`' at that share.
    const rows = badgeRows(badgePaper(design), badgePhoneRow(design), words.free !== null, design.nameSpacePct);
    expect([layout.header, layout.role, layout.writing]).toEqual([rows.header, rows.role, rows.writing]);
    const render = () => renderBadgeSheet({ design, locale, words, entries: [{ role: face, count: 1 }], eventTitle: "Brașov Trail Race", generatedAt: AT });
    expect(await sheetRuns(render)).toEqual(layoutRuns(layout));
    const { scale } = badgeImageSize(design);
    const markup = badgeMarkup({ design, locale, words, role: face }, "logo");
    expect(pictureRuns(markup, scale).map(([, text, size]) => [text, size])).toEqual(layoutRuns(layout).map(([text, size]) => [text, expect.closeTo(size, 9)]));
    // The two bands: the sheet's filled rectangles and the picture's boxes, both the layout's.
    const [headerRect, roleRect] = await sheetRects(render);
    expect(headerRect[3]).toBeCloseTo(layout.header.height, 9);
    expect(roleRect[3]).toBeCloseTo(layout.role.height, 9);
    expect(roleRect[1] - headerRect[1]).toBeCloseTo(layout.header.height, 9);
    expect(pictureBox(markup, "badge-header-band", scale)!.height).toBeCloseTo(layout.header.height, 9);
    expect(pictureBox(markup, "badge-role-band", scale)!.height).toBeCloseTo(layout.role.height, 9);
  }, 60_000);

  it("renders a PNG of the paper's proportion at 80 %, the words at their small sizes", async () => {
    const design = designOf(custom(90, 130), TICKS[3], 80);
    const image = await renderBadgeImage({ design, locale: "ro", words: badgeWords(design, "ro", "Brașov Trail Race", RO), role: FACES[2][1] });
    const bytes = Buffer.from(await image.arrayBuffer());
    expect(bytes.subarray(1, 4).toString()).toBe("PNG");
    expect(bytes.readUInt32BE(16)).toBe(960);
    expect(bytes.readUInt32BE(20)).toBe(badgeImageSize(design).height);
  }, 60_000);
});

describe("§972 the picture's address", () => {
  it("raises the drawing's version to 5, and makes a space for the name another picture's address", () => {
    expect(BADGE_DRAWING_VERSION).toBe(5);
    const at = (nameSpacePct: number) => badgePictureStamp([{ ...DEFAULT_BADGE_DESIGN, nameSpacePct }, "Crosul", "single"]);
    expect(at(60)).not.toBe(at(43));
    expect(at(60)).not.toBe(at(61));
  });
});
