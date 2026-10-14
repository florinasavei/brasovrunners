import { describe, expect, it } from "vitest";
import { mergeFieldsIn } from "@/modules/legal-documents/domain/merge-fields";
import { describesRefusal } from "@/modules/legal-documents/domain/refusal-clause";
import { LEGAL_TEMPLATES } from "@/modules/legal-documents/templates/catalogue";
import {
  declarationRoadEn,
  declarationRoadRo,
  declarationTrailEn,
  declarationTrailRo,
  RACE_DECLARATION_PARTS,
} from "@/modules/legal-documents/templates/declaration";
import type { LegalDocumentBody } from "@/modules/legal-documents/domain/content-hash";

/**
 * §NNN (the owner, 2026-10-14, after a SportID «Consimțământ electronic» he received for a trail race; amending §568, §418
 * and §330) — five more clauses in the race declaration's TEMPLATE, trail and road, Romanian and English, and one
 * sentence that the typed name is the person's electronic signature. The texts in force never move; a Romanian lawyer reads the
 * disqualification clause and the signature sentence before the club approves them (the template's own note says so).
 *
 * The five, in the owner's order: medical insurance or the costs borne; the marked route and the instructions of the
 * organiser and the volunteers («voluntari», never «arbitri»); disqualification without appeal, on objective grounds, within
 * the law's limits; litter in the event's area; no vehicle of any kind in its perimeter.
 */
type Locale = "ro" | "en";
const LOCALES: readonly Locale[] = ["ro", "en"];
const paragraphsOf = (body: LegalDocumentBody) => body.sections.flatMap((section) => section.paragraphs);
const TEXTS = {
  trail: { ro: paragraphsOf(declarationTrailRo), en: paragraphsOf(declarationTrailEn) },
  road: { ro: paragraphsOf(declarationRoadRo), en: paragraphsOf(declarationRoadEn) },
} as const;
const COURSES = ["trail", "road"] as const;

/** The five clauses, each as the pattern that finds it in each language — and the order they stand in. */
const CLAUSES = [
  { what: "valid medical insurance, or the medical costs borne in full", ro: /asigurare medicală valabilă.*costurile medicale/, en: /valid medical insurance.*medical costs/ },
  { what: "the marked route and the instructions of the organiser and the volunteers, who may stop or disqualify", ro: /Urmez numai traseul marcat.*voluntarilor.*opri sau descalifica/, en: /follow only the marked course.*volunteers.*stop or disqualify/ },
  {
    what: "disqualification without appeal for leaving the route, unsporting behaviour or breaking the rules",
    ro: /mă poate descalifica, fără drept de contestare.*părăsesc traseul marcat.*comportament nesportiv.*încalc regulamentul/,
    en: /may disqualify me, without appeal.*leave the marked course.*unsporting.*break the event's rules/,
  },
  { what: "litter in the event's area is disqualification", ro: /Nu las deșeuri în zona evenimentului.*pot fi descalificat/, en: /leave no litter in the area of the event.*may be disqualified/ },
  {
    what: "no vehicle of any kind in the event's perimeter",
    ro: /niciun vehicul de orice fel \(mașină, bicicletă, motocicletă, ATV\).*perimetrul evenimentului/,
    en: /no vehicle of any kind \(car, bicycle, motorbike, ATV\).*perimeter of the event/,
  },
] as const;

const SIGNATURE_SENTENCE = {
  ro: /Numele pe care îl scriu mai jos, când semnez electronic, este semnătura mea electronică: între mine și organizator produce aceleași efecte ca o semnătură olografă, iar prin bifa de acceptare sunt de acord să semnez în acest mod\./,
  en: /The name I type below, when I sign electronically, is my electronic signature: between the organiser and me it has the same effect as a handwritten signature, and by ticking the acceptance box I agree to sign in this way\./,
} as const;

const indexOf = (course: (typeof COURSES)[number], locale: Locale, pattern: RegExp) => TEXTS[course][locale].findIndex((paragraph) => pattern.test(paragraph));

describe("§NNN the five clauses, in the trail's and the road's declaration, in both languages", () => {
  for (const course of COURSES) {
    for (const locale of LOCALES) {
      for (const clause of CLAUSES) {
        it(`${course} ${locale}: says ${clause.what}, in one paragraph of its own`, () => {
          const hits = TEXTS[course][locale].filter((paragraph) => clause[locale].test(paragraph));
          expect(hits).toHaveLength(1);
          // A list item, like its neighbours: the shared duties are bullets.
          expect(hits[0].startsWith("• ")).toBe(true);
        });
      }
      it(`${course} ${locale}: has them in the owner's order, one after the other, between fair play and the belongings`, () => {
        const at = CLAUSES.map((clause) => indexOf(course, locale, clause[locale]));
        expect(at).toEqual([...at].sort((a, b) => a - b));
        expect(at[4] - at[0]).toBe(4);
        const fairPlay = indexOf(course, locale, locale === "ro" ? /fair-play/ : /fair play/);
        const belongings = indexOf(course, locale, locale === "ro" ? /Obiectele personale/ : /personal belongings/);
        expect(fairPlay).toBe(at[0] - 1);
        expect(belongings).toBe(at[4] + 1);
      });
    }
  }

  it("are written once, in the shared duties — never in a course's own risks, so the two texts cannot drift", () => {
    for (const locale of LOCALES) {
      const parts = RACE_DECLARATION_PARTS[locale];
      for (const clause of CLAUSES) {
        expect(parts.shared.filter((paragraph) => clause[locale].test(paragraph)), `${locale} ${clause.what}`).toHaveLength(1);
        expect([...parts.trail, ...parts.road, ...parts.opening, ...parts.closing].filter((paragraph) => clause[locale].test(paragraph))).toEqual([]);
      }
    }
  });

  it("names the volunteers «voluntari» and «volunteers», and never a referee: the house says «voluntari», never «arbitri»", () => {
    for (const course of COURSES) {
      expect(TEXTS[course].ro.join("\n")).toMatch(/voluntarilor/);
      expect(TEXTS[course].ro.join("\n")).not.toMatch(/arbitr/i);
      expect(TEXTS[course].en.join("\n")).toMatch(/volunteers/);
      expect(TEXTS[course].en.join("\n")).not.toMatch(/referee|umpire|arbiter/i);
    }
  });

  it("qualifies the disqualification by the law's limits and by objective grounds the organiser tells, as the terms' refusal grounds are (§618, §636)", () => {
    for (const course of COURSES) {
      const ro = TEXTS[course].ro.find((paragraph) => CLAUSES[2].ro.test(paragraph))!;
      const en = TEXTS[course].en.find((paragraph) => CLAUSES[2].en.test(paragraph))!;
      expect(ro).toContain("în limitele permise de lege");
      expect(ro).toMatch(/doar pe aceste motive obiective, iar organizatorul mi le comunică/);
      expect(en).toContain("to the extent the law allows");
      expect(en).toMatch(/only on these objective grounds, and the organiser tells me which/);
    }
    // And the terms' own paragraph of grounds is untouched: still found word for word by the gate that reads it.
    expect(describesRefusal(LEGAL_TEMPLATES.TERMS.ro.body)).toBe(true);
    expect(describesRefusal(LEGAL_TEMPLATES.TERMS.en.body)).toBe(true);
  });

  it("is written in merge fields and the club's placeholder alone: the event is {{event}}, nothing is named (§357)", () => {
    for (const course of COURSES) {
      for (const locale of LOCALES) {
        const added = CLAUSES.map((clause) => TEXTS[course][locale].find((paragraph) => clause[locale].test(paragraph))!);
        // The route, the litter and the vehicle clauses say which event by its blank.
        for (const paragraph of [added[1], added[3], added[4]]) expect([...mergeFieldsIn({ sections: [{ paragraphs: [paragraph] }] })]).toEqual(["event"]);
        // No digit, no town, no club: the text names no place, date, distance or number.
        for (const paragraph of added) expect(paragraph.replace(/\{\{[a-zA-Z]+\}\}/g, "")).not.toMatch(/\d|Brașov|Brasov/);
      }
    }
  });
});

describe("§NNN the typed name is the person's electronic signature", () => {
  for (const course of COURSES) {
    for (const locale of LOCALES) {
      it(`${course} ${locale}: one sentence of its own in the closing, before the organiser's footnote`, () => {
        const paragraphs = TEXTS[course][locale];
        const hits = paragraphs.filter((paragraph) => SIGNATURE_SENTENCE[locale].test(paragraph));
        expect(hits).toHaveLength(1);
        const at = paragraphs.indexOf(hits[0]);
        expect(paragraphs[at + 1].startsWith("*")).toBe(true);
        expect(at).toBe(paragraphs.length - 2);
        // The paragraph that describes how the signature is recorded stays directly above it.
        expect(paragraphs[at - 1]).toMatch(locale === "ro" ? /^Semnez personal/ : /^I sign personally/);
      });
    }
  }

  it("is the closing's, shared: written once for both courses, and the other declarations of the platform are untouched by it", () => {
    for (const locale of LOCALES) {
      expect(RACE_DECLARATION_PARTS[locale].closing.filter((paragraph) => SIGNATURE_SENTENCE[locale].test(paragraph))).toHaveLength(1);
    }
    for (const key of ["GROUP_RUN_DECLARATION_TRAIL", "GROUP_RUN_DECLARATION_ASPHALT", "VOLUNTEER_AGREEMENT"] as const) {
      for (const locale of LOCALES) {
        expect(paragraphsOf(LEGAL_TEMPLATES[key][locale].body).some((paragraph) => SIGNATURE_SENTENCE[locale].test(paragraph)), `${key} ${locale}`).toBe(false);
      }
    }
  });
});

describe("§NNN the privacy notice's template says the trace is kept", () => {
  const notice = (locale: Locale) => paragraphsOf(LEGAL_TEMPLATES.PRIVACY_NOTICE[locale].body);
  const declarationParagraph = (locale: Locale) => notice(locale).find((paragraph) => paragraph.startsWith(locale === "ro" ? "Declarația pe proprie răspundere confirmă locul" : "The declaration of own responsibility confirms your place"))!;

  it("says in the declaration's paragraph that the IP address and the browser at the moment of signing are kept with the signed declaration as proof of the signature, as long as the declaration", () => {
    expect(declarationParagraph("ro")).toMatch(/Dacă semnezi electronic, păstrăm împreună cu declarația semnată adresa IP și browserul din care semnezi, așa cum sunt în momentul semnării, ca dovadă a semnăturii, cât timp păstrăm declarația \(secțiunea 7\)/);
    expect(declarationParagraph("en")).toMatch(/If you sign electronically, we keep with the signed declaration the IP address and the browser you sign from, as they are at the moment of signing, as proof of the signature, for as long as we keep the declaration \(section 7\)/);
  });

  it("says a paper signature keeps nothing of the kind, and no longer says the IP address is not kept", () => {
    expect(declarationParagraph("ro")).toContain("la o semnătură pe hârtie nu păstrăm nimic de acest fel");
    expect(declarationParagraph("en")).toContain("for a signature on paper we keep nothing of the kind");
    for (const locale of LOCALES) expect(notice(locale).join("\n")).not.toMatch(/nu și adresa IP|not your IP address/);
  });

  it("says it of the group run's declaration and of the volunteer agreement too — the same three rows keep it", () => {
    expect(notice("ro").find((paragraph) => paragraph.startsWith("Pe o alergare de grup"))).toContain("împreună cu adresa IP și browserul din care semnezi, ca dovadă a semnăturii");
    expect(notice("en").find((paragraph) => paragraph.startsWith("On a group run you may sign"))).toContain("together with the IP address and the browser you sign from, as proof of the signature");
    const volunteersRo = notice("ro").find((paragraph) => paragraph.startsWith("Voluntari ("))!;
    const volunteersEn = notice("en").find((paragraph) => paragraph.startsWith("Volunteers ("))!;
    expect(volunteersRo).toContain("dacă accepți electronic, în formular sau din legătura primită pe e-mail, păstrăm și adresa IP și browserul din care accepți");
    expect(volunteersRo).toContain("adresa IP și browserul din care acceptă");
    expect(volunteersEn).toContain("if you accept electronically, on the form or from the link received by email, we also keep the IP address and the browser you accept from");
    expect(volunteersEn).toContain("the IP address and browser they accept from");
  });

  it("no longer says in section 10 that the platform stores no IP address, which the same text contradicts", () => {
    const all = (locale: Locale) => notice(locale).join(" ");
    expect(all("ro")).not.toContain("nu stochează nicio adresă IP");
    expect(all("en")).not.toContain("stores no IP address");
    expect(all("ro")).toContain("singura adresă IP pe care o păstrăm este cea a unei semnături electronice");
    expect(all("en")).toContain("the only IP address we keep is that of an electronic signature");
  });

  it("gates nothing: no merge field or marker was added for it, so no /admin/tasks row waits on it", () => {
    for (const locale of LOCALES) {
      const fields = [...mergeFieldsIn({ sections: [{ paragraphs: [declarationParagraph(locale)] }] })];
      expect(fields).toEqual([]);
    }
  });
});
