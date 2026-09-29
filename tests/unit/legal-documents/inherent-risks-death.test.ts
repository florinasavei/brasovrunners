import { describe, expect, it } from "vitest";
import type { LegalDocumentBody } from "@/modules/legal-documents/domain/content-hash";
import { LEGAL_TEMPLATES } from "@/modules/legal-documents/templates/catalogue";
import { declarationRoadEn, declarationRoadRo, declarationTrailEn, declarationTrailRo } from "@/modules/legal-documents/templates/declaration";
import { groupRunAsphaltEn, groupRunAsphaltRo, groupRunTrailEn, groupRunTrailRo } from "@/modules/legal-documents/templates/group-run-declaration";

/**
 * BR-REQ-053-01, BR-REQ-053-02 (§568, amending §515, §523 and §556) — the owner, 2026-09-29: «vreau
 * la declarații să fim acoperiți inclusiv în caz de deces». Every declaration template, in both
 * languages, names serious injury and death among the inherent risks, says the runner takes part at
 * their own risk and accepts those risks death included, and waives — «în limitele permise de lege» —
 * the claims for harm arising from them against the organiser, its team, its volunteers and its
 * partners, the heirs bound within the same limits. The text never frees the organiser from a death it
 * causes: a clause excluding liability for bodily harm or death through the organiser's own fault is
 * void (Codul civil art. 1355), so the waiver leaves out the harm caused through their fault and the
 * organiser's safety duties, in so many words.
 */
type Locale = "ro" | "en";
const paragraphsOf = (body: LegalDocumentBody) => body.sections.flatMap((section) => section.paragraphs);
const sentencesOf = (body: LegalDocumentBody) => paragraphsOf(body).flatMap((p) => p.split(/(?<=[.;])\s+(?=\p{Lu})/u));

const DECLARATIONS: ReadonlyArray<{ key: keyof typeof LEGAL_TEMPLATES; ro: LegalDocumentBody; en: LegalDocumentBody; race: boolean }> = [
  { key: "EVENT_DECLARATION", ro: declarationTrailRo, en: declarationTrailEn, race: true },
  { key: "EVENT_DECLARATION_ROAD", ro: declarationRoadRo, en: declarationRoadEn, race: true },
  { key: "GROUP_RUN_DECLARATION_ASPHALT", ro: groupRunAsphaltRo, en: groupRunAsphaltEn, race: false },
  { key: "GROUP_RUN_DECLARATION_TRAIL", ro: groupRunTrailRo, en: groupRunTrailEn, race: false },
];

const LAW_LIMIT = { ro: "în limitele permise de lege", en: "to the extent the law allows" } as const;

/** The sentences §568 wrote, the same in the four texts. */
const WORDS = {
  ownRisk: { ro: "Particip de bunăvoie și pe propriul risc.", en: "I take part of my own free will and at my own risk." },
  canKill: { ro: "Aceste riscuri pot duce la accidentare, la vătămare gravă sau chiar la deces.", en: "These risks can lead to injury, to serious injury or even to death." },
  acceptsDeath: { ro: "inclusiv riscul de vătămare gravă sau de deces", en: "including the risk of serious injury or death" },
  sources: {
    ro: "de teren, de vreme, de propria mea sănătate, de ceilalți participanți, de animale și de trafic, unde traseul folosește sau traversează drumuri.",
    en: "the weather, my own health, the other participants, animals and traffic, where the",
  },
  waiver: {
    ro: "Renunț însă, separat și expres, în limitele permise de lege, la pretențiile pentru prejudiciile ce decurg exclusiv din riscurile inerente, fără vina organizatorului, inclusiv vătămare gravă sau deces.",
    en: "I do, however, separately and expressly waive, to the extent the law allows, my claims for harm arising solely from the inherent risks, without the organiser's fault, serious injury or death included.",
  },
  against: {
    ro: "Renunțarea privește pretențiile față de organizator, echipa lui de organizare, voluntarii și partenerii lui.",
    en: "The waiver covers my claims against the organiser, its organising team, its volunteers and its partners.",
  },
  notTheirFault: {
    ro: "Ea nu privește prejudiciile cauzate din vina acestora și nu înlătură obligațiile de siguranță ale organizatorului.",
    en: "It does not cover harm caused through their fault, and it does not remove the organiser's safety duties.",
  },
  heirs: {
    ro: "Renunțarea îi obligă și pe moștenitorii mei, în limitele permise de lege.",
    en: "This waiver also binds my heirs, to the extent the law allows.",
  },
  notByItself: {
    ro: "nu înseamnă, prin ea însăși, că renunț la dreptul de a fi despăgubit (art. 1355 alin. (4) din Codul civil)",
    en: "not, by itself, a waiver of my right to compensation (art. 1355(4) of the Romanian Civil Code)",
  },
} as const;

const GUARDIAN = {
  ro: "Părintele sau tutorele legal care semnează alături de minor acceptă pentru el riscurile de mai jos, inclusiv pe cel de deces, și renunțarea de mai jos, în limitele permise de lege.",
  en: "The parent or legal guardian who signs beside the minor accepts for them the risks below, death included, and the waiver below, to the extent the law allows.",
} as const;

const DEATH = { ro: /\bdeces(?:ul)?\b/, en: /\bdeath\b/ } as const;
const NOT_LIABLE = { ro: /nu răspunde|nu (?:poate|pot) fi tras/, en: /not responsible|not liable|cannot be held liable/ } as const;

describe("§568 the declarations cover the inherent risks, death included, within the law's limits", () => {
  it("are the catalogue's four declaration texts", () => {
    for (const { key, ro, en } of DECLARATIONS) {
      expect(LEGAL_TEMPLATES[key].ro.body, key).toBe(ro);
      expect(LEGAL_TEMPLATES[key].en.body, key).toBe(en);
    }
  });

  for (const { key, ro, en, race } of DECLARATIONS) {
    const bodies = { ro, en } as const;
    for (const locale of ["ro", "en"] as const satisfies readonly Locale[]) {
      const all = () => paragraphsOf(bodies[locale]).join("\n");

      it(`${key} ${locale}: names serious injury and death among the inherent risks`, () => {
        expect(all()).toContain(WORDS.canKill[locale]);
        expect(all()).toContain(WORDS.sources[locale]);
        if (race) {
          // The course's first risk bullet names them too, beside the injury and the existing condition.
          const firstRisk = paragraphsOf(bodies[locale]).find((p) => p.startsWith(locale === "ro" ? "• Cunosc și accept riscurile" : "• I know and accept the risks"));
          expect(firstRisk, key).toMatch(locale === "ro" ? /vătămare gravă sau deces;$/ : /serious injury or death;$/);
        }
      });

      it(`${key} ${locale}: takes part at their own risk and accepts the risks, death included`, () => {
        expect(all()).toContain(WORDS.ownRisk[locale]);
        expect(all()).toContain(WORDS.acceptsDeath[locale]);
        // The acceptance comes before the waiver, and the Civil Code's own «not by itself» stays between them.
        const text = all();
        expect(text.indexOf(WORDS.acceptsDeath[locale])).toBeLessThan(text.indexOf(WORDS.notByItself[locale]));
        expect(text.indexOf(WORDS.notByItself[locale])).toBeLessThan(text.indexOf(WORDS.waiver[locale]));
      });

      it(`${key} ${locale}: waives, within the law's limits, the claims for harm from those risks — the heirs too, never for their fault`, () => {
        for (const sentence of [WORDS.waiver, WORDS.against, WORDS.notTheirFault, WORDS.heirs]) expect(all()).toContain(sentence[locale]);
        expect(WORDS.waiver[locale]).toContain(LAW_LIMIT[locale]);
        // The waiver names death itself, not only by pointing back to the acceptance: a clause the
        // club drafted is read against the club (art. 1269 C. civ.).
        expect(WORDS.waiver[locale]).toMatch(DEATH[locale]);
        expect(WORDS.heirs[locale]).toContain(LAW_LIMIT[locale]);
        // The four sentences sit together, in this order, in one paragraph.
        const paragraph = paragraphsOf(bodies[locale]).find((p) => p.includes(WORDS.waiver[locale]))!;
        expect(paragraph).toContain(`${WORDS.waiver[locale]} ${WORDS.against[locale]} ${WORDS.notTheirFault[locale]} ${WORDS.heirs[locale]}`);
      });

      it(`${key} ${locale}: never says the organiser does not answer for a death`, () => {
        for (const sentence of sentencesOf(bodies[locale])) {
          if (DEATH[locale].test(sentence)) expect(sentence, sentence.slice(0, 60)).not.toMatch(NOT_LIABLE[locale]);
        }
        if (race) {
          expect(all()).toContain(
            locale === "ro"
              ? "Nimic din această declarație nu înlătură și nu limitează răspunderea organizatorului pentru prejudiciile cauzate cu intenție sau din culpă gravă ori pentru vătămarea integrității corporale sau a sănătății"
              : "Nothing in this declaration excludes or limits the organiser's liability for harm caused intentionally or through gross negligence, or for harm to bodily integrity or health",
          );
        }
      });

      if (race) {
        it(`${key} ${locale}: the guardian of a minor of 14–17 accepts the risks and the waiver for them, within the law's limits`, () => {
          const minors = paragraphsOf(bodies[locale]).find((p) => p.includes(GUARDIAN[locale]));
          expect(minors, key).toBeDefined();
          expect(minors).toMatch(locale === "ro" ? /între 14 și 17 ani inclusiv/ : /aged between 14 and 17 inclusive/);
        });
      }
    }
  }

  it("writes the new sentences plainly: at most 200 characters each, no «platforma», no «de obicei», no «trail» in Romanian", () => {
    const romanian = [WORDS.ownRisk.ro, WORDS.canKill.ro, WORDS.waiver.ro, WORDS.against.ro, WORDS.notTheirFault.ro, WORDS.heirs.ro, GUARDIAN.ro];
    const english = [WORDS.ownRisk.en, WORDS.canKill.en, WORDS.waiver.en, WORDS.against.en, WORDS.notTheirFault.en, WORDS.heirs.en, GUARDIAN.en];
    const written = [
      ...romanian,
      ...english,
      ...DECLARATIONS.flatMap(({ ro, en }) => [...sentencesOf(ro), ...sentencesOf(en)]).filter((s) => DEATH.ro.test(s) || DEATH.en.test(s)),
    ];
    for (const sentence of written) expect(sentence.length, sentence.slice(0, 60)).toBeLessThanOrEqual(200);
    for (const sentence of romanian) {
      expect(sentence).not.toMatch(/platform|de obicei/i);
      expect(sentence).not.toMatch(/(^|[^\p{L}])trail($|[^\p{L}])/iu);
    }
    for (const sentence of english) expect(sentence).not.toMatch(/platform|usually/i);
  });
});
