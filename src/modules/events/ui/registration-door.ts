import { unstable_rethrow } from "next/navigation";
import { cachedPublicAvailability } from "@/modules/public-cache/reads";
import { type PublicFill, publicFill, registrationCta, type RegistrationCta } from "../domain/registration-cta";
import { registrationState } from "../domain/registration-window";
import type { PublicEvent } from "../repository";

/**
 * What the one registration door says for an event right now: the state `registrationCta` picks,
 * and how full the event is — read once, for the event page's `RegistrationCta` and the listing
 * card's `CardRegistration` (§NNN) alike, so the two can never disagree about a race.
 *
 * `UNKNOWN` is the count that could not be read (§281): the caller shows no button, because a
 * button would lead to a form whose first act is the query that just failed.
 */
export type RegistrationDoor =
  | {
      kind: "KNOWN";
      cta: RegistrationCta;
      /** "12 înscriși din 50 de locuri" (§346): null for an uncapped event and every event not read. */
      fill: PublicFill | null;
    }
  | { kind: "UNKNOWN" };

/**
 * The door's state, from the one count there is (`AGENTS.md` §10.6).
 *
 * **Only an open internal event costs a read.** `capacity` is deliberately absent from the public
 * columns, so the count needs the internal row — and asking for it for every event, including the
 * ones that take no registration at all, would be round trips bought for nothing.
 *
 * The read is the public cache's (§333), and still the allocator's number for this instant: every
 * registration that moves expires it, and the one input the clock changes — a waiting-list offer
 * lapsing — is part of its key (`public-cache/reads.ts#cachedPublicAvailability`). The same entry
 * carries the event's size beside the free places (§346) and the waiting list's room and limit
 * (§348), off the same row the count was taken against, so neither line costs more. On the
 * listing that is one cached entry per open race card, and nothing for any other card (§NNN).
 */
export async function readRegistrationDoor(event: PublicEvent, now: Date): Promise<RegistrationDoor> {
  let availablePlaces: number | null = null;
  let capacity: number | null = null;
  let waitlistRoom: number | null = null;
  let waitlistCapacity: number | null = null;
  if (event.registrationMode === "INTERNAL" && registrationState(event, now) === "OPEN") {
    try {
      const availability = await cachedPublicAvailability(event.id, now);
      if (availability) {
        availablePlaces = availability.available;
        capacity = availability.capacity;
        waitlistRoom = availability.waitlistRoom;
        waitlistCapacity = availability.waitlistCapacity;
      }
    } catch (error) {
      /*
        The one thing on a page that is never served from a copy (§281).

        The rest of an event — the date, the place, the rules — is the same facts it was an hour
        ago, and showing the last copy of those during an outage costs a reader nothing. How many
        places are left is not like that: it is the number somebody decides on, the allocator is
        the only thing that knows it, and a stale "3 locuri libere" sends a person through a form
        to be refused at the end of it. So the caller says it cannot count, and the rest stands.
      */
      unstable_rethrow(error);
      console.error("[registration-door] could not read the availability", error);
      return { kind: "UNKNOWN" };
    }
  }

  return {
    kind: "KNOWN",
    cta: registrationCta({ ...event, availablePlaces, waitlistRoom, waitlistCapacity }, now),
    fill: publicFill(capacity, availablePlaces),
  };
}
