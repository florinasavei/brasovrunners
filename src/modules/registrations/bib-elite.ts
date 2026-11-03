import type { BibDesign } from "./bib-design";
import { type BibEliteLayout, bibEliteLayout } from "./bib-geometry";
import { bibTitleWidth } from "./bib-header";

/**
 * An elite bib (§895): one name of the race's «Elită» list (`elite-list.ts`), printed where the number goes —
 * and, beside it, what the club's design says. Decided here once so the sheet (`bibs-pdf.ts`) and the picture
 * (`bib-image.tsx`) cannot drift; where everything sits is `bib-geometry.ts#bibEliteLayout`.
 */
export type BibEliteEntry = {
  /** The name as stored: trimmed, one space between words, 1 to 80 characters. */
  name: string;
  /** The line's own number, when the club typed one. */
  bibNumber: number | null;
};

/**
 * What an elite bib prints besides the name and the race's header, small print and extras:
 *
 * - `number` — the line's number, only while «Număr pe BIB-urile de elită» is ticked **and** the line has one;
 * - `sponsors` — the sponsors' row (the picture, and the stubs when ticked) only while «Banda de sponsori pe
 *   BIB-urile de elită» is ticked;
 * - `stubs` — the number at the row's two ends (§750) only where there is a row and a number to repeat.
 *
 * Never a name line under it, never a desk spare's blank mark, never the members' header or mark.
 */
export function bibEliteParts(design: Pick<BibDesign, "eliteNumber" | "eliteSponsors" | "numberStubs">, entry: Pick<BibEliteEntry, "bibNumber">) {
  const number = design.eliteNumber && entry.bibNumber !== null ? entry.bibNumber : null;
  const sponsors = design.eliteSponsors;
  return { number, sponsors, stubs: sponsors && design.numberStubs && number !== null };
}

/** The elite bib's name and number in the number's area, measured in the bold type both renderers embed. */
export function bibElite(name: string, options: { area: number; scale: number; number: boolean }): BibEliteLayout {
  return bibEliteLayout(name, options, bibTitleWidth);
}
