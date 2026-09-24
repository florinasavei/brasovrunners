import { describe, expect, it } from "vitest";
import type { LegalDocumentKey } from "@/db/schema/legal-documents";
import { SAMPLE_DOCUMENTS } from "@/db/seeds/sample-legal-documents";
import type { LegalDocumentBody } from "@/modules/legal-documents/domain/content-hash";
import { mergeFieldsIn } from "@/modules/legal-documents/domain/merge-fields";
import { LEGAL_TEMPLATES, templatePrefill } from "@/modules/legal-documents/templates/catalogue";
import { clubFactsFromEnv, remainingPlaceholders } from "@/modules/legal-documents/templates/club-facts";

/**
 * §357 — the owner, 2026-09-24: "when I seed a document I must have the placeholders as well!"
 *
 * Two kinds of gap live in the platform's legal texts, and neither may be lost on the way from
 * the template to a version in the database:
 * - the merge fields, `{{participant}}` and the rest (§95, §330), which are filled only when the
 *   declaration is shown, signed or printed for one person at one event — never when a text is
 *   seeded or prefilled, or one approved text could not serve every event;
 * - the club facts, `<DENUMIREA JURIDICĂ…>` and the rest (§132), which the seed never fills (a
 *   sample must not look approved) and the prefill fills only from what the deployment knows.
 *
 * Counted, not merely found: a text that lost the second `<EMAIL DE CONTACT>` of four still
 * "contains" the placeholder, and still asks the club to approve a sentence with a hole in it.
 */
const KEYS: readonly LegalDocumentKey[] = ["PRIVACY_NOTICE", "TERMS", "EVENT_DECLARATION"];
const LOCALES = ["ro", "en"] as const;

const texts = (body: LegalDocumentBody) => body.sections.flatMap((section) => [section.heading ?? "", ...section.paragraphs]);

/** Every `{{…}}` written in a body, a misspelt one included, with how often it appears. */
function fieldCounts(body: LegalDocumentBody): Map<string, number> {
  const counts = new Map<string, number>();
  for (const text of texts(body)) {
    for (const match of text.matchAll(/\{\{\s*[a-zA-Z]+\s*\}\}/g)) counts.set(match[0], (counts.get(match[0]) ?? 0) + 1);
  }
  return counts;
}

/** Every club-fact `<PLACEHOLDER>` in a body, with how often it appears. */
function placeholderCounts(body: LegalDocumentBody): Map<string, number> {
  const counts = new Map<string, number>();
  for (const text of texts(body)) {
    for (const match of text.matchAll(/<[A-ZĂÂÎȘȚ'’][^<>]{3,}>/g)) counts.set(match[0], (counts.get(match[0]) ?? 0) + 1);
  }
  return counts;
}

const FACTS = clubFactsFromEnv({
  CLUB_LEGAL_NAME: "Asociația Exemplu",
  CLUB_REGISTRATION_NUMBER: "CIF 12345678",
  CLUB_REGISTERED_ADDRESS: "Str. Exemplu nr. 1",
  EMAIL_REPLY_TO: "contact@example.test",
});

describe("§357 the gaps of the platform's legal texts survive the seed and the prefill", () => {
  it("has gaps to lose: the declaration's merge fields, and club facts in all three", () => {
    // So that "every gap survived" cannot pass by the templates having none.
    expect(fieldCounts(LEGAL_TEMPLATES.EVENT_DECLARATION.ro.body).size).toBeGreaterThanOrEqual(7);
    expect(fieldCounts(LEGAL_TEMPLATES.EVENT_DECLARATION.en.body).size).toBeGreaterThanOrEqual(7);
    for (const key of KEYS) {
      for (const locale of LOCALES) expect(placeholderCounts(LEGAL_TEMPLATES[key][locale].body).size, `${key} ${locale}`).toBeGreaterThan(0);
    }
  });

  for (const key of KEYS) {
    for (const locale of LOCALES) {
      it(`${key} ${locale}: the seeded sample carries every merge field and placeholder, as often as the template`, () => {
        const template = LEGAL_TEMPLATES[key][locale].body;
        const sample = SAMPLE_DOCUMENTS.find((document) => document.key === key)!.translations.find((t) => t.locale === locale)!.body;
        // The template's own sections, word for word, between the banner and the review note.
        expect(sample.sections.slice(1, -1)).toEqual(template.sections);
        for (const [field, count] of fieldCounts(template)) expect(fieldCounts(sample).get(field), field).toBe(count);
        for (const [placeholder, count] of placeholderCounts(template)) expect(placeholderCounts(sample).get(placeholder), placeholder).toBe(count);
        expect([...mergeFieldsIn(sample)].sort()).toEqual([...mergeFieldsIn(template)].sort());
      });

      it(`${key} ${locale}: "start from the platform's text" with no fact known is the template, every gap standing`, () => {
        const prefill = templatePrefill(key, clubFactsFromEnv({ CLUB_LEGAL_NAME: undefined, CLUB_REGISTRATION_NUMBER: undefined, CLUB_REGISTERED_ADDRESS: undefined, EMAIL_REPLY_TO: undefined }));
        expect(prefill[locale]).toEqual(LEGAL_TEMPLATES[key][locale]);
      });

      it(`${key} ${locale}: with every fact known, the prefill writes the facts in and keeps every merge field`, () => {
        const template = LEGAL_TEMPLATES[key][locale].body;
        const body = templatePrefill(key, FACTS)[locale].body;
        expect(fieldCounts(body)).toEqual(fieldCounts(template));
        expect(remainingPlaceholders(body)).toEqual([]);
        // Each fact as often as its placeholder stood — written in, never dropped.
        const joined = texts(body).join("\n");
        const standing = placeholderCounts(template);
        const legalName = (standing.get("<DENUMIREA JURIDICĂ COMPLETĂ A CLUBULUI>") ?? 0) + (standing.get("<THE CLUB'S FULL LEGAL NAME>") ?? 0);
        expect(joined.split("Asociația Exemplu").length - 1).toBe(legalName);
      });
    }
  }

  it("fills only what the deployment knows: an unknown fact stays its placeholder, the fields untouched", () => {
    const body = templatePrefill("TERMS", { legalName: "Asociația Exemplu" }).ro.body;
    const left = remainingPlaceholders(body);
    expect(left).toEqual(expect.arrayContaining(["<ADRESA SEDIULUI>", "<NUMĂR DE ÎNREGISTRARE / CUI>", "<EMAIL DE CONTACT>"]));
    expect(left).not.toContain("<DENUMIREA JURIDICĂ COMPLETĂ A CLUBULUI>");
    const declaration = templatePrefill("EVENT_DECLARATION", { legalName: "Asociația Exemplu" });
    expect(fieldCounts(declaration.ro.body)).toEqual(fieldCounts(LEGAL_TEMPLATES.EVENT_DECLARATION.ro.body));
    expect(fieldCounts(declaration.en.body)).toEqual(fieldCounts(LEGAL_TEMPLATES.EVENT_DECLARATION.en.body));
  });
});
