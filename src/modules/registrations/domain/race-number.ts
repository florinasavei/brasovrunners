/**
 * Which number a runner actually has, and whether it can still move (`DECISIONS.md` §214).
 *
 * Two columns hold one fact. `bib_number` is settled — printed, emailed, never reissued — and
 * `provisional_bib_number` is the number held with the place until the registration window
 * closes. Every screen that shows "the race number" has to answer the same two questions, and
 * answering them in eight places is how one of them ends up showing a dash on race morning
 * because it only ever looked at the settled column.
 *
 * Pure, and over the two columns alone, so a list row, a desk row, a detail page and an export
 * can all ask it without any of them knowing how the numbering works.
 */

export type RaceNumber = {
  value: number;
  /** True once it is final: emailed, printable, and refused to any further change. */
  settled: boolean;
};

export function raceNumberOf(row: {
  bibNumber: number | null;
  provisionalBibNumber: number | null;
}): RaceNumber | null {
  // The settled one wins wherever both somehow exist: it is the one that has been sent out.
  if (row.bibNumber !== null) return { value: row.bibNumber, settled: true };
  if (row.provisionalBibNumber !== null) return { value: row.provisionalBibNumber, settled: false };
  return null;
}
