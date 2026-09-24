import { describe, expect, it } from "vitest";
import {
  NO_WAITLIST,
  WAITLIST_FULL,
  waitlistFullError,
  waitlistHasRoom,
  waitlistLength,
  waitlistRefusalCode,
  waitlistRefusalOf,
  waitlistRoom,
} from "@/modules/registrations/domain/waitlist";
import { DomainError } from "@/shared/errors/domain-error";

/**
 * BR-REQ-035-01 (§NNN) — the waiting list's length, as the arithmetic the allocator asks under
 * the event lock. The line is `WAITLISTED` plus the offers still open; a limit of null is none,
 * 0 is no waiting list at all, and a limit lowered under the line refuses the next without
 * removing anybody.
 */
describe("§NNN the waiting list's length and room", () => {
  it("counts the people waiting and the offers still open as one line", () => {
    expect(waitlistLength({ waitlisted: 5, openOffers: 2 })).toBe(7);
    expect(waitlistLength({ waitlisted: 0, openOffers: 0 })).toBe(0);
  });

  it("has no room figure without a limit, and always takes one more", () => {
    const input = { waitlistCapacity: null, waitlisted: 400, openOffers: 30 };
    expect(waitlistRoom(input)).toBeNull();
    expect(waitlistHasRoom(input)).toBe(true);
  });

  it("takes people until the line reaches its limit, offers included", () => {
    expect(waitlistRoom({ waitlistCapacity: 10, waitlisted: 5, openOffers: 2 })).toBe(3);
    expect(waitlistHasRoom({ waitlistCapacity: 10, waitlisted: 5, openOffers: 2 })).toBe(true);
    expect(waitlistHasRoom({ waitlistCapacity: 10, waitlisted: 9, openOffers: 0 })).toBe(true);
    // An open offer still stands in the line: it frees its slot when it is answered, not made.
    expect(waitlistHasRoom({ waitlistCapacity: 2, waitlisted: 1, openOffers: 1 })).toBe(false);
    expect(waitlistRoom({ waitlistCapacity: 2, waitlisted: 1, openOffers: 1 })).toBe(0);
  });

  it("takes nobody with a limit of 0 — there is no waiting list", () => {
    expect(waitlistRoom({ waitlistCapacity: 0, waitlisted: 0, openOffers: 0 })).toBe(0);
    expect(waitlistHasRoom({ waitlistCapacity: 0, waitlisted: 0, openOffers: 0 })).toBe(false);
  });

  it("reads a limit lowered under the line as no room, never a negative one", () => {
    expect(waitlistRoom({ waitlistCapacity: 3, waitlisted: 8, openOffers: 1 })).toBe(0);
    expect(waitlistHasRoom({ waitlistCapacity: 3, waitlisted: 8, openOffers: 1 })).toBe(false);
  });
});

describe("§NNN the refusal every door gives", () => {
  it("names the full line with its own marker, and an event with no line with another", () => {
    const full = waitlistFullError(5);
    expect(full).toBeInstanceOf(DomainError);
    expect(full.code).toBe("VALIDATION_ERROR");
    expect(full.fields).toEqual([WAITLIST_FULL]);
    expect(full.message).toMatch(/^WAITLIST_FULL:/);

    const none = waitlistFullError(0);
    expect(none.fields).toEqual([NO_WAITLIST]);
  });

  it("is told apart from every other refusal, so the pages say the right sentence", () => {
    expect(waitlistRefusalOf(waitlistFullError(5))).toBe(WAITLIST_FULL);
    expect(waitlistRefusalOf(waitlistFullError(0))).toBe(NO_WAITLIST);
    expect(waitlistRefusalCode(waitlistFullError(5))).toBe("WAITLIST_FULL");
    expect(waitlistRefusalCode(waitlistFullError(0))).toBe("NO_WAITLIST");

    // The throttle, a field error, a conflict and a plain Error are not this refusal.
    expect(waitlistRefusalOf(new DomainError("VALIDATION_ERROR", "slow down", ["throttled"]))).toBeNull();
    expect(waitlistRefusalOf(new DomainError("VALIDATION_ERROR", "bad", ["email"]))).toBeNull();
    expect(waitlistRefusalOf(new DomainError("CONFLICT", "x", [WAITLIST_FULL]))).toBeNull();
    expect(waitlistRefusalCode(new Error("boom"))).toBeNull();
  });
});
