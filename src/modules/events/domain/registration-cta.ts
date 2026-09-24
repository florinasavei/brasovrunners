/**
 * What the one registration control on an event page says, and where it points.
 *
 * A pure function over the event's own columns, the free-place count the allocator's formula
 * produced, and `now` — AGENTS.md §1.5 requires that of every time-dependent rule, and this one
 * decides whether a visitor is offered a place, a waiting list, or nothing at all.
 *
 * It does not re-derive the window: `registrationState` is the single place that rule lives
 * (§10.1, BR-REQ-011-01), and this only translates that state, plus availability, into the one
 * thing the page renders.
 */

import { type RegistrationWindowInput, registrationState } from "./registration-window";

export type RegistrationCtaInput = RegistrationWindowInput & {
  externalRegistrationUrl: string | null;
  externalProvider: string | null;
  /**
   * The places a *new* registrant could receive right now
   * (`registrations/domain/capacity.ts#computePublicAvailability`), or `null` for an uncapped
   * event, where BR-REQ-034-01 criterion 4 says no number is shown at all. Only read when the
   * window is open; the caller does not have to count for an event nobody can enter.
   */
  availablePlaces: number | null;
};

export type RegistrationCta =
  /** No control at all: the club has not asked anybody to sign up for this one. */
  | { kind: "NONE" }
  | { kind: "EXTERNAL"; url: string; provider: string | null }
  | { kind: "CANCELLED" }
  /** The race is over (§82): "it has ended", and no control. */
  | { kind: "COMPLETED" }
  | { kind: "NOT_YET_OPEN"; opensAt: Date }
  | { kind: "CLOSED" }
  /** `availablePlaces` is null for an uncapped event — open, with no number to show. */
  | { kind: "OPEN"; availablePlaces: number | null }
  | { kind: "FULL" };

export function registrationCta(event: RegistrationCtaInput, now: Date): RegistrationCta {
  // An event nobody registers for gets no control and no explanation. `EventFacts` already
  // states the registration requirement in words; a second line saying the same thing is noise
  // on the one screen a phone gives (BR-REQ-041-01 criterion 2).
  if (event.registrationMode === "NONE") return { kind: "NONE" };

  switch (registrationState(event, now)) {
    case "EVENT_CANCELLED":
      // Cancelled outranks the window and outranks the mode, exactly as it does in
      // `registrationState`: a link that takes somebody to an organizer's entry form for a race
      // the club has called off is worse than no link.
      return { kind: "CANCELLED" };

    case "EVENT_COMPLETED":
      return { kind: "COMPLETED" };

    case "EXTERNAL":
      // The URL is required of an EXTERNAL event by `content/events/service.ts`, and a row that
      // somehow lacks one renders nothing rather than a button that goes nowhere.
      return event.externalRegistrationUrl
        ? { kind: "EXTERNAL", url: event.externalRegistrationUrl, provider: event.externalProvider }
        : { kind: "NONE" };

    case "NOT_YET_OPEN":
      // The same fallback the window rule uses: an absent opening means publication
      // (BR-REQ-011-01 criterion 4). One of the two is non-null here — `NOT_YET_OPEN` is only
      // returned when `now` is before it — so the date shown is always a real one.
      return { kind: "NOT_YET_OPEN", opensAt: (event.registrationOpensAt ?? event.publishedAt) as Date };

    case "CLOSED":
      return { kind: "CLOSED" };

    case "OPEN":
      // Zero free places is the waiting list, not a refusal: BR-REQ-035-01. `null` is an
      // uncapped event, which is never full.
      return event.availablePlaces === 0 ? { kind: "FULL" } : { kind: "OPEN", availablePlaces: event.availablePlaces };

    case "NOT_APPLICABLE":
      return { kind: "NONE" };
  }
}

/** How full a capped event is, in the two numbers a visitor reads beside the button (§NNN). */
export type PublicFill = { taken: number; capacity: number };

/**
 * "12 înscriși din 50 de locuri" — the free places read the other way round (§NNN; the owner:
 * "I need to show the total number registered out of the available places").
 *
 * **Not a second count.** `taken` is the event's places minus the free places the button
 * already shows, and those come from `readPublicAvailability`, the allocator's own formula
 * (AGENTS.md §10.6). So the two lines beside the button can never disagree — "12 of 50" beside
 * "38 places left" is one number read twice — and what "taken" means is exactly what the
 * formula means by occupied: confirmed places, held places (a declaration still to sign, a
 * waiting-list offer still open) and the waiting list's claim on anything free. A form sent but
 * not yet confirmed by email takes no place and is not counted (BR-REQ-034-01 criterion 5).
 *
 * It says nothing the page did not say already: with the free places public, the taken places
 * are the event's size minus them. What is new is the size, and the size is a fact about the
 * event, not about anybody — which is why the public event query still carries no capacity and
 * this is read from the row the free-place count already reads (`RegistrationCta`).
 *
 * `null` for an uncapped event, where the formula gives no free places either: BR-REQ-034-01
 * criterion 4 shows no number there, and a head count with no "out of" beside it would be a
 * count of people rather than of places — held places and all, which §32 declined to publish.
 *
 * Never more than the capacity and never below nought, whatever arrives: the formula clamps at
 * nought already, and this clamps again rather than print "51 of 50" from a row that lowered
 * its capacity under a hold between two reads.
 *
 * **A `TEST` registration counts here too**, because `readPublicAvailability` counts it: §12.6
 * says `kind` appears in neither the allocator nor the capacity formula, so a demonstration
 * registration holds a place exactly like a real one and this reads the same free-place number
 * the button does, deliberately, rather than a second, REAL-only count that could disagree with
 * it. That is only ever true where a `TEST` row can exist at all — never in production
 * (`modules/registrations/test-registrations.ts`) — so the figure a real visitor reads never
 * includes one. `tests/integration/registrations/test-kind.test.ts` proves the arithmetic
 * against a mixed REAL/TEST event on a real database, the same way it proves every other §30
 * property.
 */
export function publicFill(capacity: number | null, availablePlaces: number | null): PublicFill | null {
  if (capacity === null || availablePlaces === null) return null;
  const taken = Math.min(Math.max(capacity - availablePlaces, 0), capacity);
  return { taken, capacity };
}
