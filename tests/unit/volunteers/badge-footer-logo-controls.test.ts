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
  BADGE_CUSTOM_BOUNDS,
  BADGE_FOOTER_LOGO_MIN_WIDTH,
  BADGE_FOOTER_LOGO_OPACITY,
  BADGE_FOOTER_LOGO_SETTING_KEYS,
  BADGE_FOOTER_LOGO_SETTINGS,
  BADGE_FOOTER_LOGOS,
  BADGE_INSET,
  BADGE_LAYOUT,
  type BadgeFooterLogo,
  type BadgeFooterLogoBox,
  type BadgeFooterLogoPlacement,
  type BadgeFooterLogoSetting,
  type BadgeLayout,
  type BadgeRow,
  type BadgeSizeChoice,
  badgeFooterLogoBox,
  badgeFooterLogoOf,
  badgeFooterLogoSetting,
  badgeFooterLogoWidthShare,
  badgeImageSize,
  badgeLayout,
  badgeLineHeight,
  badgePaper,
  badgeRows,
  badgeSheetSlots,
  MM,
} from "@/modules/volunteers/badges/badge-geometry";
import { badgeImageLayout, badgeMarkup, renderBadgeImage } from "@/modules/volunteers/badges/badge-image";
import { badgeDesignQuery, badgeDesignValuesFromQuery, badgePreviewUrl, isBadgeDesignInput, readBadgeDesignForm } from "@/modules/volunteers/badges/badge-query";
import { BadgeSizeRefusal, parseBadgeDesignPost } from "@/modules/volunteers/badges/badges";
import { renderBadgeSheet } from "@/modules/volunteers/badges/badges-pdf";
import { DomainError } from "@/shared/errors/domain-error";
import { LOGO_RATIO } from "@/theme/brand";

/**
 * §969 — the watermark's size, room and place (BR-REQ-050-02; the owner, 2026-11-17, designing the volunteers' badges with §965's
 * watermark: «și practic trebuie să pot seta dimensiunea logo-ului, padding și offset»). Four whole numbers of the design —
 * «Mărimea logo-ului» (10–100 % of the badge's width, 67), «Spațiu în jurul logo-ului» (0–20 mm, 0) and the two moves (−100…100 mm, 0;
 * right and down positive) — read forgivingly, refused at the save naming their box, carried by the preview's address and the event's
 * file; one box both renderers draw and the designer names, sized at the default in §965's room under «Nume:» and at a size typed in the
 * whole writing area — each less the space, never narrower than a readable logo — moved, and kept inside the writing area less the space,
 * over no band and no row, moving none. At the defaults every badge draws as before, byte for byte: `badge-type-unchanged.test.ts` and its
 * snapshot `badge-drawing-before-logo-controls.json`, written from the code before the four settings.
 */

const MEASURE = { bold: bibTitleWidth, regular: bibFooterWidth };
const RO = { label: "VOLUNTAR", name: "Nume:", phoneLabel: "Coordonator" };
const LEVELS = BADGE_FOOTER_LOGOS.filter((level): level is Exclude<BadgeFooterLogo, "off"> => level !== "off");
const DEFAULTS = { footerLogoSizePct: 67, footerLogoPaddingMm: 0, footerLogoOffsetXMm: 0, footerLogoOffsetYMm: 0 } as const;
const custom = (width: number, height: number): BadgeSizeChoice => ({ size: "custom", customWidthMm: width, customHeightMm: height });
const wordsOf = (design: BadgeDesign) => badgeWords(design, "ro", "Brașov Trail Race", RO);
const AT = new Date("2026-11-17T08:00:00.000Z");
const HAIR = 1e-9;

/** One badge's layout as both renderers lay it out: the design's choice, the words through `badgeLayoutWords`. */
function layoutOf(design: BadgeDesign, role: BadgeFaceRole | null = { name: "Punct de apă", colour: null }): BadgeLayout {
  return badgeLayout({ ...design, showPhone: badgePhoneRow(design), headerPicture: false }, badgeLayoutWords(design, wordsOf(design), "ro", role), MEASURE);
}

/** Whether a box overlaps a row by more than a hair. */
const overlaps = (box: { top: number; height: number }, row: BadgeRow | null) => row !== null && box.top < row.top + row.height - HAIR && row.top < box.top + box.height - HAIR;

/** §965's box, as §965 computed it — the reference the defaults are held to, bit for bit. */
function box965(level: Exclude<BadgeFooterLogo, "off">, at: { paper: { width: number }; writing: BadgeRow; pad: number; name: { top: number; size: number } }): BadgeFooterLogoBox | null {
  const top = at.name.top + badgeLineHeight(at.name.size);
  const foot = at.writing.top + at.writing.height - at.pad * BADGE_LAYOUT.footerLogoFootShare;
  const room = foot - top;
  if (!(room > 0)) return null;
  const width = Math.min(at.paper.width * (2 / 3), room * LOGO_RATIO);
  const height = width / LOGO_RATIO;
  return { left: (at.paper.width - width) / 2, top: foot - height, width, height, opacity: BADGE_FOOTER_LOGO_OPACITY[level] };
}

describe("§969 the design's four settings of the logo", () => {
  it("are four whole numbers with the bounds and defaults decided, the defaults in the platform's design", () => {
    expect(BADGE_FOOTER_LOGO_SETTINGS).toEqual({
      footerLogoSizePct: { min: 10, max: 100, default: 67 },
      footerLogoPaddingMm: { min: 0, max: 20, default: 0 },
      footerLogoOffsetXMm: { min: -100, max: 100, default: 0 },
      footerLogoOffsetYMm: { min: -100, max: 100, default: 0 },
    });
    expect(BADGE_FOOTER_LOGO_SETTING_KEYS).toEqual(Object.keys(DEFAULTS));
    expect(DEFAULT_BADGE_DESIGN).toMatchObject(DEFAULTS);
    expect(readBadgeDesign(null)).toMatchObject(DEFAULTS);
  });

  it("reads a design saved before them at their defaults, and names nothing as unreadable", () => {
    const before: Record<string, unknown> = { ...DEFAULT_BADGE_DESIGN, footerLogo: "medium", size: "strip100" };
    for (const key of BADGE_FOOTER_LOGO_SETTING_KEYS) delete before[key];
    expect(readBadgeDesign(before)).toEqual({ ...DEFAULT_BADGE_DESIGN, footerLogo: "medium", size: "strip100" });
    expect(badgeDesignDropped(before)).toEqual([]);
    // Nothing stored is not an unreadable value either.
    expect(badgeDesignDropped({ footerLogoSizePct: null, footerLogoOffsetYMm: undefined })).toEqual([]);
  });

  it.each(BADGE_FOOTER_LOGO_SETTING_KEYS)("keeps %s at every whole number within its bounds, and reads anything else as its default — never a throw — named beside its fold", (key) => {
    const { min, max, default: fallback } = BADGE_FOOTER_LOGO_SETTINGS[key];
    for (const value of [min, max, Math.round((min + max) / 2), min + 1, max - 1]) {
      expect(readBadgeDesign({ ...DEFAULT_BADGE_DESIGN, [key]: value })[key], `${value}`).toBe(value);
      expect(badgeDesignDropped({ [key]: value }), `${value}`).toEqual([]);
      expect(badgeFooterLogoSetting(key, value)).toBe(value);
    }
    for (const unreadable of [min - 1, max + 1, 12.5, Number.NaN, Number.POSITIVE_INFINITY, "40", true, [5], { value: 5 }]) {
      expect(readBadgeDesign({ ...DEFAULT_BADGE_DESIGN, [key]: unreadable })[key], String(unreadable)).toBe(fallback);
      expect(badgeDesignDropped({ [key]: unreadable }), String(unreadable)).toEqual([key]);
      expect(badgeFooterLogoSetting(key, unreadable as number), String(unreadable)).toBe(fallback);
    }
    // The rest of the design is read as it stands: one unreadable number never costs another setting.
    expect(readBadgeDesign({ ...DEFAULT_BADGE_DESIGN, footerLogo: "strong", [key]: "big" })).toMatchObject({ footerLogo: "strong", [key]: fallback });
    expect(badgeFooterLogoSetting(key, undefined)).toBe(fallback);
  });

  it("travel in the event file under `badges.design`: a file made before them reads the defaults, and the diff names each", () => {
    const badgesOf = eventConfigSchema.shape.badges;
    expect(badgesOf.parse({ design: { size: "strip100", footerLogo: "medium" } }).design).toMatchObject({ footerLogo: "medium", ...DEFAULTS });
    expect(badgesOf.parse({ design: { footerLogoSizePct: 90, footerLogoPaddingMm: 2, footerLogoOffsetXMm: -40, footerLogoOffsetYMm: 100 } }).design).toMatchObject({
      footerLogoSizePct: 90,
      footerLogoPaddingMm: 2,
      footerLogoOffsetXMm: -40,
      footerLogoOffsetYMm: 100,
    });
    // A file that carries a number out of bounds is read as the import would write it: the default.
    expect(badgesOf.parse({ design: { footerLogoSizePct: 500, footerLogoOffsetXMm: -101 } }).design).toMatchObject(DEFAULTS);
    const config = (settings: Partial<BadgeDesign>) => ({ badges: { design: { ...DEFAULT_BADGE_DESIGN, ...settings } } }) as unknown as EventConfig;
    for (const key of BADGE_FOOTER_LOGO_SETTING_KEYS) {
      expect(FIELD_LABELS).toContain(`badges.design.${key}`);
      const changed = { [key]: BADGE_FOOTER_LOGO_SETTINGS[key].max };
      expect(diffConfigs(config(changed), config({}))).toEqual([
        { key: `badges.design.${key}`, label: `badges.design.${key}`, locale: null, from: { type: "text", value: String(DEFAULTS[key]) }, to: { type: "text", value: String(BADGE_FOOTER_LOGO_SETTINGS[key].max) } },
      ]);
      for (const language of ["ro", "en"] as const) {
        const fields = catalogueOf(language).Admin.eventJson.fields.badges.design as Record<string, string>;
        expect(fields[key], `${language} ${key}`).toEqual(expect.any(String));
      }
    }
    expect(diffConfigs(config({ footerLogoPaddingMm: 4 }), config({ footerLogoPaddingMm: 4 }))).toEqual([]);
  });
});

describe("§969 the form, the preview's address and the save", () => {
  const posted = (fields: Record<string, string>) => readBadgeDesignForm((name) => fields[name] ?? null);
  const base = { "badge.design.mode": "single", "badge.design.size": "strip90", "badge.design.writingLine": "on" };
  const boxOf = (key: BadgeFooterLogoSetting) => `badge.design.${key}`;
  /** What the save throws for a post, or null. */
  const refusalOf = (fields: Record<string, string>) => {
    try {
      parseBadgeDesignPost(posted({ ...base, ...fields }));
    } catch (error) {
      return error;
    }
    return null;
  };

  it("goes from the form to the preview's address and back at every bound and between, so the preview follows the unsaved boxes", () => {
    for (const key of BADGE_FOOTER_LOGO_SETTING_KEYS) {
      // The island redraws on any control under the designer's prefix: each box is one.
      expect(isBadgeDesignInput(boxOf(key))).toBe(true);
      const { min, max } = BADGE_FOOTER_LOGO_SETTINGS[key];
      for (const value of [min, max, Math.round((min + max) / 3)]) {
        const values = posted({ ...base, "badge.design.footerLogo": "medium", [boxOf(key)]: String(value) });
        expect(values[key]).toBe(value);
        expect(badgeDesignQuery(values).get(key)).toBe(String(value));
        expect(badgeDesignFromQuery(badgeDesignQuery(values))[key]).toBe(value);
        const url = new URL(badgePreviewUrl({ eventId: "e", locale: "ro", role: "none", design: values }), "http://preview.test");
        expect(badgeDesignFromQuery(url.searchParams)[key]).toBe(value);
      }
    }
    // All four at once, as the designer posts them, and the stored design's own address — the first picture the page draws.
    const moved = { footerLogoSizePct: 45, footerLogoPaddingMm: 3, footerLogoOffsetXMm: -25, footerLogoOffsetYMm: 9 };
    const values = posted({ ...base, ...Object.fromEntries(Object.entries(moved).map(([key, value]) => [`badge.design.${key}`, String(value)])) });
    expect(badgeDesignFromQuery(badgeDesignQuery(values))).toMatchObject(moved);
    expect(badgeDesignFromQuery(badgeDesignQuery({ ...DEFAULT_BADGE_DESIGN, ...moved }))).toMatchObject(moved);
  });

  it("reads an address without them, or with a number out of bounds, at the defaults; a form from before the boxes carries none", () => {
    expect(badgeDesignFromQuery(new URLSearchParams("size=strip100&footerLogo=strong"))).toMatchObject({ footerLogo: "strong", ...DEFAULTS });
    expect(badgeDesignFromQuery(new URLSearchParams("footerLogoSizePct=150&footerLogoPaddingMm=-1&footerLogoOffsetXMm=2.5&footerLogoOffsetYMm=abc"))).toMatchObject(DEFAULTS);
    const before = posted(base);
    for (const key of BADGE_FOOTER_LOGO_SETTING_KEYS) {
      expect(Number.isNaN(before[key]), key).toBe(true);
      expect(badgeDesignQuery(before).has(key), key).toBe(false);
      expect(badgeDesignValuesFromQuery(badgeDesignQuery(before))[key], key).toBeUndefined();
    }
  });

  it("is saved at every whole number within the bounds — the level «Fără» too — and an empty box as its default", () => {
    for (const key of BADGE_FOOTER_LOGO_SETTING_KEYS) {
      const { min, max, default: fallback } = BADGE_FOOTER_LOGO_SETTINGS[key];
      for (const value of [min, max]) {
        for (const level of BADGE_FOOTER_LOGOS) expect(parseBadgeDesignPost(posted({ ...base, "badge.design.footerLogo": level, [boxOf(key)]: String(value) }))[key]).toBe(value);
      }
      expect(parseBadgeDesignPost(posted({ ...base, [boxOf(key)]: "" }))[key]).toBe(fallback);
      expect(parseBadgeDesignPost(posted({ ...base, [boxOf(key)]: "  " }))[key]).toBe(fallback);
    }
    // A form from before the boxes posts none: the four defaults.
    expect(parseBadgeDesignPost(posted(base))).toMatchObject(DEFAULTS);
  });

  it.each(BADGE_FOOTER_LOGO_SETTING_KEYS)("refuses %s below its least, over its most, or not whole, naming its box alone", (key) => {
    const { min, max } = BADGE_FOOTER_LOGO_SETTINGS[key];
    for (const wrong of [String(min - 1), String(max + 1), String(min + 0.5), "1e9", "Infinity"]) {
      for (const level of ["off", "medium"]) {
        const refusal = refusalOf({ "badge.design.footerLogo": level, [boxOf(key)]: wrong });
        expect(refusal, `${wrong} ${level}`).toBeInstanceOf(DomainError);
        expect(refusal, `${wrong} ${level}`).toMatchObject({ code: "VALIDATION_ERROR", fields: [boxOf(key)] });
      }
    }
  });

  it("names every wrong box of the four at once, and none that is right", () => {
    const refusal = refusalOf({ "badge.design.footerLogoSizePct": "5", "badge.design.footerLogoPaddingMm": "3", "badge.design.footerLogoOffsetXMm": "150", "badge.design.footerLogoOffsetYMm": "-101" });
    expect(refusal).toMatchObject({ code: "VALIDATION_ERROR", fields: ["badge.design.footerLogoSizePct", "badge.design.footerLogoOffsetXMm", "badge.design.footerLogoOffsetYMm"] });
  });

  it("never makes a size too small: the smallest badge the designer accepts is accepted at every extreme, and a refused one is refused alike", () => {
    const smallest = { "badge.design.size": "custom", "badge.design.customWidthMm": "60", "badge.design.customHeightMm": "30", "badge.design.footerLogo": "strong" };
    const phone = { "badge.design.showPhone": "on", "badge.design.phone": "0712 345 678" };
    const free = { "badge.design.showFreeText": "on", "badge.design.freeTextRo": "Bea apă", "badge.design.freeTextEn": "Drink water" };
    const extremes: Array<Record<string, string>> = [
      {},
      { "badge.design.footerLogoSizePct": "100", "badge.design.footerLogoPaddingMm": "20", "badge.design.footerLogoOffsetXMm": "100", "badge.design.footerLogoOffsetYMm": "100" },
      { "badge.design.footerLogoSizePct": "10", "badge.design.footerLogoOffsetXMm": "-100", "badge.design.footerLogoOffsetYMm": "-100" },
    ];
    for (const extras of [{}, phone, free]) for (const extreme of extremes) expect(refusalOf({ ...smallest, ...extras, ...extreme })).toBeNull();
    const without = refusalOf({ ...smallest, ...phone, ...free });
    expect(without).toBeInstanceOf(BadgeSizeRefusal);
    for (const extreme of extremes) expect(refusalOf({ ...smallest, ...phone, ...free, ...extreme })).toEqual(without);
  });
});

describe("§969 the logo's one box", () => {
  /** Every width step of 10 mm, every height step of 10 mm and the tallest, and the two presets. */
  const sizes: BadgeSizeChoice[] = [
    { size: "strip90", customWidthMm: 90, customHeightMm: 35 },
    { size: "strip100", customWidthMm: 90, customHeightMm: 35 },
  ];
  for (let width = BADGE_CUSTOM_BOUNDS.width.min; width <= BADGE_CUSTOM_BOUNDS.width.max; width += 10) {
    for (let height = BADGE_CUSTOM_BOUNDS.height.min; height <= BADGE_CUSTOM_BOUNDS.height.max; height += 10) sizes.push(custom(width, height));
    sizes.push(custom(width, BADGE_CUSTOM_BOUNDS.height.max));
  }
  /** The rows a design can take height for, and the marker's area, which takes width. */
  const ticks = [
    { showPhone: false, showFreeText: false, showMarker: false },
    { showPhone: true, showFreeText: false, showMarker: false },
    { showPhone: false, showFreeText: true, showMarker: true },
    { showPhone: true, showFreeText: true, showMarker: true },
  ];
  /** The extremes asked for: sizes 10, 67 and 100 %, spaces 0 and 20 mm, each move at ±100 mm and none. */
  const placements: BadgeFooterLogoPlacement[] = [];
  for (const footerLogoSizePct of [10, 67, 100]) {
    for (const footerLogoPaddingMm of [0, 20]) {
      for (const [footerLogoOffsetXMm, footerLogoOffsetYMm] of [[0, 0], [100, 100], [-100, -100], [100, -100], [-100, 100], [0, 100], [0, -100], [100, 0], [-100, 0]]) {
        placements.push({ footerLogoSizePct, footerLogoPaddingMm, footerLogoOffsetXMm, footerLogoOffsetYMm });
      }
    }
  }
  const designOf = (size: BadgeSizeChoice, tick: (typeof ticks)[number], footerLogo: BadgeFooterLogo, placement: BadgeFooterLogoPlacement = {}): BadgeDesign => ({
    ...DEFAULT_BADGE_DESIGN,
    ...size,
    mode: "perRole",
    ...tick,
    phone: tick.showPhone ? "0712 345 678" : "",
    freeTextRo: tick.showFreeText ? "Bea apă la fiecare punct" : "",
    freeTextEn: tick.showFreeText ? "Drink water at every point" : "",
    markerLabelRo: "Tură",
    markerLabelEn: "Shift",
    footerLogo,
    ...placement,
  });

  it("is §965's box, bit for bit, at the defaults — spelled out, absent, or handed nothing", () => {
    for (const size of sizes) {
      for (const tick of ticks) {
        const plain = layoutOf(designOf(size, tick, "medium"));
        const at = { paper: plain.paper, writing: plain.writing, pad: plain.pad, name: { top: plain.name.top, size: plain.content.height * BADGE_LAYOUT.nameShare } };
        const reference = box965("medium", at);
        expect(plain.footerLogo ?? null).toEqual(reference);
        expect(badgeFooterLogoBox("medium", at)).toEqual(reference);
        expect(badgeFooterLogoBox("medium", at, DEFAULTS)).toEqual(reference);
        expect(badgeFooterLogoBox("medium", at, {})).toEqual(reference);
      }
    }
  });

  it("takes «Mărimea logo-ului» as a share of the badge's width — 67 % is §965's two thirds exactly — and a size out of bounds as the default", () => {
    expect(Object.is(badgeFooterLogoWidthShare(67), BADGE_LAYOUT.footerLogoWidthShare)).toBe(true);
    expect(BADGE_LAYOUT.footerLogoWidthShare).toBe(2 / 3);
    expect(badgeFooterLogoWidthShare(undefined)).toBe(2 / 3);
    expect([10, 50, 66, 68, 100].map(badgeFooterLogoWidthShare)).toEqual([0.1, 0.5, 0.66, 0.68, 1]);
    for (const wrong of [9, 101, 50.5, Number.NaN]) expect(badgeFooterLogoWidthShare(wrong)).toBe(2 / 3);
    // Larger is never smaller: the share grows with the percent, 67 included.
    for (let pct = 11; pct <= 100; pct++) expect(badgeFooterLogoWidthShare(pct)).toBeGreaterThan(badgeFooterLogoWidthShare(pct - 1));
  });

  it("stays inside the writing area less the space at every size, tick, level and extreme — over no band and no row, as large as its size and room allow — and moves nothing", () => {
    let drawn = 0;
    let none = 0;
    /**
     * The placements whose whole layout is drawn on every size and tick — the defaults and the far corners, largest and smallest — so
     * the layout is shown to hand the one function what the rest of the grid hands it directly, and to move nothing else.
     */
    const isWhole = (placement: BadgeFooterLogoPlacement) =>
      [
        [67, 0, 0, 0],
        [100, 20, 100, 100],
        [10, 0, -100, -100],
        [100, 0, -100, 100],
      ].some((whole) => JSON.stringify(whole) === JSON.stringify(BADGE_FOOTER_LOGO_SETTING_KEYS.map((key) => placement[key])));
    expect(placements.filter(isWhole)).toHaveLength(4);
    /** Every rule a box broke, named with its badge — plain comparisons, so ninety thousand boxes cost a second, not a minute. */
    const broken: string[] = [];
    for (const size of sizes) {
      for (const tick of ticks) {
        const off = layoutOf(designOf(size, tick, "off"));
        const rows = badgeRows(badgePaper(size), tick.showPhone, tick.showFreeText);
        const content = rows.content;
        const nameFoot = off.name.top + badgeLineHeight(content.height * BADGE_LAYOUT.nameShare);
        const foot = rows.writing.top + rows.writing.height - off.pad * BADGE_LAYOUT.footerLogoFootShare;
        // What `badgeLayout` hands the one function: the paper, the writing area, the pad, and «Nume:»'s line at its largest size.
        const at = { paper: off.paper, writing: off.writing, pad: off.pad, name: { top: off.name.top, size: content.height * BADGE_LAYOUT.nameShare } };
        for (const placement of placements) {
          const box = badgeFooterLogoBox("strong", at, placement) ?? undefined;
          const fail = (rule: string) => broken.push(`${size.size} ${size.customWidthMm}×${size.customHeightMm} ${JSON.stringify(tick)} ${JSON.stringify(placement)}: ${rule}`);
          if (isWhole(placement)) {
            const design = designOf(size, tick, "strong", placement);
            const { footerLogo, ...rest } = layoutOf(design);
            // The layout's box is the one function's, and nothing else moves, whatever the logo's size, space or place: every row and
            // every line is the badge without it.
            if (JSON.stringify(footerLogo) !== JSON.stringify(box)) fail("the layout's box is not the function's");
            if (JSON.stringify(rest) !== JSON.stringify(off)) fail("something else in the layout moved");
            // The designer names the size from the very box, drawn without a badge's words (`badgeFooterLogoOf`).
            const named = badgeFooterLogoOf(design, { phone: badgePhoneRow(design), free: tick.showFreeText });
            if (JSON.stringify(named ?? undefined) !== JSON.stringify(footerLogo)) fail("the designer's box is not the layout's");
          }
          const space = placement.footerLogoPaddingMm! * MM;
          // The room it is fitted in: at the default size §965's, under «Nume:», less the space; at a size typed the whole writing area
          // less the space — over «Nume:» if it must.
          const typed = placement.footerLogoSizePct !== BADGE_FOOTER_LOGO_SETTINGS.footerLogoSizePct.default;
          const room = typed ? rows.writing.height - 2 * space : foot - space - (nameFoot + space);
          const across = content.width - 2 * space;
          const share = off.paper.width * badgeFooterLogoWidthShare(placement.footerLogoSizePct);
          // As large as its share, the width between the sides and the room's height allow, at the lockup's proportion.
          const fits = room > 0 && across > 0 ? Math.min(share, across, room * LOGO_RATIO) : 0;
          if (!box) {
            // No box only when that leaves less than a readable logo: never a speck, never a logo out of the white.
            if (fits >= BADGE_FOOTER_LOGO_MIN_WIDTH) fail("no box, with room for one");
            none += 1;
            continue;
          }
          drawn += 1;
          if (box.opacity !== BADGE_FOOTER_LOGO_OPACITY.strong) fail("the level's opacity");
          if (box.width < BADGE_FOOTER_LOGO_MIN_WIDTH) fail("a speck");
          // Inside the whole writing area less the space, between the content's sides less the space.
          if (box.left < content.left + space - HAIR) fail("over the left side");
          if (box.left + box.width > content.left + content.width - space + HAIR) fail("over the right side");
          if (box.top < rows.writing.top + space - HAIR) fail("over the writing area's top");
          if (box.top + box.height > rows.writing.top + rows.writing.height - space + HAIR) fail("over the writing area's foot");
          for (const row of [rows.header, rows.role, rows.free, rows.phone]) if (overlaps(box, row)) fail("over a band or a row");
          // At the lockup's own proportion, no wider than its share of the badge, no taller than its room — and exactly as large as they allow.
          if (Math.abs(box.width / box.height - LOGO_RATIO) > 1e-9) fail("not the lockup's proportion");
          if (box.width > share + HAIR) fail("wider than its share of the badge");
          if (box.height > room + HAIR) fail("taller than its room");
          if (Math.abs(box.width - fits) > 1e-6) fail("not as large as its size and room allow");
          // At the default size it rises over «Nume:»'s line only when moved up: §965's place, which the size typed may leave.
          if (!typed && placement.footerLogoOffsetYMm! >= 0 && box.top < nameFoot + space - HAIR) fail("the default size over «Nume:»");
          // Not moved: centred across the badge, standing on the room's foot — or, taller than the white above that foot, at the white's top.
          if (placement.footerLogoOffsetXMm === 0 && placement.footerLogoOffsetYMm === 0) {
            if (Math.abs(box.left + box.width / 2 - off.paper.width / 2) > 1e-9) fail("not centred");
            if (Math.abs(box.top - Math.max(foot - space - box.height, rows.writing.top + space)) > 1e-9) fail("not standing on its room's foot");
          }
        }
      }
    }
    expect(broken).toEqual([]);
    // Every extreme was drawn somewhere, and the 20 mm space leaves the short badges none.
    expect(drawn).toBeGreaterThan(sizes.length * ticks.length * 10);
    expect(none).toBeGreaterThan(0);
  });

  it("is the same box at every level, at the level's own opacity, and none while off", () => {
    const placement = { footerLogoSizePct: 40, footerLogoPaddingMm: 2, footerLogoOffsetXMm: -15, footerLogoOffsetYMm: 3 };
    for (const size of [sizes[0], sizes[1], custom(90, 140)]) {
      const boxes = LEVELS.map((level) => layoutOf(designOf(size, ticks[0], level, placement)).footerLogo);
      for (const [index, level] of LEVELS.entries()) expect(boxes[index]).toEqual({ ...boxes[0], opacity: BADGE_FOOTER_LOGO_OPACITY[level] });
      expect("footerLogo" in layoutOf(designOf(size, ticks[0], "off", placement))).toBe(false);
    }
  });

  it("grows with «Mărimea logo-ului» on a tall badge until the width between the sides stops it, 67 % being two thirds", () => {
    const tall = (pct: number, padding = 0) => layoutOf(designOf(custom(90, 287), ticks[0], "medium", { footerLogoSizePct: pct, footerLogoPaddingMm: padding })).footerLogo!;
    expect(tall(10).width).toBeCloseTo(9 * MM, 9);
    expect(tall(50).width).toBeCloseTo(45 * MM, 9);
    expect(tall(67).width).toBeCloseTo(60 * MM, 9);
    // At 100 % the whole width between the content's sides — the paper less its white border — and with 20 mm kept, 40 mm less.
    expect(tall(100).width).toBeCloseTo(90 * MM - 2 * BADGE_INSET, 9);
    expect(tall(100, 20).width).toBeCloseTo(90 * MM - 2 * BADGE_INSET - 40 * MM, 9);
    for (let pct = 11; pct <= 100; pct++) expect(tall(pct).width).toBeGreaterThanOrEqual(tall(pct - 1).width);
  });

  it("on the default 90 × 35 strip, draws the size typed — over «Nume:» if it must, up to the writing area's height — and §965's box at 67", () => {
    const strip = (pct: number) => layoutOf(designOf(sizes[0], ticks[0], "medium", { footerLogoSizePct: pct }));
    const logo = (pct: number) => strip(pct).footerLogo!;
    const plain = strip(67);
    const nameFoot = plain.name.top + badgeLineHeight(plain.content.height * BADGE_LAYOUT.nameShare);
    const foot = plain.writing.top + plain.writing.height - plain.pad * BADGE_LAYOUT.footerLogoFootShare;
    // 67, the default: §965's box, as large as the room under «Nume:» allows — 21.7 × 8.9 mm, a quarter of the strip's width.
    expect(logo(67).width / MM).toBeCloseTo(21.69, 2);
    expect(logo(67).height / MM).toBeCloseTo(8.95, 2);
    expect(logo(67).top).toBeCloseTo(nameFoot, 9);
    // Any other number is that share of the width, standing on the same foot: 10 % is 9 mm and 20 % 18 mm, under «Nume:»; 25, 30 and
    // 35 % are larger than the default's box and rise over «Nume:», which is written over them.
    for (const pct of [10, 20, 24, 25, 30, 35]) expect(logo(pct).width, `${pct} %`).toBeCloseTo((90 * MM * pct) / 100, 9);
    for (const pct of [10, 20, 24]) expect(logo(pct).top + logo(pct).height, `${pct} %`).toBeCloseTo(foot, 9);
    for (const pct of [25, 30]) {
      expect(logo(pct).top + logo(pct).height, `${pct} %`).toBeCloseTo(foot, 9);
      expect(logo(pct).top, `${pct} %`).toBeLessThan(nameFoot);
    }
    // From 36 % the writing area's height stops it — 13.3 mm, the white between the role's band and the badge's foot — so it is 32.3 mm
    // wide, its top at the band's foot and never over it.
    for (const pct of [36, 40, 50, 66, 68, 80, 100]) {
      const box = logo(pct);
      expect(box.width / MM, `${pct} %`).toBeCloseTo(32.31, 2);
      expect(box.height, `${pct} %`).toBeCloseTo(plain.writing.height, 9);
      expect(box.top, `${pct} %`).toBeCloseTo(plain.role.top + plain.role.height, 9);
    }
    // So the box is never inert: every whole percent up to the writing area's height draws a larger logo than the one before — but 67,
    // which keeps §965's room.
    for (let pct = 11; pct <= 35; pct++) expect(logo(pct).width, `${pct} %`).toBeGreaterThan(logo(pct - 1).width);
    for (let pct = 37; pct <= 100; pct++) if (pct !== 67 && pct !== 68) expect(logo(pct).width, `${pct} %`).toBeGreaterThanOrEqual(logo(pct - 1).width);
    // A move never changes the size: the default's box moved up is §965's box, at the writing area's top.
    const raised = layoutOf(designOf(sizes[0], ticks[0], "medium", { footerLogoOffsetYMm: -100 })).footerLogo!;
    expect([raised.width, raised.height]).toEqual([logo(67).width, logo(67).height]);
    expect(raised.top).toBeCloseTo(plain.writing.top, 9);
    // 100 × 40: §965's 25.2 mm at 67, and up to the writing area's 15.5 mm of height at a size typed, 37.5 mm wide.
    const strip100 = (pct: number) => layoutOf(designOf(sizes[1], ticks[0], "medium", { footerLogoSizePct: pct })).footerLogo!;
    expect(strip100(67).width / MM).toBeCloseTo(25.19, 2);
    expect(strip100(30).width).toBeCloseTo(30 * MM, 9);
    expect(strip100(100).width / MM).toBeCloseTo(37.52, 2);
  });

  it("makes it smaller with each millimetre of space where the room holds it, and keeps that space from the room's every edge", () => {
    const strip = (padding: number) => layoutOf(designOf(sizes[0], ticks[0], "medium", { footerLogoPaddingMm: padding })).footerLogo;
    const widths: number[] = [];
    for (let padding = 0; padding <= 20; padding++) {
      const box = strip(padding);
      if (!box) break;
      widths.push(box.width);
    }
    // 21.7 × 8.9 mm with no space; each millimetre takes two from the room's height, until what is left is less than a readable logo.
    expect(widths.length).toBeGreaterThan(2);
    expect(widths.length).toBeLessThan(21);
    for (let index = 1; index < widths.length; index++) expect(widths[index]).toBeLessThan(widths[index - 1]);
    expect(strip(20)).toBeUndefined();
    // At a size typed the room is the whole writing area less the space: 100 % keeps a logo up to 5 mm of space on the default strip.
    const typed = (padding: number) => layoutOf(designOf(sizes[0], ticks[0], "medium", { footerLogoSizePct: 100, footerLogoPaddingMm: padding })).footerLogo;
    expect(typed(5)!.width / MM).toBeCloseTo(8.07, 2);
    expect(typed(6)).toBeUndefined();
    // On a tall badge the logo's share decides, and the space keeps it from the sides only once it reaches them.
    const tall = (padding: number) => layoutOf(designOf(custom(90, 287), ticks[0], "medium", { footerLogoPaddingMm: padding })).footerLogo!;
    expect(tall(5).width).toBeCloseTo(60 * MM, 9);
    expect(tall(5).top + tall(5).height).toBeCloseTo(tall(0).top + tall(0).height - 5 * MM, 9);
    expect(tall(20).width).toBeCloseTo(90 * MM - 2 * BADGE_INSET - 40 * MM, 9);
  });

  it("draws no logo narrower than 5 mm — a speck — and never meets a box §965 draws, nor the least size typed", () => {
    expect(BADGE_FOOTER_LOGO_MIN_WIDTH).toBe(5 * MM);
    // 100 × 40 at the default size: 4 mm of space leave a 5.8 mm logo; 5 mm left a speck of 0.9 × 0.4 mm, which is now none.
    const strip100 = (padding: number) => layoutOf(designOf(sizes[1], ticks[0], "medium", { footerLogoPaddingMm: padding })).footerLogo;
    expect(strip100(4)!.width / MM).toBeCloseTo(5.8, 1);
    expect(strip100(5)).toBeUndefined();
    // The default strip: 3 mm leave 7.1 mm, 4 mm would leave 2.3 mm — none.
    const strip = (padding: number) => layoutOf(designOf(sizes[0], ticks[0], "medium", { footerLogoPaddingMm: padding })).footerLogo;
    expect(strip(3)!.width / MM).toBeCloseTo(7.15, 1);
    expect(strip(4)).toBeUndefined();
    // «Mărimea logo-ului»'s least, 10 %, on the narrowest badge the designer accepts, 60 mm wide: 6 mm, drawn.
    expect(layoutOf(designOf(custom(60, 30), ticks[0], "medium", { footerLogoSizePct: 10 })).footerLogo!.width).toBeCloseTo(6 * MM, 9);
    // §965's box at the defaults, on every whole size the bounds allow and with each set of rows that takes height: never under it —
    // the narrowest is 9.45 mm, on 60 × 48 mm with the free-text line and the telephone — so the defaults draw as they drew.
    let least = Number.POSITIVE_INFINITY;
    for (let width = BADGE_CUSTOM_BOUNDS.width.min; width <= BADGE_CUSTOM_BOUNDS.width.max; width++) {
      for (let height = BADGE_CUSTOM_BOUNDS.height.min; height <= BADGE_CUSTOM_BOUNDS.height.max; height++) {
        for (const [phone, free] of [[false, false], [true, false], [false, true], [true, true]]) {
          const box = badgeFooterLogoOf({ ...custom(width, height), footerLogo: "medium" }, { phone, free });
          least = Math.min(least, box?.width ?? 0);
        }
      }
    }
    expect(least / MM).toBeCloseTo(9.45, 2);
    expect(least).toBeGreaterThan(BADGE_FOOTER_LOGO_MIN_WIDTH);
  });

  it("moves it right and down by the millimetres typed, left and up by negative ones, and stops it at the writing area's edges", () => {
    const tallDesign = (placement: BadgeFooterLogoPlacement, tick = ticks[0]) => designOf(custom(90, 287), tick, "medium", placement);
    const still = layoutOf(tallDesign({})).footerLogo!;
    // It stands on its room's foot, half a pad above the writing area's: from 30 mm up, a move down has room to show.
    const raised = layoutOf(tallDesign({ footerLogoOffsetYMm: -30 })).footerLogo!;
    const moved = layoutOf(tallDesign({ footerLogoOffsetXMm: 10, footerLogoOffsetYMm: -10 })).footerLogo!;
    // Right and down are positive: the box's left grows by 10 mm and its top by 20 mm, its size the same.
    expect(moved.left - still.left).toBeCloseTo(10 * MM, 9);
    expect(moved.top - raised.top).toBeCloseTo(20 * MM, 9);
    expect([moved.width, moved.height]).toEqual([still.width, still.height]);
    const back = layoutOf(tallDesign({ footerLogoOffsetXMm: -10, footerLogoOffsetYMm: -20 })).footerLogo!;
    expect(still.left - back.left).toBeCloseTo(10 * MM, 9);
    expect(still.top - back.top).toBeCloseTo(20 * MM, 9);
    // Down from §965's place it goes as far as the writing area's foot, half a pad, and no further.
    const down = layoutOf(tallDesign({ footerLogoOffsetYMm: 20 }));
    expect(down.footerLogo!.top + down.footerLogo!.height).toBeCloseTo(down.writing.top + down.writing.height, 9);
    // Pushed past an edge it stops there — the sides, the writing area's top over «Nume:» and its foot — never on a band.
    for (const padding of [0, 7]) {
      const space = padding * MM;
      for (const tick of [ticks[0], ticks[3]]) {
        const layout = layoutOf(tallDesign({ footerLogoPaddingMm: padding }, tick));
        const corner = (x: number, y: number) => layoutOf(tallDesign({ footerLogoPaddingMm: padding, footerLogoOffsetXMm: x, footerLogoOffsetYMm: y }, tick)).footerLogo!;
        const right = layout.content.left + layout.content.width - space;
        expect(corner(100, 100).left + corner(100, 100).width).toBeCloseTo(right, 9);
        expect(corner(-100, 0).left).toBeCloseTo(layout.content.left + space, 9);
        expect(corner(0, 100).top + corner(0, 100).height).toBeCloseTo(layout.writing.top + layout.writing.height - space, 9);
        expect(corner(0, -100).top).toBeCloseTo(layout.writing.top + space, 9);
        // With the telephone ticked, its row is under the writing area: the foot the logo stops at is the row's top.
        if (layout.phone) expect(corner(0, 100).top + corner(0, 100).height).toBeLessThanOrEqual(layout.phone.top - space + HAIR);
        if (layout.free) expect(corner(0, -100).top).toBeGreaterThanOrEqual(layout.free.top + layout.free.height + space - HAIR);
      }
    }
    // On the default strip a move up lays it over «Nume:» — under the words, which are drawn over it — and never over the role's band.
    const up = layoutOf(designOf(sizes[0], ticks[0], "medium", { footerLogoOffsetYMm: -100 }));
    expect(up.footerLogo!.top).toBeCloseTo(up.writing.top, 9);
    expect(up.footerLogo!.top).toBeLessThan(up.name.top + badgeLineHeight(up.name.size));
  });

  it("is one box on every badge of a design — a role's, a role under a category, «fără rol», the one badge for everyone", () => {
    const placement = { footerLogo: "faint" as const, footerLogoSizePct: 90, footerLogoPaddingMm: 1, footerLogoOffsetXMm: 30, footerLogoOffsetYMm: -4 };
    for (const design of [{ ...DEFAULT_BADGE_DESIGN, ...placement }, { ...DEFAULT_BADGE_DESIGN, mode: "perRole" as const, size: "strip100" as const, ...placement }]) {
      const boxes = [
        layoutOf(design, null),
        layoutOf(design, { name: "Punct de apă", colour: "#c62828" }),
        layoutOf(design, { name: "Direcționare", colour: null, category: "Pe Traseu" }),
        layoutOf(design, { name: "Coordonatorul general al punctelor de control, apă și al tuturor voluntarilor", colour: null, category: "A".repeat(80) }),
      ].map((layout) => layout.footerLogo);
      expect(boxes[0]).toMatchObject({ opacity: BADGE_FOOTER_LOGO_OPACITY.faint });
      for (const box of boxes) expect(box).toEqual(boxes[0]);
    }
  });
});

/** What a call's argument is, as data: numbers and words as they are, anything else named. */
function plain(value: unknown): unknown {
  if (Buffer.isBuffer(value)) return "[bytes]";
  if (Array.isArray(value)) return value.map(plain);
  if (value && typeof value === "object") {
    if (Object.getPrototypeOf(value) !== Object.prototype) return `[${(value as object).constructor?.name ?? "object"}]`;
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, plain(inner)]));
  }
  return value;
}

type Call = [string, ...unknown[]];

/** The sheet's calls that draw the watermark: `opacity` and the picture after it. */
async function sheetCalls(design: BadgeDesign, role: BadgeFaceRole | null): Promise<Call[]> {
  const calls: Call[] = [];
  const prototype = PDFDocument.prototype as unknown as Record<string, (...args: unknown[]) => unknown>;
  for (const name of ["opacity", "image"] as const) {
    const original = prototype[name];
    vi.spyOn(prototype, name).mockImplementation(function (this: unknown, ...args: unknown[]) {
      calls.push([name, ...args.map(plain)]);
      return original.apply(this, args);
    });
  }
  try {
    await renderBadgeSheet({ design, locale: "ro", words: wordsOf(design), entries: [{ role, count: 1 }], eventTitle: "Brașov Trail Race", generatedAt: AT });
  } finally {
    vi.restoreAllMocks();
  }
  return calls;
}

/** A React tree's elements in drawing order, as plain data: each one's type and props. */
type Node = { type: string; props: Record<string, unknown>; children: unknown };
function elements(markup: ReactNode): Node[] {
  const tree = (node: ReactNode): unknown => {
    if (Array.isArray(node)) return node.filter((child) => child !== null && child !== undefined && typeof child !== "boolean").map(tree);
    if (!isValidElement(node)) return node ?? null;
    const { children, ...props } = node.props as { children?: ReactNode } & Record<string, unknown>;
    return { type: typeof node.type === "string" ? node.type : "fragment", props, children: tree(children) };
  };
  const out: Node[] = [];
  const walk = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (node && typeof node === "object" && "type" in node) {
      out.push(node as Node);
      walk((node as Node).children);
    }
  };
  walk(tree(markup));
  return out;
}

afterEach(() => vi.restoreAllMocks());

describe("§969 the sheet and the picture draw the moved logo at one box", () => {
  const cases: Array<[string, BadgeDesign, BadgeFaceRole | null]> = [
    ["the tallest badge, the logo at its widest with a space, moved left and down", { ...DEFAULT_BADGE_DESIGN, size: "custom", customWidthMm: 90, customHeightMm: 287, footerLogo: "strong", footerLogoSizePct: 100, footerLogoPaddingMm: 3, footerLogoOffsetXMm: -20, footerLogoOffsetYMm: 5 }, null],
    ["the default strip per role, at 30 % — over «Nume:» — and pushed to the right edge", { ...DEFAULT_BADGE_DESIGN, mode: "perRole", footerLogo: "medium", footerLogoSizePct: 30, footerLogoOffsetXMm: 100 }, { name: "Direcționare", colour: null, category: "Pe Traseu" }],
    [
      "100 × 40 with every row ticked, moved up over «Nume:»",
      { ...DEFAULT_BADGE_DESIGN, mode: "perRole", size: "strip100", showPhone: true, phone: "0712 345 678", showFreeText: true, freeTextRo: "Bea apă", freeTextEn: "Drink water", showMarker: true, footerLogo: "faint", footerLogoOffsetYMm: -100 },
      { name: "Punct de apă", colour: "#c62828" },
    ],
  ];

  it.each(cases)("%s: the PDF's picture and the PNG's are the layout's box, at the level's opacity", async (_name, design, role) => {
    const input = { design, locale: "ro" as const, words: wordsOf(design), role };
    const box = badgeImageLayout(input).footerLogo!;
    expect(box).toBeDefined();
    expect(box.opacity).toBe(BADGE_FOOTER_LOGO_OPACITY[design.footerLogo as Exclude<BadgeFooterLogo, "off">]);
    // The picture: one lockup at the box, read back into points (the paper's edge and the scale undone).
    const nodes = elements(badgeMarkup(input, "data:image/png;base64,LOGO"));
    const marks = nodes.filter((node) => node.props["data-testid"] === "badge-footer-logo");
    expect(marks).toHaveLength(1);
    const { scale } = badgeImageSize(design);
    const band = nodes.find((node) => node.props["data-testid"] === "badge-header-band")!;
    const edge = badgeImageLayout(input).content.left * scale - (band.props.style as { left: number }).left;
    const style = marks[0].props.style as { left: number; top: number; opacity: number };
    expect(style.opacity).toBe(box.opacity);
    expect((style.left + edge) / scale).toBeCloseTo(box.left, 9);
    expect((style.top + edge) / scale).toBeCloseTo(box.top, 9);
    expect((marks[0].props.width as number) / scale).toBeCloseTo(box.width, 9);
    expect((marks[0].props.height as number) / scale).toBeCloseTo(box.height, 9);
    // The sheet: the same box from the badge's corner, at the same opacity.
    const calls = await sheetCalls(design, role);
    const slot = badgeSheetSlots(1, badgePaper(design))[0];
    const at = calls.findIndex((call) => call[0] === "opacity");
    expect(calls[at]).toEqual(["opacity", box.opacity]);
    const [, , x, y, options] = calls[at + 1] as [string, unknown, number, number, { fit: [number, number] }];
    expect(x - slot.x).toBeCloseTo(box.left, 9);
    expect(y - slot.y).toBeCloseTo(box.top, 9);
    expect(options.fit).toEqual([box.width, box.height]);
  });

  it("renders a PNG of the paper's proportion with the logo moved to a corner", async () => {
    const design: BadgeDesign = { ...DEFAULT_BADGE_DESIGN, footerLogo: "strong", footerLogoSizePct: 40, footerLogoOffsetXMm: -100, footerLogoOffsetYMm: 100 };
    const image = await renderBadgeImage({ design, locale: "ro", words: wordsOf(design), role: null });
    const bytes = Buffer.from(await image.arrayBuffer());
    expect(bytes.subarray(1, 4).toString()).toBe("PNG");
    expect(bytes.readUInt32BE(16)).toBe(960);
    expect(bytes.readUInt32BE(20)).toBe(373);
  }, 60_000);
});

describe("§969 the drawing's version and the picture's stamp", () => {
  it("raises the drawing's version to 4, so every picture's address changes with it", () => {
    expect(BADGE_DRAWING_VERSION).toBe(4);
  });

  it("stamps a new address for each of the four settings changed, so the browser never shows the old badge", () => {
    const stamp = (design: BadgeDesign) => badgePictureStamp([design, "Crosul", null]);
    const before = stamp({ ...DEFAULT_BADGE_DESIGN, footerLogo: "medium" });
    const seen = new Set([before]);
    for (const key of BADGE_FOOTER_LOGO_SETTING_KEYS) {
      const changed = stamp({ ...DEFAULT_BADGE_DESIGN, footerLogo: "medium", [key]: BADGE_FOOTER_LOGO_SETTINGS[key].max });
      expect(seen.has(changed), key).toBe(false);
      seen.add(changed);
    }
  });
});
