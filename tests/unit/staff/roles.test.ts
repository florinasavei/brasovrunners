import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { AdminSection, StaffRole } from "@/modules/staff-identity/domain/roles";
import * as roles from "@/modules/staff-identity/domain/roles";
import {
  allowedTransitions,
  assignableRoles,
  canAssignRole,
  canCreatePage,
  canDeleteEvent,
  canEditEventFields,
  canEditTexts,
  canEditTranslation,
  canHardDeleteEvent,
  canManageMember,
  canManagePlatform,
  canManageRegistrations,
  canManageStaff,
  canReadRegistrations,
  canWriteLegalTexts,
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
 * The owner, of his two colleagues: "[colega] e Administrator, [colegul] e Organizator dar poate
 * face prostii, deci trebuie manageuit de [ea]". The rule is one sentence — below Administrator,
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
  it("gives the team to the Administrator and everyone above (§450)", () => {
    // The owner: "administrators should manage everything". Staff administration moved down one
    // rung; what a role could grant itself is held by `canAssignRole` and `canManageMember` below.
    expect(canManageStaff("SUPERADMIN")).toBe(true);
    expect(canManageStaff("ADMIN")).toBe(true);
    expect(canManageStaff("DEV")).toBe(false);
    expect(canManageStaff("MODERATOR")).toBe(false);
    expect(canManageStaff("COPYWRITER")).toBe(false);
    expect(canManageStaff("CONTRIBUTOR")).toBe(false);
  });

  it("lets only a Superadministrator make, change or remove a Superadministrator (§450)", () => {
    // An Administrator gives every role up to their own, and never the top one — so no
    // Administrator can promote a colleague (or a second account of their own) past themselves.
    expect(assignableRoles("ADMIN")).toEqual(["CONTRIBUTOR", "COPYWRITER", "MODERATOR", "DEV", "ADMIN"]);
    expect(assignableRoles("SUPERADMIN")).toEqual([...STAFF_ROLES]);
    expect(canAssignRole("ADMIN", "SUPERADMIN")).toBe(false);
    expect(canAssignRole("SUPERADMIN", "SUPERADMIN")).toBe(true);
    expect(canManageMember("ADMIN", "SUPERADMIN")).toBe(false);
    expect(canManageMember("ADMIN", "ADMIN")).toBe(true);
    expect(canManageMember("SUPERADMIN", "SUPERADMIN")).toBe(true);

    // Below the Administrator nobody gives or touches anything, whatever the target.
    for (const actor of STAFF_ROLES.filter((role) => !canManageStaff(role))) {
      expect(assignableRoles(actor), actor).toEqual([]);
      for (const target of STAFF_ROLES) expect(canManageMember(actor, target), `${actor} on ${target}`).toBe(false);
    }
    // And the one property that makes the ladder safe: nobody gives a role above their own.
    const rank = (role: (typeof STAFF_ROLES)[number]) => STAFF_ROLES.indexOf(role);
    for (const actor of STAFF_ROLES) {
      for (const role of assignableRoles(actor)) expect(rank(role), `${actor} gives ${role}`).toBeLessThanOrEqual(rank(actor));
    }
  });

  it("gives the club's legal texts to the Administrator (§450)", () => {
    expect(canWriteLegalTexts("SUPERADMIN")).toBe(true);
    expect(canWriteLegalTexts("ADMIN")).toBe(true);
    // The Organizer and the Redactor read the texts (§208) and write none of them.
    expect(canWriteLegalTexts("DEV")).toBe(false);
    expect(canWriteLegalTexts("MODERATOR")).toBe(false);
    expect(canWriteLegalTexts("COPYWRITER")).toBe(false);
    expect(canWriteLegalTexts("CONTRIBUTOR")).toBe(false);
  });

  it("keeps the platform settings that can stop the service to the Superadministrator (§450)", () => {
    // "superadministrator is more like administrator + platform configs that can break stuff
    // (throttling, etc)": the one capability that tells the top two roles apart.
    expect(canManagePlatform("SUPERADMIN")).toBe(true);
    for (const role of STAFF_ROLES.filter((r) => r !== "SUPERADMIN")) {
      expect(canManagePlatform(role), role).toBe(false);
    }
  });

  it("reserves the hard delete — an event and everyone on it — to the Administrator, and no higher", () => {
    // Both halves of it, because it is the conjunction of two powers: deleting club content
    // and destroying participant data. The interesting assertion is the SUPERADMIN one — the
    // temptation is to reserve the most destructive verb to the highest role, and that would be
    // wrong: SUPERADMIN is defined by the platform's settings (§450), not by what destroys club
    // data, and an Administrator
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
      The Organizer sees the same content as the copywriter and changes none of it — "organizatorul îi
      zice administratorului să modifice X, Y lucru".
    */
    // "emails" joins them in §253: the messages and the words in them are the Redactor's work
    // (§247), and the panels behind that page ask their own questions — the queue and the
    // club's copies are read only for a role that may see a participant's address (§243, §244).
    // "tasks" joins them in §438: «Sarcini» → «De făcut», the club's own checklist, is read by
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
    // «Newsletter» (§445): the Organizer writes to the subscribers as they write to an event's
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
    // §438 «De făcut» read-only; the page itself refuses the club's ops panels to this role
    // (`task-panels.test.ts`).
    expect(sections).toContain("tasks");
    // The line that carries the weight (§38): DEV helps with the platform and never sees the
    // people who registered.
    expect(sections).not.toContain("registrations");
    expect(sections).not.toContain("staff");
    // Nor writes to anybody: the newsletter is the club speaking, never the platform's helper (§445).
    expect(sections).not.toContain("newsletter");
  });

  it("gives ADMIN every section, the team included (§450)", () => {
    // The Administrator runs the club; what they cannot do on the team page — make or touch a
    // Superadministrator — is refused per row and in the service, not by hiding the section.
    expect(visibleAdminSections("ADMIN")).toEqual([
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
    **The one row where the table is deliberately not monotone (§289, §445).**

    DEV outranks MODERATOR, and since the Organizer was given the registrations it is offered one
    section DEV is not. That is the point of DEV rather than an oversight — it is the role the
    club hands somebody helping with the platform, and §38 and the test above both promise such a
    person never receives the participant list. «Newsletter» (§445) is the second cell of the same
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

/**
 * BR-REQ-060-01, §450 — the whole matrix, as data. Every single-role capability `domain/roles.ts`
 * exports, against every role, written out as the expected answer rather than derived from the
 * ladder: a change to any one cell has to be made here too, on purpose. The first test refuses a
 * capability exported without a row, so the table cannot fall behind the module.
 */
describe("BR-REQ-060-01 every capability × every role", () => {
  // Columns in STAFF_ROLES order: Voluntar, Redactor, Organizator, Tehnic, Administrator, Superadministrator.
  const ORDER = ["CONTRIBUTOR", "COPYWRITER", "MODERATOR", "DEV", "ADMIN", "SUPERADMIN"] as const;
  const MATRIX: Record<string, readonly [boolean, boolean, boolean, boolean, boolean, boolean]> = {
    //                          CONTRIB COPYW  MODER  DEV    ADMIN  SUPER
    isEditorial: /*           */ [false, false, true, true, true, true],
    canEditTexts: /*          */ [false, true, false, false, true, true],
    canEditEventFields: /*    */ [false, false, true, true, true, true],
    canCreateEvent: /*        */ [false, false, false, false, true, true],
    canCreatePage: /*         */ [false, true, false, false, true, true],
    canEditTeamPage: /*       */ [false, true, false, false, true, true],
    canShowTeamMember: /*     */ [false, false, false, false, true, true],
    canDeleteEvent: /*        */ [false, false, false, false, true, true],
    canHardDeleteEvent: /*    */ [false, false, false, false, true, true],
    canReadRegistrations: /*  */ [false, false, true, false, true, true],
    canMessageParticipants: /**/ [false, false, true, false, true, true],
    canSendNewsletter: /*     */ [false, false, true, false, true, true],
    canTranslateTexts: /*     */ [false, true, true, false, true, true],
    canManageRegistrations: /**/ [false, false, false, false, true, true],
    canWorkTheDesk: /*        */ [true, true, true, true, true, true],
    canManageTestRegistrations: [false, false, false, false, true, true],
    canSeeDiagnostics: /*     */ [false, false, false, true, true, true],
    canManageStaff: /*        */ [false, false, false, false, true, true],
    isSuperadmin: /*          */ [false, false, false, false, false, true],
    canWriteLegalTexts: /*    */ [false, false, false, false, true, true],
    canManagePlatform: /*     */ [false, false, false, false, false, true],
    canManageClubSettings: /* */ [false, false, false, false, true, true],
    canReadContent: /*        */ [false, true, true, true, true, true],
  };
  // Exported functions of one argument that are not about a role.
  const NOT_A_ROLE_CAPABILITY = new Set(["isLiveContent", "assignableRoles", "visibleAdminSections", "atLeast"]);
  const capability = (name: string) => (roles as unknown as Record<string, (role: StaffRole) => boolean>)[name];

  it("has a row for every capability the module exports, and the roles in their order", () => {
    expect([...STAFF_ROLES]).toEqual([...ORDER]);
    const exported = Object.entries(roles)
      .filter(([name, value]) => typeof value === "function" && /^(can|is)[A-Z]/.test(name) && !NOT_A_ROLE_CAPABILITY.has(name))
      .filter(([, value]) => (value as (...args: unknown[]) => unknown).length === 1)
      .map(([name]) => name)
      .sort();
    expect(exported).toEqual(Object.keys(MATRIX).sort());
  });

  for (const [name, row] of Object.entries(MATRIX)) {
    it.each(ORDER.map((role, index) => [role, row[index]] as const))(`${name}(%s) is %s`, (role, expected) => {
      expect(capability(name)(role)).toBe(expected);
    });
  }

  // Actor (row) × target (column), in STAFF_ROLES order. The Administrator gives and touches every
  // role but the top one; the Superadministrator every role; nobody below the Administrator any.
  const PAIRS: Record<StaffRole, readonly [boolean, boolean, boolean, boolean, boolean, boolean]> = {
    CONTRIBUTOR: [false, false, false, false, false, false],
    COPYWRITER: [false, false, false, false, false, false],
    MODERATOR: [false, false, false, false, false, false],
    DEV: [false, false, false, false, false, false],
    ADMIN: [true, true, true, true, true, false],
    SUPERADMIN: [true, true, true, true, true, true],
  };
  const pairs = ORDER.flatMap((actor) => ORDER.map((target, index) => [actor, target, PAIRS[actor][index]] as const));

  it.each(pairs)("canAssignRole(%s, %s) is %s", (actor, target, expected) => {
    expect(canAssignRole(actor, target)).toBe(expected);
  });

  it.each(pairs)("canManageMember(%s, %s) is %s", (actor, target, expected) => {
    expect(canManageMember(actor, target)).toBe(expected);
  });

  it.each(ORDER)("assignableRoles(%s) is exactly the targets canAssignRole allows", (actor) => {
    expect(assignableRoles(actor)).toEqual(ORDER.filter((_, index) => PAIRS[actor][index]));
  });
});

/**
 * BR-REQ-060-01, §450 — the doors the V2.03 batch added, each on the side of the line it belongs to.
 *
 * The roles branch drew the line (the Administrator runs the club; the Superadministrator adds the
 * settings that can stop the service) while the batch was adding settings of its own. Each one is
 * pinned here by the predicate its action asks at the door and its service asserts again, so a
 * later move of any of them is made on purpose, in this file.
 */
describe("BR-REQ-060-01 the batch's own settings ask the right predicate (§450)", () => {
  const source = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");
  /** The body of one exported action, up to the next export. */
  const action = (file: string, name: string) => {
    const text = source(file);
    const start = text.indexOf(`export async function ${name}(`);
    expect(start, `${file}: ${name}`).toBeGreaterThan(-1);
    const next = text.indexOf("\nexport ", start + 1);
    return text.slice(start, next === -1 ? undefined : next);
  };

  it("«Prin ce pleacă emailurile» (§443) is a club setting: the Administrator's", () => {
    expect(action("src/app/[locale]/admin/emails/actions.ts", "updateEmailTransportAction")).toContain("requireStaffCapability(canManageClubSettings)");
    expect(source("src/modules/notifications/email-transport.ts")).toMatch(/if \(!canManageClubSettings\(actor\.role\)\)/);
  });

  it("«Adresa de contact afișată» (§442) is a club setting: the Administrator's", () => {
    expect(action("src/app/[locale]/admin/emails/actions.ts", "updateShownContactAddressAction")).toContain("requireStaffCapability(canManageClubSettings)");
    expect(source("src/modules/contact/shown-address.ts")).toMatch(/if \(!canManageClubSettings\(actor\.role\)\)/);
  });

  it("the month's budget thresholds (§447) are a platform setting: the Superadministrator's, form included", () => {
    expect(action("src/app/[locale]/admin/tasks/actions.ts", "updateBudgetThresholdsAction")).toContain("requireStaffCapability(canManagePlatform)");
    expect(source("src/modules/diagnostics/budget-thresholds.ts")).toMatch(/if \(!canManagePlatform\(actor\.role\)\)/);
    expect(source("src/app/[locale]/admin/tasks/page.tsx")).toMatch(/<NeonBudgetPanel [^>]*mayEdit=\{canManagePlatform\(actor\.role\)\}/);
    expect([canManagePlatform("ADMIN"), canManagePlatform("SUPERADMIN")]).toEqual([false, true]);
  });

  it("removing a newsletter address by hand (§445) is a registrations verb: the Administrator's", () => {
    expect(action("src/app/[locale]/admin/newsletter/actions.ts", "withdrawNewsletterAddressAction")).toContain("requireStaffCapability(canManageRegistrations)");
    expect(source("src/modules/newsletter/service.ts")).toMatch(/if \(!canManageRegistrations\(actor\.role\)\)/);
  });
});
