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
import { asksForIdDocument, asksForMinorSignature, mergeFieldsIn } from "@/modules/legal-documents/domain/merge-fields";
import type { LegalDocumentBody } from "@/modules/legal-documents/domain/content-hash";
import { LEGAL_TEMPLATES } from "@/modules/legal-documents/templates/catalogue";
import { remainingPlaceholders } from "@/modules/legal-documents/templates/club-facts";
import { groupRunAsphaltEn, groupRunAsphaltRo, groupRunTrailEn, groupRunTrailRo } from "@/modules/legal-documents/templates/group-run-declaration";

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
  it("lists every enum value, in order, and the two optional kinds after the three a registration rests on", () => {
    expect([...LEGAL_DOCUMENT_KEYS]).toEqual([...legalDocumentKey.enumValues]);
    expect([...REGISTRATION_LEGAL_KEYS]).toEqual(["PRIVACY_NOTICE", "TERMS", "EVENT_DECLARATION"]);
    expect([...GROUP_RUN_DECLARATION_KEYS]).toEqual(["GROUP_RUN_DECLARATION_ASPHALT", "GROUP_RUN_DECLARATION_TRAIL"]);
  });

  it("names the three declarations in both catalogues, as the owner did", () => {
    expect(ro.Admin.legal.keys.EVENT_DECLARATION).toBe("Declarație pe propria răspundere (concurs)");
    expect(ro.Admin.legal.keys.GROUP_RUN_DECLARATION_ASPHALT).toBe("Declarație pe propria răspundere (alergare de grup, asfalt)");
    expect(ro.Admin.legal.keys.GROUP_RUN_DECLARATION_TRAIL).toBe("Declarație pe propria răspundere (alergare de grup, trail)");
    expect(en.Admin.legal.keys.EVENT_DECLARATION).toBe("Self-declaration (race)");
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
  it("carry the race declaration's tokens for an adult signer, and ask for the identity document", () => {
    for (const body of [groupRunAsphaltRo, groupRunAsphaltEn, groupRunTrailRo, groupRunTrailEn]) {
      expect([...mergeFieldsIn(body)].sort()).toEqual(["event", "eventDate", "eventLocation", "idDocument", "participant", "signedAt"]);
      expect(asksForIdDocument(body)).toBe(true);
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

  it("names asphalt's risks: traffic, the group's pace, the dark", () => {
    const ro = bullets(TEXTS.asphalt.ro).join(" ");
    const en = bullets(TEXTS.asphalt.en).join(" ");
    for (const pattern of [/drumuri publice/, /regulile de circulație/, /ritm pe care nu îl aleg eu/, /întunericului/, /reflectorizante/]) expect(ro).toMatch(pattern);
    for (const pattern of [/public roads/, /traffic rules/, /pace I do not choose/, /after dark/, /reflective/]) expect(en).toMatch(pattern);
    // Not the mountain's: no bears on the ring road.
    expect(ro).not.toMatch(/urși|câini de stână/);
    expect(en).not.toMatch(/bears|sheepdogs/);
  });

  it("names the trail's risks: terrain, wild animals and dogs, weather and the dark, own equipment with a headlamp, own pace", () => {
    const ro = bullets(TEXTS.trail.ro).join(" ");
    const en = bullets(TEXTS.trail.en).join(" ");
    for (const pattern of [/porțiuni abrupte/, /cădere/, /animalelor sălbatice/, /urși/, /câini de stână/, /furtună, fulgere/, /întunericului/, /Echipamentul este responsabilitatea mea/, /lanternă frontală funcțională/, /în ritmul meu/]) {
      expect(ro).toMatch(pattern);
    }
    for (const pattern of [/steep sections/, /falls/, /wild animals/, /bears/, /sheepdogs/, /storms, lightning/, /after dark/, /equipment is my own responsibility/, /working headlamp/, /at my own pace/]) {
      expect(en).toMatch(pattern);
    }
  });

  it("is informed acceptance, never a waiver: every sentence that says the organiser does not answer carries the law's limit", () => {
    const limit = { ro: "în limitele permise de lege", en: "to the extent the law allows" } as const;
    const disclaimer = { ro: /nu (?:pot|poate) fi (?:tras|trasă)|nu răspunde\b/, en: /cannot be held liable|not responsible/ } as const;
    const waiver = { ro: /renunț|în niciun fel/i, en: /waive|in any way/i } as const;
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

  it("says it is optional, that it registers nobody, and how long the platform keeps it", () => {
    for (const surface of ["asphalt", "trail"] as const) {
      expect(TEXTS[surface].ro.join(" ")).toMatch(/este opțională și nu este o condiție/);
      expect(TEXTS[surface].ro.join(" ")).toMatch(/o șterge la șapte zile după alergare/);
      expect(TEXTS[surface].en.join(" ")).toMatch(/optional and is not a condition/);
      expect(TEXTS[surface].en.join(" ")).toMatch(/deletes it seven days after the run/);
    }
  });

  it("is an adult's: the signer declares in the first sentence that they are 18 or older, and the page's consent box says it too", () => {
    for (const surface of ["asphalt", "trail"] as const) {
      expect(TEXTS[surface].ro[0]).toMatch(/declar pe propria răspundere că am împlinit 18 ani/);
      expect(TEXTS[surface].en[0]).toMatch(/declare on my own responsibility that I am 18 or older/);
    }
    expect(ro.Event.groupRunDeclaration.page.accept).toMatch(/^Am împlinit 18 ani/);
    expect(en.Event.groupRunDeclaration.page.accept).toMatch(/^I am 18 or older/);
    expect(ro.Event.groupRunDeclaration.page.adultsOnly).toMatch(/18 ani/);
    expect(en.Event.groupRunDeclaration.page.adultsOnly).toMatch(/18 or older/);
  });
});

describe("§393 the public offer line states the retention truthfully", () => {
  it("says the club's platform deletes it, not that the club keeps it (the archive copy is the privacy notice's three years)", () => {
    expect(ro.Event.groupRunDeclaration.line).toMatch(/platforma clubului o șterge la \{days\} după alergare/);
    expect(en.Event.groupRunDeclaration.line).toMatch(/the club's platform deletes it \{days\} after the run/);
    expect(ro.Event.groupRunDeclaration.line).not.toMatch(/păstrează/);
    expect(en.Event.groupRunDeclaration.line).not.toMatch(/keeps/);
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
        expect(mergeFieldsIn(translation.body).has("idDocument")).toBe(true);
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
