import { describe, expect, it } from "vitest";
import {
  newcomerWouldQueue,
  publicFill,
  registrationCta,
  type RegistrationCtaInput,
} from "@/modules/events/domain/registration-cta";

/**
 * BR-REQ-030-01 criterion 1 — an event that takes no registration offers no action.
 * BR-REQ-034-01 — the free-place count a visitor is shown, and the uncapped case that shows none.
 * BR-REQ-035-01 — a full open event offers the waiting list rather than a refusal.
 * BR-REQ-020-01 criterion 3 — a cancelled event never advertises a way in.
 *
 * One test per state the control can render. The whole registration lifecycle was reachable
 * only by typing its URL until this component existed, so "which state renders" is the rule
 * that had never been asserted anywhere.
 */
const START = new Date("2026-10-04T07:00:00Z");
const PUBLISHED = new Date("2026-09-01T10:00:00Z");
const DURING = new Date("2026-09-15T12:00:00Z");

function event(overrides: Partial<RegistrationCtaInput> = {}): RegistrationCtaInput {
  return {
    registrationMode: "INTERNAL",
    eventStatus: "SCHEDULED",
    startsAt: START,
    registrationOpensAt: null,
    registrationOpensSoon: false,
    registrationClosesAt: null,
    publishedAt: PUBLISHED,
    externalRegistrationUrl: null,
    externalProvider: null,
    availablePlaces: null,
    ...overrides,
  };
}

describe("BR-REQ-030-01 an event nobody registers for", () => {
  it("renders no control at all", () => {
    expect(registrationCta(event({ registrationMode: "NONE" }), DURING)).toEqual({ kind: "NONE" });
  });

  it("renders none even while the event is cancelled, so the page says it once", () => {
    // The page already carries a cancelled notice of its own; a second sentence under it adds
    // nothing to an event that never had a registration control.
    expect(
      registrationCta(event({ registrationMode: "NONE", eventStatus: "CANCELLED" }), DURING),
    ).toEqual({ kind: "NONE" });
  });
});

describe("registration held somewhere else", () => {
  it("carries the organizer's own link and their name", () => {
    const cta = registrationCta(
      event({
        registrationMode: "EXTERNAL",
        externalRegistrationUrl: "https://example.org/entries/1",
        externalProvider: "Example Timing",
      }),
      DURING,
    );

    expect(cta).toEqual({
      kind: "EXTERNAL",
      url: "https://example.org/entries/1",
      provider: "Example Timing",
    });
  });

  it("renders nothing rather than a button with nowhere to go", () => {
    // The service refuses to save an EXTERNAL event without a link, so this is a row that
    // arrived some other way — a migration, a seed, a hand-written UPDATE.
    expect(registrationCta(event({ registrationMode: "EXTERNAL" }), DURING)).toEqual({ kind: "NONE" });
  });
});

describe("BR-REQ-020-01 criterion 3 a cancelled event", () => {
  it("offers no way in, whatever the window says", () => {
    expect(registrationCta(event({ eventStatus: "CANCELLED" }), DURING)).toEqual({
      kind: "CANCELLED",
    });
  });

  it("does not send anyone to an external entry form either", () => {
    // Cancelled outranks the mode: the club has called the event off, and an organizer's form
    // that is still accepting entries is precisely the wrong place to send somebody.
    expect(
      registrationCta(
        event({
          eventStatus: "CANCELLED",
          registrationMode: "EXTERNAL",
          externalRegistrationUrl: "https://example.org/entries/1",
        }),
        DURING,
      ),
    ).toEqual({ kind: "CANCELLED" });
  });
});

describe("BR-REQ-011-01 the window, stated to a visitor", () => {
  it("names the opening moment before registration opens", () => {
    const opensAt = new Date("2026-09-20T06:00:00Z");
    expect(registrationCta(event({ registrationOpensAt: opensAt }), DURING)).toEqual({
      kind: "NOT_YET_OPEN",
      opensAt,
    });
  });

  it("falls back to the publication date when no opening was stated", () => {
    // BR-REQ-011-01 criterion 4: an absent opening means publication. The date shown is
    // therefore always a real one — never an empty sentence.
    const beforePublication = new Date("2026-08-30T00:00:00Z");
    expect(registrationCta(event(), beforePublication)).toEqual({
      kind: "NOT_YET_OPEN",
      opensAt: PUBLISHED,
    });
  });

  it("says «soon» with no date while the organizer has announced the opening without one (§451)", () => {
    // After publication, before the start: the window would be open but for the switch.
    expect(registrationCta(event({ registrationOpensSoon: true }), DURING)).toEqual({ kind: "NOT_YET_OPEN", opensAt: null });
    // The switch outranks a stray date too — the stricter of the two answers wins.
    expect(registrationCta(event({ registrationOpensSoon: true, registrationOpensAt: new Date("2026-09-10T06:00:00Z") }), DURING)).toEqual({
      kind: "NOT_YET_OPEN",
      opensAt: null,
    });
    // Cancelled still outranks everything.
    expect(registrationCta(event({ registrationOpensSoon: true, eventStatus: "CANCELLED" }), DURING)).toEqual({ kind: "CANCELLED" });
  });

  it("says registration is closed once the window has passed", () => {
    expect(registrationCta(event(), new Date(START.getTime() + 1000))).toEqual({ kind: "CLOSED" });
  });
});

describe("BR-REQ-034-01 an open event", () => {
  it("offers a place and states how many are left", () => {
    expect(registrationCta(event({ availablePlaces: 4 }), DURING)).toEqual({
      kind: "OPEN",
      availablePlaces: 4,
      offered: 0,
      waitlisted: 0,
      fromWaitlist: false,
    });
  });

  it("§615 carries the line's two halves while places are free, and gives the places from the line", () => {
    expect(registrationCta(event({ availablePlaces: 2, waiting: 3, offered: 1, waitlisted: 2 }), DURING)).toEqual({
      kind: "OPEN",
      availablePlaces: 2,
      offered: 1,
      waitlisted: 2,
      fromWaitlist: true,
    });
    // A cache entry written before the halves were counted: no halves to name, but the line's
    // length says somebody is in it, so the door is the line's all the same.
    expect(registrationCta(event({ availablePlaces: 2, waiting: 3 }), DURING)).toEqual({
      kind: "OPEN",
      availablePlaces: 2,
      offered: 0,
      waitlisted: 0,
      fromWaitlist: true,
    });
  });

  it("§615 gives the places from the line for people waiting, never for an open offer alone (its holder has a place)", () => {
    expect(registrationCta(event({ availablePlaces: 3, offered: 0, waitlisted: 1, waiting: 1 }), DURING)).toMatchObject({ kind: "OPEN", fromWaitlist: true });
    // An offer is not somebody waiting (§160, `newcomerJoinsLine`): the free places are a newcomer's, and say so.
    expect(registrationCta(event({ availablePlaces: 3, offered: 1, waitlisted: 0, waiting: 1 }), DURING)).toEqual({
      kind: "OPEN",
      availablePlaces: 3,
      offered: 1,
      waitlisted: 0,
      fromWaitlist: false,
    });
    // An uncapped event with somebody still waiting (a cap lifted while offers are the organizer's): the line's door too.
    expect(registrationCta(event({ availablePlaces: null, waitlisted: 2, waiting: 2 }), DURING)).toMatchObject({ kind: "OPEN", availablePlaces: null, fromWaitlist: true });
  });

  it("§615 offers nothing to join when the line in front of the free places is at its limit, or the event keeps no list", () => {
    // A newcomer is not given a free place past the line (`newcomerJoinsLine`), and the line takes nobody more.
    expect(registrationCta(event({ availablePlaces: 2, waitlisted: 3, waiting: 3, waitlistCapacity: 3, waitlistRoom: 0 }), DURING)).toEqual({ kind: "WAITLIST_FULL" });
    expect(registrationCta(event({ availablePlaces: 2, waitlisted: 1, waiting: 1, waitlistCapacity: 0, waitlistRoom: 0 }), DURING)).toEqual({ kind: "FULL_NO_WAITLIST" });
  });

  it("shows no number for an uncapped event", () => {
    // Criterion 4: no numeric count at all, rather than a count of something else.
    expect(registrationCta(event({ availablePlaces: null }), DURING)).toEqual({
      kind: "OPEN",
      availablePlaces: null,
      offered: 0,
      waitlisted: 0,
      fromWaitlist: false,
    });
  });
});

describe("BR-REQ-035-01 a full event", () => {
  it("offers the waiting list rather than refusing", () => {
    // No limit said — every event before §348, and every caller that does not pass one.
    expect(registrationCta(event({ availablePlaces: 0 }), DURING)).toEqual({ kind: "FULL", waitlistRoom: null, waiting: 0 });
  });

  it("is never full when it is uncapped", () => {
    // `null` is "no capacity", which is not the same number as zero — and reading it as one is
    // how an unlimited event would start turning people away.
    expect(registrationCta(event({ availablePlaces: null }), DURING).kind).toBe("OPEN");
  });
});

/**
 * BR-REQ-035-01 (§348) — the waiting list's length: its room under the button while it has
 * some, a sentence and no button once it is full, and an event with no line closed as full.
 */
describe("BR-REQ-035-01 a full event whose waiting list has a limit (§348)", () => {
  it("offers the waiting list with the room it has left", () => {
    expect(registrationCta(event({ availablePlaces: 0, waitlistCapacity: 10, waitlistRoom: 3 }), DURING)).toEqual({
      kind: "FULL",
      waitlistRoom: 3,
      waiting: 0,
    });
  });

  it("offers nothing to join once the line is full, and says so", () => {
    expect(registrationCta(event({ availablePlaces: 0, waitlistCapacity: 10, waitlistRoom: 0 }), DURING)).toEqual({
      kind: "WAITLIST_FULL",
    });
  });

  it("closes an event with no waiting list as full, without mentioning a line", () => {
    expect(registrationCta(event({ availablePlaces: 0, waitlistCapacity: 0, waitlistRoom: 0 }), DURING)).toEqual({
      kind: "FULL_NO_WAITLIST",
    });
  });

  it("ignores the line while places are free: a place is a place", () => {
    expect(registrationCta(event({ availablePlaces: 2, waitlistCapacity: 0, waitlistRoom: 0 }), DURING)).toEqual({
      kind: "OPEN",
      availablePlaces: 2,
      offered: 0,
      waitlisted: 0,
      fromWaitlist: false,
    });
  });

  it("leaves a closed or cancelled window as it was, whatever the line says", () => {
    const closed = event({ registrationClosesAt: new Date("2026-09-10T00:00:00Z"), availablePlaces: 0, waitlistRoom: 0, waitlistCapacity: 5 });
    expect(registrationCta(closed, DURING).kind).toBe("CLOSED");
    expect(registrationCta(event({ eventStatus: "CANCELLED", availablePlaces: 0, waitlistRoom: 0, waitlistCapacity: 0 }), DURING).kind).toBe("CANCELLED");
  });
});

describe("§615 publicFill — in progress counted from the occupied places, never from taken", () => {
  it("adds up on a full race with somebody waiting: occupied 150, confirmed 130", () => {
    expect(publicFill(150, 0, { occupied: 150, confirmed: 130 })).toEqual({ taken: 150, capacity: 150, confirmed: 130 });
  });

  it("makes the first number the occupied count when a line's claim zeroes the free places", () => {
    expect(publicFill(150, 0, { occupied: 105, confirmed: 86 })).toEqual({ taken: 105, capacity: 150, confirmed: 86, kept: 45 });
  });

  it("names the waiting list's claim as kept places: 4 confirmed, 2 pending, 4 waiting, capacity 10", () => {
    expect(publicFill(10, 0, { occupied: 6, confirmed: 4 })).toEqual({ taken: 6, capacity: 10, confirmed: 4, kept: 4 });
    expect(publicFill(10, 0, { occupied: 6, confirmed: 6 })).toEqual({ taken: 6, capacity: 10, confirmed: 6, kept: 4 });
  });

  it("keeps nothing on an open race, and never a negative claim", () => {
    expect(publicFill(150, 45, { occupied: 105, confirmed: 105 })).toEqual({ taken: 105, capacity: 150, confirmed: 105 });
    expect(publicFill(10, 5, { occupied: 6, confirmed: 6 })).toEqual({ taken: 6, capacity: 10, confirmed: 6 });
  });

  it("is the plain line when nothing is in progress, or the entry is older than the count", () => {
    expect(publicFill(150, 0, { occupied: 105, confirmed: 105 })).toEqual({ taken: 105, capacity: 150, confirmed: 105, kept: 45 });
    expect(publicFill(150, 45, { confirmed: 86 })).toEqual({ taken: 105, capacity: 150 });
    expect(publicFill(150, 45)).toEqual({ taken: 105, capacity: 150 });
  });
});

/**
 * §346 — how full a capped event is, read from the exact two numbers the button already uses:
 * never a second query, never a second formula.
 */
describe("§346 publicFill — capacity minus the allocator's own free-place count", () => {
  it("is nought taken when nobody has registered yet", () => {
    expect(publicFill(50, 50)).toEqual({ taken: 0, capacity: 50 });
  });

  it("reads some taken against the free places left", () => {
    expect(publicFill(50, 38)).toEqual({ taken: 12, capacity: 50 });
  });

  it("is the whole capacity taken when the free-place count is nought — BR-REQ-035-01's FULL", () => {
    expect(publicFill(50, 0)).toEqual({ taken: 50, capacity: 50 });
  });

  it("is null for an uncapped event, whatever the free-place count says", () => {
    // `readPublicAvailability` itself returns null for capacity === null, so this case is what
    // a real caller sees — but the clamp does not rely on that: it is null whichever side is.
    expect(publicFill(null, null)).toBeNull();
  });

  it("is null when the free-place count could not be read, even for a capped event", () => {
    // `RegistrationCta` leaves `availablePlaces` null on the one query it never serves stale
    // (§281) — the fill line disappears with the rest of the number rather than print a taken
    // count with no free-place count to have been derived from.
    expect(publicFill(50, null)).toBeNull();
  });

  it("never reads over capacity — clamped at both ends against an impossible row", () => {
    // The allocator's own formula cannot produce a negative free-place count or one above
    // capacity, but the clamp holds anyway rather than trust that between two reads of the row.
    expect(publicFill(50, 55)).toEqual({ taken: 0, capacity: 50 }); // more "free" than capacity
    expect(publicFill(50, -5)).toEqual({ taken: 50, capacity: 50 }); // a negative free count
  });
});

describe("§615 newcomerWouldQueue — the card's rule, which the registration form asks too", () => {
  it("is true with no free place, and with places free while somebody is WAITLISTED", () => {
    expect(newcomerWouldQueue({ availablePlaces: 0 })).toBe(true);
    expect(newcomerWouldQueue({ availablePlaces: 3, waitlisted: 1, waiting: 1 })).toBe(true);
  });

  it("reads a cache entry from before the halves were counted by the line's length", () => {
    expect(newcomerWouldQueue({ availablePlaces: 3, waiting: 2 })).toBe(true);
  });

  it("is false with places free and nobody waiting — an open offer alone included", () => {
    expect(newcomerWouldQueue({ availablePlaces: 3, waitlisted: 0, waiting: 1 })).toBe(false);
    expect(newcomerWouldQueue({ availablePlaces: 3 })).toBe(false);
  });
});
