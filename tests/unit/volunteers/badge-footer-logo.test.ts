import { describe, expect, it } from "vitest";
import { catalogueOf } from "@/i18n/catalogue";
import { diffConfigs, FIELD_LABELS } from "@/modules/content/events/transfer/diff";
import { eventConfigSchema, type EventConfig } from "@/modules/content/events/transfer/file-format";
import { bibFooterWidth } from "@/modules/registrations/bib-footer";
import { bibTitleWidth } from "@/modules/registrations/bib-header";
import {
  BADGE_DRAWING_VERSION,
  type BadgeDesign,
  badgeDesignDropped,
  badgeDesignFromQuery,
  badgeDesignSchema,
  badgeLayoutWords,
  badgePhoneRow,
  badgeWords,
  DEFAULT_BADGE_DESIGN,
  readBadgeDesign,
} from "@/modules/volunteers/badges/badge-design";
import {
  BADGE_CUSTOM_BOUNDS,
  BADGE_FOOTER_LOGO_OPACITY,
  BADGE_FOOTER_LOGOS,
  BADGE_LAYOUT,
  type BadgeFooterLogo,
  type BadgeLayout,
  type BadgeRow,
  type BadgeSizeChoice,
  badgeFooterLogoBox,
  badgeLayout,
  badgeLineHeight,
  badgePaper,
  badgeRows,
  badgeSizeRefusal,
  DEFAULT_BADGE_FOOTER_LOGO,
} from "@/modules/volunteers/badges/badge-geometry";
import { badgeDesignQuery, badgePreviewUrl, isBadgeDesignInput, readBadgeDesignForm } from "@/modules/volunteers/badges/badge-query";
import { BadgeSizeRefusal, parseBadgeDesignPost } from "@/modules/volunteers/badges/badges";
import { DomainError } from "@/shared/errors/domain-error";
import { LOGO_RATIO } from "@/theme/brand";

/**
 * §965 — «Logo-ul clubului jos, ca filigran» (BR-REQ-050-02; the owner, 2026-11-17: «vreau ca la voluntari să pot pune logo-ul clubului
 * în footer, dar transparent», then his choice: a large, pale watermark of the club's logo at the bottom of the badge, the name written in
 * marker reading over it, a little, medium or well visible). The design's key and its reading, the preview's address, the save's reading,
 * the one box both renderers draw — inside the writing area's lower part at every size the bounds allow, over no band and no row, moving
 * nothing — and the event file's diff. Pure: no renderer, no database; the drawing itself is `badge-footer-logo-drawn.test.ts`.
 */

const MEASURE = { bold: bibTitleWidth, regular: bibFooterWidth };
const RO = { label: "VOLUNTAR", name: "Nume:", phoneLabel: "Coordonator" };
const LEVELS = BADGE_FOOTER_LOGOS.filter((level): level is Exclude<BadgeFooterLogo, "off"> => level !== "off");
const custom = (width: number, height: number): BadgeSizeChoice => ({ size: "custom", customWidthMm: width, customHeightMm: height });

/** One badge's layout as both renderers lay it out: the design's choice, the words through `badgeLayoutWords`. */
function layoutOf(design: BadgeDesign, role: { name: string; colour: string | null; category?: string | null } | null = { name: "Punct de apă", colour: null }): BadgeLayout {
  const words = badgeWords(design, "ro", "Brașov Trail Race", RO);
  return badgeLayout({ ...design, showPhone: badgePhoneRow(design), headerPicture: false }, badgeLayoutWords(design, words, "ro", role), MEASURE);
}

/** Whether two rows overlap by more than a hair. */
const overlaps = (a: { top: number; height: number }, b: BadgeRow | null) => b !== null && a.top < b.top + b.height - 1e-9 && b.top < a.top + a.height - 1e-9;

describe("§965 the design's key «Logo-ul clubului jos, ca filigran»", () => {
  it("is off by default and for every design saved before it, never refused and never named as unreadable", () => {
    expect(DEFAULT_BADGE_FOOTER_LOGO).toBe("off");
    expect(DEFAULT_BADGE_DESIGN.footerLogo).toBe("off");
    expect(readBadgeDesign(null).footerLogo).toBe("off");
    // A design as §783 stored it: every key it knew, none of the watermark's.
    const before = { ...DEFAULT_BADGE_DESIGN } as Record<string, unknown>;
    delete before.footerLogo;
    expect(readBadgeDesign(before)).toEqual(DEFAULT_BADGE_DESIGN);
    expect(badgeDesignDropped(before)).toEqual([]);
    expect(readBadgeDesign({ size: "strip100", showPhone: true, phone: "0712 345 678" }).footerLogo).toBe("off");
  });

  it("keeps each of its four levels, and reads a level no one knows, or a value of the wrong type, as off — named beside its section", () => {
    expect(BADGE_FOOTER_LOGOS).toEqual(["off", "faint", "medium", "strong"]);
    for (const level of BADGE_FOOTER_LOGOS) {
      expect(readBadgeDesign({ ...DEFAULT_BADGE_DESIGN, footerLogo: level }).footerLogo).toBe(level);
      expect(badgeDesignDropped({ footerLogo: level })).toEqual([]);
      expect(badgeDesignSchema.parse({ ...DEFAULT_BADGE_DESIGN, footerLogo: level }).footerLogo).toBe(level);
    }
    for (const unreadable of ["bold", "Medium", 2, true, { level: "faint" }]) {
      expect(readBadgeDesign({ ...DEFAULT_BADGE_DESIGN, footerLogo: unreadable }).footerLogo, String(unreadable)).toBe("off");
      expect(badgeDesignDropped({ footerLogo: unreadable }), String(unreadable)).toEqual(["footerLogo"]);
    }
    // Nothing stored is not an unreadable value.
    expect(badgeDesignDropped({ footerLogo: null })).toEqual([]);
  });

  it("travels in the event file under `badges.design`: a file made before it reads off, and the diff names it", () => {
    const badgesOf = eventConfigSchema.shape.badges;
    expect(badgesOf.parse({ design: { size: "strip100" } }).design.footerLogo).toBe("off");
    expect(badgesOf.parse({ design: { size: "strip100", footerLogo: "strong" } }).design.footerLogo).toBe("strong");
    expect(badgesOf.parse({ design: { footerLogo: "loud" } }).design.footerLogo).toBe("off");
    expect(FIELD_LABELS).toContain("badges.design.footerLogo");
    const config = (footerLogo: BadgeFooterLogo) => ({ badges: { design: { ...DEFAULT_BADGE_DESIGN, footerLogo } } }) as unknown as EventConfig;
    expect(diffConfigs(config("medium"), config("off"))).toEqual([
      { key: "badges.design.footerLogo", label: "badges.design.footerLogo", locale: null, from: { type: "text", value: "off" }, to: { type: "text", value: "medium" } },
    ]);
    expect(diffConfigs(config("faint"), config("faint"))).toEqual([]);
    for (const language of ["ro", "en"] as const) {
      const fields = catalogueOf(language).Admin.eventJson.fields.badges.design as Record<string, string>;
      expect(fields.footerLogo, language).toEqual(expect.any(String));
    }
  });
});

describe("§965 the form and the preview's address", () => {
  const posted = (fields: Record<string, string>) => readBadgeDesignForm((name) => fields[name] ?? null);

  it("goes from the form to the preview's address and back at every level, so the preview follows the unsaved choice", () => {
    // The island redraws on any control under the designer's prefix: the select is one.
    expect(isBadgeDesignInput("badge.design.footerLogo")).toBe(true);
    for (const level of BADGE_FOOTER_LOGOS) {
      const values = posted({ "badge.design.size": "strip90", "badge.design.footerLogo": level });
      expect(values.footerLogo).toBe(level);
      expect(badgeDesignQuery(values).get("footerLogo")).toBe(level);
      expect(badgeDesignFromQuery(badgeDesignQuery(values)).footerLogo).toBe(level);
      const url = new URL(badgePreviewUrl({ eventId: "e", locale: "ro", role: "none", design: values }), "http://preview.test");
      expect(badgeDesignFromQuery(url.searchParams).footerLogo).toBe(level);
    }
    // The stored design's own address (the first picture the page draws) carries it too.
    expect(badgeDesignFromQuery(badgeDesignQuery({ ...DEFAULT_BADGE_DESIGN, footerLogo: "strong" })).footerLogo).toBe("strong");
  });

  it("reads an address without it, or with a level no one knows, as off", () => {
    expect(badgeDesignFromQuery(new URLSearchParams("size=strip100")).footerLogo).toBe("off");
    expect(badgeDesignFromQuery(new URLSearchParams("footerLogo=loud")).footerLogo).toBe("off");
    // A form from before the choice posts nothing: no key in the address, off again.
    expect(badgeDesignQuery(posted({ "badge.design.size": "strip90" })).has("footerLogo")).toBe(false);
  });

  it("is saved at each level, an empty post as off, and a word that is none of the four is refused naming its box", () => {
    const base = { "badge.design.mode": "single", "badge.design.size": "strip90", "badge.design.writingLine": "on" };
    for (const level of BADGE_FOOTER_LOGOS) expect(parseBadgeDesignPost(posted({ ...base, "badge.design.footerLogo": level })).footerLogo).toBe(level);
    expect(parseBadgeDesignPost(posted(base)).footerLogo).toBe("off");
    let refusal: unknown;
    try {
      parseBadgeDesignPost(posted({ ...base, "badge.design.footerLogo": "loud" }));
    } catch (error) {
      refusal = error;
    }
    expect(refusal).toBeInstanceOf(DomainError);
    expect(refusal).toMatchObject({ code: "VALIDATION_ERROR", fields: ["badge.design.footerLogo"] });
  });

  it("never makes a size too small: the smallest badge the designer accepts is accepted with the logo, and a refused one is refused alike", () => {
    // 60 × 30 mm, the least the bounds allow, with each extra the save accepts there.
    const smallest = { "badge.design.mode": "single", "badge.design.size": "custom", "badge.design.customWidthMm": "60", "badge.design.customHeightMm": "30" };
    const phone = { "badge.design.showPhone": "on", "badge.design.phone": "0712 345 678" };
    const free = { "badge.design.showFreeText": "on", "badge.design.freeTextRo": "Bea apă", "badge.design.freeTextEn": "Drink water" };
    for (const extras of [{}, phone, free]) {
      for (const level of BADGE_FOOTER_LOGOS) expect(parseBadgeDesignPost(posted({ ...smallest, ...extras, "badge.design.footerLogo": level })).footerLogo).toBe(level);
    }
    // Both extras at 30 mm were refused before the logo, and are refused the same with it: the same rows, the same least height.
    const refusalOf = (level: BadgeFooterLogo) => {
      try {
        parseBadgeDesignPost(posted({ ...smallest, ...phone, ...free, "badge.design.footerLogo": level }));
      } catch (error) {
        return error;
      }
      return null;
    };
    const without = refusalOf("off");
    expect(without).toBeInstanceOf(BadgeSizeRefusal);
    for (const level of LEVELS) expect(refusalOf(level)).toEqual(without);
  });
});

describe("§965 the watermark's one box", () => {
  /** Every size the bounds allow: each width step of 10 mm, each whole height, and the two presets. */
  const sizes: BadgeSizeChoice[] = [{ size: "strip90", customWidthMm: 90, customHeightMm: 35 }, { size: "strip100", customWidthMm: 90, customHeightMm: 35 }];
  for (let width = BADGE_CUSTOM_BOUNDS.width.min; width <= BADGE_CUSTOM_BOUNDS.width.max; width += 10) {
    for (let height = BADGE_CUSTOM_BOUNDS.height.min; height <= BADGE_CUSTOM_BOUNDS.height.max; height += 1) sizes.push(custom(width, height));
  }
  /** The rows a design can take height for, and the marker's area, which takes width. */
  const ticks = [
    { showPhone: false, showFreeText: false, showMarker: false },
    { showPhone: true, showFreeText: false, showMarker: false },
    { showPhone: false, showFreeText: true, showMarker: true },
    { showPhone: true, showFreeText: true, showMarker: true },
  ];
  const designOf = (size: BadgeSizeChoice, tick: (typeof ticks)[number], footerLogo: BadgeFooterLogo): BadgeDesign => ({
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
  });

  it("is drawn inside the writing area's lower part at every size and tick, over no band and no row, and moves nothing", () => {
    let checked = 0;
    for (const size of sizes) {
      for (const tick of ticks) {
        const off = layoutOf(designOf(size, tick, "off"));
        expect("footerLogo" in off).toBe(false);
        const on = layoutOf(designOf(size, tick, "strong"));
        const { footerLogo: box, ...rest } = on;
        // Nothing else moves: every row and every line is the badge without it.
        expect(rest).toEqual(off);
        const label = `${size.size} ${size.customWidthMm}×${size.customHeightMm} ${JSON.stringify(tick)}`;
        expect(box, label).toBeDefined();
        if (!box) continue;
        // Held to the rows as `badgeRows` lays them out on their own, not as the layout reports them.
        const rows = badgeRows(badgePaper(size), tick.showPhone, tick.showFreeText);
        const area = { top: box.top, height: box.height };
        expect(box.top, label).toBeGreaterThanOrEqual(rows.writing.top - 1e-9);
        expect(box.top + box.height, label).toBeLessThanOrEqual(rows.writing.top + rows.writing.height + 1e-9);
        for (const row of [rows.header, rows.role, rows.free, rows.phone]) expect(overlaps(area, row), label).toBe(false);
        // Under «Nume:»'s line, at the largest size it and the marker's label are set at.
        const nameFoot = on.name.top + badgeLineHeight(rows.content.height * BADGE_LAYOUT.nameShare);
        expect(nameFoot).toBeGreaterThanOrEqual(on.name.top + badgeLineHeight(on.name.size) - 1e-9);
        if (on.marker?.label) expect(nameFoot).toBeGreaterThanOrEqual(on.marker.label.top + badgeLineHeight(on.marker.label.size) - 1e-9);
        expect(box.top, label).toBeGreaterThanOrEqual(nameFoot - 1e-9);
        // Inside the content's sides, centred across the badge, at the lockup's own proportion, never wider than two thirds of it.
        expect(box.left).toBeGreaterThanOrEqual(rows.content.left - 1e-9);
        expect(box.left + box.width).toBeLessThanOrEqual(rows.content.left + rows.content.width + 1e-9);
        expect(box.left + box.width / 2).toBeCloseTo(on.paper.width / 2, 9);
        expect(box.width / box.height).toBeCloseTo(LOGO_RATIO, 9);
        expect(box.width).toBeLessThanOrEqual((on.paper.width * 2) / 3 + 1e-9);
        expect(box.height, label).toBeGreaterThan(0);
        // As large as the room allows: it fills the lower part's height, or it is two thirds of the badge wide.
        const foot = rows.writing.top + rows.writing.height - on.pad * BADGE_LAYOUT.footerLogoFootShare;
        expect(box.top + box.height).toBeCloseTo(foot, 9);
        const fillsHeight = Math.abs(box.top - nameFoot) < 1e-9;
        const fillsWidth = Math.abs(box.width - (on.paper.width * 2) / 3) < 1e-9;
        expect(fillsHeight || fillsWidth, label).toBe(true);
        checked += 1;
      }
    }
    expect(checked).toBe(sizes.length * ticks.length);
  });

  it("raised the drawing's version to 3, so every picture's address changed with it (a later drawing raises it further, §NNN)", () => {
    expect(BADGE_DRAWING_VERSION).toBeGreaterThanOrEqual(3);
  });

  it("is the same box at every level, at the level's own opacity, and none while off", () => {
    expect(BADGE_FOOTER_LOGO_OPACITY).toEqual({ faint: 0.12, medium: 0.22, strong: 0.35 });
    const at = { paper: { width: 255 }, writing: { top: 55, height: 38 }, pad: 4, name: { top: 57, size: 6.6 } };
    expect(badgeFooterLogoBox("off", at)).toBeNull();
    expect(badgeFooterLogoBox(undefined, at)).toBeNull();
    const boxes = LEVELS.map((level) => badgeFooterLogoBox(level, at));
    for (const [index, level] of LEVELS.entries()) expect(boxes[index]).toEqual({ ...boxes[0], opacity: BADGE_FOOTER_LOGO_OPACITY[level] });
    // Paler first: each level is more visible than the one before, and none hides a name written over it.
    expect(BADGE_FOOTER_LOGO_OPACITY.faint).toBeLessThan(BADGE_FOOTER_LOGO_OPACITY.medium);
    expect(BADGE_FOOTER_LOGO_OPACITY.medium).toBeLessThan(BADGE_FOOTER_LOGO_OPACITY.strong);
    expect(BADGE_FOOTER_LOGO_OPACITY.strong).toBeLessThanOrEqual(0.4);
    // No room under «Nume:»: no box, never one drawn over it.
    expect(badgeFooterLogoBox("strong", { ...at, writing: { top: 55, height: 9 } })).toBeNull();
  });

  it("is on every badge of a design — a role's, a role under a category, «fără rol», the one badge for everyone — at one place", () => {
    for (const design of [{ ...DEFAULT_BADGE_DESIGN, footerLogo: "medium" as const }, { ...DEFAULT_BADGE_DESIGN, mode: "perRole" as const, footerLogo: "medium" as const }]) {
      const boxes = [
        layoutOf(design, null),
        layoutOf(design, { name: "Punct de apă", colour: "#c62828" }),
        layoutOf(design, { name: "Direcționare", colour: null, category: "Pe Traseu" }),
        layoutOf(design, { name: "Coordonatorul general al punctelor de control, apă și al tuturor voluntarilor", colour: null, category: "A".repeat(80) }),
      ].map((layout) => layout.footerLogo);
      expect(boxes[0]).toMatchObject({ opacity: 0.22 });
      for (const box of boxes) expect(box).toEqual(boxes[0]);
    }
  });

  it("keeps room for the logo at the smallest badge the designer accepts, with every extra it accepts there", () => {
    for (const tick of ticks) {
      const design = designOf(custom(BADGE_CUSTOM_BOUNDS.width.min, BADGE_CUSTOM_BOUNDS.height.min), tick, "faint");
      const refused = badgeSizeRefusal(design, { freeText: tick.showFreeText, phone: tick.showPhone });
      // Both extras need 34 mm (§776): there, the smallest accepted is 60 × 34.
      const accepted = refused ? designOf(custom(BADGE_CUSTOM_BOUNDS.width.min, refused.minHeightMm), tick, "faint") : design;
      expect(badgeSizeRefusal(accepted, { freeText: tick.showFreeText, phone: tick.showPhone })).toBeNull();
      const box = layoutOf(accepted).footerLogo;
      expect(box, JSON.stringify(tick)).toBeDefined();
      // At least a centimetre wide: a logo, never a speck.
      expect(box!.width).toBeGreaterThan(10 * (72 / 25.4));
    }
  });
});
