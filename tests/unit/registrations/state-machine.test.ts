import { describe, expect, it } from "vitest";
import type { RegistrationStatus } from "@/db/schema/registrations";
import { allowedFromStatuses, canTransition, isActiveStatus } from "@/modules/registrations/domain/state-machine";

/** AGENTS.md §10.5 — the registration state machine. */
describe("registration state machine", () => {
  const ALL: RegistrationStatus[] = [
    "PENDING_EMAIL_CONFIRMATION",
    "PENDING_DECLARATION",
    "WAITLISTED",
    "WAITLIST_OFFERED",
    "CONFIRMED",
    "CANCELLED",
    "EXPIRED",
  ];

  it("allows every transition AGENTS.md §10.5 names", () => {
    const expected: Array<[RegistrationStatus, RegistrationStatus]> = [
      ["PENDING_EMAIL_CONFIRMATION", "PENDING_DECLARATION"],
      ["PENDING_EMAIL_CONFIRMATION", "WAITLISTED"],
      ["PENDING_EMAIL_CONFIRMATION", "EXPIRED"],
      ["PENDING_DECLARATION", "CONFIRMED"],
      ["PENDING_DECLARATION", "WAITLISTED"],
      ["PENDING_DECLARATION", "CANCELLED"],
      ["PENDING_DECLARATION", "EXPIRED"],
      ["WAITLISTED", "WAITLIST_OFFERED"],
      ["WAITLISTED", "CANCELLED"],
      ["WAITLIST_OFFERED", "CONFIRMED"],
      ["WAITLIST_OFFERED", "CANCELLED"],
      ["WAITLIST_OFFERED", "EXPIRED"],
      ["WAITLISTED", "EXPIRED"],
      ["CONFIRMED", "CANCELLED"],
    ];
    for (const [from, to] of expected) {
      expect(canTransition(from, to), `${from} -> ${to}`).toBe(true);
    }
  });

  it("never lands a restart directly on CONFIRMED", () => {
    for (const from of ["CANCELLED", "EXPIRED"] as const) {
      expect(canTransition(from, "CONFIRMED")).toBe(false);
    }
  });

  it("allows a restart only to the three re-entry points, from Cancelled or Expired", () => {
    for (const from of ["CANCELLED", "EXPIRED"] as const) {
      expect(canTransition(from, "PENDING_EMAIL_CONFIRMATION")).toBe(true);
      expect(canTransition(from, "PENDING_DECLARATION")).toBe(true);
      expect(canTransition(from, "WAITLISTED")).toBe(true);
    }
  });

  it("refuses every transition not explicitly named", () => {
    let named = 0;
    let refused = 0;
    for (const from of ALL) {
      for (const to of ALL) {
        if (canTransition(from, to)) named += 1;
        else refused += 1;
      }
    }
    // 49 possible pairs (7x7); 20 are named transitions per §10.5's list.
    expect(named).toBe(20);
    expect(refused).toBe(49 - 20);
  });

  it("a status can never transition to itself", () => {
    for (const status of ALL) {
      expect(canTransition(status, status)).toBe(false);
    }
  });

  it("lists the allowed origins for a guarded UPDATE's WHERE clause", () => {
    expect(allowedFromStatuses("CANCELLED").sort()).toEqual(
      ["CONFIRMED", "PENDING_DECLARATION", "WAITLISTED", "WAITLIST_OFFERED"].sort(),
    );
    expect(allowedFromStatuses("CONFIRMED").sort()).toEqual(
      ["PENDING_DECLARATION", "WAITLIST_OFFERED"].sort(),
    );
  });

  it("treats Pending email, both holds, Waitlisted and Confirmed as active", () => {
    for (const status of [
      "PENDING_EMAIL_CONFIRMATION",
      "PENDING_DECLARATION",
      "WAITLISTED",
      "WAITLIST_OFFERED",
      "CONFIRMED",
    ] as const) {
      expect(isActiveStatus(status)).toBe(true);
    }
    expect(isActiveStatus("CANCELLED")).toBe(false);
    expect(isActiveStatus("EXPIRED")).toBe(false);
  });
});
