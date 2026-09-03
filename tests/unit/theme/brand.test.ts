import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { COLOR, FONT, LOGO } from "@/theme/brand";

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
    ["a link on the page", COLOR.greenInk, COLOR.paper],
    ["a link on a card", COLOR.greenInk, COLOR.surface],
    ["button text on the primary colour", COLOR.paper, COLOR.green],
    ["text on the secondary colour", COLOR.ink, COLOR.orange],
  ];

  for (const [label, foreground, background] of bodyText) {
    it(`clears AA for ${label}`, () => {
      expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(4.5);
    });
  }

  it("keeps the surface distinguishable from the page behind it", () => {
    // Not a WCAG threshold — cards are separated by a border as well. This only catches a
    // brand swap that makes `surface` and `paper` the same colour, which would flatten the
    // event list into one undifferentiated column.
    expect(COLOR.surface).not.toBe(COLOR.paper);
  });

  it("is not MUI's default blue", () => {
    // AGENTS.md §3.2: the site must never read as an admin template.
    expect([COLOR.green, COLOR.orange]).not.toContain("#1976d2");
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

    it(`${name} declares the dimensions the header reserves`, () => {
      const svg = readFileSync(join(process.cwd(), "public", asset.src), "utf8");
      expect(svg).toContain(`viewBox="0 0 ${asset.width} ${asset.height}"`);
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
});
