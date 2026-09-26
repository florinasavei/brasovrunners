/**
 * The spare bibs for on-the-spot entries (`DECISIONS.md` §NNN): a band of numbers the club prints
 * ahead with an empty name line, for the desk to hand to a walk-in with the name written on in
 * marker.
 *
 * Why a band of its own. On race morning a number the allocator draws for a walk-in is a number
 * nobody printed — the sheet went to the printer when registration closed — so the desk had a
 * runner at the table and no bib to give them. Pre-printed spares fix that only if the allocator
 * can never hand one of those numbers to somebody who registered online: the two people would
 * wear the same number. So the band is reserved: every automatic draw in `bibs.ts` treats it as
 * taken, and a number in it reaches a runner only when somebody at the desk chooses it.
 *
 * Pure and importing nothing, so the editor, the desk, the sheet and the allocator read one rule.
 */

/** At most this many spares per event: a sheet somebody prints, not a second race. The table's CHECK says it too. */
export const SPARE_BIBS_MAX = 500;

/** The highest number a bib may carry (five digits), as `setBibNumberByStaff` refuses anything above. */
export const BIB_NUMBER_MAX = 99_999;

export type SpareBand = { from: number; to: number };

/** The event's two columns as a band, or null when the club set none (or only half of one). */
export function spareBandOf(event: { bibSpareFrom: number | null; bibSpareTo: number | null }): SpareBand | null {
  if (event.bibSpareFrom === null || event.bibSpareTo === null) return null;
  if (event.bibSpareFrom > event.bibSpareTo) return null;
  return { from: event.bibSpareFrom, to: event.bibSpareTo };
}

/** Whether this number is one of the event's spares. */
export function isSpareNumber(band: SpareBand | null, number: number): boolean {
  return band !== null && number >= band.from && number <= band.to;
}

/** Every number of the band, lowest first. */
export function spareNumbersOf(band: SpareBand | null): number[] {
  if (!band) return [];
  return Array.from({ length: band.to - band.from + 1 }, (_, index) => band.from + index);
}

/** How many numbers the band holds. */
export function spareCountOf(band: SpareBand | null): number {
  return band ? band.to - band.from + 1 : 0;
}

/**
 * The band's numbers nobody is wearing or holding, lowest first — what the spares sheet prints and
 * what the desk suggests from. `taken` is every settled and provisional number at the event and
 * every erased one (`bibs.ts#erasedBibNumbers`): a spare already given is on somebody's chest.
 */
export function freeSpareNumbers(band: SpareBand | null, taken: ReadonlySet<number>): number[] {
  return spareNumbersOf(band).filter((number) => !taken.has(number));
}

/**
 * What the editor's two boxes may hold (§NNN): both or neither, each a whole number from 1 to
 * 99 999, the first no higher than the second, at most `SPARE_BIBS_MAX` of them. The refusal names
 * the box it is about, so the form can point at it (§47); null is a band the save may write.
 */
export function spareBandRefusal(
  from: number | null,
  to: number | null,
): { field: "bibSpareFrom" | "bibSpareTo"; reason: "half" | "order" | "size" } | null {
  if (from === null && to === null) return null;
  if (from === null) return { field: "bibSpareFrom", reason: "half" };
  if (to === null) return { field: "bibSpareTo", reason: "half" };
  if (from > to) return { field: "bibSpareTo", reason: "order" };
  if (to - from + 1 > SPARE_BIBS_MAX) return { field: "bibSpareTo", reason: "size" };
  return null;
}
