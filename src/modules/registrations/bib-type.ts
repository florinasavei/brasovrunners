/**
 * What the bib's two measured texts share (§317, §NNN): the small print (`bib-footer.ts`, Roboto
 * Regular) and the header (`bib-header.ts`, Roboto Bold) are measured and cut the same way, so a fix
 * to the measure or to the cut reaches both.
 *
 * - **The measure** is a font's advance widths plus every pair it kerns *apart*, in ems: it errs wide
 *   by a hair and is never narrower than pdfkit or Satori sets the line (`fontWidth`).
 * - **The cut** keeps the longest beginning of a text that fits with «…» after it, without a dangling
 *   separator before the «…» (`withEllipsis`).
 *
 * Pure and importing nothing, so `bib-geometry.ts` (which imports nothing else) and `bib-footer.ts`
 * (which imports the geometry) can both take it without a cycle.
 */

/** Roboto's design grid: its advance widths are in 2048ths of an em. */
export const UNITS_PER_EM = 2048;

/** The one character a cut line ends in. */
export const ELLIPSIS = "…";

/**
 * A font's measure, in ems: each character's advance (`unknownUnits` for one outside the table — wider
 * than any glyph of the font with room for a kern on both its sides), plus the units of every pair of
 * neighbours the font kerns apart. Kerns are never negative here, so a longer prefix is never narrower.
 */
export function fontWidth(
  advances: ReadonlyMap<string, number>,
  kerning: ReadonlyMap<string, number>,
  unknownUnits: number,
): (text: string) => number {
  return (text) => {
    let units = 0;
    let previous = "";
    for (const character of text) {
      units += (advances.get(character) ?? unknownUnits) + (kerning.get(previous + character) ?? 0);
      previous = character;
    }
    return units / UNITS_PER_EM;
  };
}

/** The largest length in 0…`max` for which `ok` holds, by halving: `ok` shrinks as length grows. */
export function longestPrefix(max: number, ok: (length: number) => boolean): number {
  let low = 0;
  let high = max;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (ok(middle)) low = middle;
    else high = middle - 1;
  }
  return low;
}

/**
 * As much of `text` as fits with «…» after it, the characters `trailing` matches stripped before the
 * «…» — by default spaces and the small print's middle dot; the header passes its punctuation and dashes.
 * At worst the «…» alone.
 */
export function withEllipsis(text: string, fits: (text: string) => boolean, trailing: RegExp = /[\s·]+$/u): string {
  const characters = Array.from(text);
  const shortened = (length: number) => `${characters.slice(0, length).join("").replace(trailing, "")}${ELLIPSIS}`;
  return shortened(longestPrefix(characters.length, (length) => fits(shortened(length))));
}
