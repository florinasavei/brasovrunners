import { describe, expect, it } from "vitest";
import {
  computeOccupied,
  computePublicAvailability,
  hasDirectAvailability,
} from "@/modules/registrations/domain/capacity";

/** AGENTS.md §10.6 — the capacity formula. BR-REQ-034-01. */
describe("capacity formula", () => {
  it("occupied is confirmed plus both kinds of unexpired hold", () => {
    expect(
      computeOccupied({
        confirmed: 15,
        unexpiredPendingDeclarationHolds: 1,
        unexpiredWaitlistOfferedHolds: 2,
      }),
    ).toBe(18);
  });

  it("BR-REQ-034-01 criterion 1: 20 capacity, 15 confirmed, 1 hold, 0 waitlisted -> 4 available", () => {
    const occupied = computeOccupied({
      confirmed: 15,
      unexpiredPendingDeclarationHolds: 1,
      unexpiredWaitlistOfferedHolds: 0,
    });
    expect(computePublicAvailability({ capacity: 20, occupied, eligibleWaitlisted: 0 })).toBe(4);
  });

  it("BR-REQ-034-01 criterion 2: the same event with 3 eligible waiting entries -> 1 available", () => {
    const occupied = computeOccupied({
      confirmed: 15,
      unexpiredPendingDeclarationHolds: 1,
      unexpiredWaitlistOfferedHolds: 0,
    });
    expect(computePublicAvailability({ capacity: 20, occupied, eligibleWaitlisted: 3 })).toBe(1);
  });

  it("never goes negative when the waiting list outweighs the free places", () => {
    expect(computePublicAvailability({ capacity: 20, occupied: 20, eligibleWaitlisted: 5 })).toBe(0);
  });

  it("BR-REQ-034-01 criterion 4: an uncapped event has no numeric count, ever", () => {
    expect(computePublicAvailability({ capacity: null, occupied: 500, eligibleWaitlisted: 0 })).toBeNull();
  });

  describe("hasDirectAvailability", () => {
    it("is true for an uncapped event regardless of occupancy", () => {
      expect(hasDirectAvailability({ capacity: null, occupied: 10_000, eligibleWaitlisted: 3 })).toBe(true);
    });

    it("is false exactly when the formula would floor at zero", () => {
      expect(hasDirectAvailability({ capacity: 10, occupied: 9, eligibleWaitlisted: 0 })).toBe(true);
      expect(hasDirectAvailability({ capacity: 10, occupied: 10, eligibleWaitlisted: 0 })).toBe(false);
      expect(hasDirectAvailability({ capacity: 10, occupied: 8, eligibleWaitlisted: 2 })).toBe(false);
    });
  });
});
