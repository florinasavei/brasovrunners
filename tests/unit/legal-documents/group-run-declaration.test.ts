import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { legalDocumentKey } from "@/db/schema/legal-documents";
import { assertSampleLegalDocumentsAllowed, SAMPLE_DOCUMENTS } from "@/db/seeds/sample-legal-documents";
import { SIGNING_GRACE_MINUTES, signingOpen } from "@/modules/group-run-declarations/domain";
import { parseGroupRunInvalid } from "@/modules/group-run-declarations/form";
import {
  GROUP_RUN_DECLARATION_KEYS,
  groupRunDeclarationKeyFor,
  LEGAL_DOCUMENT_KEYS,
  offeredGroupRunDeclarationKey,
  REGISTRATION_LEGAL_KEYS,
} from "@/modules/legal-documents/domain/keys";
import { asksForIdDocument, asksForMinorSignature, isPlacelessSeriesSentence, mergeFieldsIn } from "@/modules/legal-documents/domain/merge-fields";
import { privacyNoticeEn, privacyNoticeRo } from "@/modules/legal-documents/templates/privacy-notice";
import type { LegalDocumentBody } from "@/modules/legal-documents/domain/content-hash";
import { LEGAL_TEMPLATES } from "@/modules/legal-documents/templates/catalogue";
import { remainingPlaceholders } from "@/modules/legal-documents/templates/club-facts";
import { groupRunAsphaltEn, groupRunAsphaltRo, groupRunTrailEn, groupRunTrailRo } from "@/modules/legal-documents/templates/group-run-declaration";
import { signedOnPageWords } from "@/modules/group-run-declarations/pdf";

/**
 * §393 — the group runs' optional self-declarations: three kinds of declaration, two new templates,
 * and which one a run offers.
 *
 * The owner, 2026-09-25: "we need 'declarație pe propria răspundere (concurs)' and asfalt and trail
 * — 3 so far." The surface decides the text, because it decides the risks; the texts are informed
 * acceptance of risk and the runner's own obligations, never a waiver (Civil Code art. 1355, §357).
 */

const paragraphs = (body: LegalDocumentBody): string[] => body.sections.flatMap((section) => [...section.paragraphs]);
const TEXTS = {
  asphalt: { ro: paragraphs(groupRunAsphaltRo), en: paragraphs(groupRunAsphaltEn) },
  trail: { ro: paragraphs(groupRunTrailRo), en: paragraphs(groupRunTrailEn) },
} as const;
const bullets = (list: readonly string[]) => list.filter((p) => p.startsWith("• "));

describe("§393 the kinds and their names", () => {
  it("lists every enum value, the road race's beside the trail one (§515), and the two optional kinds after them", () => {
    // The enum appends a value; the backoffice lists the road declaration beside the trail one.
    expect([...LEGAL_DOCUMENT_KEYS].sort()).toEqual([...legalDocumentKey.enumValues].sort());
    expect([...LEGAL_DOCUMENT_KEYS]).toEqual(["PRIVACY_NOTICE", "TERMS", "EVENT_DECLARATION", "EVENT_DECLARATION_ROAD", "GROUP_RUN_DECLARATION_ASPHALT", "GROUP_RUN_DECLARATION_TRAIL"]);
    expect([...REGISTRATION_LEGAL_KEYS]).toEqual(["PRIVACY_NOTICE", "TERMS", "EVENT_DECLARATION"]);
    expect([...GROUP_RUN_DECLARATION_KEYS]).toEqual(["GROUP_RUN_DECLARATION_ASPHALT", "GROUP_RUN_DECLARATION_TRAIL"]);
  });

  it("names the four declarations in both catalogues, as the owner did", () => {
    expect(ro.Admin.legal.keys.EVENT_DECLARATION).toBe("Declarație pe propria răspundere — cursă trail");
    expect(ro.Admin.legal.keys.EVENT_DECLARATION_ROAD).toBe("Declarație pe propria răspundere — cursă pe asfalt / în parc");
    expect(ro.Admin.legal.keys.GROUP_RUN_DECLARATION_ASPHALT).toBe("Declarație pe propria răspundere (alergare de grup, asfalt)");
    expect(ro.Admin.legal.keys.GROUP_RUN_DECLARATION_TRAIL).toBe("Declarație pe propria răspundere (alergare de grup, trail)");
    expect(en.Admin.legal.keys.EVENT_DECLARATION).toBe("Self-declaration — trail race");
    expect(en.Admin.legal.keys.EVENT_DECLARATION_ROAD).toBe("Self-declaration — road / park race");
    expect(en.Admin.legal.keys.GROUP_RUN_DECLARATION_ASPHALT).toBe("Self-declaration (group run, asphalt)");
    expect(en.Admin.legal.keys.GROUP_RUN_DECLARATION_TRAIL).toBe("Self-declaration (group run, trail)");
    for (const key of LEGAL_DOCUMENT_KEYS) {
      expect(ro.Admin.legal.whatIs[key], key).toBeTruthy();
      expect(en.Admin.legal.whatIs[key], key).toBeTruthy();
    }
  });
});

describe("§393 which declaration a run offers: the surface decides", () => {
  it("maps a group run's surface to its text, and anything else to none", () => {
    expect(groupRunDeclarationKeyFor({ type: "GROUP_RUN", surface: "ASPHALT" })).toBe("GROUP_RUN_DECLARATION_ASPHALT");
    expect(groupRunDeclarationKeyFor({ type: "GROUP_RUN", surface: "TRAIL" })).toBe("GROUP_RUN_DECLARATION_TRAIL");
    expect(groupRunDeclarationKeyFor({ type: "GROUP_RUN", surface: "MIXED" })).toBeNull();
    expect(groupRunDeclarationKeyFor({ type: "GROUP_RUN", surface: null })).toBeNull();
    for (const type of ["RACE", "HIKE", "COFFEE", "GEAR_TEST", "MEETUP", "EXTERNAL"]) {
      expect(groupRunDeclarationKeyFor({ type, surface: "TRAIL" }), type).toBeNull();
    }
  });

  it("offers it only where the organizer ticked it", () => {
    expect(offeredGroupRunDeclarationKey({ type: "GROUP_RUN", surface: "TRAIL", offersGroupRunDeclaration: true })).toBe("GROUP_RUN_DECLARATION_TRAIL");
    expect(offeredGroupRunDeclarationKey({ type: "GROUP_RUN", surface: "TRAIL", offersGroupRunDeclaration: false })).toBeNull();
    expect(offeredGroupRunDeclarationKey({ type: "RACE", surface: "TRAIL", offersGroupRunDeclaration: true })).toBeNull();
  });

  it("takes a signature until an hour after the start of a published run that is not cancelled", () => {
    const startsAt = new Date("2026-10-07T16:00:00Z");
    const at = (minutes: number) => new Date(startsAt.getTime() + minutes * 60_000);
    const run = { editorialStatus: "PUBLISHED", eventStatus: "SCHEDULED", startsAt };
    expect(signingOpen(run, at(-60 * 24))).toBe(true);
    expect(signingOpen(run, at(SIGNING_GRACE_MINUTES))).toBe(true);
    expect(signingOpen(run, at(SIGNING_GRACE_MINUTES + 1))).toBe(false);
    expect(signingOpen({ ...run, eventStatus: "CANCELLED" }, at(-60))).toBe(false);
    expect(signingOpen({ ...run, editorialStatus: "DRAFT" }, at(-60))).toBe(false);
  });

  it("reads the refused boxes from the address, known names only, in the form's order", () => {
    expect(parseGroupRunInvalid("typedName,email,evil,accepted")).toEqual(["email", "accepted", "typedName"]);
    expect(parseGroupRunInvalid(undefined)).toEqual([]);
  });
});

describe("§393 the two templates", () => {
  /*
    §418 — the counsel review of 2026-09-25: a group run hands out no kit and the address is not
    verified, so a typed identity number proves nothing and is data the club need not hold (GDPR
    art. 5(1)(c)). Neither text names a document, so the signing page asks for none.
  */
  it("carry the race declaration's tokens for an adult signer, and ask for no identity document (§418)", () => {
    for (const body of [groupRunAsphaltRo, groupRunAsphaltEn, groupRunTrailRo, groupRunTrailEn]) {
      // `minimumAge` since §440: the run's own minimum, in a sentence of its own; the series
      // sentence's three since §523.
      expect([...mergeFieldsIn(body)].sort()).toEqual([
        "event",
        "eventDate",
        "eventLocation",
        "minimumAge",
        "participant",
        "series",
        "seriesPlace",
        "seriesRhythm",
        "signedAt",
      ]);
      expect(asksForIdDocument(body)).toBe(false);
      // Adults only for now: no minor's second signature is asked (§330 is the race's flow).
      expect(asksForMinorSignature(body)).toBe(false);
    }
  });

  it("leave all four club facts as placeholders, and no other", () => {
    for (const key of GROUP_RUN_DECLARATION_KEYS) {
      expect(remainingPlaceholders(LEGAL_TEMPLATES[key].ro.body).sort()).toEqual(
        ["<ADRESA SEDIULUI>", "<DENUMIREA JURIDICĂ COMPLETĂ A CLUBULUI>", "<EMAIL DE CONTACT>", "<NUMĂR DE ÎNREGISTRARE / CUI>"].sort(),
      );
      expect(remainingPlaceholders(LEGAL_TEMPLATES[key].en.body).sort()).toEqual(
        ["<CONTACT EMAIL>", "<REGISTERED ADDRESS>", "<REGISTRATION NUMBER>", "<THE CLUB'S FULL LEGAL NAME>"].sort(),
      );
    }
  });

  it("names asphalt's risks: traffic, dogs (§418), the group's pace, the dark", () => {
    const ro = bullets(TEXTS.asphalt.ro).join(" ");
    const en = bullets(TEXTS.asphalt.en).join(" ");
    for (const pattern of [/drumuri publice/, /regulile de circulație/, /câini, inclusiv fără stăpân/, /ritm pe care nu îl aleg eu/, /întunericului/, /reflectorizante/]) expect(ro).toMatch(pattern);
    for (const pattern of [/public roads/, /traffic rules/, /dogs, stray ones included/, /pace I do not choose/, /after dark/, /reflective/]) expect(en).toMatch(pattern);
    // Not the mountain's: no bears on the ring road.
    expect(ro).not.toMatch(/urși|câini de stână/);
    expect(en).not.toMatch(/bears|sheepdogs/);
  });

  it("names the trail's risks: terrain, wild animals and dogs, weather and the dark, own equipment with a headlamp, own pace", () => {
    const ro = bullets(TEXTS.trail.ro).join(" ");
    const en = bullets(TEXTS.trail.en).join(" ");
    for (const pattern of [/porțiuni abrupte/, /cădere/, /animalelor sălbatice/, /să nu provoc sau hrănesc animalele/, /câini de stână/, /furtună, fulgere/, /întunericului/, /Echipamentul este responsabilitatea mea/, /lanternă frontală funcțională/, /în ritmul meu/]) {
      expect(ro).toMatch(pattern);
    }
    for (const pattern of [/steep sections/, /falls/, /wild animals/, /not to provoke or feed the animals/, /sheepdogs/, /storms, lightning/, /after dark/, /equipment is my own responsibility/, /working headlamp/, /at my own pace/]) {
      expect(en).toMatch(pattern);
    }
  });

  it("is informed acceptance, never a waiver: every sentence that says the organiser does not answer carries the law's limit", () => {
    const limit = { ro: "în limitele permise de lege", en: "to the extent the law allows" } as const;
    const disclaimer = { ro: /nu (?:pot|poate) fi (?:tras|trasă)|nu răspunde\b/, en: /cannot be held liable|not responsible/ } as const;
    // A waiver, or the organiser free "in any way" — never the Civil Code's own sentence that accepting the
    // risks is *not* a waiver (art. 1355(4), §515), which the text now says in so many words.
    const waiver = {
      ro: /(?<!nu înseamnă, prin ea însăși, că )renunț|în niciun fel/i,
      en: /(?<!not, by itself, a )waive|in any way/i,
    } as const;
    for (const surface of ["asphalt", "trail"] as const) {
      for (const locale of ["ro", "en"] as const) {
        const text = TEXTS[surface][locale];
        const disclaimers = text.filter((p) => disclaimer[locale].test(p));
        expect(disclaimers.length, `${surface} ${locale}`).toBeGreaterThanOrEqual(2);
        for (const p of disclaimers) expect(p, `${surface} ${locale}: ${p.slice(0, 40)}`).toContain(limit[locale]);
        for (const p of text) expect(p, `${surface} ${locale}`).not.toMatch(waiver[locale]);
        // One text per language, the same shape.
        expect(TEXTS[surface].ro.length).toBe(TEXTS[surface].en.length);
      }
    }
  });

  /*
    §NNN, the counsel's second pass (point 6): kept by its purpose, never by a count from the signing.
    The active declaration while it is needed for the runs it covers; withdrawn at the signer's request,
    used for no later run, a copy kept only as long as a legal claim needs it, the three-year limitation
    period in view, then deleted. «Three years from the signing» was untrue of a declaration still active.
  */
  it("says it is optional, that it registers nobody, and keeps it by its purpose, never three years from the signing (§NNN)", () => {
    for (const surface of ["asphalt", "trail"] as const) {
      const roText = TEXTS[surface].ro.join(" ");
      const enText = TEXTS[surface].en.join(" ");
      expect(roText).toMatch(/este opțională și nu este o condiție/);
      expect(roText).toContain("Declarația activă se păstrează cât timp este necesară pentru gestionarea participării mele la alergările la care se aplică.");
      expect(roText).toContain(
        "Dacă cer retragerea ei, la adresa de contact a clubului, nu mai este folosită pentru participările viitoare; o copie poate fi păstrată și după aceea, doar pe perioada necesară constatării, exercitării sau apărării unor drepturi, ținând seama de termenul general de prescripție de trei ani (art. 2517 din Codul civil); după expirarea acestei perioade, copia se șterge.",
      );
      expect(enText).toMatch(/optional and is not a condition/);
      expect(enText).toContain("The active declaration is kept as long as it is needed to manage my taking part in the runs it applies to.");
      expect(enText).toContain("If I ask for its withdrawal, at the club's contact address, it is no longer used for any later run;");
      expect(enText).toContain("with the general three-year limitation period in view (art. 2517 of the Romanian Civil Code); at the end of that period, the copy is deleted.");
      for (const locale of ["ro", "en"] as const) {
        expect(TEXTS[surface][locale].join(" "), `${surface} ${locale}`).not.toMatch(
          /trei ani de la (alergare|semnare)|three years from the (run|signing)|fără termen de încetare|with no end date/,
        );
      }
    }
  });

  /*
    §NNN — the counsel's second pass of 2026-09-28, point by point, in both languages and on both
    surfaces: health as the runner's own assessment and never the organiser's certificate, the
    organiser's no medical assessment right after it, no medical question, «nu un serviciu de ghidaj
    (montan)» said once, «momentul semnării» and never a time stamp, and no «în nicio situație».
  */
  describe("§NNN the counsel's second pass", () => {
    const health = {
      trail: {
        ro: "• Declar că, din câte cunosc, starea mea de sănătate îmi permite să particip la o alergare pe teren montan și că nu cunosc existența unei afecțiuni sau recomandări medicale care să îmi interzică un astfel de efort. Îmi asum responsabilitatea de a-mi evalua starea înaintea fiecărei participări și de a nu participa sau de a mă opri dacă apar simptome ori o stare care face continuarea nesigură;",
        en: "• I declare that, to the best of my knowledge, my state of health allows me to take part in a run on mountain terrain",
      },
      asphalt: {
        ro: "• Declar că, din câte cunosc, starea mea de sănătate îmi permite să particip la o alergare de grup pe drumuri publice",
        en: "• I declare that, to the best of my knowledge, my state of health allows me to take part in a group run on public roads",
      },
    } as const;
    const noMedical = {
      ro: "• Organizatorul nu efectuează și nu poate efectua o evaluare medicală a participanților; responsabilitatea de a aprecia dacă starea proprie permite participarea aparține fiecărui participant;",
      en: "• The organiser does not and cannot carry out a medical assessment of the participants;",
    } as const;

    it("states health as the runner's own assessment, the organiser's no medical assessment right after it (points 3–4)", () => {
      for (const surface of ["asphalt", "trail"] as const) {
        for (const locale of ["ro", "en"] as const) {
          const text = TEXTS[surface][locale];
          const at = text.findIndex((p) => p.startsWith(health[surface][locale]));
          expect(at, `${surface} ${locale}`).toBeGreaterThan(-1);
          expect(text[at + 1], `${surface} ${locale}`).toContain(noMedical[locale]);
          expect(text.join(" "), `${surface} ${locale}`).not.toMatch(/Starea mea de sănătate îmi permite|nu am boli|My state of health allows|I have no illness/);
        }
      }
      expect(TEXTS.trail.ro).toContain(health.trail.ro);
    });

    it("keeps the health statement under art. 9(2)(f) and asks nothing about a diagnosis, a treatment or a history (point 5)", () => {
      for (const surface of ["asphalt", "trail"] as const) {
        expect(TEXTS[surface].ro.join(" ")).toContain("afirmația despre sănătate, doar pentru constatarea, exercitarea sau apărarea unui drept în instanță (art. 9 alin. (2) lit. f) GDPR)");
        expect(TEXTS[surface].en.join(" ")).toContain("the statement about my health only for the establishment, exercise or defence of legal claims (art. 9(2)(f) GDPR)");
        expect(TEXTS[surface].ro.join(" ")).not.toMatch(/diagnostic|tratament|istoric medical/i);
        expect(TEXTS[surface].en.join(" ")).not.toMatch(/diagnos|treatment|medical history/i);
      }
    });

    it("keeps art. 1355(4) and art. 1371, and never frees the organiser in every case (points 7, 15)", () => {
      for (const surface of ["asphalt", "trail"] as const) {
        expect(TEXTS[surface].ro.join(" ")).toContain("art. 1355 alin. (4) din Codul civil");
        expect(TEXTS[surface].ro.join(" ")).toContain("art. 1371 din Codul civil");
        expect(TEXTS[surface].en.join(" ")).toContain("art. 1355(4) of the Romanian Civil Code");
        expect(TEXTS[surface].en.join(" ")).toContain("art. 1371 of the Civil Code");
        expect(TEXTS[surface].ro.join(" ")).not.toMatch(/în nicio situație|în niciun caz/);
        expect(TEXTS[surface].en.join(" ")).not.toMatch(/in no event|under no circumstances|in any situation/);
      }
    });

    it("says it is a group run, not a guiding service, once, in the opening (points 8–9)", () => {
      const service = { asphalt: { ro: "un serviciu de ghidaj", en: "a guiding service" }, trail: { ro: "un serviciu de ghidaj montan", en: "a mountain guiding service" } } as const;
      for (const surface of ["asphalt", "trail"] as const) {
        const ro = TEXTS[surface].ro.join(" ");
        const en = TEXTS[surface].en.join(" ");
        expect(ro).toContain(`Este o alergare de grup, nu ${service[surface].ro} și nu presupune supravegherea individuală a fiecărui participant.`);
        expect(ro).toContain("Organizatorul* stabilește și anunță ora, locul și traseul, aleargă împreună cu participanții și poate da indicații generale de siguranță.");
        expect(en).toContain(`It is a group run, not ${service[surface].en}, and it does not involve the individual supervision of each participant.`);
        expect(ro.match(/ghidaj|ghidată/g), `${surface} ro`).toHaveLength(1);
        expect(en.match(/guid(ing|ed)/g), `${surface} en`).toHaveLength(1);
        expect(ro).not.toMatch(/tură ghidată/);
        expect(en).not.toMatch(/guided tour/);
      }
      expect(TEXTS.asphalt.ro.join(" ")).not.toMatch(/montan/);
    });

    it("names «momentul semnării» and never a time stamp (point 14)", () => {
      for (const surface of ["asphalt", "trail"] as const) {
        const ro = TEXTS[surface].ro.join(" ");
        const en = TEXTS[surface].en.join(" ");
        expect(ro).toContain("momentul semnării ({{signedAt}})");
        expect(en).toContain("the moment of signing ({{signedAt}})");
        expect(ro).not.toMatch(/marc(a|ă|ii) temporal/i);
        expect(en).not.toMatch(/time ?stamp/i);
        expect(ro).toContain("semnătură electronică simplă");
        expect(en).toContain("simple electronic signature");
      }
    });

    it("the PDF's signing line names «momentul semnării» and no time stamp either (point 14)", () => {
      expect(signedOnPageWords("ro", "joi, 1 oct. 2026, la 11:00")).toContain("momentul semnării");
      expect(signedOnPageWords("en", "Thursday, 1 Oct 2026, at 11:00")).toContain("the moment of signing");
      expect(signedOnPageWords("ro", "x")).not.toMatch(/marc(a|ă|ii) temporal/i);
      expect(signedOnPageWords("en", "x")).not.toMatch(/time ?stamp/i);
    });
  });

  /*
    §523 — the owner, 2026-09-27: "one self-declaration per series of group runs: a returning runner
    signs once; it has no end date and is deleted only at their request". One text serves a series
    and a one-off run, so it says what it covers in one of two sentences, and the renderer keeps the
    one that fits: the series sentence (the series, its rhythm, its usual place — every run of it
    from the signing, no end date, a differing date read on its own page) or the one-off sentence
    (that run, its date, its place).
  */
  it("carries a series sentence and a one-off sentence, the opening naming neither (§523)", () => {
    for (const surface of ["asphalt", "trail"] as const) {
      const roText = TEXTS[surface].ro.join(" ");
      const enText = TEXTS[surface].en.join(" ");
      expect(TEXTS[surface].ro[0]).toContain("particip la alergarea de grup descrisă mai jos");
      expect(TEXTS[surface].ro[0]).not.toMatch(/\{\{(event|eventDate|series)\}\}/);
      expect(roText).toContain("înainte de fiecare alergare îi citesc detaliile pe pagina ei");
      // The validity in the counsel's words (§NNN, points 1–2): the whole series, signed once, from the
      // date of signing, until withdrawn or replaced — the run of the signing day included («începând cu»).
      expect(roText).toContain(
        "Declarația este valabilă pentru toate alergările seriei {{series}} — {{seriesRhythm}}, cu plecare de obicei din {{seriesPlace}} — și nu trebuie semnată din nou la fiecare alergare.",
      );
      expect(roText).toContain(
        "Declarația se aplică alergărilor din această serie la care particip începând cu data semnării și rămâne valabilă până când este retrasă sau înlocuită cu o versiune nouă.",
      );
      expect(roText).toContain("aflu acest lucru de pe pagina acelei date, iar declarația se aplică și ei");
      expect(roText).toContain("Dacă organizatorul aprobă o versiune nouă a declarației, participantului i se va cere să o semneze din nou.");
      expect(roText).toContain("Declarația este pentru alergarea de grup {{event}}, {{eventDate}}, cu plecare din {{eventLocation}}.");
      expect(TEXTS[surface].en[0]).toContain("I take part in the group run described below");
      expect(enText).toContain("before each run I read its details on its page");
      expect(enText).toContain(
        "This declaration is valid for every run of the series {{series}} — {{seriesRhythm}}, usually starting from {{seriesPlace}} — and need not be signed again for each run.",
      );
      expect(enText).toContain(
        "The declaration applies to the runs of this series that I take part in from the date of signing onwards, and remains valid until it is withdrawn or replaced by a new version.",
      );
      expect(enText).toContain("I learn it from that date's page, and the declaration applies to that date too");
      expect(enText).toContain("If the organiser approves a new version of the declaration, the participant will be asked to sign it again.");
      expect(enText).toContain("This declaration is for the group run {{event}} on {{eventDate}}, starting from {{eventLocation}}.");
      // The one-off sentence names no series field, the series sentence no date: the renderer keeps one.
      // The series sentence in two shapes (§523): with the usual place, and without it for a run whose
      // place is not written — the same words otherwise, so neither says more than the other.
      for (const paragraphs of [TEXTS[surface].ro, TEXTS[surface].en]) {
        const withSeries = paragraphs.filter((paragraph) => paragraph.includes("{{series}}"));
        const withDate = paragraphs.filter((paragraph) => paragraph.includes("{{eventDate}}"));
        expect(withSeries).toHaveLength(2);
        expect(withSeries.filter(isPlacelessSeriesSentence)).toHaveLength(1);
        expect(withSeries.filter((paragraph) => paragraph.includes("{{seriesPlace}}"))).toHaveLength(1);
        const [placed, placeless] = [withSeries.find((paragraph) => paragraph.includes("{{seriesPlace}}"))!, withSeries.find(isPlacelessSeriesSentence)!];
        expect(placeless).toBe(placed.replace(/, (cu plecare de obicei din|usually starting from) \{\{seriesPlace\}\}/, ""));
        expect(withDate).toHaveLength(1);
        for (const sentence of withSeries) expect(sentence).not.toContain("{{eventDate}}");
        expect(withDate[0]).not.toContain("{{series");
      }
      // The evidence is about these runs, not one run.
      expect(roText).toContain("riscurile acestor alergări");
      expect(enText).toContain("the risks of these runs");
    }
  });

  /*
    §523, the review — the privacy notice says what the code does with a series' signature: signed
    again on the same text, no second one is kept; signed on a new version, the older is kept beside
    it as evidence of what was accepted then, the new one is in force, and both go only at the
    signer's request. Never «replaces the old one»: no public press deletes a signature.
  */
  it("the privacy notice keeps the older signature as evidence beside the new one (§523)", () => {
    const roText = paragraphs(privacyNoticeRo).join(" ");
    const enText = paragraphs(privacyNoticeEn).join(" ");
    expect(roText).toContain("Dacă o semnezi din nou pe același text, nu păstrăm a doua: îți retrimitem copia.");
    expect(roText).toContain(
      "Pe o versiune nouă a textului, cea nouă e în vigoare, iar pe cea veche o păstrăm ca dovadă a ce ai acceptat atunci, după aceeași regulă ca o declarație retrasă (mai jos).",
    );
    expect(enText).toContain("If you sign it again on the same text, we keep no second one: we resend your copy.");
    expect(enText).toContain(
      "On a new version of the text, the new one is in force and we keep the old one as evidence of what you accepted then, under the same rule as a withdrawn declaration (below).",
    );
    for (const text of [roText, enText]) expect(text).not.toMatch(/o înlocuiește pe cea veche|replaces the old one/);
  });

  // A signature covers every date of a repeating run only once the text names {{series}} (§523).
  it("the privacy notice hedges the whole-series signature to the declaration's text (§523)", () => {
    expect(paragraphs(privacyNoticeRo).join(" ")).toContain(
      "O semnezi o singură dată pentru o alergare care se repetă, când textul declarației prevede asta: acoperă atunci fiecare dată a ei, până când o retragi sau este înlocuită cu o versiune nouă.",
    );
    expect(paragraphs(privacyNoticeEn).join(" ")).toContain(
      "You sign it once for a run that repeats, where the declaration's text says so: it then covers every date of it, until you withdraw it or it is replaced by a new version.",
    );
  });

  /*
    §418 — evidence the signer could withdraw at will would be no evidence: the basis is the club's
    legitimate interest (art. 6(1)(f)), art. 9(2)(f) for the health statement, and the rights list
    names restriction and objection — as the privacy notice's §3 does.
  */
  it("rests on legitimate interest, names art. 9(2)(f) for health, and lists restriction and objection (§418)", () => {
    for (const surface of ["asphalt", "trail"] as const) {
      const roText = TEXTS[surface].ro.join(" ");
      const enText = TEXTS[surface].en.join(" ");
      expect(roText).toMatch(/interesului legitim al organizatorului \(art\. 6 alin\. \(1\) lit\. f\) GDPR\)/);
      expect(roText).toMatch(/art\. 9 alin\. \(2\) lit\. f\) GDPR/);
      expect(roText).toMatch(/de restricționare și de opoziție/);
      expect(enText).toMatch(/legitimate interest \(art\. 6\(1\)\(f\) GDPR\)/);
      expect(enText).toMatch(/art\. 9\(2\)\(f\) GDPR/);
      expect(enText).toMatch(/restriction and objection/);
      expect(roText).not.toMatch(/consimțământ/);
      expect(enText).not.toMatch(/\bconsent\b/);
    }
  });

  it("states one age, the run's {{minimumAge}}, and no 18 of its own; the consent box repeats the run's age (§515)", () => {
    for (const surface of ["asphalt", "trail"] as const) {
      for (const locale of ["ro", "en"] as const) {
        const text = TEXTS[surface][locale].join("\n");
        expect(text, `${surface} ${locale}`).not.toMatch(/\b18\b|împlinit 18|18 or older/);
        expect(text.match(/\{\{minimumAge\}\}/g)?.length, `${surface} ${locale}`).toBe(1);
      }
      // On the day of each run (§523): the text covers every date of the run.
      expect(TEXTS[surface].ro).toContain("Declar că am cel puțin {{minimumAge}} împliniți la data fiecărei alergări la care particip.");
      expect(TEXTS[surface].en).toContain("I declare that I am at least {{minimumAge}} old on the day of each run I take part in.");
      // Signed personally, for oneself: it covers nobody else, no minor.
      expect(TEXTS[surface].ro.join(" ")).toContain("Semnez această declarație personal, doar pentru mine.");
      expect(TEXTS[surface].en.join(" ")).toContain("I sign this declaration personally, for myself only.");
    }
    for (const catalogue of [ro, en]) {
      expect(catalogue.Event.groupRunDeclaration.page.accept).toContain("{age}");
      expect(catalogue.Event.groupRunDeclaration.page.adultsOnly).toContain("{age}");
      expect(catalogue.Event.groupRunDeclaration.page.accept).not.toMatch(/18/);
    }
  });
});

describe("§393 the public offer line states the retention truthfully", () => {
  it("says the club keeps it while it is needed and stops using it at the signer's withdrawal (§503, §NNN), with no number of days", () => {
    expect(ro.Event.groupRunDeclaration.line).toMatch(/clubul o păstrează cât timp este necesară pentru alergările la care se aplică și nu o mai folosește dacă ceri retragerea ei/);
    expect(en.Event.groupRunDeclaration.line).toMatch(/the club keeps it as long as it is needed for the runs it applies to and stops using it when you ask for its withdrawal/);
    expect(ro.Event.groupRunDeclaration.line).not.toMatch(/\{days\}|zile/);
    expect(en.Event.groupRunDeclaration.line).not.toMatch(/\{days\}|days/);
  });

  it("says a returning runner signs once, for the whole series of a run that repeats — on the offer, the signing page and its answer (§523)", () => {
    expect(ro.Event.groupRunDeclaration.line).toContain("La o alergare care se repetă o semnezi o singură dată, pentru toată seria {event}");
    expect(en.Event.groupRunDeclaration.line).toContain("For a run that repeats you sign it once, for the whole {event} series");
    expect(ro.Event.groupRunDeclaration.page.intro).toContain("o semnezi o singură dată, pentru toată seria");
    expect(en.Event.groupRunDeclaration.page.intro).toContain("you sign it once, for the whole series");
    // The same answer whether a row was written or the kept one sent again: nothing tells them apart.
    expect(ro.Event.groupRunDeclaration.page.done).toContain("nu o mai semnezi la următoarele");
    expect(en.Event.groupRunDeclaration.page.done).toContain("you do not sign it again for the next ones");
    for (const catalogue of [ro, en]) expect(catalogue.Event.groupRunDeclaration.page.done).not.toMatch(/deja|already/i);
  });

  // §523, the review: under a text in force that names no series, a signature covers its own date,
  // and the offer, the signing page and its answer say this run — never «once for the whole series».
  it("says this run, and claims no series, while the text in force names none (§523)", () => {
    for (const catalogue of [ro, en]) {
      const words = catalogue.Event.groupRunDeclaration;
      for (const text of [words.lineOneDate, words.page.introOneDate, words.page.doneOneDate]) {
        expect(text).not.toBe("");
        expect(text).not.toMatch(/seri(a|ei)|series|singură dată|sign it once/i);
      }
      expect(words.page.doneOneDate).not.toMatch(/deja|already/i);
    }
    expect(ro.Event.groupRunDeclaration.lineOneDate).toContain("pentru această alergare");
    expect(en.Event.groupRunDeclaration.lineOneDate).toContain("for this run");
  });

  it("offers no language select: the signature is in the page's language, the text that was read (§57)", () => {
    expect(ro.Event.groupRunDeclaration.page.fields).not.toHaveProperty("preferredLocale");
    expect(en.Event.groupRunDeclaration.page.fields).not.toHaveProperty("preferredLocale");
    expect(parseGroupRunInvalid("preferredLocale")).toEqual([]);
  });
});

describe("§393 the sample seed (§29)", () => {
  it("wraps both group-run texts in the not-approved banner, placeholders kept", () => {
    for (const key of GROUP_RUN_DECLARATION_KEYS) {
      const sample = SAMPLE_DOCUMENTS.find((document) => document.key === key);
      expect(sample, key).toBeDefined();
      for (const translation of sample!.translations) {
        expect(translation.body.sections[0].heading).toMatch(/NEAPROBAT|NOT APPROVED/);
        expect(translation.title).toMatch(/NEAPROBAT|NOT APPROVED/);
        expect(mergeFieldsIn(translation.body).has("idDocument")).toBe(false);
        expect(remainingPlaceholders(translation.body).length).toBeGreaterThanOrEqual(4);
      }
    }
  });

  it("is refused in production, for the group-run texts as for the rest", () => {
    const before = process.env.APP_ENV;
    process.env.APP_ENV = "production";
    try {
      expect(() => assertSampleLegalDocumentsAllowed()).toThrow(/production/);
    } finally {
      process.env.APP_ENV = before;
    }
  });
});
