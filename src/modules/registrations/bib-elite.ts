import { ELITE_NAME_MAX } from "@/db/schema/event-elite-entries";
import { DomainError } from "@/shared/errors/domain-error";
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
  /** «Eticheta pe BIB» (§NNN): what prints where the number goes when the club typed one; null or absent, the name's first word. */
  bibLabel?: string | null;
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
 * «Eticheta pe BIB» (§NNN, amending §948 and §963; the owner, 2026-11-18, of the elite list: «vreau să customizez cum apare pe
 * BIB, dacă pun doar prenume sau cum afișez de fapt. Deci în dreptul fiecăruia vreau un „BIB Label” și să fie prenumele by
 * default»): what an elite bib prints where the number goes is a label per line — the one the Administrator typed, when there
 * is one, and otherwise the default below. Decided here once, for the sheet (`bibs-pdf.ts`), the picture (`bib-image.tsx`,
 * through the preview route) and every screen that says it (the elite card, the desk), so none of them can drift.
 */
function storedLabel(label: string | null | undefined): string | null {
  const typed = (label ?? "").trim().replace(/\s+/g, " ");
  return typed === "" ? null : typed;
}

/**
 * The default a line of the race's elite list prints (§963, amending §948; the owner, 2026-11-17: «la Ingrid de ce scrie și
 * prenumele???»): the first word of what the club typed, as a registration prints its first name alone — one word, large,
 * read from the roadside.
 */
export function eliteLineDefaultLabel(name: string): string {
  const first = name.trim().split(/\s+/)[0] ?? "";
  return first === "" ? name : first;
}

/**
 * The label a line of the race's elite list prints (§NNN): the line's own «Eticheta pe BIB» when the club typed one, else the
 * name's first word (`eliteLineDefaultLabel`).
 */
export function eliteLineBibName(name: string, bibLabel?: string | null): string {
  return storedLabel(bibLabel) ?? eliteLineDefaultLabel(name);
}

/**
 * The default a registration marked «Elită» prints where the number goes (§948, amending §897; the owner, 2026-11-15: «cele 6
 * elite … vor avea BIB-uri doar cu numele mic»): the person's **first name alone**, as the registration holds it — one word
 * prints large and is read from the roadside, a full name prints small. A row that keeps no first name (a registration from
 * before the two halves were stored) prints the registered name, as it did.
 */
export function eliteDefaultLabel(row: { firstName?: string | null; registeredName: string }): string {
  const first = (row.firstName ?? "").trim().replace(/\s+/g, " ");
  return first === "" ? row.registeredName : first;
}

/**
 * The label a registration marked «Elită» prints (§NNN): its own «Eticheta pe BIB» when the Administrator typed one, else the
 * first name (`eliteDefaultLabel`). A label kept while the mark is off is the same label when the mark comes back.
 */
export function eliteBibName(row: { eliteBibLabel?: string | null; firstName?: string | null; registeredName: string }): string {
  return storedLabel(row.eliteBibLabel) ?? eliteDefaultLabel(row);
}

/**
 * A typed «Eticheta pe BIB», ready to store (§NNN): trimmed, inner spaces collapsed to one — it is printed, and a double space
 * would print as a gap. Empty, or the very default the line prints anyway, stores null — back to the default, so a corrected
 * first name is followed again. Longer than `ELITE_NAME_MAX` is refused naming the box (`ELITE_LABEL_TOO_LONG`).
 */
export function parseEliteBibLabel(raw: unknown, defaultLabel: string, field = "eliteBibLabel"): string | null {
  const typed = storedLabel(typeof raw === "string" ? raw : "");
  if (typed === null || typed === defaultLabel) return null;
  if ([...typed].length > ELITE_NAME_MAX) {
    throw new DomainError("ELITE_LABEL_TOO_LONG", `a label of at most ${ELITE_NAME_MAX} characters`, [field]);
  }
  return typed;
}

/** The elite bib's name and number in the number's area, measured in the bold type both renderers embed. */
export function bibElite(name: string, options: { area: number; scale: number; number: boolean }): BibEliteLayout {
  return bibEliteLayout(name, options, bibTitleWidth);
}
