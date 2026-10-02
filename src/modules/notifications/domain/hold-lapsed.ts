import { hasDirectAvailability } from "@/modules/registrations/domain/capacity";
import { newcomerJoinsLine, waitlistHasRoom } from "@/modules/registrations/domain/waitlist";

/**
 * What a person whose declaration hold lapsed can still do (§638), said by the
 * `DECLARATION_HOLD_EXPIRED` email in one sentence:
 *
 * - `register` — registration is open and a newcomer would get a place: «te poți înscrie din nou»;
 * - `waitlist` — registration is open, a newcomer would join the line, and the line takes them:
 *   «poți intra pe lista de așteptare»;
 * - `desk` — registration is closed, or the line is full or the event has none: nothing more online,
 *   and free places on the day are the desk's.
 *
 * Read when the message is rendered, not when it is queued: in the transaction that releases the hold,
 * the place is free for an instant before the same transaction offers it to the line
 * (`fillAvailableSpots`), so a reading taken there would say «te poți înscrie din nou» for a place that
 * is already somebody else's. The send follows the commit by seconds (§513), and reads the event as it
 * then stands, like every other fact of a message (§331, §629).
 *
 * Pure, over the allocator's own rules (`hasDirectAvailability`, `newcomerJoinsLine`,
 * `waitlistHasRoom`), so the sentence cannot promise what the form would refuse.
 */
export type HoldLapsedNext = "register" | "waitlist" | "desk";

export function holdLapsedNext(input: {
  /** `registrationState(event, now) === "OPEN"` — the public form takes a newcomer. */
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
}): HoldLapsedNext {
  if (!input.registrationOpen) return "desk";
  const direct =
    !newcomerJoinsLine({ waitlisted: input.waitlisted }) &&
    hasDirectAvailability({ capacity: input.capacity, occupied: input.occupied, eligibleWaitlisted: input.waitlisted });
  if (direct) return "register";
  return waitlistHasRoom({ waitlistCapacity: input.waitlistCapacity, waitlisted: input.waitlisted, openOffers: input.openOffers }) ? "waitlist" : "desk";
}
