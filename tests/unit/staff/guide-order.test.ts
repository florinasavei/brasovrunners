import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import { STAFF_ROLES } from "@/modules/staff-identity/domain/roles";
import { orderGuideSections } from "@/modules/staff-identity/domain/guide-order";

/**
 * BR-REQ-060-01 criterion 34 — the guide's per-role order, as a pure function
 * (`guide-order.ts`), rather than only through the page's own render (`tests/e2e/guide.spec.ts`,
 * which covers MODERATOR and CONTRIBUTOR only).
 *
 * Every `StaffRole` gets its own case here, including `ADMIN` — the Administrator's, and the one
 * the e2e suite left out.
 */

type GuideSection = { title: string; roles: string[] };

const sections = (en.Admin.guide.sections as GuideSection[]).map((section) => ({
  title: section.title,
  roles: section.roles as (typeof STAFF_ROLES)[number][],
}));

describe("orderGuideSections", () => {
  it.each(STAFF_ROLES)("puts %s's own sections first, in the catalogue's order, and opens the first", (role) => {
    const ordered = orderGuideSections(sections, role);
    // Same sections, none dropped or duplicated.
    expect(ordered).toHaveLength(sections.length);
    expect(new Set(ordered.map((s) => s.title))).toEqual(new Set(sections.map((s) => s.title)));

    const mine = sections.filter((s) => s.roles.includes(role));
    const others = sections.filter((s) => !s.roles.includes(role));
    expect(ordered.slice(0, mine.length)).toEqual(mine);
    expect(ordered.slice(mine.length)).toEqual(others);
    // The page opens `index < max(1, mine.length)`: the reader's own sections, or the first one.
    expect(ordered[0]).toEqual(mine[0] ?? others[0]);
  });

  it("ADMIN: first steps and the Administrator's own section come before a colleague's", () => {
    const ordered = orderGuideSections(sections, "ADMIN");
    const titles = ordered.map((s) => s.title);
    expect(titles[0]).toBe("First steps");
    const adminIndex = titles.findIndex((title) => title.startsWith("Administrator —"));
    const organizerIndex = titles.findIndex((title) => title.startsWith("Organizer —"));
    expect(adminIndex).toBeGreaterThan(-1);
    expect(organizerIndex).toBeGreaterThan(-1);
    expect(adminIndex).toBeLessThan(organizerIndex);
  });
});
