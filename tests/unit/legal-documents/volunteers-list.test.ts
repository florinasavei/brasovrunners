import { describe, expect, it } from "vitest";
import type { LegalDocumentBody } from "@/modules/legal-documents/domain/content-hash";
import {
  describesVolunteers,
  describesVolunteersList,
  isMergeField,
  mergeText,
  VOLUNTEERS_LIST_NOTICE_MERGE_FIELD,
} from "@/modules/legal-documents/domain/merge-fields";
import { privacyNoticeEn, privacyNoticeRo } from "@/modules/legal-documents/templates/privacy-notice";
import { DECLARATION_TOKENS } from "@/modules/legal-documents/templates/tokens";
import { volunteersListClause, volunteersMergeValues } from "@/modules/volunteers/notice-words";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";

/**
 * §821 — the privacy notice's marker for the volunteers' public list (`{{volunteersList}}`; the owner, 2026-10-19: «private vs public lists
 * of volunteers»): the tick's own words, quoted, in the volunteers' paragraph, and the switch — the event page's card «Voluntarii», the form's
 * tick and the organizers' record of it wait for a notice naming it. Template only: no text in force is touched, and a lawyer reads the
 * sentence first (the template's header says so).
 */
const text = (body: LegalDocumentBody) => body.sections.flatMap((section) => [section.heading ?? "", ...section.paragraphs]).join("\n");
const bodyNaming = (markers: string) => ({ sections: [{ paragraphs: [`Voluntari (${markers}): păstrăm numele`] }] });

describe("§821 the marker", () => {
  it("is a merge field of the privacy notice, and a notice describes the list only by naming it", () => {
    expect(VOLUNTEERS_LIST_NOTICE_MERGE_FIELD).toBe("volunteersList");
    expect(isMergeField("volunteersList")).toBe(true);
    expect(describesVolunteersList(bodyNaming("{{volunteers}}, {{volunteersList}}"))).toBe(true);
    expect(describesVolunteersList(bodyNaming("{{volunteers}}"))).toBe(false);
    expect(describesVolunteersList(bodyNaming("{{volunteers}}, {{volunteerAgreement}}, {{volunteerProfile}}, {{volunteerMinors}}"))).toBe(false);
    // The list is a part of the volunteers' paragraph: the callers ask both, and the marker alone says nothing of volunteers.
    expect(describesVolunteers(bodyNaming("{{volunteersList}}"))).toBe(false);
  });
});

describe("§821 the template's sentence", () => {
  it("names the marker in both languages, in the volunteers' paragraph", () => {
    for (const body of [privacyNoticeRo, privacyNoticeEn]) {
      expect(describesVolunteersList(body)).toBe(true);
      expect(describesVolunteers(body)).toBe(true);
    }
    const paragraphOf = (body: LegalDocumentBody) => body.sections.flatMap((section) => section.paragraphs).find((paragraph) => paragraph.includes("{{volunteersList}}")) ?? "";
    expect(paragraphOf(privacyNoticeRo)).toContain("{{volunteers}}");
    expect(paragraphOf(privacyNoticeEn)).toContain("{{volunteers}}");
  });

  it("says what the page shows — the name and the role given, nothing else —, for whom, on what basis, and how it is withdrawn", () => {
    const roText = text(privacyNoticeRo);
    expect(roText).toContain("pagina evenimentului arată numele tău și rolul pe care ți-l dau organizatorii, nimic altceva");
    expect(roText).toContain("după ce organizatorii te confirmă");
    expect(roText).toContain("pe voluntarii care nu au bifat și pe cei minori îi numără, fără nume");
    expect(roText).toContain("consimțământul tău, dat prin această bifă (art. 6(1)(a) GDPR), pe care îl poți retrage oricând scriindu-ne");
    const enText = text(privacyNoticeEn);
    expect(enText).toContain("the event's page shows your name and the role the organizers give you, nothing else");
    expect(enText).toContain("once the organizers confirm you");
    expect(enText).toContain("volunteers who did not tick, and minors, are counted, without names");
    expect(enText).toContain("your consent, given by this tick (art. 6(1)(a) GDPR), which you can withdraw at any time by writing to us");
  });

  it("no longer says the offer is on a public list without saying whose: it is the participants' list, and the full list stays the organizers'", () => {
    expect(text(privacyNoticeRo)).toContain("nu apare pe lista publică a participanților");
    expect(text(privacyNoticeRo)).toContain("Lista completă a voluntarilor, cu adresa și telefonul, o văd doar organizatorii și administratorii clubului");
    expect(text(privacyNoticeEn)).toContain("is not on the public list of participants");
    expect(text(privacyNoticeEn)).toContain("The full list of volunteers, with the address and telephone number, is seen only by the club's organizers and administrators");
  });
});

describe("§821 the marker's value", () => {
  it("is the form's own tick, quoted, in each language, read from the catalogue the form reads", () => {
    expect(volunteersListClause("ro")).toBe("„Vreau să apar pe lista publică a voluntarilor”");
    expect(volunteersListClause("en")).toBe("“I want to appear on the public list of volunteers”");
    expect(volunteersMergeValues("ro").volunteersList).toBe(volunteersListClause("ro"));
    expect(mergeText("({{volunteersList}})", volunteersMergeValues("en"))).toBe("(“I want to appear on the public list of volunteers”)");
    // A renamed label changes the notice's sentence with it.
    expect(volunteersListClause("ro")).toContain(ro.Event.volunteers.list.tick);
    expect(volunteersListClause("en")).toContain(en.Event.volunteers.list.tick);
  });

  it("is what the legal pages substitute, so an approved text never shows the braces", () => {
    const merged = mergeText(text(privacyNoticeRo), volunteersMergeValues("ro"));
    expect(merged).not.toContain("{{volunteersList}}");
    expect(merged).toContain("„Vreau să apar pe lista publică a voluntarilor”");
  });
});

describe("§821 the editor's legend", () => {
  it("has a token and a line for the marker, in both languages", () => {
    expect(DECLARATION_TOKENS.some((token) => token.token === "{{volunteersList}}")).toBe(true);
    expect((ro.Admin.legal.tokens as Record<string, string>).volunteersList).toBeTruthy();
    expect((en.Admin.legal.tokens as Record<string, string>).volunteersList).toBeTruthy();
  });
});
