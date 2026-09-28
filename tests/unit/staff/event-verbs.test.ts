import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { eventListVerbs } from "@/modules/content/events/event-list-verbs";
import {
  canCreateEvent,
  canDeleteEvent,
  canEditEventFields,
  canEditTexts,
  canHardDeleteEvent,
  canMessageParticipants,
  canReadContent,
  canReadRegistrations,
  canSendNewsletter,
  canTransitionEvent,
  canWorkTheDesk,
  eventEditorTransitions,
  EDITORIAL_STATUSES,
  STAFF_ROLES,
  type StaffRole,
} from "@/modules/staff-identity/domain/roles";

/**
 * BR-REQ-060-01, §542 — «Organizatorul nu ar trebui să poată edita evenimentele» (the owner,
 * 2026-09-28). Every verb on an event, against every role, written out as the expected answer: a
 * change to one cell has to be made here on purpose. The Organizer keeps every read and every
 * registration and race-day verb it had; it makes no change to an event.
 */
const ORDER = ["MEMBER", "CONTRIBUTOR", "COPYWRITER", "MODERATOR", "DEV", "ADMIN", "SUPERADMIN"] as const;
type Row = readonly [boolean, boolean, boolean, boolean, boolean, boolean, boolean];

/** The verbs on an event, each as the service asserts it (`content/events/service.ts`). */
const EVENT_VERBS: Record<string, { gate: (role: StaffRole) => boolean; row: Row }> = {
  //                                                                        MEMBER CONTRIB COPYW  MODER  DEV    ADMIN  SUPER
  "create (createEvent, createEventAndPublish)": { gate: canCreateEvent, row: [false, false, false, false, false, true, true] },
  "save the settings (saveEventFields, saveEventAndTranslations)": { gate: canEditEventFields, row: [false, false, false, false, false, true, true] },
  "save the words (saveEventTranslation)": { gate: canEditTexts, row: [false, false, true, false, false, true, true] },
  "a series' dates (applyToSeries)": { gate: canEditEventFields, row: [false, false, false, false, false, true, true] },
  "cancel, and the update notice (readNoticeRequest)": { gate: canEditEventFields, row: [false, false, false, false, false, true, true] },
  "pictures, links, participation window, bib band, featured (the save)": { gate: canEditEventFields, row: [false, false, false, false, false, true, true] },
  "duplicate (duplicateEvent)": { gate: canCreateEvent, row: [false, false, false, false, false, true, true] },
  "repeat, stop, auto-publish a series": { gate: canCreateEvent, row: [false, false, false, false, false, true, true] },
  "publish (publishEvent)": { gate: (role) => canTransitionEvent(role, "IN_REVIEW", "PUBLISHED", false), row: [false, false, false, false, false, true, true] },
  "unpublish (PUBLISHED → DRAFT)": { gate: (role) => canTransitionEvent(role, "PUBLISHED", "DRAFT", false), row: [false, false, false, false, false, true, true] },
  "submit for review (DRAFT → IN_REVIEW)": { gate: (role) => canTransitionEvent(role, "DRAFT", "IN_REVIEW", false), row: [false, false, true, false, false, true, true] },
  "return to draft (IN_REVIEW → DRAFT)": { gate: (role) => canTransitionEvent(role, "IN_REVIEW", "DRAFT", false), row: [false, false, false, false, false, true, true] },
  "archive a draft (DRAFT → ARCHIVED)": { gate: (role) => canTransitionEvent(role, "DRAFT", "ARCHIVED", false), row: [false, false, false, false, false, true, true] },
  "bring back from the archive (ARCHIVED → DRAFT)": { gate: (role) => canTransitionEvent(role, "ARCHIVED", "DRAFT", false), row: [false, false, false, false, false, true, true] },
  "delete (deleteEvent)": { gate: canDeleteEvent, row: [false, false, false, false, false, true, true] },
  "erase with its registrations (hardDeleteEvent)": { gate: canHardDeleteEvent, row: [false, false, false, false, false, true, true] },
  // What the Organizer keeps (§289, §67, §364, §445), unchanged by §542.
  "read the event (the editor, read-only)": { gate: canReadContent, row: [false, false, true, true, true, true, true] },
  "read the registrations, the export, the numbers, the queue (§289)": { gate: canReadRegistrations, row: [false, false, false, true, false, true, true] },
  "the race-day desk (§67)": { gate: canWorkTheDesk, row: [false, true, true, true, true, true, true] },
  "«Trimite un mesaj participanților» (§364)": { gate: canMessageParticipants, row: [false, false, false, true, false, true, true] },
  "the newsletter (§445)": { gate: canSendNewsletter, row: [false, false, false, true, false, true, true] },
};

describe("BR-REQ-060-01 §542 every event verb × every role", () => {
  it("names the roles in their order", () => {
    expect([...STAFF_ROLES]).toEqual([...ORDER]);
  });

  for (const [verb, { gate, row }] of Object.entries(EVENT_VERBS)) {
    it.each(ORDER.map((role, index) => [role, row[index]] as const))(`${verb}: %s is %s`, (role, expected) => {
      expect(gate(role)).toBe(expected);
    });
  }

  it("offers the Organizer and the Tehnic no move on an event from any status, in the editor either", () => {
    for (const role of ["MODERATOR", "DEV"] as const) {
      for (const from of EDITORIAL_STATUSES) {
        expect(eventEditorTransitions(role, from, false), `${role} from ${from}`).toEqual([]);
        expect(eventEditorTransitions(role, from, true), `${role} from ${from}, own`).toEqual([]);
        for (const to of EDITORIAL_STATUSES) expect(canTransitionEvent(role, from, to, true), `${role} ${from}→${to}`).toBe(false);
      }
    }
  });
});

describe("BR-REQ-060-01 §542 the events list offers each role only what its services accept", () => {
  it("offers the Organizer the list's reads and no verb that changes an event", () => {
    expect(eventListVerbs("MODERATOR")).toEqual({
      create: false,
      edit: false,
      select: false,
      duplicate: false,
      remove: false,
      hardDelete: false,
      publish: false,
      switchSeries: false,
      readRegistrations: true,
    });
  });

  it("offers the Administrator and the Superadministrator every verb", () => {
    for (const role of ["ADMIN", "SUPERADMIN"] as const) {
      expect(Object.values(eventListVerbs(role)).every(Boolean), role).toBe(true);
    }
  });

  it("gives the Redactor the pencil for the words and nothing else, and the Tehnic nothing", () => {
    expect(eventListVerbs("COPYWRITER")).toMatchObject({ edit: true, create: false, select: false, duplicate: false, remove: false, publish: false, readRegistrations: false });
    expect(Object.values(eventListVerbs("DEV")).some(Boolean)).toBe(false);
  });

  it("asks, per verb, the gate its service asserts", () => {
    for (const role of STAFF_ROLES) {
      const verbs = eventListVerbs(role);
      expect(verbs.create, role).toBe(canCreateEvent(role));
      expect(verbs.duplicate, role).toBe(canCreateEvent(role));
      expect(verbs.edit, role).toBe(canEditEventFields(role) || canEditTexts(role));
      expect(verbs.remove, role).toBe(canDeleteEvent(role));
      expect(verbs.hardDelete, role).toBe(canHardDeleteEvent(role));
      expect(verbs.publish, role).toBe(canTransitionEvent(role, "IN_REVIEW", "PUBLISHED", false));
      expect(verbs.readRegistrations, role).toBe(canReadRegistrations(role));
    }
  });

  it("is what the list draws: «Eveniment nou», the ticks, the ⋮'s verbs and the pencil or the eye", () => {
    const page = readFileSync(path.join(process.cwd(), "src/app/[locale]/admin/(list)/page.tsx"), "utf8");
    expect(page).toContain("const verbs = eventListVerbs(staffUser.role);");
    expect(page).toContain("{verbs.create && (");
    expect(page).toContain("{lines.length > 0 && verbs.select && (");
    expect(page).toContain("{verbs.duplicate && (");
    expect(page).toContain("...(verbs.duplicate");
    expect(page).toContain('verbs.edit ? "event-row-edit" : "event-row-open"');
    // No role check of its own beside the verbs, but the two reads it had.
    expect(page).not.toMatch(/canCreateEvent\(|canDeleteEvent\(|canHardDeleteEvent\(|canTransition\(/);
  });

  it("says in the editor that the event is read-only for a role that saves nothing", () => {
    const editor = readFileSync(path.join(process.cwd(), "src/app/[locale]/admin/events/[id]/page.tsx"), "utf8");
    expect(editor).toContain('{!maySaveAnything && (');
    expect(editor).toContain('t("editor.readOnly")');
  });
});
