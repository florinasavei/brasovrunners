import { describe, expect, it } from "vitest";
import {
  allowedTransitions,
  canEditEventFields,
  canEditTranslation,
  canManageStaff,
  canTransition,
  EDITORIAL_STATUSES,
  isLiveContent,
  STAFF_ROLES,
  TRANSITIONS,
  visibleAdminSections,
} from "@/modules/staff-identity/domain/roles";

/**
 * BR-REQ-051-01 — editorial workflow and permissions.
 * BR-REQ-060-01 — role boundaries.
 *
 * The rules themselves, exhaustively, with no database and no browser. Every server guard in
 * the backoffice calls one of these functions, so a hole here is a hole everywhere; the
 * integration tests then prove the guards are actually consulted.
 */

const AUTHOR_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_ID = "22222222-2222-2222-2222-222222222222";

describe("BR-REQ-051-01 criterion 1 an Author works on their own drafts", () => {
  it("lets an Author edit a draft they wrote", () => {
    expect(
      canEditTranslation(
        "CONTRIBUTOR",
        { editorialStatus: "DRAFT", authorStaffUserId: AUTHOR_ID },
        AUTHOR_ID,
      ),
    ).toBe(true);
  });

  it("refuses an Author a colleague's draft", () => {
    expect(
      canEditTranslation(
        "CONTRIBUTOR",
        { editorialStatus: "DRAFT", authorStaffUserId: OTHER_ID },
        AUTHOR_ID,
      ),
    ).toBe(false);
  });

  it("refuses an Author a draft that is already in review", () => {
    // Once submitted the piece belongs to the reviewer, or the review is of a moving target.
    expect(
      canEditTranslation(
        "CONTRIBUTOR",
        { editorialStatus: "IN_REVIEW", authorStaffUserId: AUTHOR_ID },
        AUTHOR_ID,
      ),
    ).toBe(false);
  });

  it("lets an Author submit their own draft for review and nothing else", () => {
    expect(allowedTransitions("CONTRIBUTOR", "DRAFT", true)).toEqual(["IN_REVIEW"]);
    expect(allowedTransitions("CONTRIBUTOR", "DRAFT", false)).toEqual([]);
    expect(allowedTransitions("CONTRIBUTOR", "IN_REVIEW", true)).toEqual([]);
    expect(allowedTransitions("CONTRIBUTOR", "PUBLISHED", true)).toEqual([]);
  });
});

describe("BR-REQ-051-01 criterion 3 published content is out of an Author's hands", () => {
  it.each(["PUBLISHED", "ARCHIVED"] as const)("refuses an Author a %s translation", (status) => {
    expect(
      canEditTranslation("CONTRIBUTOR", { editorialStatus: status, authorStaffUserId: AUTHOR_ID }, AUTHOR_ID),
    ).toBe(false);
  });

  it("never lets an Author publish, whatever the starting status", () => {
    for (const from of EDITORIAL_STATUSES) {
      expect(canTransition("CONTRIBUTOR", from, "PUBLISHED", true), `from ${from}`).toBe(false);
    }
  });
});

describe("BR-REQ-051-01 criterion 2 an Editor or Administrator publishes", () => {
  it.each(["MODERATOR", "ADMIN"] as const)("lets %s publish a reviewed draft", (role) => {
    expect(canTransition(role, "IN_REVIEW", "PUBLISHED", false)).toBe(true);
  });

  it.each(["MODERATOR", "ADMIN"] as const)("lets %s unpublish and archive", (role) => {
    expect(canTransition(role, "PUBLISHED", "DRAFT", false)).toBe(true);
    expect(canTransition(role, "PUBLISHED", "ARCHIVED", false)).toBe(true);
  });

  it.each(["MODERATOR", "ADMIN"] as const)("lets %s edit any status", (role) => {
    for (const status of EDITORIAL_STATUSES) {
      expect(
        canEditTranslation(role, { editorialStatus: status, authorStaffUserId: OTHER_ID }, AUTHOR_ID),
        `${role} editing ${status}`,
      ).toBe(true);
    }
  });
});

describe("the transition table itself", () => {
  it("never allows a draft to reach the public without a review", () => {
    // The interesting property of the table is which moves are absent.
    for (const role of STAFF_ROLES) {
      expect(canTransition(role, "DRAFT", "PUBLISHED", true), role).toBe(false);
    }
  });

  it("has no duplicate or self-referential transition", () => {
    const seen = new Set<string>();
    for (const transition of TRANSITIONS) {
      const key = `${transition.from}->${transition.to}`;
      expect(seen.has(key), `duplicate transition ${key}`).toBe(false);
      expect(transition.from, "a transition to the same status is not a transition").not.toBe(
        transition.to,
      );
      seen.add(key);
    }
  });

  it("refuses an unknown move outright", () => {
    expect(canTransition("ADMIN", "ARCHIVED", "PUBLISHED", false)).toBe(false);
  });
});

describe("BR-REQ-051-01 criterion 4 live content is content that is published", () => {
  it.each(EDITORIAL_STATUSES)("says whether %s is live", (status) => {
    expect(isLiveContent(status)).toBe(status === "PUBLISHED");
  });
});

describe("BR-REQ-060-01 what each role may reach", () => {
  it("reserves staff administration to the Superadministrator", () => {
    // The top of the hierarchy is defined by this one capability: a role that could grant
    // itself a higher one would make every rule above it decorative. An Administrator reads the
    // whole participant list and still cannot change who else may.
    expect(canManageStaff("SUPERADMIN")).toBe(true);
    expect(canManageStaff("ADMIN")).toBe(false);
    expect(canManageStaff("DEV")).toBe(false);
    expect(canManageStaff("MODERATOR")).toBe(false);
    expect(canManageStaff("CONTRIBUTOR")).toBe(false);
  });

  it("reserves the event row — times, map link, featured — to editorial roles", () => {
    expect(canEditEventFields("ADMIN")).toBe(true);
    expect(canEditEventFields("MODERATOR")).toBe(true);
    expect(canEditEventFields("CONTRIBUTOR")).toBe(false);
  });
});

/**
 * BR-REQ-060-01 — the backoffice offers a role exactly the sections it may open.
 *
 * These exist because the layout did not consult any of the capabilities above. It tested
 * `role === "ADMIN"` for the whole group, and against five nesting roles that meant a
 * **SUPERADMIN was shown only the Events tab** — while migration `0016` had just turned every
 * existing ADMIN into a SUPERADMIN. Nothing was exposed; every page still refused on the
 * server. What broke was the reader's picture of the system, which is how four separate
 * "this feature is missing" reports came from one equality operator.
 *
 * The monotonicity test below is the one that would have caught it, and it is the reason this
 * is a pure function rather than a conditional inside a React component.
 */
describe("BR-REQ-060-01 which backoffice sections a role is offered", () => {
  it("gives every signed-in role the events section and nothing it may not open", () => {
    expect(visibleAdminSections("CONTRIBUTOR")).toEqual(["events"]);
    expect(visibleAdminSections("MODERATOR")).toEqual(["events"]);
  });

  it("gives DEV the configuration report and no participant data", () => {
    const sections = visibleAdminSections("DEV");

    expect(sections).toContain("devs");
    // The line that carries the weight (§38): DEV helps with the platform and never sees the
    // people who registered.
    expect(sections).not.toContain("registrations");
    expect(sections).not.toContain("staff");
  });

  it("gives ADMIN the registrations and the legal documents, but not staff administration", () => {
    const sections = visibleAdminSections("ADMIN");

    expect(sections).toEqual(["events", "registrations", "tasks", "legal", "devs"]);
    // An Administrator reads every registration and still cannot promote themselves.
    expect(sections).not.toContain("staff");
  });

  it("gives SUPERADMIN every section — the case that was broken", () => {
    expect(visibleAdminSections("SUPERADMIN")).toEqual([
      "events",
      "registrations",
      "tasks",
      "legal",
      "staff",
      "devs",
    ]);
  });

  it("never offers a higher role less than a lower one", () => {
    // The property, across every pair in the hierarchy. An equality test against a role name
    // fails this immediately, which is the whole point of asserting it rather than the lists.
    for (let lower = 0; lower < STAFF_ROLES.length; lower += 1) {
      for (let higher = lower; higher < STAFF_ROLES.length; higher += 1) {
        const lowerSections = visibleAdminSections(STAFF_ROLES[lower]);
        const higherSections = visibleAdminSections(STAFF_ROLES[higher]);

        for (const section of lowerSections) {
          expect(
            higherSections,
            `${STAFF_ROLES[higher]} must be offered everything ${STAFF_ROLES[lower]} is`,
          ).toContain(section);
        }
      }
    }
  });
});
