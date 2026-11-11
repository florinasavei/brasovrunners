import { describe, expect, it } from "vitest";
import { registrationStatus } from "@/db/schema/registrations";
import {
  ADDRESS_CHANGE_MIN_REMAINING_MS,
  deadlineKeptOnMove,
  eventOverForMove,
  signedAfterStaffAddressChange,
  stateMessageOnMove,
} from "@/modules/registrations/domain/address-change";

/**
 * «Schimbă adresa» — what is pure about a move (BR-REQ-037-03): the deadline a hold or an offer keeps (decided for the
 * owner: kept, or a day from the move when less remains, capped by the start, never lengthened for a counted place while
 * somebody waits), which message the new address is sent, and how the trail tells a signature given after the move.
 */
const NOW = new Date("2026-10-01T10:00:00.000Z");
const HOUR = 60 * 60_000;
const START = new Date(NOW.getTime() + 10 * 24 * HOUR);

describe("deadlineKeptOnMove", () => {
  it("keeps a deadline with a day or more left", () => {
    const hold = new Date(NOW.getTime() + ADDRESS_CHANGE_MIN_REMAINING_MS);
    expect(deadlineKeptOnMove({ holdExpiresAt: hold, now: NOW, eventStartsAt: START, mayLengthen: true })).toBe(hold);
  });

  it("gives a day from the move when less remains and nobody waits", () => {
    const hold = new Date(NOW.getTime() + 3 * HOUR);
    expect(deadlineKeptOnMove({ holdExpiresAt: hold, now: NOW, eventStartsAt: START, mayLengthen: true })?.toISOString()).toBe(new Date(NOW.getTime() + 24 * HOUR).toISOString());
  });

  it("caps the day by the start, and never shortens", () => {
    const soon = new Date(NOW.getTime() + 5 * HOUR);
    const hold = new Date(NOW.getTime() + 3 * HOUR);
    expect(deadlineKeptOnMove({ holdExpiresAt: hold, now: NOW, eventStartsAt: soon, mayLengthen: true })?.toISOString()).toBe(soon.toISOString());
    const later = new Date(NOW.getTime() + 4 * HOUR);
    const startBefore = new Date(NOW.getTime() + 2 * HOUR);
    expect(deadlineKeptOnMove({ holdExpiresAt: later, now: NOW, eventStartsAt: startBefore, mayLengthen: true })).toBe(later);
  });

  it("does not lengthen while somebody waits for a counted place, nor touch a deadline passed or absent", () => {
    const hold = new Date(NOW.getTime() + 3 * HOUR);
    expect(deadlineKeptOnMove({ holdExpiresAt: hold, now: NOW, eventStartsAt: START, mayLengthen: false })).toBe(hold);
    const passed = new Date(NOW.getTime() - HOUR);
    expect(deadlineKeptOnMove({ holdExpiresAt: passed, now: NOW, eventStartsAt: START, mayLengthen: true })).toBe(passed);
    expect(deadlineKeptOnMove({ holdExpiresAt: null, now: NOW, eventStartsAt: START, mayLengthen: true })).toBeNull();
  });
});

describe("stateMessageOnMove and eventOverForMove", () => {
  it("sends each state's own message, none for a row that is over or an event that is", () => {
    const expected: Record<string, string | null> = {
      PENDING_EMAIL_CONFIRMATION: "VERIFY_REGISTRATION_EMAIL",
      PENDING_DECLARATION: "COMPLETE_DECLARATION",
      WAITLISTED: "WAITLIST_JOINED",
      WAITLIST_OFFERED: "WAITLIST_SPOT_OFFER",
      CONFIRMED: "REGISTRATION_CONFIRMED",
      CANCELLED: null,
      EXPIRED: null,
    };
    for (const status of registrationStatus.enumValues) {
      expect(stateMessageOnMove(status, false), status).toBe(expected[status]);
      expect(stateMessageOnMove(status, true), status).toBeNull();
    }
  });

  it("an event is over once cancelled, completed, or past its end (its start without one)", () => {
    expect(eventOverForMove({ eventStatus: "SCHEDULED", startsAt: START, endsAt: null }, NOW)).toBe(false);
    expect(eventOverForMove({ eventStatus: "CANCELLED", startsAt: START, endsAt: null }, NOW)).toBe(true);
    expect(eventOverForMove({ eventStatus: "COMPLETED", startsAt: START, endsAt: null }, NOW)).toBe(true);
    expect(eventOverForMove({ eventStatus: "SCHEDULED", startsAt: new Date(NOW.getTime() - HOUR), endsAt: null }, NOW)).toBe(true);
    expect(eventOverForMove({ eventStatus: "SCHEDULED", startsAt: new Date(NOW.getTime() - HOUR), endsAt: new Date(NOW.getTime() + HOUR) }, NOW)).toBe(false);
  });
});

describe("signedAfterStaffAddressChange", () => {
  it("only an emailed-link signature after the move; paper, an earlier signature or no move is not", () => {
    const moved = new Date(NOW.getTime() - HOUR);
    expect(signedAfterStaffAddressChange({ method: "EMAIL_LINK", acceptedAt: NOW }, moved)).toBe(true);
    expect(signedAfterStaffAddressChange({ method: "PAPER", acceptedAt: NOW }, moved)).toBe(false);
    expect(signedAfterStaffAddressChange({ method: "EMAIL_LINK", acceptedAt: new Date(moved.getTime() - HOUR) }, moved)).toBe(false);
    expect(signedAfterStaffAddressChange({ method: "EMAIL_LINK", acceptedAt: NOW }, null)).toBe(false);
  });
});
