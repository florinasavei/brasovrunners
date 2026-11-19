import { describe, expect, it } from "vitest";
import { SAMPLE_DOCUMENTS } from "@/db/seeds/sample-legal-documents";
import { DOCUMENT_CODES } from "@/modules/legal-documents/domain/confirmation";
import { LEGAL_DOCUMENT_KEYS, RAFFLE_RULES_KEY } from "@/modules/legal-documents/domain/keys";
import { describesRaffle, mergeFieldsIn, RAFFLE_GROUPS_MERGE_FIELD, RAFFLE_MERGE_FIELD } from "@/modules/legal-documents/domain/merge-fields";
import { LEGAL_KIND_GROUPS } from "@/modules/legal-documents/domain/overview";
import { LEGAL_TEMPLATES } from "@/modules/legal-documents/templates/catalogue";
import { privacyNoticeEn, privacyNoticeRo } from "@/modules/legal-documents/templates/privacy-notice";
import { raffleRulesEn, raffleRulesRo } from "@/modules/legal-documents/templates/raffle-rules";
import { DECLARATION_TOKENS } from "@/modules/legal-documents/templates/tokens";
import { volunteersMergeValues } from "@/modules/volunteers/notice-words";
import { raffleClause, raffleGroupsPhrase } from "@/modules/volunteers/raffle-words";
import { CLUB_LOCALITY } from "@/modules/events/domain/place";
import { CLUB_NAME } from "@/theme/brand";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";

/**
 * §984 — «Regulamentul tombolei», a legal document of the platform (BR-REQ-053-01; the owner, 2026-11-18, asked: a person accepts a
 * raffle's rules approved by the club, without which the sign-up does not open), and the privacy notice's `{{raffle}}`:
 *
 * - a key of its own, last, in a group of its own on `/admin/legal`, approved by the one press like the volunteer agreement, its code
 *   one word in both languages;
 * - a template in Romanian and English saying what the brief asks — the organizer, who may take part, how to sign up, the draw, the
 *   prizes, the winners and no name published without their agreement, the data, withdrawal, disputes — with the club's facts left as
 *   visible placeholders and the event's as merge fields filled when a person accepts; no club, place, date or prize written in;
 * - the seed's sample outside production, under the not-approved banner;
 * - the notice's paragraph and line, naming `{{raffle}}` — the marker of the gate — in both languages, and the legend's words for both
 *   fields in both catalogues.
 */

const text = (body: { sections: ReadonlyArray<{ heading?: string; paragraphs: readonly string[] }> }) => body.sections.flatMap((section) => [section.heading ?? "", ...section.paragraphs]).join("\n");

describe("§984 BR-REQ-053-01 «Regulamentul tombolei» is a legal document of the platform", () => {
  it("is a key of its own, last, in a group of its own, with a one-word code and a name in both languages", () => {
    expect(RAFFLE_RULES_KEY).toBe("RAFFLE_RULES");
    // Last but for the team's undertaking, appended after it (§NNN).
    expect(LEGAL_DOCUMENT_KEYS.at(-2)).toBe("RAFFLE_RULES");
    expect(LEGAL_KIND_GROUPS.find((group) => group.id === "raffle")?.keys).toEqual(["RAFFLE_RULES"]);
    expect(DOCUMENT_CODES.RAFFLE_RULES).toBe("RAFFLE");
    expect(LEGAL_TEMPLATES.RAFFLE_RULES.ro).toEqual({ title: "Regulamentul tombolei", body: raffleRulesRo });
    expect(LEGAL_TEMPLATES.RAFFLE_RULES.en).toEqual({ title: "Raffle rules", body: raffleRulesEn });
    expect(ro.Admin.legal.keys.RAFFLE_RULES).toBe("Regulamentul tombolei");
    expect(en.Admin.legal.keys.RAFFLE_RULES).toBe("Raffle rules");
    expect(ro.Admin.legal.whatIs.RAFFLE_RULES).toMatch(/nu se deschide/);
    expect(en.Admin.legal.whatIs.RAFFLE_RULES).toMatch(/does not open/);
  });

  it("says, in both languages and the same nine sections, what the brief asks", () => {
    expect(raffleRulesRo.sections.map((section) => section.paragraphs.length)).toEqual(raffleRulesEn.sections.map((section) => section.paragraphs.length));
    expect(raffleRulesRo.sections).toHaveLength(9);
    const roText = text(raffleRulesRo);
    const enText = text(raffleRulesEn);
    for (const [words, english] of [
      ["Tombola este organizată de", "The raffle is organised by"],
      ["Pot participa la tombolă {{raffleGroups}}", "The raffle is open to {{raffleGroups}}"],
      ["Participarea este gratuită", "Taking part is free"],
      ["Înscrierea se face numai cu acceptarea acestui regulament", "A sign-up is made only by accepting these rules"],
      ["din formularul tombolei de pe pagina evenimentului", "from the raffle's form on the event's page"],
      ["dintre cei înscriși", "among those signed up"],
      ["Câștigătorul trebuie să fie prezent la extragere", "A winner must be present at the draw"],
      ["Premiile, câte sunt și în ce ordine se extrag le anunță organizatorul", "The prizes, how many there are and the order in which they are drawn are announced by the organiser"],
      ["nu publică pe internet numele unui câștigător fără acordul lui", "publishes no winner's name online without their agreement"],
      ["nota de confidențialitate a clubului", "the club's privacy notice"],
      ["Te poți retrage oricând până la extragere", "You may withdraw at any time before the draw"],
      ["instanțele competente din România", "the competent courts of Romania"],
    ]) {
      expect(roText, words).toContain(words);
      expect(enText, english).toContain(english);
    }
  });

  it("leaves the club's facts as visible placeholders and the event's as merge fields — no club, place, date or prize written in", () => {
    for (const [locale, body] of [["ro", raffleRulesRo], ["en", raffleRulesEn]] as const) {
      const all = text(body);
      expect([...mergeFieldsIn(body)].sort(), locale).toEqual(["event", "eventDate", "eventLocation", RAFFLE_GROUPS_MERGE_FIELD].sort());
      expect(all.match(/<[^>]+>/g)?.length ?? 0, locale).toBeGreaterThanOrEqual(4);
      expect(all, locale).not.toContain(CLUB_NAME);
      expect(all, locale).not.toContain(CLUB_LOCALITY);
      expect(all, locale).not.toMatch(/\b20\d\d\b|\blei\b|\bRON\b|\b\d{1,2}:\d{2}\b/);
      // Nothing of the screens' words: a label renamed must not leave the approved text behind.
      expect(all, locale).not.toMatch(/Gestionează înscrierea|Manage your registration|Nu mai particip|no longer taking part/);
    }
  });

  it("is seeded outside production as a sample, under the not-approved banner, its fields and placeholders as they are", () => {
    const sample = SAMPLE_DOCUMENTS.find((document) => document.key === "RAFFLE_RULES");
    expect(sample?.translations.map((translation) => translation.locale)).toEqual(["ro", "en"]);
    const [roSample, enSample] = sample?.translations ?? [];
    expect(roSample.title).toBe("Regulamentul tombolei (EXEMPLU, NEAPROBAT)");
    expect(enSample.title).toBe("Raffle rules (SAMPLE, NOT APPROVED)");
    expect(roSample.body.sections[0].heading).toBe("TEXT DE EXEMPLU — NEAPROBAT");
    expect(enSample.body.sections[0].heading).toBe("SAMPLE TEXT — NOT APPROVED");
    expect(mergeFieldsIn(roSample.body).has(RAFFLE_GROUPS_MERGE_FIELD)).toBe(true);
  });
});

describe("§984 BR-REQ-053-01 the privacy notice's `{{raffle}}`, the marker of the sign-up's gate", () => {
  it("is named in sections 5 and 7 of the template, in both languages, and nowhere else", () => {
    for (const body of [privacyNoticeRo, privacyNoticeEn]) {
      expect(describesRaffle(body)).toBe(true);
      const named = body.sections.flatMap((section, index) => section.paragraphs.filter((paragraph) => paragraph.includes(`{{${RAFFLE_MERGE_FIELD}}}`)).map(() => index));
      expect(named).toHaveLength(2);
    }
    const roParagraph = privacyNoticeRo.sections.flatMap((section) => section.paragraphs).find((paragraph) => paragraph.startsWith("Tombola ({{raffle}})")) ?? "";
    // What it keeps, why, who sees it, for how long, how to withdraw.
    for (const words of ["numele scris în formular", "dacă te-ai înscris ca voluntar", "acceptarea regulamentului tombolei", "adresa IP și browserul", "cine din echipă a înregistrat-o", "Scop:", "Temei:", "organizatorii și administratorii clubului", "30 de zile după începutul evenimentului", "Te poți retrage oricând până la extragere"]) {
      expect(roParagraph, words).toContain(words);
    }
    expect(describesRaffle({ sections: [{ paragraphs: ["Nimic despre tombolă."] }] })).toBe(false);
  });

  it("is filled with the public form's name, quoted, wherever the notice is shown", () => {
    expect(raffleClause("ro")).toBe(`„${ro.Event.raffle.title}”`);
    expect(raffleClause("en")).toBe(`“${en.Event.raffle.title}”`);
    expect(volunteersMergeValues("ro").raffle).toBe(raffleClause("ro"));
    expect(volunteersMergeValues("en").raffle).toBe(raffleClause("en"));
  });

  it("names the groups a raffle ticks as a sentence names them, in both languages", () => {
    expect(raffleGroupsPhrase({ RUNNER: true, ELITE: false, VOLUNTEER: false }, "ro")).toBe(ro.Legal.raffleGroups.RUNNER);
    expect(raffleGroupsPhrase({ RUNNER: true, ELITE: false, VOLUNTEER: true }, "ro")).toBe(`${ro.Legal.raffleGroups.RUNNER} și ${ro.Legal.raffleGroups.VOLUNTEER}`);
    expect(raffleGroupsPhrase({ RUNNER: true, ELITE: true, VOLUNTEER: true }, "en")).toBe(`${en.Legal.raffleGroups.RUNNER}, ${en.Legal.raffleGroups.ELITE} and ${en.Legal.raffleGroups.VOLUNTEER}`);
    expect(raffleGroupsPhrase({ RUNNER: false, ELITE: false, VOLUNTEER: false }, "ro")).toBe("");
  });

  it("has the legend's words for both fields, in both catalogues", () => {
    for (const field of [RAFFLE_MERGE_FIELD, RAFFLE_GROUPS_MERGE_FIELD]) {
      expect(DECLARATION_TOKENS.some((token) => token.token === `{{${field}}}`), field).toBe(true);
      expect((ro.Admin.legal.tokens as Record<string, string>)[field], field).toBeTruthy();
      expect((en.Admin.legal.tokens as Record<string, string>)[field], field).toBeTruthy();
    }
  });
});
