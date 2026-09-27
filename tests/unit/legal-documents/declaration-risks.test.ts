import { describe, expect, it } from "vitest";
import { mergeFieldsIn } from "@/modules/legal-documents/domain/merge-fields";
import {
  declarationRoadEn,
  declarationRoadRo,
  declarationTrailEn,
  declarationTrailRo,
  RACE_DECLARATION_PARTS,
} from "@/modules/legal-documents/templates/declaration";
import { LEGAL_TEMPLATES } from "@/modules/legal-documents/templates/catalogue";
import type { LegalDocumentBody } from "@/modules/legal-documents/domain/content-hash";

/**
 * §357 — the owner, 2026-09-24: the declaration must "cover us on the encounters with wild
 * animals, proper equipment (shoes, headlamp for night running), falling, etc — basically the
 * runner takes ownership of everything". §418 — the counsel review: informed acceptance of risk,
 * never a waiver, and the law's limit on every sentence that says the organiser does not answer.
 *
 * §NNN — the owner's review of 2026-09-27: the race's declaration is two texts from one shared
 * body — trail (`EVENT_DECLARATION`) and road or park (`EVENT_DECLARATION_ROAD`). The shared
 * sections (the participant, the minimum age, minors of 14–17, liability, health, stopping, fair
 * play, belongings, the kit, photographs, the data, the signature) are written once; each text adds
 * the risks of its own course. No flow for a participant under fourteen. Wild animals in general
 * words; substances as "other substances that impair my ability to take part safely"; the start
 * refused only for the mandatory equipment of the event's own rules.
 */
type Locale = "ro" | "en";
const LOCALES: readonly Locale[] = ["ro", "en"];
const paragraphsOf = (body: LegalDocumentBody) => body.sections.flatMap((s) => s.paragraphs);
const TEXTS = {
  trail: { ro: paragraphsOf(declarationTrailRo), en: paragraphsOf(declarationTrailEn) },
  road: { ro: paragraphsOf(declarationRoadRo), en: paragraphsOf(declarationRoadEn) },
} as const;
type Course = keyof typeof TEXTS;
const COURSES: readonly Course[] = ["trail", "road"];
const bullets = (course: Course, locale: Locale) => TEXTS[course][locale].filter((p) => p.startsWith("• "));
const all = (course: Course, locale: Locale) => TEXTS[course][locale].join("\n");

/** What both texts must say, in each language. */
const SHARED: ReadonlyArray<{ what: string; ro: RegExp[]; en: RegExp[] }> = [
  { what: "the event's own minimum age, never a number", ro: [/Declar că am cel puțin \{\{minimumAge\}\} împliniți la data evenimentului\./], en: [/I declare that I am at least \{\{minimumAge\}\} old on the day of the event\./] },
  {
    what: "minors of 14 to 17: the minor signs, the parent or guardian approves and signs",
    ro: [/între 14 și 17 ani inclusiv, declarația este semnată de participant și încuviințată de părintele sau tutorele legal/, /art\. 41 alin\. \(2\)/],
    en: [/aged between 14 and 17 inclusive, this declaration is signed by the participant and approved by the parent or legal guardian/, /art\. 41\(2\)/],
  },
  { what: "nobody under the minimum takes part", ro: [/Persoanele care nu au împlinit vârsta minimă stabilită pentru eveniment nu pot participa\./], en: [/Persons who have not reached the minimum age set for the event may not take part\./] },
  {
    what: "liability without an absolute waiver",
    ro: [/riscuri inerente/, /nu înseamnă, prin ea însăși, că renunț la dreptul de a fi despăgubit/, /răspunde, potrivit legii, pentru prejudiciile care îi sunt imputabile/, /Nu răspunde, în limitele permise de lege, pentru prejudiciile care nu îi sunt imputabile/, /art\. 1371/, /se reduce sau, după caz, se înlătură/, /intenție sau din culpă gravă/, /integrității corporale sau a sănătății/],
    en: [/inherent risks/, /not, by itself, a waiver of my right to compensation/, /liable, under the law, for harm attributable to it/, /not responsible, to the extent the law allows, for harm not attributable to it/, /art\. 1371/, /reduced or, as the case may be, removed/, /intentionally or through gross negligence/, /bodily integrity or health/],
  },
  { what: "health, as far as the runner knows, and the heart", ro: [/După cunoștința mea/, /inclusiv cardiace/, /sfatul medicului/], en: [/To the best of my knowledge/, /including cardiac ones/, /a doctor's advice/] },
  { what: "heat and cold", ro: [/deshidratare/, /epuizare termică/, /hipotermie/], en: [/dehydration/, /heat exhaustion/, /hypothermia/] },
  { what: "the weather and the dark", ro: [/fulgere/, /întunericului/, /modifica, scurta, opri sau anula/], en: [/lightning/, /after dark/, /change, shorten, stop or cancel/] },
  {
    what: "own equipment; the start refused only for the rules' mandatory equipment",
    ro: [/Echipamentul este responsabilitatea mea/, /telefon mobil încărcat/, /refuza startul doar dacă îmi lipsește echipamentul declarat obligatoriu în regulamentul evenimentului/, /ce regulamentul doar recomandă rămâne o recomandare/],
    en: [/equipment is my own responsibility/, /charged mobile phone/, /refuse me the start only if I lack the equipment the event's rules declare mandatory/, /only recommend remains a recommendation/],
  },
  {
    what: "own pace, dropping out, first aid and being stopped",
    ro: [/în ritmul meu/, /mă opresc dacă nu mă simt bine/, /abandonez/, /112/, /primul ajutor/, /oprit\/ă din eveniment/, /Deciziile pe care le iau pe traseu îmi aparțin/],
    en: [/at my own pace/, /stop if I feel unwell/, /drop out/, /112/, /first aid/, /being stopped from continuing/, /decisions I make on the course are my own/],
  },
  {
    what: "substances, in the owner's words",
    ro: [/Nu particip sub influența alcoolului, a drogurilor ori a altor substanțe care îmi afectează capacitatea de a participa în siguranță/],
    en: [/I do not take part under the influence of alcohol, drugs or other substances that impair my ability to take part safely/],
  },
  { what: "fair play", ro: [/fair-play/], en: [/fair play/] },
  { what: "personal belongings", ro: [/Obiectele personale/, /pierderea sau deteriorarea/], en: [/personal belongings/, /loss or damage/] },
  {
    what: "the kit, against a document on the declaration — for 14–17, the minor's or the co-signing parent's, as the terms say",
    ro: [/Kitul de participare se ridică personal și nu se cedează/, /pentru un participant de 14–17 ani, al lui ori al părintelui sau tutorelui legal care a semnat alături de el/],
    en: [/The race kit is collected in person and is not passed on/, /for a participant aged 14–17, theirs or that of the parent or legal guardian who signed beside them/],
  },
  { what: "photographs", ro: [/fotografii și filmări/], en: [/photographs and film/] },
  {
    what: "the data: three years, the documents seven days, the archive masked",
    ro: [/trei ani de la data evenimentului/, /cel mult șapte zile de la eveniment/, /le au mascate/],
    en: [/three years from the date of the event/, /at most seven days from the event/, /have them masked/],
  },
  {
    what: "the signature: personal, 14–17 both, simple electronic signature, fingerprint, moment, name",
    ro: [/Semnez personal: un adult semnează doar pentru sine/, /pentru un participant de 14–17 ani semnează minorul și părintele sau tutorele legal/, /semnătură electronică simplă/, /amprenta textului citit/, /momentul semnării/, /numele fiecărui semnatar/],
    en: [/I sign personally: an adult signs only for themselves/, /for a participant aged 14–17 the minor and the parent or legal guardian sign/, /simple electronic signature/, /fingerprint of the text read/, /moment of signing/, /each signer's name/],
  },
];

/** The trail's own risks — and the road text must not carry them. */
const TRAIL_ONLY = {
  ro: [/trasee montane sau de pădure/, /rădăcini/, /noroi/, /animalelor sălbatice/, /câini de stână/, /pantofi de trail/, /ajutorul poate ajunge greu/, /ariile naturale protejate/],
  en: [/mountain or forest trails/, /roots/, /mud/, /wild animals/, /sheepdogs/, /trail shoes/, /help can be slow/, /protected natural areas/],
};

/** The road's and the park's own risks — and the trail text must not carry them. */
const ROAD_ONLY = {
  ro: [/asfalt, beton, tartan sau pavele/, /borduri/, /gropi/, /capace de canal/, /suprafețe ude sau alunecoase/, /curbe și porțiuni înguste/, /aglomerație/, /contact sau în coliziune cu alți participanți/, /pietoni, bicicliști, trotinete/, /nu este complet închis circulației/, /schimbările bruște de direcție/, /nu blochez traseul/],
  en: [/asphalt, concrete, tartan or paving/, /kerbs/, /potholes/, /manhole covers/, /wet or slippery surfaces/, /bends and narrow sections/, /crowding/, /contact or collide with other participants/, /pedestrians, cyclists, scooters/, /not fully closed to traffic/, /sudden changes of direction/, /do not block the course/],
};

/** A sentence that says the organiser does not answer for something, qualified or not. */
const DISCLAIMER = { ro: /nu (?:pot|poate) fi (?:tras|trasă|trași|răspunz)|nu răspunde\b/i, en: /cannot be held liable|not responsible/i } as const;
const LAW_LIMIT = { ro: "în limitele permise de lege", en: "to the extent the law allows" } as const;

describe("§NNN the race's two declarations, one shared body", () => {
  it("are the catalogue's trail and road texts, both languages", () => {
    expect(LEGAL_TEMPLATES.EVENT_DECLARATION.ro.body).toBe(declarationTrailRo);
    expect(LEGAL_TEMPLATES.EVENT_DECLARATION.en.body).toBe(declarationTrailEn);
    expect(LEGAL_TEMPLATES.EVENT_DECLARATION_ROAD.ro.body).toBe(declarationRoadRo);
    expect(LEGAL_TEMPLATES.EVENT_DECLARATION_ROAD.en.body).toBe(declarationRoadEn);
    expect(LEGAL_TEMPLATES.EVENT_DECLARATION.ro.title).toMatch(/trail/);
    expect(LEGAL_TEMPLATES.EVENT_DECLARATION_ROAD.ro.title).toMatch(/șosea sau parc/);
  });

  it("share every section but the risks, written once: opening + course risks + shared duties + closing", () => {
    for (const locale of LOCALES) {
      const parts = RACE_DECLARATION_PARTS[locale];
      expect(TEXTS.trail[locale]).toEqual([...parts.opening, ...parts.trail, ...parts.shared, ...parts.closing]);
      expect(TEXTS.road[locale]).toEqual([...parts.opening, ...parts.road, ...parts.shared, ...parts.closing]);
      // The GDPR paragraph, the liability, the signature and the minors exist once, in the shared parts.
      for (const pattern of [/GDPR|Regulation \(EU\) 2016\/679/, /art\. 1371/, /eIDAS/, /14 (?:și|and) 17|14–17/]) {
        const inRisks = [...parts.trail, ...parts.road].filter((p) => pattern.test(p));
        expect(inRisks, `${locale} ${pattern}`).toEqual([]);
      }
    }
  });

  for (const course of COURSES) {
    for (const { what, ro, en } of SHARED) {
      it(`${course}: says ${what}, in both languages`, () => {
        for (const pattern of ro) expect(all(course, "ro"), `ro ${pattern}`).toMatch(pattern);
        for (const pattern of en) expect(all(course, "en"), `en ${pattern}`).toMatch(pattern);
      });
    }
  }

  it("names the trail's risks only in the trail text, and the road's only in the road text", () => {
    for (const locale of LOCALES) {
      for (const pattern of TRAIL_ONLY[locale]) {
        expect(all("trail", locale), `trail ${locale} ${pattern}`).toMatch(pattern);
        expect(all("road", locale), `road ${locale} ${pattern}`).not.toMatch(pattern);
      }
      for (const pattern of ROAD_ONLY[locale]) {
        expect(all("road", locale), `road ${locale} ${pattern}`).toMatch(pattern);
        expect(all("trail", locale), `trail ${locale} ${pattern}`).not.toMatch(pattern);
      }
    }
  });

  it("words wild animals as the owner did, with no species list and no bear drill", () => {
    expect(all("trail", "ro")).toContain(
      "Știu că traseul poate traversa habitatul animalelor sălbatice și că pot întâlni animale domestice sau câini de stână. Mă oblig să păstrez distanța, să nu provoc sau hrănesc animalele, să respect indicațiile organizatorului și recomandările autorităților și, în caz de urgență, să apelez 112",
    );
    for (const course of COURSES) {
      expect(all(course, "ro")).not.toMatch(/urși|mistreți|vipere|nu fug de un urs/);
      expect(all(course, "en")).not.toMatch(/bears|wild boar|vipers|run from a bear/);
    }
  });

  it("has no flow for a participant under fourteen, and no «medicines that lower my attention»", () => {
    for (const course of COURSES) {
      expect(all(course, "ro")).not.toMatch(/sub 14 ani|semnează singur|minor sub 14|medicamentelor care îmi scad atenția/);
      expect(all(course, "en")).not.toMatch(/under 14|signs alone|minor under 14|medicines that impair my attention/);
    }
  });

  it("keeps the bullet style: each ends with a semicolon, the last with a full stop, the same shape in both languages", () => {
    for (const course of COURSES) {
      for (const locale of LOCALES) {
        const list = bullets(course, locale);
        expect(list.length, `${course} ${locale}`).toBeGreaterThanOrEqual(14);
        for (const bullet of list.slice(0, -1)) expect(bullet.endsWith(";"), `${course} ${locale}: ${bullet.slice(0, 40)}`).toBe(true);
        expect(list.at(-1)!.endsWith("."), `${course} ${locale}`).toBe(true);
      }
      expect(TEXTS[course].ro.length).toBe(TEXTS[course].en.length);
      TEXTS[course].ro.forEach((p, i) => expect(p.startsWith("• "), `${course} paragraph ${i}`).toBe(TEXTS[course].en[i].startsWith("• ")));
    }
  });

  it("closes the bullets with the owner's sentence, as a paragraph of its own", () => {
    for (const course of COURSES) {
      const ro = TEXTS[course].ro.indexOf("Îmi asum responsabilitatea pentru propria siguranță, pentru echipamentul meu și pentru deciziile pe care le iau pe traseu.");
      const en = TEXTS[course].en.indexOf("I take responsibility for my own safety, my equipment and the decisions I make on the course.");
      expect(ro).toBeGreaterThan(-1);
      expect(TEXTS[course].ro[ro - 1].startsWith("• ")).toBe(true);
      expect(ro).toBe(en);
    }
  });

  it("limits by the law every sentence that says the organiser does not answer for something", () => {
    for (const course of COURSES) {
      for (const locale of LOCALES) {
        const disclaimers = TEXTS[course][locale].filter((p) => DISCLAIMER[locale].test(p));
        // The liability paragraph and the belongings bullet.
        expect(disclaimers.length, `${course} ${locale}`).toBe(2);
        for (const paragraph of disclaimers) expect(paragraph, `${course} ${locale}: ${paragraph.slice(0, 40)}`).toContain(LAW_LIMIT[locale]);
      }
    }
  });

  it("takes the same merge fields in both, the minimum age among them, and the club's name as the footnote's placeholder", () => {
    const expected = ["event", "eventDate", "eventLocation", "guardian", "guardianIdDocument", "minimumAge", "participant", "participantIdDocument"];
    for (const body of [declarationTrailRo, declarationTrailEn, declarationRoadRo, declarationRoadEn]) {
      expect([...mergeFieldsIn(body)].sort()).toEqual(expected);
    }
    for (const course of COURSES) {
      expect(TEXTS[course].ro.at(-1)).toBe("*Prin Organizator se înțelege <DENUMIREA JURIDICĂ COMPLETĂ A CLUBULUI>.");
      expect(TEXTS[course].en.at(-1)).toBe("*Organiser means <THE CLUB'S FULL LEGAL NAME>.");
    }
  });
});
