import { describe, expect, it } from "vitest";
import { bibFooterWidth } from "@/modules/registrations/bib-footer";
import { A4_PAGE } from "@/modules/registrations/bib-geometry";
import { bibTitleWidth } from "@/modules/registrations/bib-header";
import { DEFAULT_BADGE_DESIGN, readBadgeDesign } from "@/modules/volunteers/badges/badge-design";
import {
  BADGE_CUSTOM_BOUNDS,
  BADGE_LAYOUT,
  BADGE_PAD_MAX,
  BADGE_PAGE_MARGIN,
  type BadgeLayoutWords,
  type BadgeSizeChoice,
  badgeLayout,
  badgePaper,
  badgeRows,
  badgeSheetGrid,
  badgeSizeRefusal,
} from "@/modules/volunteers/badges/badge-geometry";

/**
 * §967 — taller volunteer badges (BR-REQ-050-02; the owner, 2026-11-17: «lasă-mă să fac ecusoanele mai mari pt voluntari, adică
 * mai înalte!», then, at 100 mm: «tot văd limitări aici»). «Altă dimensiune» reaches an A4 page's height less its margins, one badge
 * to a page; every badge up to 100 mm draws with the pad it had; past 100 mm the bands keep growing and the pad does not.
 */

const MEASURE = { bold: bibTitleWidth, regular: bibFooterWidth };
const WORDS: BadgeLayoutWords = { title: "Brașov Trail Race", label: "VOLUNTAR", role: "PUNCT DE APĂ", name: "Nume:", phone: null, free: null, markerLabel: null };
const custom = (width: number, height: number): BadgeSizeChoice => ({ size: "custom", customWidthMm: width, customHeightMm: height });
const layoutOf = (size: BadgeSizeChoice) => badgeLayout({ ...size, headerPicture: false, showLogo: true, writingLine: true, showMarker: false }, WORDS, MEASURE);
const PRINTABLE_HEIGHT = A4_PAGE.height - 2 * BADGE_PAGE_MARGIN;

describe("§967 taller volunteer badges", () => {
  it("reach an A4 page's height less its margins, one badge to a page — and no further", () => {
    expect(BADGE_CUSTOM_BOUNDS.height.max).toBe(287);
    const tallest = badgePaper(custom(BADGE_CUSTOM_BOUNDS.width.max, BADGE_CUSTOM_BOUNDS.height.max));
    expect(tallest.height).toBeLessThanOrEqual(PRINTABLE_HEIGHT + 1e-6);
    expect(badgeSheetGrid(tallest)).toMatchObject({ columns: 1, rows: 1, perSheet: 1 });
    // One millimetre more would not fit the page.
    expect(badgePaper(custom(90, BADGE_CUSTOM_BOUNDS.height.max + 1)).height).toBeGreaterThan(PRINTABLE_HEIGHT);
    // A lanyard's 90 × 140 mm: four to a page.
    expect(badgeSheetGrid(badgePaper(custom(90, 140)))).toMatchObject({ columns: 2, rows: 2, perSheet: 4 });
  });

  it("keep the height the club typed, up to the page, and read a taller one as the default", () => {
    for (const height of [101, 140, 200, 287]) {
      expect(readBadgeDesign({ ...DEFAULT_BADGE_DESIGN, size: "custom", customWidthMm: 90, customHeightMm: height }).customHeightMm).toBe(height);
    }
    expect(readBadgeDesign({ ...DEFAULT_BADGE_DESIGN, size: "custom", customWidthMm: 90, customHeightMm: 288 }).customHeightMm).toBe(DEFAULT_BADGE_DESIGN.customHeightMm);
  });

  it("draw every badge up to 100 mm with the pad it had, to the last bit", () => {
    for (const width of [60, 90, 200]) {
      for (let height = BADGE_CUSTOM_BOUNDS.height.min; height <= 100; height += 1) {
        const size = custom(width, height);
        const rows = badgeRows(badgePaper(size), false, false);
        expect(layoutOf(size).pad, `${width} × ${height}`).toBe(rows.header.height * BADGE_LAYOUT.padShare);
      }
    }
    // The cap is the 100 mm badge's own pad, so that badge reaches it and none under it passes it.
    expect(layoutOf(custom(90, 100)).pad).toBe(BADGE_PAD_MAX);
  });

  it("stop the pad growing past 100 mm while the bands keep growing with the badge", () => {
    let header = layoutOf(custom(90, 100)).header.height;
    for (const height of [101, 140, 200, 287]) {
      const layout = layoutOf(custom(90, height));
      expect(layout.pad, `${height} mm`).toBe(BADGE_PAD_MAX);
      expect(layout.header.height, `${height} mm`).toBeGreaterThan(header);
      header = layout.header.height;
    }
  });

  it("fit every row a club may tick at the tallest size, as at the others", () => {
    expect(badgeSizeRefusal(custom(60, BADGE_CUSTOM_BOUNDS.height.max), { freeText: true, phone: true })).toBeNull();
    expect(badgeSizeRefusal(custom(90, 140), { freeText: true, phone: true })).toBeNull();
  });
});
