import { describe, expect, it } from "vitest";
import {
  allowedTransitions,
  canCreatePage,
  canDeleteEvent,
  canEditEventFields,
  canEditTexts,
  canEditTranslation,
  canHardDeleteEvent,
  canManageRegistrations,
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

describe("BR-REQ-051-01 criterion 1 a copywriter works on the words, a volunteer on none (§103)", () => {
  it("lets a copywriter edit any text, theirs or a colleague's, at any status", () => {
    for (const status of EDITORIAL_STATUSES) {
      expect(
        canEditTranslation("COPYWRITER", { editorialStatus: status, authorStaffUserId: OTHER_ID }, AUTHOR_ID),
        `copywriter editing ${status}`,
      ).toBe(true);
    }
  });

  it("refuses a volunteer every text, even a draft they are named on", () => {
    for (const status of EDITORIAL_STATUSES) {
      expect(
        canEditTranslation("CONTRIBUTOR", { editorialStatus: status, authorStaffUserId: AUTHOR_ID }, AUTHOR_ID),
        `volunteer editing ${status}`,
      ).toBe(false);
    }
  });

  it("lets a copywriter submit a draft for review and nothing else; a volunteer nothing at all", () => {
    expect(allowedTransitions("COPYWRITER", "DRAFT", true)).toEqual(["IN_REVIEW"]);
    expect(allowedTransitions("COPYWRITER", "DRAFT", false)).toEqual(["IN_REVIEW"]);
    expect(allowedTransitions("COPYWRITER", "IN_REVIEW", true)).toEqual([]);
    expect(allowedTransitions("COPYWRITER", "PUBLISHED", true)).toEqual([]);
    for (const from of EDITORIAL_STATUSES) expect(allowedTransitions("CONTRIBUTOR", from, true)).toEqual([]);
  });
});

describe("BR-REQ-051-01 criterion 3 publishing is out of a copywriter's hands", () => {
  it.each(["COPYWRITER", "CONTRIBUTOR"] as const)("never lets %s publish, whatever the starting status", (role) => {
    for (const from of EDITORIAL_STATUSES) {
      expect(canTransition(role, from, "PUBLISHED", true), `from ${from}`).toBe(false);
    }
  });

  it("keeps the event row and the pages' order and deletion above the copywriter", () => {
    expect(canEditEventFields("COPYWRITER")).toBe(false);
    expect(canEditTexts("COPYWRITER")).toBe(true);
    expect(canEditTexts("CONTRIBUTOR")).toBe(false);
    expect(canCreatePage("COPYWRITER")).toBe(true);
    expect(canCreatePage("CONTRIBUTOR")).toBe(false);
  });
});

/**
 * BR-REQ-051-01 criterion 2 and `DECISIONS.md` §201 — **crossing into or out of public view is
 * the Administrator's**.
 *
 * The owner, of his two colleagues: "Amalia e Administrator, Dani e Organizator dar poate face
 * prostii, deci trebuie manageuit de Amalia". The rule is one sentence — below Administrator,
 * nothing the public can see changes — and these assertions are that sentence from both sides.
 */
describe("BR-REQ-051-01 criterion 2 the Administrator publishes", () => {
  it("lets an Administrator publish a reviewed draft", () => {
    expect(canTransition("ADMIN", "IN_REVIEW", "PUBLISHED", false)).toBe(true);
  });

  it("refuses the organizer, who prepares it and asks", () => {
    expect(canTransition("MODERATOR", "IN_REVIEW", "PUBLISHED", false)).toBe(false);
  });

  it("lets an Administrator unpublish and archive what is live", () => {
    expect(canTransition("ADMIN", "PUBLISHED", "DRAFT", false)).toBe(true);
    expect(canTransition("ADMIN", "PUBLISHED", "ARCHIVED", false)).toBe(true);
  });

  it("refuses the organizer both, because both change what the public sees", () => {
    expect(canTransition("MODERATOR", "PUBLISHED", "DRAFT", false)).toBe(false);
    expect(canTransition("MODERATOR", "PUBLISHED", "ARCHIVED", false)).toBe(false);
  });

  it("leaves the organizer everything that never reaches the public", () => {
    // Returning a submission to its author, and archiving something that was never live.
    expect(canTransition("MODERATOR", "IN_REVIEW", "DRAFT", false)).toBe(true);
    expect(canTransition("MODERATOR", "DRAFT", "ARCHIVED", false)).toBe(true);
    expect(canTransition("MODERATOR", "IN_REVIEW", "ARCHIVED", false)).toBe(true);
    expect(canTransition("MODERATOR", "ARCHIVED", "DRAFT", false)).toBe(true);
  });

  it("lets an Administrator edit at any status, live included", () => {
    for (const status of EDITORIAL_STATUSES) {
      expect(
        canEditTranslation("ADMIN", { editorialStatus: status, authorStaffUserId: OTHER_ID }, AUTHOR_ID),
        `administrator editing ${status}`,
      ).toBe(true);
    }
  });

  it("still lets the copywriter and the organizer edit text at any status, live included", () => {
    /*
      The open half of §201. Editing the words of a published page is the remaining way
      something reaches the public without the Administrator, and closing it would reverse
      BR-REQ-051-01 criterion 3 — "a copywriter edits live text with the acknowledgement" —
      for the copywriter as well as the organizer, because the organizer sits above them.
      That is the club's decision to take, so this asserts what is true today and will be
      changed the day the club takes it.
    */
    for (const status of EDITORIAL_STATUSES) {
      for (const role of ["COPYWRITER", "MODERATOR"] as const) {
        expect(
          canEditTranslation(role, { editorialStatus: status, authorStaffUserId: OTHER_ID }, AUTHOR_ID),
          `${role} editing ${status}`,
        ).toBe(true);
      }
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
    expect(canManageStaff("COPYWRITER")).toBe(false);
    expect(canManageStaff("CONTRIBUTOR")).toBe(false);
  });

  it("reserves the hard delete — an event and everyone on it — to the Administrator, and no higher", () => {
    // Both halves of it, because it is the conjunction of two powers: deleting club content
    // and destroying participant data. The interesting assertion is the SUPERADMIN one — the
    // temptation is to reserve the most destructive verb to the highest role, and that would be
    // wrong: SUPERADMIN is defined by staff administration, not by danger, and an Administrator
    // may already erase each of these registrations one at a time. The gate that protects the
    // data is the typed title, the reason and the audit rows, not a rank.
    expect(canHardDeleteEvent("SUPERADMIN")).toBe(true);
    expect(canHardDeleteEvent("ADMIN")).toBe(true);
    // DEV is the boundary worth naming: above MODERATOR, and still on the wrong side of the
    // personal-data line this verb crosses.
    expect(canHardDeleteEvent("DEV")).toBe(false);
    expect(canHardDeleteEvent("MODERATOR")).toBe(false);
    expect(canHardDeleteEvent("COPYWRITER")).toBe(false);
    expect(canHardDeleteEvent("CONTRIBUTOR")).toBe(false);

    // And it never grants more than the two verbs it is built from: a role that may not delete
    // an event, or may not touch registrations, may not do both at once either.
    for (const role of STAFF_ROLES) {
      expect(canHardDeleteEvent(role), role).toBe(canDeleteEvent(role) && canManageRegistrations(role));
    }
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
  it("gives each role the sections it may open and nothing it may not", () => {
    // The desk is every role's (BR-REQ-037-08, `DECISIONS.md` §67), and since §103 it is the
    // volunteer's whole backoffice: a person handing out numbers is not offered the events.
    expect(visibleAdminSections("CONTRIBUTOR")).toEqual(["checkin", "guide"]);
    // The copywriter: the events (their texts), the desk, the pages — no gallery, no settings.
    expect(visibleAdminSections("COPYWRITER")).toEqual(["events", "checkin", "guide", "pages"]);
    // An Organizer gains the gallery (BR-REQ-050-03): pictures sit with the roles that
    // configure an event, where an event's own settings already sit.
    expect(visibleAdminSections("MODERATOR")).toEqual(["events", "checkin", "guide", "pages", "gallery"]);
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

    expect(sections).toEqual(["events", "checkin", "guide", "pages", "gallery", "registrations", "tasks", "legal", "devs"]);
    // An Administrator reads every registration and still cannot promote themselves.
    expect(sections).not.toContain("staff");
  });

  it("gives SUPERADMIN every section — the case that was broken", () => {
    expect(visibleAdminSections("SUPERADMIN")).toEqual([
      "events",
      "checkin",
      "guide",
      "pages",
      "gallery",
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
