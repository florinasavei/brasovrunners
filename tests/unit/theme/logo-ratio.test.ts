import { describe, expect, it } from "vitest";
import { LEGAL_PDF_LOGO } from "@/modules/legal-documents/pdf";
import { bibFooterWidth } from "@/modules/registrations/bib-footer";
import { BIB_LAYOUT } from "@/modules/registrations/bib-geometry";
import { bibTitleWidth } from "@/modules/registrations/bib-header";
import { DECLARATION_LOGO } from "@/modules/registrations/declaration-pdf";
import { BADGE_LAYOUT, badgeLayout } from "@/modules/volunteers/badges/badge-geometry";
import { LOGO, LOGO_HEIGHT_SHARE, LOGO_RATIO } from "@/theme/brand";

/**
 * BR-REQ-101-01 (§NNN): the logo's proportions are read from `club/club.json` wherever the code sized the lockup by
 * hand — the race number, the volunteer badge, the bib designer's swatch and the two PDFs — and not a point moved.
 *
 * Each ratio is `LOGO` rounded to three decimals, the number those places wrote before (2.424); the PDFs, which wrote
 * the raster's 495 / 1200, read the lockup's exact share, the same number. The literals below are today's geometry,
 * computed as origin/qa computed it.
 */
describe("BR-REQ-101-01: the logo's proportions come from the club's file, and every geometry number is today's (§NNN)", () => {
  it("is LOGO rounded to three decimals: 2.424 for 2880 × 1188", () => {
    expect(LOGO_RATIO).toBe(Math.round((LOGO.lockup.width / LOGO.lockup.height) * 1000) / 1000);
    expect(LOGO_RATIO).toBe(2.424);
    expect(LOGO_HEIGHT_SHARE).toBe(LOGO.lockup.height / LOGO.lockup.width);
    expect(LOGO_HEIGHT_SHARE).toBe(495 / 1200);
  });

  it("keeps the race number's lockup 122 points wide at 2.424 : 1, centred on the 62-point band as before", () => {
    expect(BIB_LAYOUT.logoWidth).toBe(122);
    expect(BIB_LAYOUT.logoRatio).toBe(2.424);
    expect(BIB_LAYOUT.logoWidth / BIB_LAYOUT.logoRatio).toBe(122 / 2.424);
    expect((BIB_LAYOUT.bandHeight - BIB_LAYOUT.logoWidth / BIB_LAYOUT.logoRatio) / 2).toBe((62 - 122 / 2.424) / 2);
  });

  it("keeps the badge's logo box as it was", () => {
    expect(BADGE_LAYOUT.logoRatio).toBe(2.424);
    const layout = badgeLayout(
      { size: "strip90", customWidthMm: 0, customHeightMm: 0, headerPicture: false, showLogo: true, writingLine: true, showMarker: false },
      { title: "Alergare", label: "VOLUNTAR", role: "PUNCT", name: "Nume:", phone: null, free: null, markerLabel: null },
      { bold: bibTitleWidth, regular: bibFooterWidth },
    );
    expect(layout.logo).not.toBeNull();
    expect(layout.logo?.width).toBe(layout.header.height * 0.68 * 2.424);
  });

  it("starts both PDFs' title where it started", () => {
    expect(DECLARATION_LOGO).toEqual({ width: 140, height: 140 * (495 / 1200) });
    expect(LEGAL_PDF_LOGO).toEqual({ width: 150, height: 150 * (495 / 1200) });
  });

  it("draws the bib designer's swatch 53 by 22 pixels, as it did", () => {
    expect(Math.round(53 / LOGO_RATIO)).toBe(22);
  });
});
