import { describe, expect, it } from "vitest";
import { clubCopyPayload } from "@/modules/notifications/domain/club-notices";
import {
  DEADLINE_KIND_BY_MESSAGE,
  rebasedDeadline,
  STARTS_DEADLINE,
  startingDeadline,
  startsItsDeadline,
} from "@/modules/notifications/domain/deadline-rebase";

/**
 * §NNN — the arithmetic of «termenul curge de când pleacă emailul» (`domain/deadline-rebase.ts`):
 * the stored deadline moves later by exactly the time its email waited, capped as the allocator
 * caps it, and never for a message that left at once, a deadline already over when it was queued,
 * a lapsed offer or the participation window's own date.
 */
const QUEUED = new Date("2026-09-04T20:05:00.000Z");
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const at = (ms: number) => new Date(QUEUED.getTime() + ms);
const EVENT = { registrationClosesAt: null, startsAt: new Date("2026-10-01T09:00:00.000Z") };

describe("§NNN rebasedDeadline", () => {
  it("names the four messages that start a participant's deadline, and no other", () => {
    expect(DEADLINE_KIND_BY_MESSAGE).toEqual({
      VERIFY_REGISTRATION_EMAIL: "emailLink",
      COMPLETE_DECLARATION: "declarationHold",
      WAITLIST_SPOT_OFFER: "offer",
      REGISTER_ANOTHER_PERSON: "familyLink",
    });
  });

  it("moves a thirty-minute hold sent 55 minutes late to thirty minutes after the send", () => {
    const moved = rebasedDeadline({ kind: "declarationHold", stored: at(30 * MINUTE), queuedAt: QUEUED, sentAt: at(55 * MINUTE), event: EVENT });
    expect(moved).toEqual(at(85 * MINUTE));
  });

  it("moves nothing for a message that left within a minute — the immediate timing", () => {
    expect(rebasedDeadline({ kind: "declarationHold", stored: at(30 * MINUTE), queuedAt: QUEUED, sentAt: at(59_999), event: EVENT })).toBeNull();
  });

  it("never moves a deadline already over when its message was queued (a resend after the lapse)", () => {
    expect(rebasedDeadline({ kind: "emailLink", stored: QUEUED, queuedAt: QUEUED, sentAt: at(HOUR) })).toBeNull();
  });

  it("leaves the participation window's date alone: no email starts it", () => {
    const windowDeadline = at(20 * 24 * HOUR);
    expect(rebasedDeadline({ kind: "declarationHold", stored: windowDeadline, queuedAt: QUEUED, sentAt: at(HOUR), event: EVENT })).toBeNull();
  });

  it("caps a hold and an offer at the close and the start, and moves nothing once the cap is reached", () => {
    const closes = at(40 * MINUTE);
    const capped = rebasedDeadline({
      kind: "declarationHold",
      stored: at(30 * MINUTE),
      queuedAt: QUEUED,
      sentAt: at(HOUR),
      event: { registrationClosesAt: closes, startsAt: EVENT.startsAt },
    });
    expect(capped).toEqual(closes);
    expect(
      rebasedDeadline({ kind: "offer", stored: closes, queuedAt: QUEUED, sentAt: at(20 * MINUTE), event: { registrationClosesAt: closes, startsAt: EVENT.startsAt } }),
    ).toBeNull();
  });

  it("re-bases an offer and a declaration hold past their stored deadline at the send — the queue kept both (§NNN)", () => {
    expect(rebasedDeadline({ kind: "offer", stored: at(24 * HOUR), queuedAt: QUEUED, sentAt: at(25 * HOUR), event: EVENT })).toEqual(at(49 * HOUR));
    expect(rebasedDeadline({ kind: "declarationHold", stored: at(30 * MINUTE), queuedAt: QUEUED, sentAt: at(HOUR), event: EVENT })).toEqual(at(90 * MINUTE));
  });

  it("does not cap the two links by the event, as nothing ever did", () => {
    const family = rebasedDeadline({ kind: "familyLink", stored: at(48 * HOUR), queuedAt: QUEUED, sentAt: at(HOUR) });
    expect(family).toEqual(at(49 * HOUR));
  });

  it("marks only the message that starts its deadline — never a plain payload, and never the club's copy of it", () => {
    const first = startingDeadline({ familyEntryId: "e" });
    expect(first).toEqual({ familyEntryId: "e", [STARTS_DEADLINE]: true });
    expect(startsItsDeadline(first)).toBe(true);
    expect(startsItsDeadline({})).toBe(false);
    expect(startsItsDeadline({ [STARTS_DEADLINE]: "true" })).toBe(false);
    expect(startsItsDeadline(null)).toBe(false);
    const copy = clubCopyPayload(first);
    expect(copy).toEqual({ familyEntryId: "e", clubCopy: true });
    expect(startsItsDeadline(copy)).toBe(false);
  });
});
