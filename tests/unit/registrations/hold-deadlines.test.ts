import { describe, expect, it } from "vitest";
import { events } from "@/db/schema/events";
import { DEFAULT_DEADLINES } from "@/modules/deadlines/domain/deadlines";
import {
  computeDeclarationHoldExpiry,
  computeWaitlistOfferExpiry,
  confirmationDueAtStart,
  confirmationDueMoment,
  confirmationDueWords,
  confirmationWindow,
  participationWindowOpen,
  DEFAULT_CONFIRMATION_DEADLINE_DAYS,
  DEFAULT_CONFIRMATION_OPENS_DAYS,
} from "@/modules/registrations/domain/hold-deadlines";

const NOW = new Date("2026-09-04T10:00:00.000Z");
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/** The club's deadlines when nobody has set them (§377): thirty minutes and twenty-four hours. */
const deadlines = DEFAULT_DEADLINES;

/** BR-REQ-033-01 criterion 4, BR-REQ-035-02 criterion 3 — capped at the earlier of the two. */
describe("hold deadlines", () => {
  it("a declaration hold is the club's thirty minutes, unset, when nothing caps it sooner", () => {
    const eventStartsAt = new Date("2026-10-01T09:00:00.000Z");
    const expiry = computeDeclarationHoldExpiry({ now: NOW, registrationClosesAt: null, eventStartsAt, deadlines });
    expect(deadlines.holdMinutes).toBe(30);
    expect(expiry).toEqual(new Date(NOW.getTime() + 30 * MINUTE));
  });

  it("caps a declaration hold at registration close when that is sooner", () => {
    const registrationClosesAt = new Date(NOW.getTime() + 10 * MINUTE);
    const eventStartsAt = new Date("2026-10-01T09:00:00.000Z");
    const expiry = computeDeclarationHoldExpiry({ now: NOW, registrationClosesAt, eventStartsAt, deadlines });
    expect(expiry).toEqual(registrationClosesAt);
  });

  it("caps a declaration hold at event start when registration has no close date and the event starts within the hold", () => {
    const eventStartsAt = new Date(NOW.getTime() + 5 * MINUTE);
    const expiry = computeDeclarationHoldExpiry({ now: NOW, registrationClosesAt: null, eventStartsAt, deadlines });
    expect(expiry).toEqual(eventStartsAt);
  });

  it("a waiting-list offer is the club's twenty-four hours, unset, when nothing caps it sooner", () => {
    const eventStartsAt = new Date("2026-10-01T09:00:00.000Z");
    const expiry = computeWaitlistOfferExpiry({ now: NOW, registrationClosesAt: null, eventStartsAt, deadlines });
    expect(deadlines.offerHours).toBe(24);
    expect(expiry).toEqual(new Date(NOW.getTime() + 24 * HOUR));
  });

  it("caps a waiting-list offer at event start when the event starts within the offer", () => {
    const eventStartsAt = new Date(NOW.getTime() + 3 * HOUR);
    const expiry = computeWaitlistOfferExpiry({ now: NOW, registrationClosesAt: null, eventStartsAt, deadlines });
    expect(expiry).toEqual(eventStartsAt);
  });

  it("takes whichever of registration close and event start is earlier", () => {
    const registrationClosesAt = new Date(NOW.getTime() + 2 * HOUR);
    const eventStartsAt = new Date(NOW.getTime() + 1 * HOUR);
    const expiry = computeWaitlistOfferExpiry({ now: NOW, registrationClosesAt, eventStartsAt, deadlines });
    expect(expiry).toEqual(eventStartsAt);
  });

  it("gives the lengths the club set (§377), still capped by the close and the start", () => {
    const eventStartsAt = new Date("2026-10-01T09:00:00.000Z");
    expect(computeDeclarationHoldExpiry({ now: NOW, registrationClosesAt: null, eventStartsAt, deadlines: { holdMinutes: 90 } })).toEqual(
      new Date(NOW.getTime() + 90 * MINUTE),
    );
    expect(computeWaitlistOfferExpiry({ now: NOW, registrationClosesAt: null, eventStartsAt, deadlines: { offerHours: 12 } })).toEqual(
      new Date(NOW.getTime() + 12 * HOUR),
    );
    // Seventy-two hours asked, the start two days away: the start wins, as it always has.
    const soon = new Date(NOW.getTime() + 48 * HOUR);
    expect(computeWaitlistOfferExpiry({ now: NOW, registrationClosesAt: null, eventStartsAt: soon, deadlines: { offerHours: 72 } })).toEqual(soon);
  });
});

/** BR-REQ-033-01 criterion 7 (`DECISIONS.md` §104) — the participation window. */
describe("the participation window", () => {
  const DAY = 24 * HOUR;
  const startsAt = new Date("2026-10-11T06:00:00.000Z");

  it("opens seven days before and closes two days before by default, and switches off at zero", () => {
    const window = confirmationWindow({ startsAt, confirmationOpensDaysBefore: 7, confirmationDeadlineDaysBefore: 2 });
    expect(window?.opensAt).toEqual(new Date(startsAt.getTime() - 7 * DAY));
    expect(window?.deadline).toEqual(new Date(startsAt.getTime() - 2 * DAY));
    expect(confirmationWindow({ startsAt, confirmationOpensDaysBefore: 0, confirmationDeadlineDaysBefore: 2 })).toBeNull();
    // A deadline at or before the opening is no window; absent fields are the pilot's rule.
    expect(confirmationWindow({ startsAt, confirmationOpensDaysBefore: 2, confirmationDeadlineDaysBefore: 2 })).toBeNull();
    expect(confirmationWindow({ startsAt, confirmationOpensDaysBefore: 3, confirmationDeadlineDaysBefore: 5 })).toBeNull();
    expect(confirmationWindow({ startsAt })).toBeNull();
  });

  it("holds the place until the deadline before the window opens, the club's minutes inside it", () => {
    const window = confirmationWindow({ startsAt, confirmationOpensDaysBefore: 7, confirmationDeadlineDaysBefore: 2 })!;
    // Thirty-seven days out: the place is theirs until two days before, whatever the close date —
    // and whatever the club's hold, which is for the place wanted now.
    const early = computeDeclarationHoldExpiry({
      now: NOW,
      registrationClosesAt: new Date(startsAt.getTime() - 10 * DAY),
      eventStartsAt: startsAt,
      window,
      deadlines: { holdMinutes: 15 },
    });
    expect(early).toEqual(window.deadline);
    // Five days out, inside the window: the club's minutes stand, and the close date caps them.
    const inside = new Date(startsAt.getTime() - 5 * DAY);
    expect(computeDeclarationHoldExpiry({ now: inside, registrationClosesAt: null, eventStartsAt: startsAt, window, deadlines })).toEqual(
      new Date(inside.getTime() + 30 * MINUTE),
    );
    // No window: the club's hold.
    expect(computeDeclarationHoldExpiry({ now: NOW, registrationClosesAt: null, eventStartsAt: startsAt, window: null, deadlines: { holdMinutes: 45 } })).toEqual(
      new Date(NOW.getTime() + 45 * MINUTE),
    );
  });
});

describe("§104 §377 whether the participation window is open", () => {
  const startsAt = new Date("2026-10-11T07:00:00.000Z");
  const day = 24 * HOUR;
  it("is closed before the opening day, open from it, and never for an event with no window", () => {
    expect(participationWindowOpen(startsAt, 7, new Date(startsAt.getTime() - 8 * day))).toBe(false);
    expect(participationWindowOpen(startsAt, 7, new Date(startsAt.getTime() - 7 * day))).toBe(true);
    expect(participationWindowOpen(startsAt, 7, new Date(startsAt.getTime() - 3 * day))).toBe(true);
    expect(participationWindowOpen(startsAt, 0, new Date(startsAt.getTime() - HOUR))).toBe(false);
    expect(participationWindowOpen(startsAt, null, new Date(startsAt.getTime() - HOUR))).toBe(false);
  });
});

describe("§104 the participation window's defaults", () => {
  it("are the column defaults, one number in two places held together", () => {
    expect(events.confirmationOpensDaysBefore.default).toBe(DEFAULT_CONFIRMATION_OPENS_DAYS);
    expect(events.confirmationDeadlineDaysBefore.default).toBe(DEFAULT_CONFIRMATION_DEADLINE_DAYS);
  });
});

/**
 * BR-REQ-033-01 criterion 6 (`DECISIONS.md` §NNN, amending §104; the owner, 2026-09-25:
 * "fereastra de confirmare trebuie să fie 0 la final, să nu expire") — a deadline of zero is the
 * start, and every sentence says "la start" beside the date through one helper.
 */
describe("§NNN a confirmation deadline of zero days is the start", () => {
  const DAY = 24 * HOUR;
  const startsAt = new Date("2026-10-11T06:00:00.000Z");

  it("puts the window's deadline, and the hold given before it opens, at the start itself", () => {
    const window = confirmationWindow({ startsAt, confirmationOpensDaysBefore: 7, confirmationDeadlineDaysBefore: 0 })!;
    expect(window).toEqual({ opensAt: new Date(startsAt.getTime() - 7 * DAY), deadline: startsAt });
    expect(
      computeDeclarationHoldExpiry({ now: NOW, registrationClosesAt: new Date(startsAt.getTime() - 10 * DAY), eventStartsAt: startsAt, window, deadlines }),
    ).toEqual(startsAt);
    // Inside the window the club's minutes still stand (§104): the place is wanted now.
    const inside = new Date(startsAt.getTime() - 3 * DAY);
    expect(computeDeclarationHoldExpiry({ now: inside, registrationClosesAt: null, eventStartsAt: startsAt, window, deadlines })).toEqual(
      new Date(inside.getTime() + 30 * MINUTE),
    );
    // Zero and zero is still the weekly run's: no window.
    expect(confirmationWindow({ startsAt, confirmationOpensDaysBefore: 0, confirmationDeadlineDaysBefore: 0 })).toBeNull();
  });

  it("is decided by one test, from the days or from the moment", () => {
    expect(confirmationDueAtStart({ days: 0 })).toBe(true);
    expect(confirmationDueAtStart({ days: 2 })).toBe(false);
    expect(confirmationDueAtStart({ at: startsAt, startsAt })).toBe(true);
    expect(confirmationDueAtStart({ at: new Date(startsAt.getTime() - DAY), startsAt })).toBe(false);
  });

  it("says «la start» / «the start» beside the counted and the dated form, in both languages", () => {
    expect(confirmationDueWords("ro", 0)).toBe("la start");
    expect(confirmationDueWords("en", 0)).toBe("the start");
    expect(confirmationDueWords("ro", 2)).toBe("cu 2 zile înainte de start");
    expect(confirmationDueWords("en", 1)).toBe("one day before the start");
    expect(confirmationDueWords("ro", 7)).toBe("cu o săptămână înainte de start");
    expect(confirmationDueMoment("ro", { at: startsAt, startsAt }, "duminică, 11 oct. 2026, 09:00")).toBe("start, duminică, 11 oct. 2026, 09:00");
    expect(confirmationDueMoment("en", { at: startsAt, startsAt }, "Sunday, 11 Oct 2026, 09:00")).toBe("the start, Sunday, 11 Oct 2026, 09:00");
    expect(confirmationDueMoment("ro", { at: new Date(startsAt.getTime() - 2 * DAY), startsAt }, "vineri")).toBe("vineri");
  });
});
