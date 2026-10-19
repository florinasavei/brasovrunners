/**
 * The route's checkpoints on a race number's profile strip (§757, amending §750; the owner, 2026-10-13:
 * «I need to put checkpoints and limit times», and on the bib: «nu pot să văd unde e punctul de
 * alimentare pe acel număr»; amended §804: the strip draws from the same elevation core as the event's page,
 * and a checkpoint the club unticked «Arată pe profilul traseului» is on neither).
 *
 * This file decides **which** checkpoints the strip pins and **what each says**; **where** they stand, their
 * glyphs, their heads' rows and which words fit is the core's (`routes/elevation/geometry.ts`, asked once by
 * `bib-profile-strip.ts` for both renderers). Each pin is the kind's glyph in a ring above the plot — a drop for
 * water, a fork for food, a cross for first aid, a stopwatch for timing, an arrow for direction, three people for
 * a point where the group regroups (§NNN: first of them all; its label is still only what a runner may take, «km 12» when that is nothing; but between two points that would touch, an aid station keeps the older rule — a regroup point within a pin's reach of one gives way to it, while a point that is both keeps the group's glyph), a dot for a point that offers none — with a stem down to the plot's foot, and under the stem, in the foot row of «Start» and
 * «Sosire»:
 *
 * - with «…cu orele limită» off, **«km 5 · apă»** or **«km 9 · hrană»** (both: «km 5 · apă + hrană») for an aid
 *   station, plain **«km 12»** for any other point;
 * - with it on, **«km 12 · 11:30»** — the cut-off beside the point, as §757 — and a point with no cut-off says «km 12».
 *
 * **The crowding rule** (§757, kept): the words go before the pins, the times before the kilometres — the cut-offs
 * are printed only when **every** label then fits (`bib-profile-strip.ts` asks the core twice: with the times, and if
 * one is dropped, without them all, since a number that says some cut-offs and not the others is read as the others
 * having none); without the times each label stays where it has room, left to right.
 *
 * Pure and importing nothing: no storage, no React.
 */

/**
 * A checkpoint as the strip reads it: where, what, and by when — the clock its time limit closes at (§770),
 * `HH:MM` on the event's clock, the same one the event page prints (`start.ts#cutoffClockOf`), null with no
 * limit or no start to count it from — and whether the club ticked it for the profile (`onProfile`; absent is on,
 * like the column's default).
 */
export type BibCheckpointSource = { km: number; kinds: readonly string[]; cutoffClock: string | null; onProfile?: boolean };

/** One checkpoint on the strip: where (the club's kilometre), what it offers, and the three ways the strip may say it. */
export type BibStripCheckpoint = {
  km: number;
  kinds: readonly string[];
  /** «km 5 · apă», «km 9 · hrană», «km 5 · apă + hrană» for an aid station, «km 12» for any other point: the words without the times. */
  label: string;
  /** «km 5 · apă + hrană»: the words of this point were it both a water and a food station — what two aid stations too close to pin apart say together. */
  bothLabel: string;
  /** «km 12»: the words of a point that has no cut-off while the cut-offs are printed. */
  kmLabel: string;
  /** «km 12 · 11:30», or null with no cut-off. */
  timeLabel: string | null;
};

/** The sheet's words for a checkpoint's label, from the catalogue (`Admin.bibs.checkpoint*`): every one fills in its kilometre. */
export type BibCheckpointWords = {
  km: (km: number) => string;
  kmWater: (km: number) => string;
  kmFood: (km: number) => string;
  kmBoth: (km: number) => string;
  kmTime: (km: number, clock: string) => string;
};

/** The aid station's own words: water and food say themselves, any other point only its kilometre. */
function aidLabel(km: number, kinds: readonly string[], words: BibCheckpointWords): string {
  const water = kinds.includes("WATER");
  const food = kinds.includes("FOOD");
  return water && food ? words.kmBoth(km) : water ? words.kmWater(km) : food ? words.kmFood(km) : words.km(km);
}

/**
 * The checkpoints to pin on a strip that spans `routeMeters`: the ones the club left ticked for the profile and that lie
 * within the printed distance (a point beyond the finish is not on this strip), by distance, ties in the order they came.
 */
export function bibStripCheckpoints(checkpoints: readonly BibCheckpointSource[], routeMeters: number, words: BibCheckpointWords): BibStripCheckpoint[] {
  if (!(routeMeters > 0)) return [];
  return checkpoints
    .filter((row) => row.onProfile !== false && row.km >= 0 && Math.round(row.km * 1000) <= Math.round(routeMeters))
    .map((row, at) => ({ row, at }))
    .sort((a, b) => a.row.km - b.row.km || a.at - b.at)
    .map(({ row }) => ({
      km: row.km,
      kinds: row.kinds,
      label: aidLabel(row.km, row.kinds, words),
      bothLabel: words.kmBoth(row.km),
      kmLabel: words.km(row.km),
      timeLabel: row.cutoffClock !== null ? words.kmTime(row.km, row.cutoffClock) : null,
    }));
}
