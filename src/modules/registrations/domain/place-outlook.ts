import { freeSplit } from "./kept-places";

/**
 * «Locuri» under the registrations list's counts, for one event with a capacity (the owner, 2026-11-03:
 * «fă niște update-uri pe site să văd mai clar asta, nu să mă uit eu de fiecare dată» — how many places
 * are taken and free, who waits, how many can still be let in, and the total if everybody comes).
 *
 * Pure: the counts in, the outlook out. `occupied` is the allocator's own count (`computeOccupied`), so
 * the free places here are the ones the allocator would give; the special guests (§643) are beside it,
 * never in it. The free places go to the official waiting list first — it is the queue, in its order —
 * then to the lines of «Lista internă (doar notițe)» («Oferă-i un loc acum», §888); everybody left needs
 * one supplementary place each, which «Trimite-i oferta» and «Oferă-i un loc acum» add on a full race
 * (§642). A line of the internal list counts as one person: it is the one the move or the offer enters.
 */
export type PlaceOutlookCounts = {
  capacity: number;
  /** The places the allocator counts as taken (`computeOccupied`). */
  occupied: number;
  /** Of those, the confirmed (`OccupiedCounts.confirmed`: never a special guest). */
  confirmed: number;
  /**
   * The rest of `occupied`, by what holds each place until somebody signs (§906; the production review of
   * 2026-11-03: «13 = 9 declarații + 2 oferte + 2 invitații»), as `capacity.ts#placesTaken` names them from the
   * same count: a declaration to sign, an offer still open, an invitation not yet answered, a family's reservation.
   */
  declaration: number;
  offered: number;
  invited: number;
  family: number;
  /** The official waiting list: `WAITLISTED`, never a row outside the places. */
  waiting: number;
  /** The lines of «Lista internă (doar notițe)». */
  internal: number;
  /** Seated «Pe lista de invitați speciali» with a place outside the capacity (§643). */
  outside: number;
  /**
   * «Locuri păstrate pentru club» (§NNN): of the capacity, the places the site never gives. Optional, 0 when absent —
   * a caller from before it reads as nothing kept.
   */
  kept?: number;
  /** «Locurile libere le dau doar eu» in force (§906): the free places split says «le dai doar tu» for the site's part. */
  offersOnly?: boolean;
};

/** The kinds of a held place, in the order «Locuri» says them; each said only when it holds a place. */
export const HELD_KINDS = ["declaration", "offered", "invited", "family"] as const satisfies ReadonlyArray<keyof PlaceOutlookCounts>;

export type PlaceOutlook = PlaceOutlookCounts & {
  /** The places nobody holds; 0 when the capacity was lowered under the places taken. */
  free: number;
  /**
   * `free` split in two (§NNN, `kept-places.ts#freeSplit`): the site's own free places — what a visitor can still take —
   * and the kept ones nobody holds, the staff's to give. They add up to `free`; with nothing kept, `publicFree` is
   * `free` and `keptFree` 0. «Libere: 12 — 2 pe site, 10 păstrate pentru club». Present when the counts carried
   * `kept` (the reader always does); a caller from before it reads the plain free places.
   */
  publicFree?: number;
  keptFree?: number;
  /** The places taken by somebody who has not signed yet: the four kinds above, together. */
  held: number;
  /** How many of the official waiting list the free places take. */
  fromWaiting: number;
  /** How many lines of the internal list the places left after the waiting list take. */
  fromInternal: number;
  /** The supplementary places it would take to let in everybody left on both lists. */
  raises: number;
  /** Everybody, if everybody on both lists came: the places taken, the special guests and both lists. */
  totalIfAll: number;
};

export function placeOutlook(counts: PlaceOutlookCounts): PlaceOutlook {
  const free = Math.max(counts.capacity - counts.occupied, 0);
  // Who may give the free places is not where they go (§NNN): `fromWaiting` and `raises` stay on the whole capacity.
  const split = counts.kept === undefined ? {} : freeSplit({ capacity: counts.capacity, placesKeptForClub: counts.kept, occupied: counts.occupied });
  const fromWaiting = Math.min(counts.waiting, free);
  const fromInternal = Math.min(counts.internal, free - fromWaiting);
  return {
    ...counts,
    free,
    ...split,
    held: counts.occupied - counts.confirmed,
    fromWaiting,
    fromInternal,
    raises: counts.waiting - fromWaiting + (counts.internal - fromInternal),
    totalIfAll: counts.occupied + counts.outside + counts.waiting + counts.internal,
  };
}

/**
 * «Oameni la start dacă intră toți», with the race's separate elite list (§895) — names, not registrations, so outside
 * every place above and every list, but each at the start (the owner, 2026-11-04: «aș vrea să mă asigur că număr și
 * elitele»). A registered runner marked «Elită» is a registration, in `totalIfAll` already: never counted twice. The page
 * reads the list's length for its «Elite» fold; `totalIfAll` stays the places' own sum.
 */
export function peopleAtStartIfAll(outlook: Pick<PlaceOutlook, "totalIfAll">, elites: number): number {
  return outlook.totalIfAll + elites;
}
