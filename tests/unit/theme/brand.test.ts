import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import messages from "@/../messages/ro.json";
import { COLOR, FONT, LOGO, WORDMARK } from "@/theme/brand";

/**
 * BR-REQ-070-02 criterion 4 — colour contrast meets the accessibility baseline.
 *
 * The palette is a placeholder, but "placeholder" is not a reason to ship unreadable text: the
 * pairs below are the ones the pages actually render, and each is asserted against the WCAG
 * 2.1 AA threshold. When the club's t-shirt colours replace these values, this test is what
 * says whether they can be used as-is or need a darkened variant for text.
 *
 * The full audit of criterion 4 is an e2e concern (`seo.spec.ts`, not built). This covers the
 * half that is decidable from the tokens alone, which is the half that a brand swap breaks.
 */

/** WCAG 2.1 relative luminance. */
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

describe("BR-REQ-070-02 the palette is readable", () => {
  it("computes a known ratio, so the helper itself is not the thing under test", () => {
    // Black on white is 21:1 exactly.
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
  });

  const bodyText: [string, string, string][] = [
    ["body text on the page", COLOR.ink, COLOR.paper],
    ["body text on a card", COLOR.ink, COLOR.surface],
    ["field labels on the page", COLOR.inkMuted, COLOR.paper],
    ["field labels on a card", COLOR.inkMuted, COLOR.surface],
    ["the club blue as text on the page", COLOR.blue, COLOR.paper],
    ["the club blue as text on a card", COLOR.blue, COLOR.surface],
    ["the hover shade on the page", COLOR.blueInk, COLOR.paper],
    ["the hover shade on a card", COLOR.blueInk, COLOR.surface],
    ["button text on the primary colour", COLOR.paper, COLOR.blue],
    ["text on the secondary colour", COLOR.ink, COLOR.orange],
  ];

  for (const [label, foreground, background] of bodyText) {
    it(`clears AA for ${label}`, () => {
      expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(4.5);
    });
  }

  it("records that the secondary colour is a surface, not a text colour", () => {
    // 2.64:1 on the page background. The theme uses it the only way it works — as a fill with
    // dark text on top, which is the `ink on orange` pair above at 6.25:1. This assertion is
    // here so that colouring text with it looks like breaking a rule rather than picking a
    // colour, and so the same question gets asked of the club's real secondary.
    expect(contrastRatio(COLOR.orange, COLOR.paper)).toBeLessThan(4.5);
  });

  it("keeps the surface distinguishable from the page behind it", () => {
    // Not a WCAG threshold — cards are separated by a border as well. This only catches a
    // brand swap that makes `surface` and `paper` the same colour, which would flatten the
    // event list into one undifferentiated column.
    expect(COLOR.surface).not.toBe(COLOR.paper);
  });

  it("uses the blue the club's own logo file states", () => {
    // Every path in public/brand/logo.svg is filled with this value. If the club settles on
    // the t-shirt's navy instead, this and the SVG have to move together — a palette that
    // disagrees with the logo beside it is the one branding error everybody notices.
    expect(COLOR.blue).toBe("#0000ff");
  });

  it("uses six-digit hex everywhere, which the contrast helper assumes", () => {
    for (const [name, value] of Object.entries(COLOR)) {
      expect(value, name).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

describe("the brand assets the theme points at exist", () => {
  for (const [name, asset] of Object.entries(LOGO)) {
    it(`${name} resolves to a file in public/`, () => {
      // A renamed or moved asset is invisible in review and shows up as a broken image on the
      // club's own home page. `src` is root-relative, so it resolves under `public/`.
      const path = join(process.cwd(), "public", asset.src);
      expect(existsSync(path), asset.src).toBe(true);
      expect(readFileSync(path, "utf8")).toContain("<svg");
    });

    it(`${name} declares the viewBox its proportions are derived from`, () => {
      // The layout reserves space from width/height, and the browser fits the artwork to the
      // viewBox. If the two disagree the logo is letterboxed or stretched, which is invisible
      // in review and obvious on the club's home page.
      const svg = readFileSync(join(process.cwd(), "public", asset.src), "utf8");
      expect(svg).toContain(`viewBox="${asset.viewBox}"`);
      expect(asset.viewBox.split(" ").slice(2).join(" ")).toBe(`${asset.width} ${asset.height}`);
    });

    it(`${name} has a variant for dark grounds`, () => {
      // The artwork is a flat single colour, so it disappears on a dark background. The club
      // supplied a white version; this is the check that it is actually wired up.
      const path = join(process.cwd(), "public", asset.onDark);
      expect(existsSync(path), asset.onDark).toBe(true);
      expect(readFileSync(path, "utf8")).toContain(`viewBox="${asset.viewBox}"`);
    });
  }

  it("keeps the browser-tab icon identical to the mark", () => {
    // `src/app/icon.svg` is a Next file convention: nothing imports it, so a new mark in
    // public/brand/ leaves the old one in the tab and no compiler notices. This is the only
    // thing that does.
    const mark = readFileSync(join(process.cwd(), "public", LOGO.mark.src), "utf8");
    const icon = readFileSync(join(process.cwd(), "src", "app", "icon.svg"), "utf8");

    expect(icon).toBe(mark);
  });

  it("names a fallback stack, so a missing webfont does not fall back to Times", () => {
    expect(FONT.fallback).toMatch(/sans-serif$/);
  });

  describe("the header wordmark stays inside what the kit typeface can render", () => {
    it("is ASCII, because Facón contains no Romanian characters", () => {
      // Verified by reading the font's own cmap: 129 mapped characters, and not one of
      // ș ț ă â î in either the comma-below or the cedilla encoding. Writing "BRAȘOV" here
      // would not throw — it would silently render the Ș in the fallback font, one Roboto
      // letter in the middle of a Facón word. docs/brand/README.md has the full table.
      expect(WORDMARK).toMatch(/^[\x20-\x7e]+$/);
    });

    it("is the kit's logotype, not the club's name", () => {
      // The name, spelled properly, comes from the message catalogue and is what the header
      // link announces to a screen reader. These two are allowed to differ; that is the whole
      // point. If someone ever "corrects" the constant, the assertion above catches it.
      expect(WORDMARK).toBe("BRASOV RUNNERS");
      expect(messages.Site.name).toBe("Brașov Runners");
    });

    it("ships the font it is set in, with the licence beside it", () => {
      // next/font/local resolves this path at build time, so a rename breaks the build rather
      // than the page. The licence is asserted because the file is redistributed in every
      // deploy, and a font without its terms is the kind of thing nobody notices is missing.
      expect(existsSync(join(process.cwd(), "src/theme/fonts/Facon.ttf"))).toBe(true);
      expect(existsSync(join(process.cwd(), "src/theme/fonts/Facon-LICENSE.txt"))).toBe(true);
    });
  });
});
