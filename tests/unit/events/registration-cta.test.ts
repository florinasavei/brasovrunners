import { describe, expect, it } from "vitest";
import {
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

  it("says registration is closed once the window has passed", () => {
    expect(registrationCta(event(), new Date(START.getTime() + 1000))).toEqual({ kind: "CLOSED" });
  });
});

describe("BR-REQ-034-01 an open event", () => {
  it("offers a place and states how many are left", () => {
    expect(registrationCta(event({ availablePlaces: 4 }), DURING)).toEqual({
      kind: "OPEN",
      availablePlaces: 4,
    });
  });

  it("shows no number for an uncapped event", () => {
    // Criterion 4: no numeric count at all, rather than a count of something else.
    expect(registrationCta(event({ availablePlaces: null }), DURING)).toEqual({
      kind: "OPEN",
      availablePlaces: null,
    });
  });
});

describe("BR-REQ-035-01 a full event", () => {
  it("offers the waiting list rather than refusing", () => {
    // No limit said — every event before §NNN, and every caller that does not pass one.
    expect(registrationCta(event({ availablePlaces: 0 }), DURING)).toEqual({ kind: "FULL", waitlistRoom: null });
  });

  it("is never full when it is uncapped", () => {
    // `null` is "no capacity", which is not the same number as zero — and reading it as one is
    // how an unlimited event would start turning people away.
    expect(registrationCta(event({ availablePlaces: null }), DURING).kind).toBe("OPEN");
  });
});

/**
 * BR-REQ-035-01 (§NNN) — the waiting list's length: its room under the button while it has
 * some, a sentence and no button once it is full, and an event with no line closed as full.
 */
describe("BR-REQ-035-01 a full event whose waiting list has a limit (§NNN)", () => {
  it("offers the waiting list with the room it has left", () => {
    expect(registrationCta(event({ availablePlaces: 0, waitlistCapacity: 10, waitlistRoom: 3 }), DURING)).toEqual({
      kind: "FULL",
      waitlistRoom: 3,
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
    });
  });

  it("leaves a closed or cancelled window as it was, whatever the line says", () => {
    const closed = event({ registrationClosesAt: new Date("2026-09-10T00:00:00Z"), availablePlaces: 0, waitlistRoom: 0, waitlistCapacity: 5 });
    expect(registrationCta(closed, DURING).kind).toBe("CLOSED");
    expect(registrationCta(event({ eventStatus: "CANCELLED", availablePlaces: 0, waitlistRoom: 0, waitlistCapacity: 0 }), DURING).kind).toBe("CANCELLED");
  });
});

/**
 * §NNN — how full a capped event is, read from the exact two numbers the button already uses:
 * never a second query, never a second formula.
 */
describe("§NNN publicFill — capacity minus the allocator's own free-place count", () => {
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
