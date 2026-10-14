import { describe, expect, it } from "vitest";
import ro from "../../../messages/ro.json";
import en from "../../../messages/en.json";
import { RETENTION_PERIODS } from "@/modules/jobs/domain/retention-periods";
import { RETENTION } from "@/modules/jobs/retention";
import { describesVolunteerAgreement, describesVolunteers, mergeText, VOLUNTEERS_MERGE_FIELD } from "@/modules/legal-documents/domain/merge-fields";
import { typedPhone } from "@/modules/registrations/answers";
import { privacyNoticeEn, privacyNoticeRo } from "@/modules/legal-documents/templates/privacy-notice";
import { DECLARATION_TOKENS } from "@/modules/legal-documents/templates/tokens";
import { buildVolunteersCsv } from "@/modules/volunteers/csv";
import {
  acceptedRoleNames,
  agreementRolesStamp,
  agreementRoleWords,
  agreementStillNamesRole,
  choicesWithAssigned,
  compareRoles,
  countsAgainstRole,
  openChoices,
  VOLUNTEER_ROLES_MAX,
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
    // No description: the document and its plain words are null in both languages (§765).
    expect(parsed).toMatchObject({
      nameRo: "Punct de apă",
      nameEn: "Water point",
      needed: 4,
      descriptionRoJson: null,
      descriptionEnJson: null,
      descriptionWordsRo: null,
      descriptionWordsEn: null,
    });
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

  it("holds a description to the bound the database holds: 2000 characters of words per language (§765)", () => {
    expect(volunteerRoleInputSchema.safeParse({ ...ROLE, descriptionRo: "x".repeat(2000), descriptionEn: "x".repeat(2000) }).success).toBe(true);
    const long = "x".repeat(2001);
    expect(volunteerRoleInputSchema.safeParse({ ...ROLE, descriptionRo: long, descriptionEn: long }).success).toBe(false);
  });
});

const ID2 = "6e8b3075-4c1d-4a36-8e68-1b0b7c4b2d22";
const staff = { roleIds: [ID], assignedRoleId: "", name: " Ana  Test ", email: " ana@example.test ", phone: "+40712345678", note: "" };

describe("§754 a person, entered by hand or offering on the page", () => {

  it("takes the staff's boxes: the roles ticked, the role given or none, a name, an address, an E.164 telephone number, an optional note", () => {
    expect(volunteerStaffInputSchema.parse(staff)).toMatchObject({ roleIds: [ID], assignedRoleId: null, name: "Ana Test", phone: "+40712345678", note: null });
    expect(volunteerStaffInputSchema.parse({ ...staff, assignedRoleId: ` ${ID2} ` })).toMatchObject({ roleIds: [ID], assignedRoleId: ID2 });
  });

  it("refuses a malformed address, a telephone number that is not E.164, a role that is no id and a blank name", () => {
    for (const [field, value, box] of [
      ["email", "not-an-address", "email"],
      ["phone", "0712345678", "phone"],
      ["roleIds", ["abc"], "roleIds"],
      ["assignedRoleId", "abc", "assignedRoleId"],
      ["name", "   ", "name"],
    ] as const) {
      const verdict = volunteerStaffInputSchema.safeParse({ ...staff, [field]: value });
      expect(verdict.success, field).toBe(false);
      if (!verdict.success) expect(refusedFields(verdict.error), field).toEqual([box]);
    }
  });

  it("§761 takes a person entered by hand with roles ticked, a role given, or both — never with neither — and keeps a role given alone as the one choice", () => {
    const neither = volunteerStaffInputSchema.safeParse({ ...staff, roleIds: [], assignedRoleId: "" });
    expect(neither.success).toBe(false);
    if (!neither.success) expect(refusedFields(neither.error)).toEqual(["roleIds"]);
    const given = volunteerStaffInputSchema.parse({ ...staff, roleIds: [], assignedRoleId: ID2 });
    expect(choicesWithAssigned(given)).toEqual([ID2]);
    // Ticked and given: the ticks are the person's offer, whatever role the organizers chose — ticked or not.
    expect(choicesWithAssigned(volunteerStaffInputSchema.parse({ ...staff, assignedRoleId: ID2 }))).toEqual([ID]);
    // The same role ticked twice is one choice; more than an event may define is refused.
    expect(volunteerStaffInputSchema.parse({ ...staff, roleIds: [ID, ` ${ID} `, ID2] }).roleIds).toEqual([ID, ID2]);
    expect(volunteerStaffInputSchema.safeParse({ ...staff, roleIds: Array.from({ length: VOLUNTEER_ROLES_MAX + 1 }, () => ID) }).success).toBe(false);
  });

  const pub = { roleIds: [ID], name: " Ana  Test ", email: " ana@example.test ", phone: "+40712345678", message: "", locale: "ro", consent: true, agreement: true, adult: true };

  it("§761 takes every role the person ticks on the public form, at least one — the box «Ce ești dispus(ă) să faci» named in the refusal", () => {
    expect(volunteerPublicInputSchema.parse({ ...pub, roleIds: [ID2, ID, ID2] }).roleIds).toEqual([ID2, ID]);
    for (const roleIds of [[], undefined, "nope", ["nope"], [ID, "nope"]]) {
      const verdict = volunteerPublicInputSchema.safeParse({ ...pub, roleIds });
      expect(verdict.success, JSON.stringify(roleIds)).toBe(false);
      if (!verdict.success) expect(refusedFields(verdict.error), JSON.stringify(roleIds)).toEqual(["roleIds"]);
    }
  });

  it("requires the consent tick on the public form — the person's own act, literally true", () => {
    expect(volunteerPublicInputSchema.safeParse(pub).success).toBe(true);
    for (const consent of [false, undefined, "on"]) {
      const verdict = volunteerPublicInputSchema.safeParse({ ...pub, consent });
      expect(verdict.success, String(consent)).toBe(false);
      if (!verdict.success) expect(refusedFields(verdict.error)).toEqual(["consent"]);
    }
  });

  it("§758 requires the agreement's tick and the age's, each literally true and each named in the refusal", () => {
    for (const tick of ["agreement", "adult"] as const) {
      for (const value of [false, undefined, "on"]) {
        const verdict = volunteerPublicInputSchema.safeParse({ ...pub, [tick]: value });
        expect(verdict.success, `${tick} ${String(value)}`).toBe(false);
        if (!verdict.success) expect(refusedFields(verdict.error)).toEqual([tick]);
      }
    }
    const neither = volunteerPublicInputSchema.safeParse({ ...pub, agreement: false, adult: false });
    expect(neither.success).toBe(false);
    if (!neither.success) expect(refusedFields(neither.error).sort()).toEqual(["adult", "agreement"]);
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

  it("§761 counts only the people given the role: an offer that ticked it, with no role yet, holds nothing", () => {
    const standing = standingOf(role, [
      { roleId: "r1", state: "REGISTERED" },
      { roleId: null, state: "REGISTERED" },
      { roleId: null, state: "CONFIRMED" },
    ]);
    expect(standing).toEqual({ roleId: "r1", needed: 3, taken: 1, confirmed: 0, free: 2 });
  });

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
  const open = { acceptsVolunteers: true, standings: [{ free: 2 }], noticeDescribes: true, agreementInForce: true, noticeDescribesAgreement: true, eventAhead: true, published: true, membersOnly: false };

  it("is offered only when the event takes volunteers, a role still needs people and the notice describes them", () => {
    expect(volunteerOfferClosedFor(open)).toBeNull();
    expect(volunteerOfferClosedFor({ ...open, acceptsVolunteers: false })).toBe("off");
    expect(volunteerOfferClosedFor({ ...open, standings: [{ free: 0 }] })).toBe("noRoleNeeds");
    expect(volunteerOfferClosedFor({ ...open, standings: [] })).toBe("noRoleNeeds");
    expect(volunteerOfferClosedFor({ ...open, noticeDescribes: false })).toBe("noNotice");
  });

  it("§758 is not offered while no volunteer agreement is in force — named after the notice, the card's last reason", () => {
    expect(volunteerOfferClosedFor({ ...open, agreementInForce: false })).toBe("noAgreement");
    // The notice is asked first: both missing, the card names the notice, which the club approves first.
    expect(volunteerOfferClosedFor({ ...open, agreementInForce: false, noticeDescribes: false })).toBe("noNotice");
    expect(volunteerOfferClosedFor({ ...open, agreementInForce: false, acceptsVolunteers: false })).toBe("off");
  });

  it("§758 is not offered while the notice in force does not describe the agreement's acceptance — after the agreement itself", () => {
    expect(volunteerOfferClosedFor({ ...open, noticeDescribesAgreement: false })).toBe("noAgreementNotice");
    // The agreement first: without one there is nothing whose acceptance the notice could describe.
    expect(volunteerOfferClosedFor({ ...open, noticeDescribesAgreement: false, agreementInForce: false })).toBe("noAgreement");
    expect(volunteerOfferClosedFor({ ...open, noticeDescribesAgreement: false, noticeDescribes: false })).toBe("noNotice");
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
    for (const reason of ["off", "notPublished", "membersOnly", "eventOver", "noRoleNeeds", "noNotice", "noAgreement"] as const) {
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
    expect(volunteersMergeValues("ro")).toMatchObject({ volunteers: `„${ro.Event.volunteers.title}”` });
    expect(volunteersMergeValues("en")).toMatchObject({ volunteers: `“${en.Event.volunteers.title}”` });
    expect(volunteersClause("ro")).toBe("„Vreau să fiu voluntar”");
    expect(mergeText("Voluntari ({{volunteers}})", volunteersMergeValues("en"))).toBe("Voluntari (“I want to volunteer”)");
  });

  it("§758 has a twin, {{volunteerAgreement}}, in the same paragraph: a notice naming only {{volunteers}} does not describe the agreement", () => {
    // A notice approved from §754's template: it names the volunteers, and says nothing of the acceptance.
    const before = { sections: [{ heading: "5.", paragraphs: ["Voluntari ({{volunteers}}): un singur e-mail de primire, fără nicio legătură care să facă ceva."] }] };
    expect(describesVolunteers(before)).toBe(true);
    expect(describesVolunteerAgreement(before)).toBe(false);
    for (const body of [privacyNoticeRo, privacyNoticeEn]) {
      expect(describesVolunteerAgreement(body)).toBe(true);
      // In the volunteers' own paragraph, beside its marker.
      const paragraph = body.sections.flatMap((section) => section.paragraphs).find((candidate) => candidate.includes("{{volunteers}}")) ?? "";
      expect(paragraph).toContain("{{volunteerAgreement}}");
      // The age is the agreement's, never a number written into the notice.
      expect(paragraph).not.toMatch(/18/);
    }
    expect(DECLARATION_TOKENS.some((entry) => entry.token === "{{volunteerAgreement}}")).toBe(true);
    expect(volunteersMergeValues("ro").volunteerAgreement).toBe(`„${ro.Legal.volunteerAgreementTitle}”`);
    expect(volunteersMergeValues("en").volunteerAgreement).toBe(`“${en.Legal.volunteerAgreementTitle}”`);
  });

  it("§761: the volunteers' paragraph names the roles ticked, the role given and the short email naming it, in both languages", () => {
    for (const [body, phrases] of [
      [privacyNoticeRo, ["rolurile pe care le-ai bifat", "rolul pe care ți-l dau organizatorii", "când organizatorii îți dau un rol, primești un e-mail scurt care îl numește"]],
      [privacyNoticeEn, ["the roles you ticked", "the role the organizers give you", "when the organizers give you a role, you receive a short email that names it"]],
    ] as const) {
      const paragraph = body.sections.flatMap((section) => section.paragraphs).find((candidate) => candidate.includes("{{volunteers}}")) ?? "";
      for (const phrase of phrases) expect(paragraph, phrase).toContain(phrase);
    }
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
    expect(parseVolunteerBoxes("message,roleIds")).toEqual(["roleIds", "message"]);
    // The single role's old box is no box any more (§761).
    expect(parseVolunteerBoxes("roleId")).toEqual([]);
    expect(parseVolunteerBoxes(undefined)).toEqual([]);
  });
});

describe("§754 the CSV", () => {
  const header = {
    role: "Rolul dat",
    choices: "S-a oferit pentru",
    name: "Nume",
    email: "Email",
    phone: "Telefon",
    state: "Stare",
    source: "Sursă",
    message: "Mesaj",
    note: "Notă",
    signedUpAt: "Data",
    age: "Vârsta",
    sex: "Sex",
    city: "Orașul",
    volunteeredBefore: "A mai fost voluntar",
    clubMember: "Din grupul clubului",
    shirtSize: "Mărime tricou",
  };

  it("starts with a BOM, ends no line with a bare newline and keeps a formula a text", () => {
    const csv = buildVolunteersCsv(header, [
      {
        role: "Punct de apă",
        choices: "Punct de apă, Sosire",
        name: "=HYPERLINK(\"x\")",
        email: "ana@example.test",
        phone: "+40712345678",
        state: "Înscris",
        source: "Din formular",
        message: "Sunt liber sâmbătă, toată ziua",
        note: null,
        signedUpAt: new Date("2026-10-13T10:00:00.000Z"),
        age: 34,
        sex: "Female",
        city: "Brașov, centru",
        volunteeredBefore: "Da",
        clubMember: "Nu",
        shirtSize: "M",
      },
    ]);
    expect(csv.startsWith("﻿Rolul dat,S-a oferit pentru,Nume")).toBe(true);
    const lines = csv.split("\r\n");
    expect(lines).toHaveLength(2);
    // A cell starting with «=» is neutralized, and a comma in a message is quoted.
    expect(lines[1]).not.toMatch(/^[^,]*,=/);
    expect(lines[1]).toContain('"Sunt liber sâmbătă, toată ziua"');
    expect(lines[1]).toContain("2026-10-13T10:00:00.000Z");
    // §761: the role given, then the roles chosen — a comma inside them quoted.
    expect(lines[1].startsWith('Punct de apă,"Punct de apă, Sosire",')).toBe(true);
    // §765: what the person said about themselves comes after the moment, so no earlier column moves; a comma in the city is quoted.
    expect(csv.split("\r\n")[0].endsWith("Data,Vârsta,Sex,Orașul,A mai fost voluntar,Din grupul clubului,Mărime tricou")).toBe(true);
    expect(lines[1].endsWith('2026-10-13T10:00:00.000Z,34,Female,"Brașov, centru",Da,Nu,M')).toBe(true);
  });

  it("§765 leaves an unanswered box empty, never «null» or 0", () => {
    const csv = buildVolunteersCsv(header, [
      {
        role: "",
        choices: "",
        name: "Ion",
        email: "ion@example.test",
        phone: "+40712345678",
        state: "Înscris",
        source: "Adăugat de organizator",
        message: null,
        note: null,
        signedUpAt: new Date("2026-10-13T10:00:00.000Z"),
        age: null,
        sex: "",
        city: null,
        volunteeredBefore: "Nu",
        clubMember: "Nu",
        shirtSize: "",
      },
    ]);
    expect(csv.split("\r\n")[1].endsWith("2026-10-13T10:00:00.000Z,,,,Nu,Nu,")).toBe(true);
  });
});

describe("§761 a volunteer ticks every role they would do; the organizers give one", () => {
  const water = { id: "w", nameRo: "Punct de apă", nameEn: "Water point", descriptionRo: "Dai apă la km 5.", descriptionEn: "Hand out water at km 5." };
  const finish = { id: "f", nameRo: "Sosire", nameEn: "Finish", descriptionRo: null, descriptionEn: null };
  const table = { id: "t", nameRo: "Masă", nameEn: "Desk", descriptionRo: "Dai numerele", descriptionEn: "Hand out the bibs" };

  it("keeps the ticked roles that still need people, in the order ticked, and drops the ones that filled", () => {
    const standings = new Map([
      ["w", { free: 2 }],
      ["f", { free: 0 }],
      ["t", { free: 1 }],
    ]);
    expect(openChoices(["t", "f", "w"], standings)).toEqual(["t", "w"]);
    // Every one filled: nothing is kept — the polite «full», with the roles still open.
    expect(openChoices(["f"], standings)).toEqual([]);
    // A role the map does not know is no open role.
    expect(openChoices(["x"], standings)).toEqual([]);
  });

  it("names in the agreement the role given — its name and what it asks — whatever was ticked, under any text", () => {
    for (const textNamesChoices of [true, false]) {
      expect(agreementRoleWords({ assigned: water, chosen: [finish, table] }, "ro", textNamesChoices)).toEqual({
        role: "Punct de apă",
        tasks: "Dai apă la km 5",
        choices: "",
        choiceTasks: "",
      });
      expect(agreementRoleWords({ assigned: finish, chosen: [water] }, "en", textNamesChoices)).toEqual({ role: "Finish", tasks: "", choices: "", choiceTasks: "" });
    }
  });

  it("§761: under a text naming {{volunteerRoleChoices}}, names the roles chosen in their own blanks and leaves the role's empty", () => {
    const several = agreementRoleWords({ assigned: null, chosen: [water, finish, table] }, "en", true);
    expect(several).toEqual({
      role: "",
      tasks: "",
      choices: "Water point, Finish, Desk",
      // What each asks, by name; a role with no description adds nothing.
      choiceTasks: "Water point — Hand out water at km 5; Desk — Hand out the bibs",
    });
    expect(agreementRoleWords({ assigned: null, chosen: [water] }, "ro", true)).toEqual({ role: "", tasks: "", choices: "Punct de apă", choiceTasks: "Punct de apă — Dai apă la km 5" });
    expect(agreementRoleWords({ assigned: null, chosen: [finish] }, "ro", true).choiceTasks).toBe("");
  });

  it("§761: under an earlier text, fills «… în rolul {{volunteerRole}}.» with the chosen roles' names alone — never a clause of the code's own", () => {
    const one = agreementRoleWords({ assigned: null, chosen: [water] }, "ro", false);
    expect(one).toEqual({ role: "Punct de apă", tasks: "Dai apă la km 5", choices: "", choiceTasks: "" });
    const several = agreementRoleWords({ assigned: null, chosen: [water, finish, table] }, "en", false);
    expect(several.role).toBe("Water point, Finish, Desk");
    expect(several.tasks).toBe("Water point — Hand out water at km 5; Desk — Hand out the bibs");
    // The club's words only: the roles' names and descriptions, nothing about who decides.
    for (const words of [several, agreementRoleWords({ assigned: null, chosen: [table, water] }, "ro", false)]) {
      expect(`${words.role} ${words.tasks}`).not.toMatch(/organizator|organiser|disponibil|available|stabilit|assigned/i);
    }
    expect(agreementRoleWords({ assigned: null, chosen: [finish] }, "ro", false).tasks).toBe("");
    expect(agreementRoleWords({ assigned: null, chosen: [] }, "ro", false)).toEqual({ role: "", tasks: "", choices: "", choiceTasks: "" });
  });

  it("reads the roles an accepted agreement named from its blanks: the choices' own, else the role's", () => {
    expect(acceptedRoleNames({ volunteerRole: "", volunteerRoleChoices: "Masă, Sosire" })).toBe("Masă, Sosire");
    expect(acceptedRoleNames({ volunteerRole: "Masă", volunteerRoleChoices: "" })).toBe("Masă");
    // A row accepted before the field existed.
    expect(acceptedRoleNames({ volunteerRole: "Masă" })).toBe("Masă");
  });

  it("tells the card when the accepted text names another role than the person's now — and not when the role given is one they offered", () => {
    const offered = agreementRoleWords({ assigned: null, chosen: [water, table] }, "ro", true).choices;
    // The same names under an earlier text, in the role's blank.
    expect(agreementRoleWords({ assigned: null, chosen: [water, table] }, "ro", false).role).toBe(offered);
    // Accepted on the form, nothing given yet: the same words.
    expect(agreementStillNamesRole(offered, { assigned: null, chosen: [water, table] }, "ro")).toBe(true);
    // Then given one of the roles offered: still what was accepted.
    expect(agreementStillNamesRole(offered, { assigned: table, chosen: [water, table] }, "ro")).toBe(true);
    // Given a role the person never offered for: the card says so.
    expect(agreementStillNamesRole(offered, { assigned: finish, chosen: [water, table] }, "ro")).toBe(false);
    // The choices changed since: so did the words.
    expect(agreementStillNamesRole(offered, { assigned: null, chosen: [water] }, "ro")).toBe(false);
    // Accepted for a role given, still given; then moved.
    expect(agreementStillNamesRole("Punct de apă", { assigned: water, chosen: [] }, "ro")).toBe(true);
    expect(agreementStillNamesRole("Punct de apă", { assigned: finish, chosen: [water] }, "ro")).toBe(false);
  });

  it("stamps what a printed agreement names — the role given, else the roles chosen, in any order — so a change since the print is seen", () => {
    expect(agreementRolesStamp("w", ["t", "f"])).toBe("role:w");
    expect(agreementRolesStamp(null, ["t", "f"])).toBe(agreementRolesStamp(null, ["f", "t"]));
    expect(agreementRolesStamp(null, ["t"])).not.toBe(agreementRolesStamp(null, ["t", "f"]));
    expect(agreementRolesStamp(null, ["w"])).not.toBe(agreementRolesStamp("w", ["w"]));
  });
});
