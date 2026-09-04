import { describe, expect, it } from "vitest";
import {
  computeDeclarationHoldExpiry,
  computeWaitlistOfferExpiry,
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
