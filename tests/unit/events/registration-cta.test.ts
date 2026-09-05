import { describe, expect, it } from "vitest";
import {
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
    expect(registrationCta(event({ availablePlaces: 0 }), DURING)).toEqual({ kind: "FULL" });
  });

  it("is never full when it is uncapped", () => {
    // `null` is "no capacity", which is not the same number as zero — and reading it as one is
    // how an unlimited event would start turning people away.
    expect(registrationCta(event({ availablePlaces: null }), DURING).kind).toBe("OPEN");
  });
});
