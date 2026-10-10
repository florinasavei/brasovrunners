import { describe, expect, it } from "vitest";
import { ALLOWED, PINNED } from "./guards-allowlist";
import { holdRatchet, SOURCES, stringTexts } from "./scan";

/**
 * BR-REQ-070-02, §694 — colour comes from the theme, never from a literal.
 *
 * The owner, 2026-10-10: «I need a design system so we can be consistent in terms of colours,
 * icons, components». Every hex of the site is a token in `src/theme/brand.ts` (and the PDF's in
 * `brand-pairs.ts` when it exists); a page asks the theme through `sx` (`"primary.main"`,
 * `"text.secondary"`), so dark mode, contrast (the AA pairs `brand.test.ts` pins) and a re-brand
 * cost one file. A raw `#1a73e8` or `rgba(0,0,0,0.5)` in a component is a colour the theme cannot
 * move and the contrast test cannot see.
 *
 * What it refuses, in a string or template literal of `src/` outside `brand.ts` (comments, regular
 * expressions and the migrations are never read): `rgb(`, `rgba(`, `hsl(`, `hsla(`, and a `#` hex of
 * three, four, six or eight digits. The hex heuristic, kept narrow so an anchor is not a colour:
 * not preceded by a word character, `&`, `/` or `=` (`href="#add"`, `/page#fff`, `&#8212;`), at
 * least one digit in it (`#add`, `#face` are words). A real colour that slips through is caught by review; a false alarm is one
 * line in the allowlist, with its reason.
 *
 * Today's offenders are in `guards-allowlist.ts` with a reason each — the list can only shrink
 * (the ratchet, `scan.ts`). To fix one: use a theme token, or add the colour to `brand.ts`.
 */
const THEME_FILES = new Set(["src/theme/brand.ts", "src/theme/brand-pairs.ts"]);
const FUNCTION = /\b(?:rgba?|hsla?)\(/;
const HEX = /(?<![\w&/=#])#([0-9a-fA-F]{3,8})\b/g;

function isColour(text: string): boolean {
  if (FUNCTION.test(text)) return true;
  for (const match of text.matchAll(HEX)) {
    const digits = match[1];
    if (![3, 4, 6, 8].includes(digits.length)) continue;
    if (!/\d/.test(digits)) continue;
    return true;
  }
  return false;
}

const offenders = new Set(
  SOURCES.filter((source) => !THEME_FILES.has(source.file))
    .filter((source) => stringTexts(source).some(isColour))
    .map((source) => source.file),
);

describe("§694 colours come from the theme", () => {
  it("reads strings, not comments — and finds a colour where there is one", () => {
    expect(isColour("0 0 0 9999px rgba(0,0,0,0.45)")).toBe(true);
    expect(isColour("color:#666;margin:0")).toBe(true);
    expect(isColour("#1b8a3a")).toBe(true);
    expect(isColour("#samples")).toBe(false);
    expect(isColour("/ro/events#add")).toBe(false);
    expect(isColour("&#8212;")).toBe(false);
    expect(offenders.has("src/theme/brand.ts")).toBe(false);
    expect(SOURCES.length).toBeGreaterThan(500);
  });

  it("has no raw colour outside the theme but the reviewed ones", () => {
    holdRatchet("colours", offenders, ALLOWED.colours, PINNED.colours, "Use a theme token (`primary.main`, `text.secondary`) or add the colour to src/theme/brand.ts.");
  });
});
