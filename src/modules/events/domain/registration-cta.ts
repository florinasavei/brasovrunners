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

import { startHeldBack } from "./dated";
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
  /**
   * How many more the waiting list takes (`registrations/domain/waitlist.ts#waitlistRoom`, §348),
   * or null — or absent — when it has no limit. Read with `availablePlaces`, under the same
   * condition: only once the places are gone does the line matter.
   */
  waitlistRoom?: number | null;
  /** The limit itself: 0 is an event with no waiting list at all; null or absent, no limit. */
  waitlistCapacity?: number | null;
  /** How many are in the waiting list's line now (§587), from the same count; absent is nought. */
  waiting?: number;
  /**
   * The line's two halves while places are free (§612, amending §587): the offers still open and the
   * people waiting with no offer yet (`readPublicPlaces`'s `offered` and `waitlisted`); absent is
   * nought, as in a cache entry written before they were counted.
   */
  offered?: number;
  waitlisted?: number;
  /**
   * «Arată public câți așteaptă» (§NNN): false withholds the people waiting from what the door says —
   * `waitlisted` on `OPEN` is said as nought and `waiting` on `FULL` as null. Absent is on, today's
   * sentences. It changes no decision: who queues is still read from the counts above.
   */
  waitlistCountPublic?: boolean;
};

export type RegistrationCta =
  /** No control at all: the club has not asked anybody to sign up for this one. */
  | { kind: "NONE" }
  | { kind: "EXTERNAL"; url: string; provider: string | null }
  | { kind: "CANCELLED" }
  /** The race is over (§82): "it has ended", and no control. */
  | { kind: "COMPLETED" }
  /** `opensAt` is null when the organizer announced "soon" with no date (§451). */
  | { kind: "NOT_YET_OPEN"; opensAt: Date | null }
  | { kind: "CLOSED" }
  /**
   * `availablePlaces` is null for an uncapped event — open, with no number to show. `offered` and
   * `waitlisted` say the line (§615): «1 loc oferit din lista de așteptare» for a place promised to
   * somebody in the line, «2 pe lista de așteptare» for the people with no offer yet — never the
   * person offered counted as still waiting.
   *
   * `fromWaitlist` (§615): somebody is waiting in the line, so a newcomer joins it whatever is free
   * (`registrations/domain/waitlist.ts#newcomerJoinsLine`, the allocator's own rule). The door is the
   * waiting list's — its words and its glyph, as `FULL` — and the free places are not advertised:
   * «Locurile se dau din lista de așteptare» stands where «N locuri libere din C» stood. False with
   * nobody waiting — an open offer alone included, since its holder has a place: today's line and door.
   *
   * `waitlisted` is the number the door may SAY: nought when the club keeps the count private (§NNN),
   * whatever the line holds — `fromWaitlist` is decided before, from the real count.
   */
  | { kind: "OPEN"; availablePlaces: number | null; offered: number; waitlisted: number; fromWaitlist: boolean }
  /**
   * No place, and the waiting list takes people: its button. `waitlistRoom` is how many more it
   * takes when it has a limit (§348) — "Mai sunt 3 locuri pe lista de așteptare" — and null when
   * it has none, which says no number, as today.
   *
   * `waiting` is the line's length the lead may say, or null when the club keeps it private (§NNN): the
   * lead is then «Mulțumim! Toate cele 150 de locuri s-au ocupat. Intră pe lista de așteptare.», which
   * says neither a number nor «Fii primul» (which would say nought). The room stays: it is a fact about
   * the list's size, like the capacity (§32's reasoning), not a count of people.
   */
  | { kind: "FULL"; waitlistRoom: number | null; waiting: number | null }
  /** No place and the waiting list at its limit (§348): a sentence, no button. */
  | { kind: "WAITLIST_FULL" }
  /** No place on an event with no waiting list (a limit of 0, §348): closed as full, no button. */
  | { kind: "FULL_NO_WAITLIST" };

/**
 * Whether a newcomer would be sent to the waiting list on this event (§615): no free place, or
 * somebody waiting in the line — a person with no place yet, or in a cache entry written before the
 * halves were counted, the line's length alone (§587). The card and the registration form ask it
 * alike, so neither says what the allocator will not do.
 */
export function newcomerWouldQueue(places: { availablePlaces: number | null; waitlisted?: number; waiting?: number }): boolean {
  return places.availablePlaces === 0 || (places.waitlisted ?? places.waiting ?? 0) > 0;
}

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
      // returned when `now` is before it — so the date shown is always a real one. «În curând»
      // (§451) has no date at all, and says so with null rather than a date it does not have.
      // «În curând» (§451), or a date still to be announced (§533): no opening date to name.
      if (event.registrationOpensSoon || startHeldBack(event) || event.startsAt === null) return { kind: "NOT_YET_OPEN", opensAt: null };
      return { kind: "NOT_YET_OPEN", opensAt: (event.registrationOpensAt ?? event.publishedAt) as Date };

    case "CLOSED":
      return { kind: "CLOSED" };

    case "OPEN": {
      const offered = event.offered ?? 0;
      /*
        «Arată public câți așteaptă» off (§NNN): the people waiting are said as nobody — the card's and the
        page's «N pe lista de așteptare» go, the offered places and «Locurile se dau din lista de așteptare»
        stay. Applied here, once, so no surface can forget it; the door below is still chosen from the
        real count. The public list's own waiting group («Cine vine», `StartList.tsx`) is §628's switch,
        not this one: with the names published, how many they are is visible by nature.
      */
      const countPublic = event.waitlistCountPublic !== false;
      const waitlisted = countPublic ? (event.waitlisted ?? 0) : 0;
      /*
        Somebody waiting (§615): a person in the line with no place yet — or, in a cache entry written
        before the halves were counted, the line's length alone (§587), until it next expires. Then a
        newcomer joins the line whatever is free (`newcomerJoinsLine`), so the door is the line's. The
        same rule the allocator follows, so the door never promises what the press will not give.
      */
      const fromWaitlist = (event.waitlisted ?? event.waiting ?? 0) > 0;
      // Zero free places is the waiting list, not a refusal: BR-REQ-035-01. `null` is an
      // uncapped event, which is never full.
      if (event.availablePlaces !== 0 && !fromWaitlist) {
        return { kind: "OPEN", availablePlaces: event.availablePlaces, offered, waitlisted, fromWaitlist: false };
      }
      // …unless the event keeps no waiting list, or keeps one that is full (§348): then there is
      // nothing to join, and a button would lead to a form that refuses at the end of it — with
      // places free too, since a newcomer is not given one past the line (§615).
      if (event.waitlistCapacity === 0) return { kind: "FULL_NO_WAITLIST" };
      if (event.waitlistRoom === 0) return { kind: "WAITLIST_FULL" };
      // Places free while somebody is in the line (§615): open, through the line's door.
      if (event.availablePlaces !== 0) return { kind: "OPEN", availablePlaces: event.availablePlaces, offered, waitlisted, fromWaitlist: true };
      return { kind: "FULL", waitlistRoom: event.waitlistRoom ?? null, waiting: countPublic ? (event.waiting ?? 0) : null };
    }

    case "NOT_APPLICABLE":
      return { kind: "NONE" };
  }
}

/** How full a capped event is, in the two numbers a visitor reads beside the button (§346). */
export type PublicFill = {
  taken: number;
  capacity: number;
  /**
   * The confirmed registrations among `taken` (§615), when the occupied count is known: `taken - confirmed`
   * are in progress — a pending declaration, an open offer, a family's hold. Absent when the count is
   * unknown (a cache entry from before it).
   */
  confirmed?: number;
  /**
   * The free places the waiting list has a claim on (§615, §617): the capacity less the free places the
   * button shows less `taken`. Absent when nought or unknown — and, with the count kept private (§NNN),
   * while places are still free, since it is then exactly the number of people waiting.
   */
  kept?: number;
  /**
   * The people waiting in the line with no offer yet (§629, `readPublicPlaces`'s `waitlisted`): the places
   * line's last part, «10 pe lista de așteptare», so the number is present wherever the line shows. From
   * the same count the door already reads — no query of its own, and the same one every public count is
   * (a `TEST` row stands in the line as a real one, `AGENTS.md` §12.6; production has none). Absent when
   * nobody waits, and in a cache entry from before the halves were counted — and absent too when the
   * club keeps the count private (§NNN, `waitlistCountPublic: false`): the line then ends where it did.
   */
  waitlisted?: number;
};

/**
 * "12 înscriși din 50 de locuri" — the free places read the other way round (§346; the owner:
 * "I need to show the total number registered out of the available places").
 *
 * **Not a second count.** The first number is the occupied count the free places are built on
 * (`occupiedForNewcomer`, from `readPublicAvailability`, the allocator's own formula, AGENTS.md
 * §10.6), at most the capacity: confirmed places and held places (a declaration still to sign, a
 * waiting-list offer still open, a family's hold). The waiting list's claim on free places is not
 * in it; it is reported separately as `kept = (capacity - free) - occupied`, floored at nought, so
 * taken + kept + free = capacity whenever a free line shows and the lines beside the button never
 * disagree. An entry cached before the counts existed falls back to capacity - free. A form sent
 * but not yet confirmed by email takes no place and is not counted (BR-REQ-034-01 criterion 5).
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
export function publicFill(
  capacity: number | null,
  availablePlaces: number | null,
  held?: { occupied?: number; confirmed?: number; waitlisted?: number; waitlistCountPublic?: boolean },
): PublicFill | null {
  if (capacity === null || availablePlaces === null) return null;
  const claimed = Math.min(Math.max(capacity - availablePlaces, 0), capacity);
  // The line's length, the places line's last part (§629): only when anybody waits, and only while the
  // club says it publicly (§NNN) — off, «, 10 pe lista de așteptare» is not drawn; every other part stays.
  const said = held?.waitlistCountPublic !== false;
  const waiting = said && held?.waitlisted !== undefined && held.waitlisted > 0 ? { waitlisted: held.waitlisted } : {};
  /*
    The first number is the occupied count in every state (§615): the registrations holding places,
    confirmed and in progress — the count `availablePlaces` is built on — never the capacity less the
    free places, which also holds the waiting list's claim on free places (§617). That claim is `kept`,
    its own part of the clause, so «6 înscriși din 10 locuri — 4 confirmați, 2 în curs, 4 păstrate» adds up.
    An entry cached before the counts existed has only the free places: the plain line.
  */
  if (held?.occupied === undefined || held.confirmed === undefined) return { taken: claimed, capacity, ...waiting };
  const taken = Math.max(Math.min(held.occupied, capacity), 0);
  const confirmed = Math.min(held.confirmed, taken);
  /*
    The count kept private (§NNN): while places are still free beside the line, the places kept for it
    are exactly the people waiting (the formula keeps one free place per person waiting), so the part is
    withheld with the count. Once no place is free, kept is every free place the line claims — a number
    about places, the line being at least as long — and it stays, so the line still adds up to «Toate
    cele 10 locuri s-au ocupat» above it (§615's consistency).
  */
  const kept = said || availablePlaces === 0 ? Math.max(claimed - taken, 0) : 0;
  return { taken, capacity, confirmed, ...(kept > 0 ? { kept } : {}), ...waiting };
}
