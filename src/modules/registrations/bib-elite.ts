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
export function bibEliteParts(design: Pick<BibDesign, "eliteSponsors">): { number: number | null; sponsors: boolean; stubs: boolean } {
  /*
    The name alone, never a number (§963; the owner, 2026-11-17: «la elite ți-am zis să nu printezi BIB! doar nume», and
    asked, «Doar numele, fără număr»): the design's old tick «Număr pe BIB-urile de elită» is read no more, and with no
    number there are no stubs to repeat it.
  */
  return { number: null, sponsors: design.eliteSponsors, stubs: false };
}

/**
 * The name a line of the race's elite list prints (§963, amending §948; the owner, 2026-11-17, of a line typed «Ingird
 * Mutter» beside registrations that print «Silviu», «Paul»: «la Ingrid de ce scrie și prenumele???»): the first word of what
 * the club typed, as a registration prints its first name alone — one word, large, read from the roadside.
 */
export function eliteLineBibName(name: string): string {
  const first = name.trim().split(/\s+/)[0] ?? "";
  return first === "" ? name : first;
}

/**
 * The name a registration marked «Elită» prints where the number goes (§948, amending §897; the owner, 2026-11-15: «cele 6
 * elite … vor avea BIB-uri doar cu numele mic: Silviu, Ingrid, Paul, Delia»): the person's **first name alone**, as the
 * registration holds it — one word prints large and is read from the roadside, a full name prints small. A row that
 * keeps no first name (a registration from before the two halves were stored) prints the registered name, as it did.
 *
 * Only a registration's bib: a line of the race's elite list (`elite-list.ts`) prints what the club typed, which is
 * where any other words go — a full name, a nickname. Decided here once, for the sheet and the picture alike.
 */
export function eliteBibName(row: { firstName?: string | null; registeredName: string }): string {
  const first = (row.firstName ?? "").trim().replace(/\s+/g, " ");
  return first === "" ? row.registeredName : first;
}

/** The elite bib's name and number in the number's area, measured in the bold type both renderers embed. */
export function bibElite(name: string, options: { area: number; scale: number; number: boolean }): BibEliteLayout {
  return bibEliteLayout(name, options, bibTitleWidth);
}
