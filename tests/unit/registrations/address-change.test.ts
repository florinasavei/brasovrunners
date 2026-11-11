import { describe, expect, it } from "vitest";
import { registrationStatus } from "@/db/schema/registrations";
import {
  ADDRESS_CHANGE_MIN_REMAINING_MS,
  deadlineKeptOnMove,
  declarationPdfAudienceAfterMove,
  eventEndForMove,
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

  it("an event is over once cancelled, completed, or past its end", () => {
    const zone = "Europe/Bucharest";
    expect(eventOverForMove({ eventStatus: "SCHEDULED", startsAt: START, endsAt: null, timezone: zone }, NOW)).toBe(false);
    expect(eventOverForMove({ eventStatus: "CANCELLED", startsAt: START, endsAt: null, timezone: zone }, NOW)).toBe(true);
    expect(eventOverForMove({ eventStatus: "COMPLETED", startsAt: START, endsAt: null, timezone: zone }, NOW)).toBe(true);
    expect(eventOverForMove({ eventStatus: "SCHEDULED", startsAt: new Date(NOW.getTime() - HOUR), endsAt: new Date(NOW.getTime() + HOUR), timezone: zone }, NOW)).toBe(false);
    expect(eventOverForMove({ eventStatus: "SCHEDULED", startsAt: new Date(NOW.getTime() - 2 * HOUR), endsAt: new Date(NOW.getTime() - HOUR), timezone: zone }, NOW)).toBe(true);
  });

  it("with no end, the event lasts to the end of its start day in its own zone — race day after the start is not over", () => {
    // 10:00 in Brașov on 4 October (summer time, UTC+3): over at the next midnight there, 21:00 UTC.
    const race = { eventStatus: "SCHEDULED", startsAt: new Date("2026-10-04T07:00:00.000Z"), endsAt: null, timezone: "Europe/Bucharest" };
    expect(eventEndForMove(race).toISOString()).toBe("2026-10-04T21:00:00.000Z");
    expect(eventOverForMove(race, new Date("2026-10-04T12:00:00.000Z"))).toBe(false);
    expect(eventOverForMove(race, new Date("2026-10-04T21:00:00.000Z"))).toBe(true);
    // The night summer time ends (25 October 2026, 04:00 → 03:00): the next midnight is in winter time, UTC+2.
    expect(eventEndForMove({ ...race, startsAt: new Date("2026-10-24T07:00:00.000Z") }).toISOString()).toBe("2026-10-24T21:00:00.000Z");
    expect(eventEndForMove({ ...race, startsAt: new Date("2026-10-25T07:00:00.000Z") }).toISOString()).toBe("2026-10-25T22:00:00.000Z");
    expect(eventEndForMove({ ...race, timezone: "UTC" }).toISOString()).toBe("2026-10-05T00:00:00.000Z");
  });
});

describe("declarationPdfAudienceAfterMove", () => {
  const moved = new Date(NOW.getTime() - HOUR);
  it("masks the participant's copy after a staff move until the address is confirmed after it", () => {
    expect(declarationPdfAudienceAfterMove("participant", null, null)).toBe("participant");
    expect(declarationPdfAudienceAfterMove("participant", moved, null)).toBe("club");
    // Verified before the move — the address of somebody else, perhaps: still masked.
    expect(declarationPdfAudienceAfterMove("participant", moved, new Date(moved.getTime() - HOUR))).toBe("club");
    expect(declarationPdfAudienceAfterMove("participant", moved, NOW)).toBe("participant");
  });
  it("leaves the club's copies as they are", () => {
    expect(declarationPdfAudienceAfterMove("club", moved, null)).toBe("club");
    expect(declarationPdfAudienceAfterMove(null, moved, null)).toBeNull();
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
