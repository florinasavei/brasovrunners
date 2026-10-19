import { describe, expect, it } from "vitest";
import { landingFor, signInBackOf, signInTargetOf } from "@/modules/staff-identity/domain/landing";
import { isBackofficeRole, STAFF_ROLES } from "@/modules/staff-identity/domain/roles";

/**
 * BR-REQ-060-01, §524 — where a sign-in lands. One sign-in page serves the team and the club's
 * members: a member always lands in the members' zone, whatever the page asked; a colleague where
 * they came from. `?to=` is typed by anybody, so it is a closed set and never a path.
 */
describe("§524 where a sign-in lands", () => {
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

/**
 * §820 — the way back from the members' sign-in to the volunteers' page of one event (the owner's «Brașov Runners only» volunteers): a
 * closed return, never a path. `back` is one page name and `slug` must fit the events' own pattern; the destination is rebuilt from the
 * slug by `getPathname`, so nothing typed in the address is ever a redirect target.
 */
describe("§820 the way back to the volunteers' page", () => {
  it("reads one page name and a slug, and nothing else", () => {
    expect(signInBackOf("volunteers", "crosul-de-toamna")).toEqual({ page: "volunteers", slug: "crosul-de-toamna" });
    expect(signInBackOf("volunteers", "cursa-2026")).toEqual({ page: "volunteers", slug: "cursa-2026" });
  });

  it("is no way back for another page, a missing slug or a slug that is a path, an address or too long", () => {
    for (const back of [undefined, null, "", "admin", "members", "Volunteers", ["volunteers"]]) expect(signInBackOf(back, "crosul"), String(back)).toBeNull();
    for (const slug of [undefined, null, "", "../admin", "/ro/admin", "https://example.test", "a/b", "A-B", "a--b", "-a", "a-", "a b", ["crosul"], "x".repeat(121)]) {
      expect(signInBackOf("volunteers", slug), String(slug)).toBeNull();
    }
  });
});
