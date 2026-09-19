import { describe, expect, it } from "vitest";
import {
  computeDeclarationHoldExpiry,
  computeWaitlistOfferExpiry,
  confirmationWindow,
  DECLARATION_HOLD_MINUTES,
  WAITLIST_OFFER_HOLD_HOURS,
} from "@/modules/registrations/domain/hold-deadlines";

const NOW = new Date("2026-09-04T10:00:00.000Z");

/** BR-REQ-033-01 criterion 4, BR-REQ-035-02 criterion 3 — capped at the earlier of the two. */
describe("hold deadlines", () => {
  it("a declaration hold is 30 minutes when nothing caps it sooner", () => {
    const eventStartsAt = new Date("2026-10-01T09:00:00.000Z");
    const expiry = computeDeclarationHoldExpiry({ now: NOW, registrationClosesAt: null, eventStartsAt });
    expect(expiry).toEqual(new Date(NOW.getTime() + DECLARATION_HOLD_MINUTES * 60_000));
  });

  it("caps a declaration hold at registration close when that is sooner", () => {
    const registrationClosesAt = new Date(NOW.getTime() + 10 * 60_000);
    const eventStartsAt = new Date("2026-10-01T09:00:00.000Z");
    const expiry = computeDeclarationHoldExpiry({ now: NOW, registrationClosesAt, eventStartsAt });
    expect(expiry).toEqual(registrationClosesAt);
  });

  it("caps a declaration hold at event start when registration has no close date and the event starts within 30 minutes", () => {
    const eventStartsAt = new Date(NOW.getTime() + 5 * 60_000);
    const expiry = computeDeclarationHoldExpiry({ now: NOW, registrationClosesAt: null, eventStartsAt });
    expect(expiry).toEqual(eventStartsAt);
  });

  it("a waiting-list offer is 24 hours when nothing caps it sooner", () => {
    const eventStartsAt = new Date("2026-10-01T09:00:00.000Z");
    const expiry = computeWaitlistOfferExpiry({ now: NOW, registrationClosesAt: null, eventStartsAt });
    expect(expiry).toEqual(new Date(NOW.getTime() + WAITLIST_OFFER_HOLD_HOURS * 60 * 60_000));
  });

  it("caps a waiting-list offer at event start when the event starts within 24 hours", () => {
    const eventStartsAt = new Date(NOW.getTime() + 3 * 60 * 60_000);
    const expiry = computeWaitlistOfferExpiry({ now: NOW, registrationClosesAt: null, eventStartsAt });
    expect(expiry).toEqual(eventStartsAt);
  });

  it("takes whichever of registration close and event start is earlier", () => {
    const registrationClosesAt = new Date(NOW.getTime() + 2 * 60 * 60_000);
    const eventStartsAt = new Date(NOW.getTime() + 1 * 60 * 60_000);
    const expiry = computeWaitlistOfferExpiry({ now: NOW, registrationClosesAt, eventStartsAt });
    expect(expiry).toEqual(eventStartsAt);
  });
});

/** BR-REQ-033-01 criterion 7 (`DECISIONS.md` §104) — the participation window. */
describe("the participation window", () => {
  const DAY = 24 * 60 * 60_000;
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

  it("holds the place until the deadline before the window opens, thirty minutes inside it", () => {
    const window = confirmationWindow({ startsAt, confirmationOpensDaysBefore: 7, confirmationDeadlineDaysBefore: 2 })!;
    // Thirty-seven days out: the place is theirs until two days before, whatever the close date.
    const early = computeDeclarationHoldExpiry({ now: NOW, registrationClosesAt: new Date(startsAt.getTime() - 10 * DAY), eventStartsAt: startsAt, window });
    expect(early).toEqual(window.deadline);
    // Five days out, inside the window: the thirty minutes stand, and the close date caps them.
    const inside = new Date(startsAt.getTime() - 5 * DAY);
    expect(computeDeclarationHoldExpiry({ now: inside, registrationClosesAt: null, eventStartsAt: startsAt, window })).toEqual(
      new Date(inside.getTime() + DECLARATION_HOLD_MINUTES * 60_000),
    );
    // No window: the pilot's rule.
    expect(computeDeclarationHoldExpiry({ now: NOW, registrationClosesAt: null, eventStartsAt: startsAt, window: null })).toEqual(
      new Date(NOW.getTime() + DECLARATION_HOLD_MINUTES * 60_000),
    );
  });
});
