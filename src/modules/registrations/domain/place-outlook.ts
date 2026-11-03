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
  /** The official waiting list: `WAITLISTED`, never a row outside the places. */
  waiting: number;
  /** The lines of «Lista internă (doar notițe)». */
  internal: number;
  /** Seated «Pe lista de invitați speciali» with a place outside the capacity (§643). */
  outside: number;
};

export type PlaceOutlook = PlaceOutlookCounts & {
  /** The places nobody holds; 0 when the capacity was lowered under the places taken. */
  free: number;
  /** The places taken by somebody who has not signed yet: a declaration to sign, an offer, a family's or an invitation's hold. */
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
  const fromWaiting = Math.min(counts.waiting, free);
  const fromInternal = Math.min(counts.internal, free - fromWaiting);
  return {
    ...counts,
    free,
    held: counts.occupied - counts.confirmed,
    fromWaiting,
    fromInternal,
    raises: counts.waiting - fromWaiting + (counts.internal - fromInternal),
    totalIfAll: counts.occupied + counts.outside + counts.waiting + counts.internal,
  };
}
