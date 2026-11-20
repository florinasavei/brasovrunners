import { describe, expect, it } from "vitest";
import { listConsentRecordedKey } from "@/modules/registrations/desk-list-wish";
import { consentWord, listChoiceColumns } from "@/modules/registrations/list-consent";
import { canRecordListWishAtDesk, canWorkTheDesk, STAFF_ROLES } from "@/modules/staff-identity/domain/roles";

/**
 * §1017 (amending §143, §910, §1004; BR-REQ-060-01, BR-REQ-039-01) — who may press the desk row's eye to record a runner's
 * spoken wish to appear by name: every role that works the desk, the desk Volunteer included, written as `canWorkTheDesk` so the
 * two lines move together; never a club member, who is no staff (§524). And the pure halves of the write: the one write's
 * columns, shared with the person's own doors, and the email's key, one per recorded wish.
 */
describe("§1017 canRecordListWishAtDesk", () => {
  it("is every desk role and never a member", () => {
    for (const role of STAFF_ROLES) expect(canRecordListWishAtDesk(role), role).toBe(role !== "MEMBER");
    expect(canRecordListWishAtDesk("CONTRIBUTOR")).toBe(true);
    expect(canRecordListWishAtDesk("MEMBER")).toBe(false);
  });

  it("is the desk's own line, role by role, and reads an actor as its role", () => {
    for (const role of STAFF_ROLES) {
      expect(canRecordListWishAtDesk(role), role).toBe(canWorkTheDesk(role));
      expect(canRecordListWishAtDesk({ role }), role).toBe(canWorkTheDesk(role));
    }
  });
});

describe("§1017 the one write's columns, whichever door", () => {
  const now = new Date("2026-11-21T07:30:00.000Z");

  it("showing clears the opt-out and touches nothing beside the name", () => {
    expect(listChoiceColumns(true, now)).toEqual({ listOptOut: false, updatedAt: now });
  });

  it("hiding sets the opt-out and takes the socials with it, for good (§500)", () => {
    expect(listChoiceColumns(false, now)).toEqual({ listOptOut: true, listSocials: false, updatedAt: now });
  });

  it("says the shape of the change, never a name", () => {
    expect(consentWord(true)).toBe("LISTED");
    expect(consentWord(false)).toBe("NOT_LISTED");
  });
});

describe("§1017 the email's key", () => {
  it("is the registration's and the recorded wish's: a retried request queues nothing twice, a new wish is a new message", () => {
    const registration = "11111111-1111-4111-8111-111111111111";
    expect(listConsentRecordedKey(registration, "a")).toBe(`registration:${registration}:list-consent-recorded:a`);
    expect(listConsentRecordedKey(registration, "a")).toBe(listConsentRecordedKey(registration, "a"));
    expect(listConsentRecordedKey(registration, "b")).not.toBe(listConsentRecordedKey(registration, "a"));
  });
});
