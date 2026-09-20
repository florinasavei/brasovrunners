import { describe, expect, it } from "vitest";
import { BIB_BAND_FALLBACK, bibBandColour, bibFooterLine } from "@/modules/registrations/bib-design";
import { COLOR } from "@/theme/brand";

/**
 * §180 — the two decisions the sheet and the preview picture share.
 *
 * They are tested here rather than through either renderer because "the PDF and the PNG agree"
 * is only true while both read the same function: a band colour worked out twice is a band
 * colour that eventually differs, and the club's only look at a bib before printing two hundred
 * of them is the picture.
 */
describe("§180 what a bib looks like", () => {
  it("uses the event's own colour when it has one", () => {
    expect(bibBandColour("#1b7f3b")).toBe("#1b7f3b");
    expect(bibBandColour("#1B7F3B")).toBe("#1B7F3B");
  });

  it("falls back to the club's, which is the ink blue rather than the pure one", () => {
    // A large flat fill under white text: `theme/brand.ts` keeps pure blue off those.
    expect(BIB_BAND_FALLBACK).toBe(COLOR.blueInk);
    expect(bibBandColour(null)).toBe(BIB_BAND_FALLBACK);
    expect(bibBandColour(undefined)).toBe(BIB_BAND_FALLBACK);
  });

  it("refuses anything that is not a six-digit hex rather than passing it to a renderer", () => {
    // The column has a CHECK constraint, so none of these can be saved today. A colour is
    // cosmetic and a bib that will not print is not, so the fallback is the answer anyway.
    for (const bad of ["", "red", "#fff", "#12345", "#12345g", "rgb(0,0,0)", "#1b7f3b; drop"]) {
      expect(bibBandColour(bad), bad).toBe(BIB_BAND_FALLBACK);
    }
  });

  it("names the partners and then the club's mailbox", () => {
    expect(bibFooterLine(["Primăria Brașov", "Salvamont"], "contact@example.test")).toBe(
      "Primăria Brașov  ·  Salvamont  ·  contact@example.test",
    );
  });

  it("is empty rather than a row of separators when the club has filled in nothing", () => {
    expect(bibFooterLine([], null)).toBe("");
    expect(bibFooterLine([" ", ""], undefined)).toBe("");
    expect(bibFooterLine([], "contact@example.test")).toBe("contact@example.test");
    expect(bibFooterLine(["Salvamont"], null)).toBe("Salvamont");
  });
});
