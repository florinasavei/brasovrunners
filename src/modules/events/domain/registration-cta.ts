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
