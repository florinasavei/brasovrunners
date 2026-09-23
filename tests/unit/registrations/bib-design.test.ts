import { describe, expect, it } from "vitest";
import {
  bandTextColour,
  BIB_BAND_FALLBACK,
  bibBandColour,
  bibDesignSchema,
  bibPictureUrl,
  DEFAULT_BIB_DESIGN,
  numberScaleFactor,
  readBibDesign,
} from "@/modules/registrations/bib-design";
import { BIB_FOOTER_SEPARATOR, bibFooterParts } from "@/modules/registrations/bib-footer";
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

  // Since §NNN the footer is the club's to compose (`bib-footer.test.ts`); the platform's own
  // design still prints exactly this.
  const footer = (partners: readonly string[], replyTo?: string | null) =>
    bibFooterParts(DEFAULT_BIB_DESIGN, { partners, replyTo, headerPicture: false }).join(BIB_FOOTER_SEPARATOR);

  it("names the partners and then the club's mailbox", () => {
    expect(footer(["Primăria Brașov", "Salvamont"], "contact@example.test")).toBe(
      "Primăria Brașov  ·  Salvamont  ·  contact@example.test",
    );
  });

  it("is empty rather than a row of separators when the club has filled in nothing", () => {
    expect(footer([], null)).toBe("");
    expect(footer([" ", ""], undefined)).toBe("");
    expect(footer([], "contact@example.test")).toBe("contact@example.test");
    expect(footer(["Salvamont"], null)).toBe("Salvamont");
  });
});

/**
 * BR-REQ-038-01, `DECISIONS.md` §249 — the club designs its own race number.
 *
 * Everything here is read by two renderers that cannot share a font size: `bibs-pdf.ts` prints
 * points on A4 and `bib-image.tsx` draws pixels for the screen. What they share is this file,
 * so the preview is a preview of the paper — and the rules below are the ones that would let
 * them drift, or let a bib fail to print at all.
 */
describe("DECISIONS.md §249 the bib's design", () => {
  it("reads an event nobody has designed as the platform's own", () => {
    expect(readBibDesign(null)).toEqual(DEFAULT_BIB_DESIGN);
    expect(readBibDesign(undefined)).toEqual(DEFAULT_BIB_DESIGN);
    expect(readBibDesign("nonsense")).toEqual(DEFAULT_BIB_DESIGN);
  });

  it("falls back setting by setting rather than refusing to print", () => {
    // A column written by an older release, a migration, or by hand. A bib that prints plainly
    // beats a bib that does not print, so nothing here throws.
    expect(readBibDesign({ numberScale: "enormous", showName: "yes", cutMarks: 1 })).toEqual(DEFAULT_BIB_DESIGN);
    expect(readBibDesign({ numberScale: "large", showDate: false })).toEqual({
      ...DEFAULT_BIB_DESIGN,
      numberScale: "large",
      showDate: false,
    });
  });

  it("takes a picture this site stored, and nothing else", () => {
    const ours = "https://pub-example.r2.dev/qa/3f2a1b4c-0000-4000-8000-000000000000/web.webp";
    const local = "/api/media/local/3f2a1b4c-0000-4000-8000-000000000000/web.webp";
    expect(readBibDesign({ headerImageSrc: ours }).headerImageSrc).toBe(ours);
    expect(readBibDesign({ sponsorImageSrc: local }).sponsorImageSrc).toBe(local);
    // A third party's address would be a request to somebody else's server on every print, and
    // a way to make this application fetch an arbitrary URL.
    for (const wrong of [
      "https://evil.example/logo.png",
      "https://pub-example.r2.dev/qa/not-a-uuid/web.webp",
      "data:image/png;base64,AAAA",
      "/api/media/local/3f2a1b4c-0000-4000-8000-000000000000/thumb.webp",
    ]) {
      expect(readBibDesign({ headerImageSrc: wrong }).headerImageSrc, wrong).toBeNull();
    }
  });

  it("refuses a setting nobody defined when the editor posts it", () => {
    // The panel posts exactly these fields; anything else is a form built by hand.
    expect(bibDesignSchema.safeParse({ ...DEFAULT_BIB_DESIGN, watermark: true }).success).toBe(false);
    expect(bibDesignSchema.safeParse(DEFAULT_BIB_DESIGN).success).toBe(true);
  });

  it("scales the number by a factor, so both renderers keep their own base size", () => {
    expect(numberScaleFactor({ ...DEFAULT_BIB_DESIGN, numberScale: "medium" })).toBe(1);
    expect(numberScaleFactor({ ...DEFAULT_BIB_DESIGN, numberScale: "small" })).toBeLessThan(1);
    expect(numberScaleFactor({ ...DEFAULT_BIB_DESIGN, numberScale: "large" })).toBeGreaterThan(1);
  });

  it("puts readable text on whatever colour the band is", () => {
    // A colour picker offers yellow, and white on yellow is the race nobody can read.
    expect(bandTextColour("#ffe14d")).toBe(COLOR.ink);
    expect(bandTextColour("#1a3a6b")).toBe(COLOR.surface);
    // The club's own blue, and anything that is not a colour at all, read as the fallback band.
    expect(bandTextColour(BIB_BAND_FALLBACK)).toBe(COLOR.surface);
    expect(bandTextColour("not a colour")).toBe(bandTextColour(BIB_BAND_FALLBACK));
  });

  it("makes a local picture absolute for a renderer, and leaves a stored address alone", () => {
    const base = "https://example.test";
    expect(bibPictureUrl("/api/media/local/x/web.webp", base)).toBe("https://example.test/api/media/local/x/web.webp");
    expect(bibPictureUrl("https://pub.example/x/web.webp", base)).toBe("https://pub.example/x/web.webp");
    expect(bibPictureUrl(null, base)).toBeNull();
  });

  it("still prints no telephone number in the footer", () => {
    // §180's rule, unchanged by anything above: a bib is worn in public.
    expect(bibFooterParts(DEFAULT_BIB_DESIGN, { partners: ["Primăria Brașov"], replyTo: "contact@example.test", headerPicture: false })).toEqual([
      "Primăria Brașov",
      "contact@example.test",
    ]);
  });
});

/**
 * §NNN — the footer's keys joined a column that already holds designs. Every design stored
 * before them must print its footer exactly as it did, and a key written wrong must fall back on
 * its own rather than take the rest of the design with it.
 */
describe("§NNN the footer's settings, read from whatever is stored", () => {
  const STORED_BEFORE = {
    showName: false,
    showEventTitle: true,
    showDate: true,
    showLogo: true,
    numberScale: "large",
    namePosition: "below",
    headerImageSrc: null,
    sponsorImageSrc: null,
    cutMarks: true,
  };

  it("reads a design stored before the footer keys existed as today's footer", () => {
    const design = readBibDesign(STORED_BEFORE);
    expect(design).toEqual({ ...DEFAULT_BIB_DESIGN, showName: false, numberScale: "large", cutMarks: true });
    expect(design.showEmail).toBe(true);
    expect(design.showPartners).toBe(true);
    expect(design.showWebsite).toBe(false);
    expect(design.showEventInFooter).toBe(false);
    expect(design.footerText).toBe("");
  });

  it("reads each footer key that is junk as its own default, and keeps the rest", () => {
    expect(
      readBibDesign({ ...STORED_BEFORE, showEmail: "no", showPartners: 0, showWebsite: "yes", showEventInFooter: null, footerText: 42 }),
    ).toEqual(readBibDesign(STORED_BEFORE));
    expect(readBibDesign({ showEmail: false, footerText: 42 })).toEqual({ ...DEFAULT_BIB_DESIGN, showEmail: false });
  });

  it("reads junk and nothing at all as the platform's design, footer included", () => {
    for (const junk of [null, undefined, "nonsense", 17, [], { footer: "x" }]) {
      expect(readBibDesign(junk), JSON.stringify(junk)).toEqual(DEFAULT_BIB_DESIGN);
    }
  });

  it("keeps the club's own line to one line of plain text the font can draw", () => {
    expect(readBibDesign({ footerText: "  Cronometraj:\n StartTime \t " }).footerText).toBe("Cronometraj: StartTime");
    expect(readBibDesign({ footerText: "x".repeat(300) }).footerText).toHaveLength(120);
    // Markup is text, drawn as the characters typed — never parsed, never a template.
    expect(readBibDesign({ footerText: "<b>{{participant}}</b>" }).footerText).toBe("<b>{{participant}}</b>");
    // An emoji is a box on the paper and a fetch in the preview, so it is left out.
    expect(readBibDesign({ footerText: "Urgențe \u{1F691} 0722 000 000" }).footerText).toBe("Urgențe 0722 000 000");
    // An "ș" typed as an "s" and a combining comma is the one letter the font has.
    expect(readBibDesign({ footerText: "Brașov" }).footerText).toBe("Brașov");
  });

  it("refuses a footer key nobody defined when the editor posts it, like every other key", () => {
    expect(bibDesignSchema.safeParse({ ...DEFAULT_BIB_DESIGN, footerLogo: true }).success).toBe(false);
  });

  it("reads past a stored key a later release added, and keeps the club's choices", () => {
    // A rollback after the club saved a newer design: the unknown key is ignored, not a reason to
    // print the platform's design instead of the club's.
    expect(readBibDesign({ ...STORED_BEFORE, showEmail: false, footerQr: true })).toEqual({
      ...DEFAULT_BIB_DESIGN,
      showName: false,
      numberScale: "large",
      cutMarks: true,
      showEmail: false,
    });
  });
});
