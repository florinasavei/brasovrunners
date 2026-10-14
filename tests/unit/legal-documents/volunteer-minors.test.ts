import { describe, expect, it } from "vitest";
import type { LegalDocumentBody } from "@/modules/legal-documents/domain/content-hash";
import {
  BLANK,
  describesVolunteerMinors,
  isMergeField,
  mergeFieldsIn,
  mergeLegalBody,
  mergeText,
  namesVolunteerGuardian,
  PARAGRAPH_MERGE_FIELDS,
  VOLUNTEER_GUARDIAN_MERGE_FIELD,
  VOLUNTEER_MERGE_FIELDS,
  VOLUNTEER_MINORS_NOTICE_MERGE_FIELD,
} from "@/modules/legal-documents/domain/merge-fields";
import { privacyNoticeEn, privacyNoticeRo } from "@/modules/legal-documents/templates/privacy-notice";
import { DECLARATION_TOKENS } from "@/modules/legal-documents/templates/tokens";
import { volunteerAgreementEn, volunteerAgreementRo } from "@/modules/legal-documents/templates/volunteer-agreement";
import { AGREEMENT_FACT_FIELDS } from "@/modules/volunteers/agreement";
import { volunteerMinorsClause, volunteersMergeValues } from "@/modules/volunteers/notice-words";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";

/**
 * §768 — the templates for volunteers under eighteen (the owner, 2026-10-14): the agreement's minors' clause with its marker
 * `{{volunteerGuardian}}`, the privacy notice's paragraph with `{{volunteerMinors}}`, and the gate they make together — the
 * club takes a person under eighteen only while a notice naming the one and an agreement naming the other are in force. Template
 * only: no text in force is touched, and a lawyer reads the clause first (the entry says so; so do the templates' headers).
 */
const text = (body: LegalDocumentBody) => body.sections.flatMap((section) => [section.heading ?? "", ...section.paragraphs]).join("\n");

const ADULT = {
  volunteer: "Ana Popescu",
  volunteerRole: "Punct de apă",
  volunteerTasks: "Împarte apă",
  volunteerRoleChoices: "",
  volunteerChoiceTasks: "",
  event: "Crosul",
  eventDate: "sâmbătă, 21 nov. 2026",
  eventLocation: "Parcul central",
  minimumAge: "14 ani",
  signedAt: "marți, 13 oct. 2026, la 13:00",
};

describe("§768 the agreement's minors' clause", () => {
  it("names one new blank, a merge field of the volunteer agreement that drops its paragraph when it is empty", () => {
    expect(VOLUNTEER_GUARDIAN_MERGE_FIELD).toBe("volunteerGuardian");
    expect(isMergeField("volunteerGuardian")).toBe(true);
    expect(VOLUNTEER_MERGE_FIELDS).toContain("volunteerGuardian");
    expect(PARAGRAPH_MERGE_FIELDS.has("volunteerGuardian")).toBe(true);
    // A fact a row keeps: the guardian's name rides in the blanks the fingerprint is taken over.
    expect(AGREEMENT_FACT_FIELDS).toContain("volunteerGuardian");
    for (const body of [volunteerAgreementRo, volunteerAgreementEn]) {
      expect(namesVolunteerGuardian(body)).toBe(true);
      expect(mergeFieldsIn(body).has("volunteerGuardian")).toBe(true);
    }
  });

  it("is four sentences, each dropped whole for an adult — never a clause about a minor in an adult's text", () => {
    for (const [body, minor] of [
      [volunteerAgreementRo, "Voluntarul fiind minor"],
      [volunteerAgreementEn, "The volunteer being a minor"],
    ] as const) {
      const adult = text(mergeLegalBody(body, { ...ADULT, volunteerGuardian: "" }));
      expect(adult).not.toContain(minor);
      expect(adult).not.toContain("Maria Popescu");
      expect(adult).not.toContain(BLANK);
      const withGuardian = mergeLegalBody(body, { ...ADULT, volunteerGuardian: "Maria Popescu" });
      // The name is in the clause's sentences: the consent (§1), the safety (§6), the data (§8) and the acceptance (§9).
      expect(text(withGuardian).split("Maria Popescu").length - 1).toBe(4);
      expect(text(withGuardian)).toContain(minor);
    }
  });

  it("says the consent, the suited activities and the withdrawal in the template's own words, with no age of its own", () => {
    const ro = text(mergeLegalBody(volunteerAgreementRo, { ...ADULT, volunteerGuardian: "Maria Popescu" }));
    expect(ro).toContain("își dă acordul ca el să fie voluntar la acest eveniment");
    expect(ro).toContain("Voluntarul minor este confirmat numai după acest acord.");
    expect(ro).toContain("numai activități potrivite vârstei sale și nu îl pune pe posturi de noapte sau periculoase");
    expect(ro).toContain("poate retrage oricând acordul");
    expect(ro).toContain("acceptă contractul în nume propriu, electronic");
    const en = text(mergeLegalBody(volunteerAgreementEn, { ...ADULT, volunteerGuardian: "Maria Popescu" }));
    expect(en).toContain("agrees that they volunteer at this event");
    expect(en).toContain("only activities suited to their age and puts them on no night or dangerous posts");
    expect(en).toContain("may withdraw the consent at any time");
    // §357: no number written into the clause — the age is the agreement's `{{minimumAge}}`, filled from the code.
    for (const body of [volunteerAgreementRo, volunteerAgreementEn]) {
      const clause = body.sections.flatMap((section) => section.paragraphs).filter((paragraph) => paragraph.includes("{{volunteerGuardian}}"));
      expect(clause).toHaveLength(4);
      for (const paragraph of clause) expect(paragraph).not.toMatch(/\b1[0-9]\b/);
    }
  });

  it("is shown as written on the public page: the guardian's name a blank, the clause kept", () => {
    const shown = text(mergeLegalBody(volunteerAgreementRo, { minimumAge: "14 ani" }));
    expect(shown).toContain(`părintele sau tutorele său, ${BLANK}, își dă acordul`);
  });

  it("is named for the lawyer in the template's header, with Legea nr. 78/2014", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("src/modules/legal-documents/templates/volunteer-agreement.ts", "utf8");
    expect(source).toContain("Legea nr. 78/2014 has its own rules on the age and the consent of minors");
    expect(source).toContain("{{volunteerGuardian}}");
  });
});

describe("§768 the privacy notice's paragraph for volunteers under eighteen", () => {
  it("names its own marker in both languages, a marker of the notice that the agreement does not carry", () => {
    expect(VOLUNTEER_MINORS_NOTICE_MERGE_FIELD).toBe("volunteerMinors");
    expect(isMergeField("volunteerMinors")).toBe(true);
    for (const body of [privacyNoticeRo, privacyNoticeEn]) {
      expect(describesVolunteerMinors(body)).toBe(true);
      expect(namesVolunteerGuardian(body)).toBe(false);
    }
    for (const body of [volunteerAgreementRo, volunteerAgreementEn]) expect(describesVolunteerMinors(body)).toBe(false);
  });

  it("says what is kept of the guardian, why, how long and who sees it, without a number of its own", () => {
    const roText = text(privacyNoticeRo);
    expect(roText).toContain("păstrăm numele și adresa de e-mail ale părintelui sau tutorelui tău, cât timp păstrăm oferta ta");
    expect(roText).toContain("legătură de unică folosință");
    expect(roText).toContain("organizatorii nu te pot confirma");
    expect(roText).toContain("interesul legitim al clubului de a primi voluntari minori numai cu acordul părintelui sau tutorelui");
    expect(roText).toContain("vârsta minimă cerută de contract");
    const enText = text(privacyNoticeEn);
    expect(enText).toContain("we keep your parent's or guardian's name and email address, for as long as we keep your offer");
    expect(enText).toContain("single-use link");
    expect(enText).toContain("the age the agreement asks");
  });

  it("fills the marker with the guardian's two boxes, quoted, in each language, from the catalogue the form reads", () => {
    expect(volunteerMinorsClause("ro")).toBe("„Numele părintelui sau tutorelui”, „Emailul părintelui sau tutorelui”");
    expect(volunteerMinorsClause("en")).toBe("“Parent's or guardian's name”, “Parent's or guardian's email”");
    expect(volunteersMergeValues("ro").volunteerMinors).toBe(volunteerMinorsClause("ro"));
    expect(mergeText("({{volunteerMinors}})", volunteersMergeValues("en"))).toContain("“Parent's or guardian's name”");
    // The words are the form's own labels: a renamed label changes the notice's sentence with it.
    expect(volunteerMinorsClause("ro")).toContain(ro.Event.volunteers.guardian.name);
    expect(volunteerMinorsClause("en")).toContain(en.Event.volunteers.guardian.email);
  });
});

describe("§768 the editor's legend names both markers, in both languages", () => {
  it("has a token and a line for each", () => {
    for (const field of ["volunteerGuardian", "volunteerMinors"]) {
      expect(DECLARATION_TOKENS.some((token) => token.token === `{{${field}}}`), field).toBe(true);
      expect((ro.Admin.legal.tokens as Record<string, string>)[field], field).toBeTruthy();
      expect((en.Admin.legal.tokens as Record<string, string>)[field], field).toBeTruthy();
    }
  });
});
