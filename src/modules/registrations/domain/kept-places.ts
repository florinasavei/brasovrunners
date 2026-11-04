import { DomainError } from "@/shared/errors/domain-error";
import type { EntryChannel } from "./waitlist";

/**
 * «Locuri păstrate pentru club» (§914; the owner, 2026-11-04: the site registers until capacity − kept, the rest
 * he gives himself), as pure rules over numbers a caller already has.
 *
 * **A threshold on the entry's channel, never a second capacity formula.** Of the event's capacity, K places are
 * the club's. A **public** entry — the form, its emailed link for another person, a family's form, a restart, the
 * confirmation of a row the form wrote — takes a place only while fewer than `capacity − K` are taken, and the
 * waiting list's automatic offers («Da») fill places only up to the same number. Every staff verb keeps the whole
 * capacity, as before. `computeOccupied` is untouched and `kind` appears nowhere (§30): K only ever lowers the
 * number a public entry and the line's automatic offers are compared with, so it can give the public fewer places,
 * never one more than the capacity.
 *
 * A place freed while `capacity − K` or more are taken stays the club's — a public runner's cancellation included —
 * so once the kept places are given out the reserve grows back as places free. On an uncapped event K means
 * nothing. 0, the column's default, changes nothing anywhere: every function here is then the identity.
 */
export type KeptPlacesEvent = {
  /** `events.capacity`: null is uncapped. */
  capacity: number | null;
  /** `events.places_kept_for_club`; absent on a row read without the column, which reads as 0. */
  placesKeptForClub?: number | null;
};

/** K as the allocator reads it: a whole number from 0 to the capacity, and 0 on an uncapped event. */
export function keptOf(event: KeptPlacesEvent): number {
  if (event.capacity === null) return 0;
  const kept = event.placesKeptForClub ?? 0;
  if (!Number.isFinite(kept)) return 0;
  return Math.min(Math.max(Math.trunc(kept), 0), Math.max(event.capacity, 0));
}

/**
 * The capacity an entry is measured against (§914): `capacity − K` for a public entry and for the line's automatic
 * offers, the whole capacity for every staff verb. Null stays null — an uncapped event has nothing to keep.
 */
export function capacityForEntry(event: KeptPlacesEvent & { channel: EntryChannel }): number | null {
  if (event.capacity === null) return null;
  return event.channel === "public" ? event.capacity - keptOf(event) : event.capacity;
}

/** The places the site announces (§914): `capacity − K` — «N înscriși din 165 de locuri». Null when uncapped. */
export function announcedCapacity(event: KeptPlacesEvent): number | null {
  return capacityForEntry({ ...event, channel: "public" });
}

/**
 * The site's room (§914): `capacity − K − occupied`, **not clamped** — below nought once the club has given kept
 * places, by how many of them are in use. Null on an uncapped event.
 */
export function lineRoom(event: KeptPlacesEvent & { occupied: number }): number | null {
  if (event.capacity === null) return null;
  return event.capacity - keptOf(event) - event.occupied;
}

/**
 * Whether the club's kept places are in use (§914): K > 0 and more places taken than the site announces
 * (`lineRoom` below nought). Then a lapsed hold released for a **public** newcomer would only give the club its place
 * back, never them one — so none is (`repository.ts#lapsedDeclarationHoldsToRelease`), and the public count does not
 * read the lapsed holds as free (`waitlist.ts#occupiedForNewcomer`). Always false with nothing kept.
 */
export function keptPlacesInUse(event: KeptPlacesEvent & { occupied: number }): boolean {
  return keptOf(event) > 0 && (lineRoom(event) ?? 0) < 0;
}

/**
 * The free places split in two (§914, «Locuri»): those the site still gives — `max(capacity − K − occupied, 0)` — and
 * the kept ones nobody holds — `min(K, max(capacity − occupied, 0))`. The two add up to the free places,
 * `max(capacity − occupied, 0)`, whatever the numbers. Both 0 on an uncapped event.
 */
export function freeSplit(event: KeptPlacesEvent & { occupied: number }): { publicFree: number; keptFree: number } {
  if (event.capacity === null) return { publicFree: 0, keptFree: 0 };
  const free = Math.max(event.capacity - event.occupied, 0);
  const keptFree = Math.min(keptOf(event), free);
  return { publicFree: free - keptFree, keptFree };
}

/**
 * The words' own question (§914): whether a place freed beside the line reaches it by itself. Only with no place kept:
 * with K > 0, a place freed while `capacity − K` or more are taken stays the club's, so «Te vom anunța dacă se
 * eliberează un loc» and «locul trece la următorul» would promise what the allocator does only sometimes — the
 * organizers' words («le dau organizatorii, pe rând») are the true ones. Never the allocator's gate, which stays
 * `waitlist.ts#offersOnItsOwn`: «Da» still offers the site's own places by itself.
 */
export function offerWordsByItself(offersOnItsOwn: boolean, event: KeptPlacesEvent): boolean {
  return offersOnItsOwn && keptOf(event) === 0;
}

/**
 * «Locuri păstrate pentru club» above the capacity (§914): refused, naming the box — on another date of a series (a
 * scoped save) the date too, in the event's zone. The database's CHECK says the same; this says it in the editor's
 * words before anything is written. Nothing is written by the refusal: the whole save is one transaction.
 */
export const PLACES_KEPT_ABOVE_CAPACITY = "PLACES_KEPT_ABOVE_CAPACITY";

export class PlacesKeptAboveCapacityError extends DomainError {
  /** The series' date the refusal is about (`YYYY-MM-DD` in the event's zone), or null for the event saved. */
  readonly date: string | null;

  constructor(kept: number, capacity: number, date: string | null = null) {
    super("VALIDATION_ERROR", `placesKeptForClub: ${kept} places kept is more than the ${capacity} places${date ? ` on ${date}` : ""}`, ["placesKeptForClub"]);
    this.name = "PlacesKeptAboveCapacityError";
    this.date = date;
  }
}

/** The refusal when `kept` is more than a capped event's places; nothing on an uncapped one, where 0 is stored. */
export function assertPlacesKeptWithin(capacity: number | null, kept: number, date: string | null = null): void {
  if (capacity !== null && kept > capacity) throw new PlacesKeptAboveCapacityError(kept, capacity, date);
}

/** The editor's code for that refusal — `_DATED` on another date of a series — and its date; null for any other error. */
export function placesKeptRefusalOf(error: unknown): { code: string; date: string | null } | null {
  if (!(error instanceof PlacesKeptAboveCapacityError)) return null;
  return { code: error.date ? `${PLACES_KEPT_ABOVE_CAPACITY}_DATED` : PLACES_KEPT_ABOVE_CAPACITY, date: error.date };
}
