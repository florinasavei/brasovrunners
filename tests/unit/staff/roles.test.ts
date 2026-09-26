import { describe, expect, it } from "vitest";
import type { AdminSection } from "@/modules/staff-identity/domain/roles";
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
  canReadRegistrations,
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

  it("lets the copywriter edit text at any status, live included, and refuses the organizer (§207)", () => {
    /*
      The open half of §201. Editing the words of a published page is the remaining way
      something reaches the public without the Administrator, and closing it would reverse
      BR-REQ-051-01 criterion 3 — "a copywriter edits live text with the acknowledgement" —
      for the copywriter as well as the organizer, because the organizer sits above them.
      That is the club's decision to take, so this asserts what is true today and will be
      changed the day the club takes it.
    */
    /*
      §207 broke the ladder at exactly one capability. "Tot ce vreau e ca organizatorul să nu fie
      și redactor… Redactorul scrie, Organizatorul organizează." A rank hierarchy cannot express
      that — rank would hand the Organizer the Redactor's work simply for sitting above them — so
      `canEditTexts` is a set, and this is both halves of it.
    */
    for (const status of EDITORIAL_STATUSES) {
      expect(
        canEditTranslation("COPYWRITER", { editorialStatus: status, authorStaffUserId: OTHER_ID }, AUTHOR_ID),
        `copywriter editing ${status}`,
      ).toBe(true);
      expect(
        canEditTranslation("MODERATOR", { editorialStatus: status, authorStaffUserId: OTHER_ID }, AUTHOR_ID),
        `organizer editing ${status}`,
      ).toBe(false);
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

  /*
    `DECISIONS.md` §289 — the Organizer reads who signed up and changes nothing.

    The owner: "ca si organizator ar trebui sa vad cine s-a inscris!", and then "organizer should
    also be able to see BIDs and export them". Asked how far, he chose the whole list — addresses,
    telephone numbers, the identity document, the signed declarations and the spreadsheet — with
    no verb on it.

    Two properties matter and both are asserted, because the change moved a boundary this file
    had defended since §10.2: reading is no longer what ADMIN is for, and DEV must not have
    followed MODERATOR through the door.
  */
  it("gives the Organizer the whole list to read, and no verb on it (§289)", () => {
    expect(canReadRegistrations("MODERATOR")).toBe(true);
    expect(canManageRegistrations("MODERATOR")).toBe(false);

    // Unchanged on either side of the new line.
    expect(canReadRegistrations("ADMIN")).toBe(true);
    expect(canManageRegistrations("ADMIN")).toBe(true);
    expect(canReadRegistrations("COPYWRITER")).toBe(false);
    expect(canReadRegistrations("CONTRIBUTOR")).toBe(false);
  });

  it("keeps DEV away from the participant list although it outranks the Organizer (§289)", () => {
    // The assertion the whole DEV role exists for (§38): somebody helping with the platform
    // reads `/devs`, reproduces a problem and fixes an event, and never receives the club's
    // participants. A threshold at MODERATOR would have handed them over silently.
    expect(canReadRegistrations("DEV")).toBe(false);
    expect(canManageRegistrations("DEV")).toBe(false);
  });

  it("never lets a role change a registration it may not read", () => {
    // The direction that would be a real hole: managing without reading. The reverse — reading
    // without managing — is exactly what §289 introduced.
    for (const role of STAFF_ROLES) {
      if (canManageRegistrations(role)) expect(canReadRegistrations(role), role).toBe(true);
    }
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
    /*
      From the copywriter up, the sections are what a role may *look* at (§208): reading the
      club's content and changing it are two questions now, and the navigation asks the first.
      The Organizer sees the same content as the copywriter and changes none of it — "Dani îi
      zice Amaliei să modifice X, Y lucru".
    */
    // "emails" joins them in §253: the messages and the words in them are the Redactor's work
    // (§247), and the panels behind that page ask their own questions — the queue and the
    // club's copies are read only for a role that may see a participant's address (§243, §244).
    // "tasks" joins them in §NNN: «Sarcini» → «De făcut», the club's own checklist, is read by
    // every role from the copywriter up — only the Organizer and the Administrators write it,
    // and the panels read from the system stay the Administrator's (`task-panels.test.ts`).
    expect(visibleAdminSections("COPYWRITER")).toEqual([
      "events",
      "checkin",
      "guide",
      "pages",
      "gallery",
      "tasks",
      "legal",
      "emails",
    ]);
    // The Organizer gained the registrations in §289 — the owner: "ca si organizator ar trebui
    // sa vad cine s-a inscris!" — and gained no verb on them. What that section offers this role
    // is the list, the export and the race numbers; `rowVerbsFor` and the panels on the page are
    // where the absence of cancel, erase and resend is asserted.
    // «Newsletter» (§NNN): the Organizer writes to the subscribers as they write to an event's
    // participants (§364) — the page's own entry since the owner's 2026-09-26 "un meniu suplimentar".
    expect(visibleAdminSections("MODERATOR")).toEqual([
      "events",
      "checkin",
      "guide",
      "pages",
      "gallery",
      "registrations",
      "tasks",
      "legal",
      "emails",
      "newsletter",
    ]);
  });

  it("gives DEV the configuration report and no participant data", () => {
    const sections = visibleAdminSections("DEV");

    expect(sections).toContain("devs");
    // Since §397, DEV (Tehnic) is also offered `tasks` — the «Aplicația» panel of it, and since
    // §NNN «De făcut» read-only; the page itself refuses the club's ops panels to this role
    // (`task-panels.test.ts`).
    expect(sections).toContain("tasks");
    // The line that carries the weight (§38): DEV helps with the platform and never sees the
    // people who registered.
    expect(sections).not.toContain("registrations");
    expect(sections).not.toContain("staff");
    // Nor writes to anybody: the newsletter is the club speaking, never the platform's helper (§NNN).
    expect(sections).not.toContain("newsletter");
  });

  it("gives ADMIN the registrations and the legal documents, but not staff administration", () => {
    const sections = visibleAdminSections("ADMIN");

    expect(sections).toEqual(["events", "checkin", "guide", "pages", "gallery", "registrations", "tasks", "legal", "emails", "newsletter", "devs"]);
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
      "emails",
      "newsletter",
      "staff",
      "devs",
    ]);
  });

  /*
    **The one row where the table is deliberately not monotone (§289, §NNN).**

    DEV outranks MODERATOR, and since the Organizer was given the registrations it is offered one
    section DEV is not. That is the point of DEV rather than an oversight — it is the role the
    club hands somebody helping with the platform, and §38 and the test above both promise such a
    person never receives the participant list. «Newsletter» (§NNN) is the second cell of the same
    row: the Organizer writes to the subscribers as they write to an event's participants (§364,
    `canSendNewsletter` is `canMessageParticipants`), and the platform's helper writes to nobody.

    Written as an exception the property test skips, and then asserted on its own below, so that
    it stays exactly these cells. A weakened invariant with nothing guarding the weakening is how
    the defect this whole block exists for got in.
  */
  const NOT_INHERITED_BY_DEV = new Set<AdminSection>(["registrations", "newsletter"]);

  it("never offers a higher role less than a lower one, apart from DEV, the participant list and the newsletter", () => {
    // The property, across every pair in the hierarchy. An equality test against a role name
    // fails this immediately, which is the whole point of asserting it rather than the lists.
    for (let lower = 0; lower < STAFF_ROLES.length; lower += 1) {
      for (let higher = lower; higher < STAFF_ROLES.length; higher += 1) {
        const lowerSections = visibleAdminSections(STAFF_ROLES[lower]);
        const higherSections = visibleAdminSections(STAFF_ROLES[higher]);

        for (const section of lowerSections) {
          if (STAFF_ROLES[higher] === "DEV" && NOT_INHERITED_BY_DEV.has(section)) continue;
          expect(
            higherSections,
            `${STAFF_ROLES[higher]} must be offered everything ${STAFF_ROLES[lower]} is`,
          ).toContain(section);
        }
      }
    }
  });

  it("keeps the exception to exactly those two sections, and only for DEV", () => {
    // What the skip above is allowed to hide. Any second hole in the ladder fails here rather
    // than passing quietly inside the loop.
    for (let lower = 0; lower < STAFF_ROLES.length; lower += 1) {
      for (let higher = lower; higher < STAFF_ROLES.length; higher += 1) {
        const missing = visibleAdminSections(STAFF_ROLES[lower]).filter(
          (section) => !visibleAdminSections(STAFF_ROLES[higher]).includes(section),
        );
        const allowed =
          STAFF_ROLES[higher] === "DEV" ? [...NOT_INHERITED_BY_DEV].filter((section) => missing.includes(section)) : [];

        expect(missing, `${STAFF_ROLES[higher]} against ${STAFF_ROLES[lower]}`).toEqual(allowed);
      }
    }
  });
});
