import { describe, expect, it } from "vitest";
import {
  registrationState,
  type RegistrationWindowInput,
} from "@/modules/events/domain/registration-window";

/**
 * BR-REQ-011-01 criteria 2, 3 and 4 — the defaults when a window is not stated.
 * BR-REQ-020-01 criterion 3 — a cancelled or completed event never accepts registration.
 * BR-REQ-030-01 criterion 1 — mode NONE offers no registration action.
 */
const START = new Date("2026-10-04T07:00:00Z");
const PUBLISHED = new Date("2026-09-01T10:00:00Z");

function event(overrides: Partial<RegistrationWindowInput> = {}): RegistrationWindowInput {
  return {
    registrationMode: "INTERNAL",
    eventStatus: "SCHEDULED",
    startsAt: START,
    registrationOpensAt: null,
    registrationClosesAt: null,
    publishedAt: PUBLISHED,
    ...overrides,
  };
}

describe("BR-REQ-011-01 registration window defaults", () => {
  it("closes registration at event start when no closing time is set", () => {
    const oneSecondBefore = new Date(START.getTime() - 1000);
    expect(registrationState(event(), oneSecondBefore)).toBe("OPEN");
    expect(registrationState(event(), START)).toBe("CLOSED");
    expect(registrationState(event(), new Date(START.getTime() + 1000))).toBe("CLOSED");
  });

  it("opens registration at publication when no opening time is set", () => {
    const beforePublication = new Date(PUBLISHED.getTime() - 1000);
    expect(registrationState(event(), beforePublication)).toBe("NOT_YET_OPEN");
    expect(registrationState(event(), PUBLISHED)).toBe("OPEN");
  });

  it("honours an explicit window over both defaults", () => {
    const opens = new Date("2026-09-20T00:00:00Z");
    const closes = new Date("2026-10-01T00:00:00Z");
    const e = event({ registrationOpensAt: opens, registrationClosesAt: closes });

    expect(registrationState(e, new Date("2026-09-19T23:59:59Z"))).toBe("NOT_YET_OPEN");
    expect(registrationState(e, opens)).toBe("OPEN");
    expect(registrationState(e, new Date("2026-09-30T23:59:59Z"))).toBe("OPEN");
    // Closes before the event starts, and stays closed after.
    expect(registrationState(e, closes)).toBe("CLOSED");
    expect(registrationState(e, START)).toBe("CLOSED");
  });
});

describe("BR-REQ-030-01 registration modes", () => {
  it("reports no registration for mode NONE, whatever the window says", () => {
    expect(registrationState(event({ registrationMode: "NONE" }), PUBLISHED)).toBe(
      "NOT_APPLICABLE",
    );
  });

  it("reports an external registration for mode EXTERNAL", () => {
    expect(registrationState(event({ registrationMode: "EXTERNAL" }), PUBLISHED)).toBe("EXTERNAL");
  });
});

describe("BR-REQ-020-01 cancelled and completed events", () => {
  it.each(["CANCELLED", "COMPLETED"] as const)(
    "reports %s events as closed to registration even mid-window",
    (eventStatus) => {
      // Mid-window on purpose: the status must win over an otherwise open window.
      expect(registrationState(event({ eventStatus }), PUBLISHED)).toBe("EVENT_CANCELLED");
    },
  );
});
