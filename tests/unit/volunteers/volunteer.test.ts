import { describe, expect, it } from "vitest";
import ro from "../../../messages/ro.json";
import en from "../../../messages/en.json";
import { RETENTION_PERIODS } from "@/modules/jobs/domain/retention-periods";
import { RETENTION } from "@/modules/jobs/retention";
import { describesVolunteers, mergeText, VOLUNTEERS_MERGE_FIELD } from "@/modules/legal-documents/domain/merge-fields";
import { typedPhone } from "@/modules/registrations/answers";
import { privacyNoticeEn, privacyNoticeRo } from "@/modules/legal-documents/templates/privacy-notice";
import { DECLARATION_TOKENS } from "@/modules/legal-documents/templates/tokens";
import { buildVolunteersCsv } from "@/modules/volunteers/csv";
import {
  compareRoles,
  countsAgainstRole,
  refusedFields,
  someRoleNeedsPeople,
  standingOf,
  volunteerBoxRoles,
  volunteerEventAhead,
  volunteerOfferClosedFor,
  volunteerPublicInputSchema,
  volunteerRoleInputSchema,
  volunteerStaffInputSchema,
} from "@/modules/volunteers/domain/volunteer";
import { volunteersClause, volunteersMergeValues } from "@/modules/volunteers/notice-words";
import { parseVolunteerBoxes, parseVolunteerOutcome } from "@/modules/volunteers/ui/volunteer-box";

/**
 * §754 — volunteers for a race, the pure part: what a role and a person may be, how a role stands
 * («N din M»), the three conditions that open the public form, the notice's marker, the retention
 * the notice promises, and the CSV's safety. No database.
 */
const ID = "5d7a2f64-3b0c-4f25-9d57-0a9a6b3a1c11";
const ROLE = { nameRo: "Punct de apă", nameEn: "Water point", needed: "4", descriptionRo: "", descriptionEn: "" };

describe("§754 a role as the club types it", () => {
  it("takes both names and a number of at least one, and folds the whitespace", () => {
    const parsed = volunteerRoleInputSchema.parse({ ...ROLE, nameRo: "  Punct   de apă ", needed: " 4 " });
    expect(parsed).toMatchObject({ nameRo: "Punct de apă", nameEn: "Water point", needed: 4, descriptionRo: null, descriptionEn: null });
  });

  it("refuses a missing name in either language, naming the box", () => {
    const missingEn = volunteerRoleInputSchema.safeParse({ ...ROLE, nameEn: "  " });
    expect(missingEn.success).toBe(false);
    if (!missingEn.success) expect(refusedFields(missingEn.error)).toEqual(["nameEn"]);
    const missingRo = volunteerRoleInputSchema.safeParse({ ...ROLE, nameRo: "" });
    if (!missingRo.success) expect(refusedFields(missingRo.error)).toEqual(["nameRo"]);
  });

  it("refuses zero, a negative, a fraction, a word and a number past the bound as the people needed", () => {
    for (const needed of ["0", "-1", "1.5", "four", "", "1001"]) {
      const verdict = volunteerRoleInputSchema.safeParse({ ...ROLE, needed });
      expect(verdict.success, needed).toBe(false);
      if (!verdict.success) expect(refusedFields(verdict.error), needed).toEqual(["needed"]);
    }
    expect(volunteerRoleInputSchema.safeParse({ ...ROLE, needed: "1000" }).success).toBe(true);
  });

  it("takes a description in both languages or in neither — never one language's under the other's page (§352)", () => {
    expect(volunteerRoleInputSchema.safeParse({ ...ROLE, descriptionRo: "Dai apă", descriptionEn: "Hand out water" }).success).toBe(true);
    const onlyRo = volunteerRoleInputSchema.safeParse({ ...ROLE, descriptionRo: "Dai apă" });
    expect(onlyRo.success).toBe(false);
    if (!onlyRo.success) expect(refusedFields(onlyRo.error)).toEqual(["descriptionEn"]);
    const onlyEn = volunteerRoleInputSchema.safeParse({ ...ROLE, descriptionEn: "Hand out water" });
    if (!onlyEn.success) expect(refusedFields(onlyEn.error)).toEqual(["descriptionRo"]);
  });

  it("holds a description to the bound the database holds", () => {
    const long = "x".repeat(201);
    expect(volunteerRoleInputSchema.safeParse({ ...ROLE, descriptionRo: long, descriptionEn: long }).success).toBe(false);
  });
});

const staff = { roleId: ID, name: " Ana  Test ", email: " ana@example.test ", phone: "+40712345678", note: "" };

describe("§754 a person, entered by hand or offering on the page", () => {

  it("takes the staff's boxes: a role, a name, an address, an E.164 telephone number, an optional note", () => {
    expect(volunteerStaffInputSchema.parse(staff)).toMatchObject({ roleId: ID, name: "Ana Test", phone: "+40712345678", note: null });
  });

  it("refuses a malformed address, a telephone number that is not E.164, a role that is no id and a blank name", () => {
    for (const [field, value] of [
      ["email", "not-an-address"],
      ["phone", "0712345678"],
      ["roleId", "abc"],
      ["name", "   "],
    ] as const) {
      const verdict = volunteerStaffInputSchema.safeParse({ ...staff, [field]: value });
      expect(verdict.success, field).toBe(false);
      if (!verdict.success) expect(refusedFields(verdict.error), field).toEqual([field]);
    }
  });

  const pub = { ...staff, message: "", locale: "ro", consent: true };

  it("requires the consent tick on the public form — the person's own act, literally true", () => {
    expect(volunteerPublicInputSchema.safeParse(pub).success).toBe(true);
    for (const consent of [false, undefined, "on"]) {
      const verdict = volunteerPublicInputSchema.safeParse({ ...pub, consent });
      expect(verdict.success, String(consent)).toBe(false);
      if (!verdict.success) expect(refusedFields(verdict.error)).toEqual(["consent"]);
    }
  });

  it("holds the message to 300 characters and the language to the two the site has", () => {
    expect(volunteerPublicInputSchema.safeParse({ ...pub, message: "m".repeat(300) }).success).toBe(true);
    expect(volunteerPublicInputSchema.safeParse({ ...pub, message: "m".repeat(301) }).success).toBe(false);
    expect(volunteerPublicInputSchema.safeParse({ ...pub, locale: "fr" }).success).toBe(false);
  });
});

describe("§754 the telephone number an organizer types — the registrations' own parser (typedPhone)", () => {
  // The organizers' box posts what was typed; the action reads it with `typedPhone`, the parser an
  // Administrator's correction of a registration uses, and the schema keeps only what a phone can dial.
  const staffWith = (typed: string) => volunteerStaffInputSchema.safeParse({ ...staff, phone: typedPhone(typed) });

  it("keeps a number with its country code as that country's, and one without as a Romanian number", () => {
    for (const [typed, kept] of [
      ["+40 712 345 678", "+40712345678"],
      ["0040712345678", "+40712345678"],
      ["+44 7911 123456", "+447911123456"],
      ["0712 345 678", "+40712345678"],
      // An edit posts back the number as it was kept.
      ["+40712345678", "+40712345678"],
    ] as const) {
      const verdict = staffWith(typed);
      expect(verdict.success, typed).toBe(true);
      if (verdict.success) expect(verdict.data.phone, typed).toBe(kept);
    }
  });

  it("refuses on the telephone box what cannot be dialled", () => {
    for (const typed of ["", "abc", "+", "12"]) {
      const verdict = staffWith(typed);
      expect(verdict.success, typed).toBe(false);
      if (!verdict.success) expect(refusedFields(verdict.error), typed).toEqual(["phone"]);
    }
  });
});

describe("§754 how a role stands: «N din M»", () => {
  const role = { id: "r1", needed: 3 };

  it("counts «Înscris» and «Confirmat» against a role and never «Anulat»", () => {
    expect(countsAgainstRole("REGISTERED")).toBe(true);
    expect(countsAgainstRole("CONFIRMED")).toBe(true);
    expect(countsAgainstRole("CANCELLED")).toBe(false);
    const standing = standingOf(role, [
      { roleId: "r1", state: "REGISTERED" },
      { roleId: "r1", state: "CONFIRMED" },
      { roleId: "r1", state: "CANCELLED" },
      { roleId: "r2", state: "CONFIRMED" },
    ]);
    expect(standing).toEqual({ roleId: "r1", needed: 3, taken: 2, confirmed: 1, free: 1 });
  });

  it("never goes below zero when an organizer entered more people than the role asked", () => {
    const people = Array.from({ length: 5 }, () => ({ roleId: "r1", state: "CONFIRMED" as const }));
    expect(standingOf(role, people)).toMatchObject({ taken: 5, free: 0 });
  });

  it("says whether any role still needs people", () => {
    expect(someRoleNeedsPeople([{ free: 0 }, { free: 2 }])).toBe(true);
    expect(someRoleNeedsPeople([{ free: 0 }])).toBe(false);
    expect(someRoleNeedsPeople([])).toBe(false);
  });

  it("orders roles by position, then age, then id — a total order", () => {
    const at = (day: number) => new Date(`2026-10-0${day}T10:00:00.000Z`);
    const rows = [
      { id: "c", position: 1, createdAt: at(1) },
      { id: "b", position: 0, createdAt: at(2) },
      { id: "a", position: 0, createdAt: at(2) },
      { id: "z", position: 0, createdAt: at(1) },
    ];
    expect([...rows].sort(compareRoles).map((row) => row.id)).toEqual(["z", "a", "b", "c"]);
  });
});

describe("§754 the three conditions of the public form", () => {
  const open = { acceptsVolunteers: true, standings: [{ free: 2 }], noticeDescribes: true, eventAhead: true, published: true, membersOnly: false };

  it("is offered only when the event takes volunteers, a role still needs people and the notice describes them", () => {
    expect(volunteerOfferClosedFor(open)).toBeNull();
    expect(volunteerOfferClosedFor({ ...open, acceptsVolunteers: false })).toBe("off");
    expect(volunteerOfferClosedFor({ ...open, standings: [{ free: 0 }] })).toBe("noRoleNeeds");
    expect(volunteerOfferClosedFor({ ...open, standings: [] })).toBe("noRoleNeeds");
    expect(volunteerOfferClosedFor({ ...open, noticeDescribes: false })).toBe("noNotice");
  });

  it("is not offered for an event that is cancelled or over, whatever else is true", () => {
    expect(volunteerOfferClosedFor({ ...open, eventAhead: false })).toBe("eventOver");
    // The tick's own refusal is named first: a form that is off says «off», not «over».
    expect(volunteerOfferClosedFor({ ...open, acceptsVolunteers: false, eventAhead: false })).toBe("off");
  });

  it("is not offered on an unpublished event, nor on one for the members alone — the card names which (the page draws no form, the service refuses)", () => {
    expect(volunteerOfferClosedFor({ ...open, published: false })).toBe("notPublished");
    expect(volunteerOfferClosedFor({ ...open, membersOnly: true })).toBe("membersOnly");
    // The tick first, then the page's own state, then the rest.
    expect(volunteerOfferClosedFor({ ...open, published: false, acceptsVolunteers: false })).toBe("off");
    expect(volunteerOfferClosedFor({ ...open, membersOnly: true, eventAhead: false, noticeDescribes: false })).toBe("membersOnly");
    // Every reason has its line on the card, in both languages.
    for (const reason of ["off", "notPublished", "membersOnly", "eventOver", "noRoleNeeds", "noNotice"] as const) {
      expect(ro.Admin.volunteers.offer.closed[reason], reason).toBeTruthy();
      expect(en.Admin.volunteers.offer.closed[reason], reason).toBeTruthy();
    }
  });

  it("calls an event ahead while it is scheduled and not past its end (or its start, with no end), and one with no date ahead", () => {
    const now = new Date("2026-10-13T10:00:00.000Z");
    const day = (offset: number) => new Date(now.getTime() + offset * 24 * 60 * 60_000);
    expect(volunteerEventAhead({ eventStatus: "SCHEDULED", startsAt: day(10), endsAt: null }, now)).toBe(true);
    expect(volunteerEventAhead({ eventStatus: "SCHEDULED", startsAt: day(-1), endsAt: day(1) }, now)).toBe(true);
    expect(volunteerEventAhead({ eventStatus: "SCHEDULED", startsAt: day(-2), endsAt: day(-1) }, now)).toBe(false);
    expect(volunteerEventAhead({ eventStatus: "SCHEDULED", startsAt: day(-1), endsAt: null }, now)).toBe(false);
    expect(volunteerEventAhead({ eventStatus: "CANCELLED", startsAt: day(10), endsAt: null }, now)).toBe(false);
    expect(volunteerEventAhead({ eventStatus: "COMPLETED", startsAt: day(10), endsAt: null }, now)).toBe(false);
    expect(volunteerEventAhead({ eventStatus: "SCHEDULED", startsAt: null, endsAt: null }, now)).toBe(true);
  });

  it("lists only the roles that still need people, and keeps the box — empty — for the answer a person whose post took the last place is owed", () => {
    const roles = [
      { id: "a", free: 0 },
      { id: "b", free: 2 },
    ];
    expect(volunteerBoxRoles(null, roles, null)).toEqual([{ id: "b", free: 2 }]);
    expect(volunteerBoxRoles(null, roles, "done")).toEqual([{ id: "b", free: 2 }]);
    // The last place gone: the thank-you, or «the role filled», still shows; a plain visit gets no box.
    expect(volunteerBoxRoles("noRoleNeeds", [], "done")).toEqual([]);
    expect(volunteerBoxRoles("noRoleNeeds", [], "full")).toEqual([]);
    expect(volunteerBoxRoles("noRoleNeeds", [], null)).toBeNull();
    // A person back to correct a refusal while the last role filled: the box stays, saying every role filled.
    for (const answer of ["invalid", "captcha", "limited"] as const) expect(volunteerBoxRoles("noRoleNeeds", [], answer), answer).toEqual([]);
    // Any other closed form draws nothing, whatever the address asks.
    for (const closed of ["off", "notPublished", "membersOnly", "eventOver", "noNotice"] as const) {
      expect(volunteerBoxRoles(closed, roles, "done"), closed).toBeNull();
      expect(volunteerBoxRoles(closed, roles, "invalid"), closed).toBeNull();
    }
  });
});

describe("§754 the privacy notice's marker {{volunteers}}", () => {
  it("is a merge field, and a notice describes volunteers only when it names it", () => {
    expect(VOLUNTEERS_MERGE_FIELD).toBe("volunteers");
    expect(describesVolunteers({ sections: [{ heading: "5.", paragraphs: ["Voluntari ({{volunteers}}): …"] }] })).toBe(true);
    expect(describesVolunteers({ sections: [{ heading: "5.", paragraphs: ["Nimic despre voluntari."] }] })).toBe(false);
    expect(describesVolunteers("not a body")).toBe(false);
  });

  it("is in both languages' templates, in the token legend, and filled with the form's own name", () => {
    for (const body of [privacyNoticeRo, privacyNoticeEn]) expect(describesVolunteers(body)).toBe(true);
    expect(DECLARATION_TOKENS.some((entry) => entry.token === "{{volunteers}}")).toBe(true);
    expect(volunteersMergeValues("ro")).toEqual({ volunteers: `„${ro.Event.volunteers.title}”` });
    expect(volunteersMergeValues("en")).toEqual({ volunteers: `“${en.Event.volunteers.title}”` });
    expect(volunteersClause("ro")).toBe("„Vreau să fiu voluntar”");
    expect(mergeText("Voluntari ({{volunteers}})", volunteersMergeValues("en"))).toBe("Voluntari (“I want to volunteer”)");
  });

  it("says in section 7, in both languages, the number of days the sweep deletes by", () => {
    const days = String(RETENTION_PERIODS.volunteerDaysAfterEvent);
    expect(RETENTION.volunteerDaysAfterEvent).toBe(RETENTION_PERIODS.volunteerDaysAfterEvent);
    for (const [body, words] of [
      [privacyNoticeRo, "Ofertele de voluntar"],
      [privacyNoticeEn, "Volunteer offers"],
    ] as const) {
      const retention = body.sections.find((section) => section.heading?.startsWith("7."));
      const paragraph = retention?.paragraphs.find((candidate) => candidate.startsWith(words)) ?? "";
      expect(paragraph, words).toContain(days);
    }
  });

  it("keeps the roles' words and the volunteers' catalogues in both languages with the same keys", () => {
    const keys = (value: unknown, prefix = ""): string[] =>
      typeof value === "object" && value !== null
        ? Object.entries(value).flatMap(([key, inner]) => keys(inner, `${prefix}${key}.`))
        : [prefix];
    expect(keys(ro.Admin.volunteers)).toEqual(keys(en.Admin.volunteers));
    expect(keys(ro.Event.volunteers)).toEqual(keys(en.Event.volunteers));
  });
});

describe("§754 the public form's address and answer", () => {
  it("reads the answer from ?volunteer= and nothing else", () => {
    expect(parseVolunteerOutcome("1")).toBe("done");
    for (const value of ["invalid", "captcha", "limited", "full"] as const) expect(parseVolunteerOutcome(value)).toBe(value);
    for (const value of [undefined, "", "yes", "DONE", "<script>"]) expect(parseVolunteerOutcome(value)).toBeNull();
  });

  it("reads the refused boxes as names only, in the form's order, dropping anything else", () => {
    expect(parseVolunteerBoxes("email,name,<b>,consent,email")).toEqual(["name", "email", "consent"]);
    expect(parseVolunteerBoxes("message,roleId")).toEqual(["roleId", "message"]);
    expect(parseVolunteerBoxes(undefined)).toEqual([]);
  });
});

describe("§754 the CSV", () => {
  const header = { role: "Rol", name: "Nume", email: "Email", phone: "Telefon", state: "Stare", source: "Sursă", message: "Mesaj", note: "Notă", signedUpAt: "Data" };

  it("starts with a BOM, ends no line with a bare newline and keeps a formula a text", () => {
    const csv = buildVolunteersCsv(header, [
      {
        role: "Punct de apă",
        name: "=HYPERLINK(\"x\")",
        email: "ana@example.test",
        phone: "+40712345678",
        state: "Înscris",
        source: "Din formular",
        message: "Sunt liber sâmbătă, toată ziua",
        note: null,
        signedUpAt: new Date("2026-10-13T10:00:00.000Z"),
      },
    ]);
    expect(csv.startsWith("﻿Rol,Nume")).toBe(true);
    const lines = csv.split("\r\n");
    expect(lines).toHaveLength(2);
    // A cell starting with «=» is neutralized, and a comma in a message is quoted.
    expect(lines[1]).not.toMatch(/^[^,]*,=/);
    expect(lines[1]).toContain('"Sunt liber sâmbătă, toată ziua"');
    expect(lines[1]).toContain("2026-10-13T10:00:00.000Z");
  });
});
