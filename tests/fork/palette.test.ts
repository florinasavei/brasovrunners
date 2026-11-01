import { describe, expect, it } from "vitest";
import { judgeTint } from "@/modules/appearance/domain/tint-contrast";
import { bibFooterWidth } from "@/modules/registrations/bib-footer";
import { BIB_CARD, BIB_LAYOUT } from "@/modules/registrations/bib-geometry";
import { bibTitleWidth } from "@/modules/registrations/bib-header";
import { type BadgeSizeChoice, badgeLayout } from "@/modules/volunteers/badges/badge-geometry";
import { COLOR, COLOR_DARK, contrastRatio, GRADIENT, LOGO_RATIO, LOOK_ACCENT, MIN_TEXT_CONTRAST, PALETTE, SITE_TINT } from "@/theme/brand";
import { BRAND_PAIRS, CALENDAR_TONE_PAIRS } from "@/theme/brand-pairs";
import fork from "../fixtures/fork-club/club.json";

/**
 * BR-REQ-101-01 (§NNN): another club's palette and logo run the platform's own checks.
 *
 * Under `yarn test:fork` the theme is built from `tests/fixtures/fork-club/club.json`: a green club that writes only
 * the four colours a palette must have — its primary and its ink, its secondary and its accent — and a square lockup.
 * Every tint, the dark scheme's primary, the kit's gradient and both accents' shades are then derived by `brand.ts`,
 * and every pair the pages draw (`brand-pairs.ts`, the same list `tests/unit/theme/brand.test.ts` holds at AA for
 * Brașov) clears AA on them; the page tints keep §488's two rules; and the square logo stands inside the race
 * number's band and the badge's header rather than spilling past them.
 */
describe("BR-REQ-101-01: a fork's palette and logo pass the platform's checks (§NNN)", () => {
  it("builds the theme from the fork's colours, deriving what it leaves out", () => {
    expect({ blue: COLOR.blue, blueInk: COLOR.blueInk, orange: COLOR.orange, accent: PALETTE.accent }).toEqual({
      blue: fork.palette.primary,
      blueInk: fork.palette.primaryInk,
      orange: fork.palette.secondary,
      accent: fork.palette.accent,
    });
    expect("tints" in fork.palette || "dark" in fork.palette || "look" in fork.palette).toBe(false);
    for (const hex of [COLOR_DARK.blue, COLOR_DARK.blueInk, GRADIENT.heroTint, GRADIENT.heroTintDark, GRADIENT.deep, ...Object.values(PALETTE.tints)]) {
      expect(hex).toMatch(/^#[0-9a-f]{6}$/);
    }
    expect(LOOK_ACCENT.pink.light.accent).not.toBe(LOOK_ACCENT.orange.light.accent);
  });

  for (const { foreground, background } of [...BRAND_PAIRS, ...CALENDAR_TONE_PAIRS]) {
    it(`clears AA for ${foreground.name} on ${background.name}`, () => {
      expect(contrastRatio(foreground.hex, background.hex), `${foreground.hex} on ${background.hex}`).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
    });
  }

  for (const [name, hex] of Object.entries(SITE_TINT)) {
    it(`keeps the «${name}» page tint readable and a page under white cards`, () => {
      expect(judgeTint(hex), hex).toBeNull();
    });
  }

  it("has a square logo", () => {
    expect(LOGO_RATIO).toBe(1);
  });

  it("stands the square logo inside the race number's band", () => {
    const height = BIB_LAYOUT.logoWidth / BIB_LAYOUT.logoRatio;
    expect(height).toBeLessThanOrEqual(BIB_LAYOUT.bandHeight);
    expect((BIB_LAYOUT.bandHeight - height) / 2).toBeGreaterThan(0);
    expect(BIB_LAYOUT.inset + BIB_LAYOUT.logoWidth).toBeLessThan(BIB_CARD.width / 2);
  });

  for (const size of ["strip90", "strip100"] as const) {
    it(`stands the square logo inside the ${size} badge's header`, () => {
      const choice: BadgeSizeChoice = { size, customWidthMm: 0, customHeightMm: 0 };
      const layout = badgeLayout(
        { ...choice, headerPicture: false, showLogo: true, writingLine: true, showMarker: false },
        { title: "Alergare", label: "VOLUNTAR", role: "PUNCT", name: "Nume:", phone: null, free: null, markerLabel: null },
        { bold: bibTitleWidth, regular: bibFooterWidth },
      );
      const logo = layout.logo;
      expect(logo).not.toBeNull();
      if (!logo) return;
      expect(logo.width).toBe(logo.height);
      expect(logo.top).toBeGreaterThanOrEqual(layout.header.top);
      expect(logo.top + logo.height).toBeLessThanOrEqual(layout.header.top + layout.header.height);
      expect(logo.left + logo.width).toBeLessThanOrEqual(layout.content.left + layout.content.width);
    });
  }
});
