import { describe, expect, it } from "vitest";
import { membershipCell } from "@/modules/registrations/csv";
import { MEMBERSHIP_EXPORT_WORDS, membershipOf } from "@/modules/registrations/domain/membership";

/**
 * §662 (amending §650) — a registration is a «verified» member when its address is a member account's,
 * whatever the tick; «declared» when the person ticked and no account matches; nothing otherwise.
 */
describe("membershipOf", () => {
  it("says verified from the account match, whatever the tick", () => {
    expect(membershipOf({ declared: true, verified: true })).toBe("verified");
    expect(membershipOf({ declared: false, verified: true })).toBe("verified");
  });

  it("says declared from the tick alone, and nothing for neither — an unticked box is not «not a member»", () => {
    expect(membershipOf({ declared: true, verified: false })).toBe("declared");
    expect(membershipOf({ declared: false, verified: false })).toBeNull();
  });

  it("writes the export's cell in the export's words, empty for none (never «No»)", () => {
    expect(membershipCell({ clubMemberDeclared: true, memberVerified: true })).toBe(MEMBERSHIP_EXPORT_WORDS.verified);
    expect(membershipCell({ clubMemberDeclared: true, memberVerified: false })).toBe(MEMBERSHIP_EXPORT_WORDS.declared);
    expect(membershipCell({ clubMemberDeclared: false, memberVerified: false })).toBe("");
  });
});
