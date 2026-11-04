import { hasDirectAvailability } from "@/modules/registrations/domain/capacity";
import { announcedCapacity } from "@/modules/registrations/domain/kept-places";
import { publicDoorOpen } from "@/modules/registrations/domain/public-door";
import { newcomerJoinsLine, publicEntryQueues, waitlistHasRoom } from "@/modules/registrations/domain/waitlist";

/**
 * What a person whose declaration hold lapsed can still do (§638), said by the
 * `DECLARATION_HOLD_EXPIRED` email in one sentence:
 *
 * - `register` — registration is open and a newcomer would get a place: «te poți înscrie din nou»;
 * - `waitlist` — registration is open, a newcomer would join the line, and the line takes them:
 *   «poți intra pe lista de așteptare»;
 * - `paused` — the dates say open, but «Înscrieri publice deschise» is unticked (§906): the site takes
 *   nobody, so no button — the card's own «oprite de organizatori», and «scrie-ne»;
 * - `offersOnly` — «Locurile libere le dau doar eu» (§906) with places free and a line that takes nobody:
 *   the places left are the organizers' to give, so no button either — the card's own words, and «scrie-ne»;
 * - `desk` — registration is closed, or the line is full or the event has none: nothing more online,
 *   and free places on the day are the desk's.
 *
 * Read when the message is rendered, not when it is queued: in the transaction that releases the hold,
 * the place is free for an instant before the same transaction offers it to the line
 * (`fillAvailableSpots`), so a reading taken there would say «te poți înscrie din nou» for a place that
 * is already somebody else's. The send follows the commit by seconds (§513), and reads the event as it
 * then stands, like every other fact of a message (§331, §629).
 *
 * Pure, over the allocator's own rules for a **public** entry — the person comes back through the site's
 * form (`hasDirectAvailability`, `newcomerJoinsLine` on the `public` channel, `waitlistHasRoom`) — and
 * the public door the card reads (`publicDoorOpen`), so the sentence cannot promise what the form would
 * refuse, nor a button the page does not draw.
 */
export type HoldLapsedNext = "register" | "waitlist" | "paused" | "offersOnly" | "desk";

export function holdLapsedNext(input: {
  /** `registrationState(event, now) === "OPEN"` — the window takes a newcomer by its dates. */
  registrationOpen: boolean;
  /** `events.capacity`: null is uncapped. */
  capacity: number | null;
  /** `computeOccupied(countOccupied(…))`. */
  occupied: number;
  /** `WAITLISTED` rows. */
  waitlisted: number;
  /** Offers still open. */
  openOffers: number;
  /** `events.waitlist_capacity`: null no limit, 0 no waiting list. */
  waitlistCapacity: number | null;
  /** «Înscrieri publice deschise» (`events.public_registration_open`, §906); absent is on, the column's default. */
  publicRegistrationOpen?: boolean | null;
  /** «Locurile libere le dau doar eu» (`events.free_places_by_offer_only`, §906); absent is off. */
  freePlacesByOfferOnly?: boolean | null;
  /** «Locuri păstrate pentru club» (`events.places_kept_for_club`, §914): a public entry is measured on the rest; absent is 0. */
  placesKeptForClub?: number | null;
}): HoldLapsedNext {
  if (!input.registrationOpen) return "desk";
  // The dates say open, the organizers say not on the site (§906): the card's `PAUSED`, never a button.
  if (!publicDoorOpen(input)) return "paused";
  const entry = { freePlacesByOfferOnly: input.freePlacesByOfferOnly === true, channel: "public" as const, capacity: input.capacity };
  // The site's places (§914): the capacity less those kept for the club, the allocator's threshold for a public entry.
  const free = hasDirectAvailability({ capacity: announcedCapacity(input), occupied: input.occupied, eligibleWaitlisted: input.waitlisted });
  if (!newcomerJoinsLine({ waitlisted: input.waitlisted, ...entry }) && free) return "register";
  if (waitlistHasRoom({ waitlistCapacity: input.waitlistCapacity, waitlisted: input.waitlisted, openOffers: input.openOffers })) return "waitlist";
  // Places free, given by the organizers alone, and nothing to join (§906): the card's `PAUSED` in its own words, not the desk's.
  return publicEntryQueues(entry) && free ? "offersOnly" : "desk";
}
