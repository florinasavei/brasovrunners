import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import {
  birthDateRefusal,
  groupRunMinorMinimumAge,
  groupRunTakesMinors,
  keptSignature,
  minorSigningRefusal,
  oldestMinorBirthDate,
  type SeriesSignature,
  signerIdentity,
} from "@/modules/group-run-declarations/domain";
import { birthDateHelper, birthDateValidity } from "@/modules/registrations/ui/BirthDateField";
import { groupRunSignedValues } from "@/modules/group-run-declarations/facts";
import { GROUP_RUN_DRAFT_FIELDS, GROUP_RUN_FORM_FIELDS, GROUP_RUN_MINOR_FIELDS, parseGroupRunInvalid } from "@/modules/group-run-declarations/form";
import { factsToKeep, readSignedFacts } from "@/modules/group-run-declarations/series";
import {
  dropsParagraph,
  isMergeField,
  mergeFieldsIn,
  mergeLegalBody,
  minimumAgeMergeValue,
  namesGroupRunMinor,
  PARAGRAPH_MERGE_FIELDS,
} from "@/modules/legal-documents/domain/merge-fields";
import { LEGAL_TEMPLATES } from "@/modules/legal-documents/templates/catalogue";
import { groupRunAsphaltEn, groupRunAsphaltRo, groupRunTrailEn, groupRunTrailRo } from "@/modules/legal-documents/templates/group-run-declaration";
import { DECLARATION_TOKENS } from "@/modules/legal-documents/templates/tokens";
import type { LegalDocumentBody } from "@/modules/legal-documents/domain/content-hash";

/**
 * A minor signs a group run's declaration, with a parent (§769, amending §393, §523 and §330; the owner,
 * 2026-10-14): the pure half. The service, the storage, the PDF and the emails are in
 * `tests/integration/group-run-declarations/minor.test.ts`.
 */

const TEXTS = [
  { name: "asphalt ro", body: groupRunAsphaltRo, locale: "ro" },
  { name: "asphalt en", body: groupRunAsphaltEn, locale: "en" },
  { name: "trail ro", body: groupRunTrailRo, locale: "ro" },
  { name: "trail en", body: groupRunTrailEn, locale: "en" },
] as const;

const paragraphs = (body: LegalDocumentBody) => body.sections.flatMap((section) => [...section.paragraphs]);
const RUN = { minAge: 14, startsAt: new Date("2026-10-07T16:00:00.000Z"), timezone: "Europe/Bucharest" };

describe("§769 the template's marker, in both kinds and both languages", () => {
  it("names {{minor}} in all four texts, and the old texts do not", () => {
    for (const { name, body } of TEXTS) expect(namesGroupRunMinor(body), name).toBe(true);
    // A text approved before: the same paragraphs without the minor's.
    const older: LegalDocumentBody = { sections: [{ paragraphs: ["Subsemnatul/a {{participant}}, declar.", "Declar că am cel puțin {{minimumAge}}."] }] };
    expect(namesGroupRunMinor(older)).toBe(false);
    expect(namesGroupRunMinor("not a body")).toBe(false);
  });

  it("names the same fields in Romanian and English, and keeps the race's text without them", () => {
    for (const key of ["GROUP_RUN_DECLARATION_ASPHALT", "GROUP_RUN_DECLARATION_TRAIL"] as const) {
      expect([...mergeFieldsIn(LEGAL_TEMPLATES[key].ro.body)].sort()).toEqual([...mergeFieldsIn(LEGAL_TEMPLATES[key].en.body)].sort());
    }
    // The race's declaration is not a group run's: it has neither marker.
    for (const locale of ["ro", "en"] as const) {
      expect(namesGroupRunMinor(LEGAL_TEMPLATES.EVENT_DECLARATION[locale].body)).toBe(false);
      expect(namesGroupRunMinor(LEGAL_TEMPLATES.EVENT_DECLARATION_ROAD[locale].body)).toBe(false);
    }
  });

  it("registers the three fields as merge fields, as paragraph fields, in the legend, and in both catalogues", () => {
    for (const field of ["minor", "signerAlone", "minorMinimumAge"]) {
      expect(isMergeField(field), field).toBe(true);
      expect(PARAGRAPH_MERGE_FIELDS.has(field), field).toBe(true);
      expect(DECLARATION_TOKENS.some((token) => token.token === `{{${field}}}`), field).toBe(true);
      expect((ro.Admin.legal.tokens as Record<string, string>)[field], field).toBeTruthy();
      expect((en.Admin.legal.tokens as Record<string, string>)[field], field).toBeTruthy();
    }
  });

  it("says the minor signs for themselves and the parent approves and accepts «în limitele permise de lege», never for the club's own fault", () => {
    for (const { name, body, locale } of TEXTS) {
      const minor = paragraphs(body).find((paragraph) => paragraph.includes("{{minor}},"))!;
      expect(minor, name).toContain("{{guardian}}");
      expect(minor, name).toContain("{{minorMinimumAge}}");
      expect(minor, name).toContain(locale === "ro" ? "art. 41 alin. (2) din Codul civil" : "art. 41(2) of the Romanian Civil Code");
      expect(minor, name).toContain(locale === "ro" ? "în limitele permise de lege" : "to the extent the law allows");
      expect(minor, name).toContain(locale === "ro" ? "art. 1355 din Codul civil" : "art. 1355 of the Civil Code");
      expect(minor, name).toContain(locale === "ro" ? "nu privește prejudiciile cauzate din vina organizatorului" : "does not cover harm caused through the fault of the organiser");
      // No identity document of a child, no hard-coded number of years.
      expect(minor, name).not.toMatch(/\{\{(idDocument|participantIdDocument|guardianIdDocument)\}\}/);
      expect(minor, name).not.toMatch(/\b1[0-9]\b ani|\b1[0-9]\b years/);
    }
  });
});

describe("§769 one text, two paths: the paragraphs that apply are kept", () => {
  const ADULT = { participant: "Ana Popescu", signerAlone: "Ana Popescu", minor: "", guardian: "—" } as const;
  const MINOR = { participant: "Ion Popescu", signerAlone: "", minor: "Ion Popescu", guardian: "Ana Popescu", minimumAge: "" } as const;

  it("an adult keeps «Eu, …, semnez această declarație personal, doar pentru mine» and loses the minor's two paragraphs", () => {
    for (const { name, body, locale } of TEXTS) {
      const kept = paragraphs(mergeLegalBody(body, { ...ADULT, minimumAge: minimumAgeMergeValue(18, locale), minorMinimumAge: minimumAgeMergeValue(14, locale) }));
      const joined = kept.join("\n");
      expect(joined, name).toContain(locale === "ro" ? "Eu, Ana Popescu, semnez această declarație personal, doar pentru mine." : "I, Ana Popescu, sign this declaration personally, for myself only.");
      expect(joined, name).not.toContain(locale === "ro" ? "declarația este semnată de minor" : "signed by the minor");
      expect(joined, name).toContain(locale === "ro" ? "Declar că am cel puțin 18 ani" : "I declare that I am at least 18 years");
      expect(kept.length, name).toBe(paragraphs(body).length - 2);
    }
  });

  it("a minor's declaration keeps the minor's two paragraphs and loses the adult's sentence and age sentence", () => {
    for (const { name, body, locale } of TEXTS) {
      const kept = paragraphs(mergeLegalBody(body, { ...MINOR, minorMinimumAge: minimumAgeMergeValue(14, locale) }));
      const joined = kept.join("\n");
      expect(joined, name).not.toContain(locale === "ro" ? "semnez această declarație personal, doar pentru mine" : "sign this declaration personally, for myself only");
      expect(joined, name).not.toMatch(/Declar că am cel puțin|I declare that I am at least/);
      expect(joined, name).toContain(locale === "ro" ? "declarația este semnată de minor, Ion Popescu, pentru sine" : "signed by the minor, Ion Popescu, for themselves");
      expect(joined, name).toContain(locale === "ro" ? "care o semnează alături de el: Ana Popescu" : "who signs it beside them: Ana Popescu");
      expect(joined, name).toContain(locale === "ro" ? "vârsta minimă a alergării, 14 ani" : "the run's minimum age, 14 years");
      // The minor's data paragraph stays, under its own marker, and so does the common e-signature paragraph.
      expect(joined, name).toContain(locale === "ro" ? "datele minorului Ion Popescu — numele scris de el" : "the data of the minor Ion Popescu — the name they write");
      expect(kept.length, name).toBe(paragraphs(body).length - 2);
    }
  });

  it("a run with no minor's minimum drops the minor's paragraph; the page leaves both ways visible with dotted blanks", () => {
    for (const { name, body } of TEXTS) {
      // «Doar adulți»: `minorMinimumAge` "" — the paragraph that names it goes (`dropsParagraph`).
      const minorParagraph = paragraphs(body).find((paragraph) => paragraph.includes("{{minorMinimumAge}}"))!;
      expect(dropsParagraph(minorParagraph, { minorMinimumAge: "" }), name).toBe(true);
      // The page before anybody has typed: no value for the two names, nothing dropped.
      expect(dropsParagraph(minorParagraph, {}), name).toBe(false);
      const alone = paragraphs(body).find((paragraph) => paragraph.includes("{{signerAlone}}"))!;
      expect(dropsParagraph(alone, {}), name).toBe(false);
      expect(dropsParagraph(alone, { signerAlone: "" }), name).toBe(true);
    }
  });

  it("a text approved before the paragraph, given the new values, reads exactly as it did", () => {
    const older: LegalDocumentBody = { sections: [{ paragraphs: ["Subsemnatul/a {{participant}}.", "Declar că am cel puțin {{minimumAge}}.", "Semnez această declarație personal, doar pentru mine."] }] };
    expect(mergeLegalBody(older, { ...ADULT, minimumAge: "18 ani" })).toEqual({
      sections: [{ paragraphs: ["Subsemnatul/a Ana Popescu.", "Declar că am cel puțin 18 ani.", "Semnez această declarație personal, doar pentru mine."] }],
    });
  });
});

describe("§769 the blanks a signature fills (§330's declarant and guardian, through the race's own functions)", () => {
  const event = { values: { event: "Tura" }, timezone: "Europe/Bucharest" };
  const base = { idDocument: null, locale: "ro" as const, acceptedAt: new Date("2026-10-01T08:00:00.000Z") };

  it("for oneself: the signer is the participant and the declarant, no guardian, no minor", () => {
    expect(groupRunSignedValues(event, { ...base, typedName: "Ana Popescu" })).toMatchObject({
      participant: "Ana Popescu",
      declarant: "Ana Popescu",
      guardian: "—",
      signerAlone: "Ana Popescu",
      minor: "",
    });
  });

  it("for a minor: the minor is the participant, the parent the guardian and the declarant spelled out, the adult's sentences gone", () => {
    const values = groupRunSignedValues(event, { ...base, typedName: "Ana Popescu", minorTypedName: "Ion Popescu" });
    expect(values).toMatchObject({
      participant: "Ion Popescu",
      guardian: "Ana Popescu",
      declarant: "Ana Popescu (părinte/tutore legal al minorului Ion Popescu)",
      minor: "Ion Popescu",
      signerAlone: "",
      minimumAge: "",
    });
    const en = groupRunSignedValues(event, { ...base, locale: "en", typedName: "Ana Popescu", minorTypedName: "Ion Popescu" });
    expect(en.declarant).toBe("Ana Popescu (parent/legal guardian of the minor Ion Popescu)");
  });

  it("keeps the minor's minimum with the run's other facts, nothing personal", () => {
    const kept = factsToKeep({ event: "Tura", minimumAge: "18 ani", minorMinimumAge: "14 ani", participant: "Ion Popescu", minor: "Ion Popescu" });
    expect(kept).toEqual({ event: "Tura", minimumAge: "18 ani", minorMinimumAge: "14 ani" });
    expect(readSignedFacts(kept)).toEqual(kept);
  });
});

describe("§769 the rules of the boxes", () => {
  it("takes a minor only on a run whose own minimum is under eighteen, and states that minimum (never under fourteen)", () => {
    expect(groupRunTakesMinors(14)).toBe(true);
    expect(groupRunTakesMinors(17)).toBe(true);
    expect(groupRunTakesMinors(18)).toBe(false);
    expect(groupRunTakesMinors(21)).toBe(false);
    // A run saved under fourteen is read as fourteen (§515).
    expect(groupRunTakesMinors(0)).toBe(true);
    expect(groupRunMinorMinimumAge(0)).toBe(14);
    expect(groupRunMinorMinimumAge(16)).toBe(16);
  });

  it("refuses by the race's rule: both names when ticked, none when not, a tick the text does not offer", () => {
    const ok = { offered: true, minor: true, minorTypedName: "Ion Popescu", guardianAgrees: true };
    expect(minorSigningRefusal(ok)).toEqual([]);
    expect(minorSigningRefusal({ ...ok, minorTypedName: " " })).toEqual(["minorTypedName"]);
    expect(minorSigningRefusal({ ...ok, minorTypedName: "x".repeat(201) })).toEqual(["minorTypedName"]);
    expect(minorSigningRefusal({ ...ok, guardianAgrees: false })).toEqual(["guardianAgrees"]);
    expect(minorSigningRefusal({ ...ok, minorTypedName: "", guardianAgrees: false })).toEqual(["minorTypedName", "guardianAgrees"]);
    // A name nobody can see is no name: it folds to "" in the signer's key, which would be the adult's own.
    expect(minorSigningRefusal({ ...ok, minorTypedName: "​­﻿" })).toEqual(["minorTypedName"]);
    // Not ticked: nothing asked.
    expect(minorSigningRefusal({ offered: true, minor: false, minorTypedName: "", guardianAgrees: false })).toEqual([]);
    expect(minorSigningRefusal({ offered: false, minor: false, minorTypedName: "", guardianAgrees: false })).toEqual([]);
    // Not ticked, but a box filled: refused on the tick.
    expect(minorSigningRefusal({ offered: true, minor: false, minorTypedName: "Ion Popescu", guardianAgrees: false })).toEqual(["minor"]);
    expect(minorSigningRefusal({ offered: true, minor: false, minorTypedName: "", guardianAgrees: true })).toEqual(["minor"]);
    // Ticked where it is not offered: refused on the tick, whatever else was typed.
    expect(minorSigningRefusal({ ...ok, offered: false })).toEqual(["minor"]);
  });

  it("counts the minor's birth date against the run's own minimum on the run's day, and an adult's against eighteen's rule as before", () => {
    // Fourteen on 7 October 2026: born 7 October 2012 is old enough, the day after is not.
    expect(birthDateRefusal(RUN, "2012-10-07", true)).toEqual([]);
    expect(birthDateRefusal(RUN, "2012-10-08", true)).toEqual(["birthDate", "tooYoung"]);
    expect(birthDateRefusal(RUN, undefined, true)).toEqual(["birthDate"]);
    expect(birthDateRefusal(RUN, "not a date", true)).toEqual(["birthDate"]);
    // The date is a minor's: under eighteen on the run's day. The 18th birthday on the day is an adult, the day before is not.
    expect(birthDateRefusal(RUN, "2008-10-07", true)).toEqual(["birthDate", "tooOld"]);
    expect(birthDateRefusal(RUN, "2008-10-08", true)).toEqual([]);
    expect(birthDateRefusal(RUN, "1986-01-01", true)).toEqual(["birthDate", "tooOld"]);
    expect(oldestMinorBirthDate("2026-10-07")).toBe("2008-10-08");
    // A run's own minimum of seventeen: eighteen and over is still refused as too old, under seventeen as too young.
    expect(birthDateRefusal({ ...RUN, minAge: 17 }, "2009-10-07", true)).toEqual([]);
    expect(birthDateRefusal({ ...RUN, minAge: 17 }, "2009-10-08", true)).toEqual(["birthDate", "tooYoung"]);
    expect(birthDateRefusal({ ...RUN, minAge: 17 }, "2008-10-07", true)).toEqual(["birthDate", "tooOld"]);
    // The adult's path: a run at fourteen asks no date (it reads it at eighteen), one above eighteen asks.
    expect(birthDateRefusal(RUN, undefined)).toEqual([]);
    expect(birthDateRefusal({ ...RUN, minAge: 21 }, undefined)).toEqual(["birthDate"]);
  });

  it("says live, in the minor's box, that a date of eighteen or more is no minor's (the box's bound is the oldest minor's birth date)", () => {
    const words = { unreadable: "no date", tooYoung: "too young", tooOld: "too old" };
    const [min, max] = [oldestMinorBirthDate("2026-10-07"), "2012-10-07"];
    expect(birthDateValidity("07.10.2008", min, max, words)).toBe("too old");
    expect(birthDateValidity("08.10.2008", min, max, words)).toBe("");
    expect(birthDateValidity("08.10.2012", min, max, words)).toBe("too young");
    expect(birthDateValidity("31.02.2010", min, max, words)).toBe("no date");
    // Without its words a date before the bound reads as it always did, unreadable.
    expect(birthDateValidity("07.10.2008", min, max, { unreadable: "no date", tooYoung: "too young" })).toBe("no date");
    const helper = (text: string) => birthDateHelper({ text, typedAgain: true, min, max, error: false, echo: "", tooYoung: "too young", tooOld: "too old" });
    expect(helper("2008-10-07")).toEqual({ lines: ["too old"], error: true });
    expect(helper("2010-05-05")).toEqual({ lines: [], error: false });
  });

  it("knows who signed: a parent's two children and the parent's own are three signatures", () => {
    const adult = signerIdentity("ana@example.ro", "Ana Popescu");
    const ion = signerIdentity("ana@example.ro", "Ana Popescu", "Ion Popescu");
    const maria = signerIdentity("ana@example.ro", "Ana Popescu", "Maria Popescu");
    expect(new Set([adult, ion, maria]).size).toBe(3);
    // The minor's name is read as loosely as the parent's (case, accents, spacing).
    expect(signerIdentity(" Ana@Example.RO ", "ana  popescu", "ion  POPESCU")).toBe(ion);
    expect(signerIdentity("ana@example.ro", "Ana Popescu", "")).toBe(adult);
    expect(signerIdentity("ana@example.ro", "Ana Popescu", null)).toBe(adult);
    expect(signerIdentity("not an address", "Ana Popescu", "Ion Popescu")).toBeNull();
  });

  it("keeps the same child's signature, and no other: a second child's press writes a new row", () => {
    const row = (id: string, minorTypedName: string | null): SeriesSignature => ({
      id,
      legalDocumentId: "v1",
      email: "ana@example.ro",
      typedName: "Ana Popescu",
      minorTypedName,
      acceptedAt: new Date("2026-10-01T08:00:00Z"),
    });
    const existing = [row("own", null), row("ion", "Ion Popescu")];
    expect(keptSignature(existing, { email: "ana@example.ro", typedName: "Ana Popescu", minorTypedName: "Ion Popescu" }, "v1")?.id).toBe("ion");
    expect(keptSignature(existing, { email: "ana@example.ro", typedName: "Ana Popescu" }, "v1")?.id).toBe("own");
    expect(keptSignature(existing, { email: "ana@example.ro", typedName: "Ana Popescu", minorTypedName: "Maria Popescu" }, "v1")).toBeNull();
  });

  it("lists the minor's boxes in the form's order, keeps them for the kept-form recall, and parses a refusal naming them", () => {
    expect([...GROUP_RUN_MINOR_FIELDS]).toEqual(["minor", "minorTypedName", "guardianAgrees"]);
    for (const field of GROUP_RUN_MINOR_FIELDS) {
      expect(GROUP_RUN_FORM_FIELDS).toContain(field);
      expect(GROUP_RUN_DRAFT_FIELDS).toContain(field);
    }
    // The summary lists them between the consent and the parent's own signature.
    expect(parseGroupRunInvalid("typedName,guardianAgrees,minorTypedName,minor,accepted")).toEqual(["accepted", "minor", "minorTypedName", "guardianAgrees", "typedName"]);
  });
});

describe("§769 the words, in both languages", () => {
  const page = { ro: ro.Event.groupRunDeclaration.page, en: en.Event.groupRunDeclaration.page } as const;

  it("has every key the page and the refusal summary read, in both catalogues", () => {
    for (const locale of ["ro", "en"] as const) {
      const words = page[locale];
      for (const field of GROUP_RUN_MINOR_FIELDS) expect((words.fields as Record<string, string>)[field], `${locale} fields.${field}`).toBeTruthy();
      expect(words.fields.minorBirthDate, locale).toBeTruthy();
      for (const key of ["adultsOrMinor", "acceptAny", "minorTickHelp", "minorBlockTitle", "minorTypedNameHelp", "guardianAgreesInline", "typedNameMinorHelp", "minorRefused"]) {
        expect((words as Record<string, unknown>)[key], `${locale} ${key}`).toBeTruthy();
      }
    }
  });

  it("says the owner's two ticks in his words", () => {
    expect(page.ro.fields.minor).toBe("Semnez pentru un minor (sub 18 ani)");
    expect(page.en.fields.minor).toBe("I am signing for a minor (under 18)");
    expect(page.ro.fields.guardianAgrees).toBe("Sunt părintele sau tutorele legal și sunt de acord");
    expect(page.en.fields.guardianAgrees).toBe("I am the parent or legal guardian and I agree");
  });

  it("takes the same placeholders in both languages, so neither shows a bare {age}", () => {
    const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
    for (const key of ["adultsOrMinor", "minorTickHelp"] as const) expect(placeholders(page.ro[key]), key).toEqual(placeholders(page.en[key]));
    expect(placeholders(page.ro.adultsOrMinor)).toEqual(["age", "minorAge"]);
    expect(placeholders(ro.Admin.groupRunDeclarations.minorOf)).toEqual(["parent"]);
    expect(placeholders(en.Admin.groupRunDeclarations.minorOf)).toEqual(["parent"]);
  });

  it("reads a minor's row «minor · părinte: …» in the backoffice", () => {
    expect(ro.Admin.groupRunDeclarations.minorOf.replace("{parent}", "Ana Popescu")).toBe("minor · părinte: Ana Popescu");
    expect(en.Admin.groupRunDeclarations.minorOf.replace("{parent}", "Ana Popescu")).toBe("minor · parent: Ana Popescu");
  });
});
