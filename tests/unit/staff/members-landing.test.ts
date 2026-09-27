import { describe, expect, it } from "vitest";
import { landingFor, signInTargetOf } from "@/modules/staff-identity/domain/landing";
import { isBackofficeRole, STAFF_ROLES } from "@/modules/staff-identity/domain/roles";

/**
 * BR-REQ-060-01, §NNN — where a sign-in lands. One sign-in page serves the team and the club's
 * members: a member always lands in the members' zone, whatever the page asked; a colleague where
 * they came from. `?to=` is typed by anybody, so it is a closed set and never a path.
 */
describe("§NNN where a sign-in lands", () => {
  it("reads `to` as a closed set: only «members» is anything but the backoffice", () => {
    expect(signInTargetOf("members")).toBe("members");
    for (const value of [undefined, null, "", "admin", "MEMBERS", "/ro/admin", "https://example.test", ["members"]]) {
      expect(signInTargetOf(value), String(value)).toBe("admin");
    }
  });

  it("sends a member to the members' zone from either door", () => {
    expect(landingFor("MEMBER", "admin")).toBe("/members-area");
    expect(landingFor("MEMBER", "members")).toBe("/members-area");
  });

  it("sends a colleague where they came from: the backoffice, or the zone they asked for", () => {
    for (const role of STAFF_ROLES.filter(isBackofficeRole)) {
      expect(landingFor(role, "admin"), role).toBe("/admin");
      expect(landingFor(role, "members"), role).toBe("/members-area");
    }
  });

  it("draws the backoffice line between the member and the volunteer", () => {
    expect(STAFF_ROLES.filter((role) => !isBackofficeRole(role))).toEqual(["MEMBER"]);
  });
});
