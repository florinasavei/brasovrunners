import { describe, expect, it } from "vitest";
import { ALLOWED, PINNED } from "./guards-allowlist";
import { byFile, holdRatchet, SOURCES, stringLiterals } from "./scan";

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
 * three, four, six or eight digits. The hex is told from an anchor by CONTEXT, not by its digits
 * (`#fff`, `#eee` and `#abcdef` are colours, and white and the greys are the commonest): a literal
 * that is the whole string, `"#fff"`, is a colour unless it is the value of an `href`, `to`, `id`
 * or `hash` attribute or property; inside a longer string a hex is a colour when it follows `:`,
 * `(`, `,` or a space in a CSS-like string (one with a `:` or `;`, or a `px` length or a border
 * style: `color:#eee`, `1px solid #ccc`). A hex with a digit in it, not preceded by a word
 * character, `&`, `/` or `=`, counts anywhere (`#1a73e8`; `href="#add"`, `/page#fff` and `&#8212;`
 * do not). A false alarm is one line in the allowlist, with its reason.
 *
 * A failure prints `file:line — the literal`.
 *
 * Today's offenders are in `guards-allowlist.ts` with a reason each — the list can only shrink
 * (the ratchet, `scan.ts`). To fix one: use a theme token, or add the colour to `brand.ts`.
 */
const THEME_FILES = new Set(["src/theme/brand.ts", "src/theme/brand-pairs.ts"]);
const FUNCTION = /\b(?:rgba?|hsla?)\(/;
const HEX = /(?<![\w&/=#])#([0-9a-fA-F]{3,8})\b/g;
const WHOLE = /^#([0-9a-fA-F]{3,8})$/;
const ANCHOR_NAMES = new Set(["href", "to", "id", "hash"]);
const CSS_LIKE = /[:;]|\d(?:px|em|rem)\b|\b(?:solid|dashed|dotted|inset)\b/;
const CSS_HEX = /(?<=[:(,\s])#([0-9a-fA-F]{3,8})\b/g;
const LENGTHS = [3, 4, 6, 8];

/** `name` is the attribute or property the literal is the value of, when it is one. */
export function isColour(text: string, name?: string): boolean {
  if (FUNCTION.test(text)) return true;
  const whole = WHOLE.exec(text);
  if (whole) return LENGTHS.includes(whole[1].length) && !(name && ANCHOR_NAMES.has(name));
  for (const match of text.matchAll(HEX)) {
    if (LENGTHS.includes(match[1].length) && /\d/.test(match[1])) return true;
  }
  if (CSS_LIKE.test(text)) {
    for (const match of text.matchAll(CSS_HEX)) if (LENGTHS.includes(match[1].length)) return true;
  }
  return false;
}

const offenders = byFile(
  SOURCES.filter((source) => !THEME_FILES.has(source.file)).flatMap((source) =>
    stringLiterals(source)
      .filter((literal) => isColour(literal.text, literal.name))
      .map((literal) => ({ file: source.file, line: literal.line, text: literal.text.length > 60 ? `${literal.text.slice(0, 57)}...` : literal.text })),
  ),
);

describe("§694 colours come from the theme", () => {
  it("reads strings, not comments — and finds a colour where there is one", () => {
    expect(isColour("0 0 0 9999px rgba(0,0,0,0.45)")).toBe(true);
    expect(isColour("color:#666;margin:0")).toBe(true);
    expect(isColour("#1b8a3a")).toBe(true);
    expect(isColour("#fff")).toBe(true);
    expect(isColour("#ffffff")).toBe(true);
    expect(isColour("color:#eee")).toBe(true);
    expect(isColour("1px solid #ccc")).toBe(true);
    expect(isColour("#add", "href")).toBe(false);
    expect(isColour("#add", "id")).toBe(false);
    expect(isColour("#samples")).toBe(false);
    expect(isColour("/ro/events#add")).toBe(false);
    expect(isColour("&#8212;")).toBe(false);
    expect(offenders.has("src/theme/brand.ts")).toBe(false);
    expect(isColour("go to #addition")).toBe(false);
    expect(SOURCES.length).toBeGreaterThan(500);
  });

  it("has no raw colour outside the theme but the reviewed ones", () => {
    holdRatchet("colours", offenders, ALLOWED.colours, PINNED.colours, "Use a theme token (`primary.main`, `text.secondary`) or add the colour to src/theme/brand.ts.");
  });
});
