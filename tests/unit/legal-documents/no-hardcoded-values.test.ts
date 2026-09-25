import { describe, expect, it } from "vitest";
import type { LegalDocumentKey } from "@/db/schema/legal-documents";
import { SAMPLE_DOCUMENTS } from "@/db/seeds/sample-legal-documents";
import { LEGAL_DOCUMENT_KEYS } from "@/modules/legal-documents/domain/keys";
import type { LegalDocumentBody } from "@/modules/legal-documents/domain/content-hash";
import { CLUB_LOCALITY } from "@/modules/events/domain/place";
import { LEGAL_TEMPLATES } from "@/modules/legal-documents/templates/catalogue";
import {
  DECLARATION_TOKENS,
  TOKEN_EXAMPLE_EVENT_STARTS_AT,
  TOKEN_EXAMPLE_SIGNED_AT,
} from "@/modules/legal-documents/templates/tokens";
import { declarantValues } from "@/modules/registrations/signed-declaration";
import { CLUB_TIME_ZONE, formatDay } from "@/i18n/dates";
import { CLUB_NAME, WORDMARK } from "@/theme/brand";

/**
 * §357 — the owner, 2026-09-24: "I do not [want] hardcoded stuff in the document and emails
 * anymore!"
 *
 * One approved declaration serves every event (§95), and one privacy notice and one set of terms
 * serve every event and every year. So no legal template may carry a value of one event or of
 * the club written in as words: an event's name, place, date, time or distance comes from a merge
 * field (`{{event}}`, `{{eventDate}}`, `{{eventLocation}}`), and a club fact from its
 * `<PLACEHOLDER>` (§132). A general statement is phrased generically — "the trails the event
 * uses", "the courts of the club's registered seat" — never "Tâmpa" or "Brașov".
 *
 * The seeded samples are held to the same rule, banner and review note included: they are what
 * QA and a developer's machine show as the club's texts.
 *
 * What may stay written in is not a club's or an event's value, and is listed here so a reader
 * can check the list rather than trust it: the laws cited (their numbers carry years), the
 * supervisory authority's statutory contact (art. 13(2)(d) GDPR), the emergency number 112, and
 * the platform's own fixed periods (48 hours, 30 minutes, three years…), which are the same for
 * every event because the code makes them so.
 */
// Every key, the group runs' two declarations included (§393).
const KEYS: readonly LegalDocumentKey[] = LEGAL_DOCUMENT_KEYS;

const texts = (body: LegalDocumentBody) => body.sections.flatMap((section) => [section.heading ?? "", ...section.paragraphs]);

/** Diacritics and case folded, so "Brașov", "Brasov" and "BRASOV" are one word to look for. */
const fold = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

const MONTHS = [
  "ianuarie", "februarie", "martie", "aprilie", "mai", "iunie", "iulie", "august", "septembrie", "octombrie", "noiembrie", "decembrie",
  "january", "february", "march", "april", "june", "july", "september", "october", "november", "december",
];

/** The authority's own contact, which art. 13(2)(d) GDPR asks the notice to give. */
const AUTHORITY_CONTACT = new Set(["www.dataprotection.ro", "anspdcp@dataprotection.ro"]);

function hardcodedValuesIn(text: string): string[] {
  const found: string[] = [];
  const folded = fold(text);
  // The club's everyday name, its wordmark and its town: the club is named by its placeholders.
  for (const name of [CLUB_NAME, WORDMARK, CLUB_LOCALITY]) if (folded.includes(fold(name))) found.push(name);
  // A date: a day and a month's name ("21 noiembrie", "November 21"), or 21.11.2026.
  for (const month of MONTHS) {
    const pattern = new RegExp(`\\b\\d{1,2}\\s+${month}\\b|\\b${month}\\s+\\d{1,2}\\b`, "i");
    const match = folded.match(pattern);
    if (match) found.push(match[0]);
  }
  for (const match of text.matchAll(/\b\d{1,2}[./]\d{1,2}[./]\d{2,4}\b/g)) found.push(match[0]);
  // A clock time: "09:00" names a start.
  for (const match of text.matchAll(/\b\d{1,2}:\d{2}\b/g)) found.push(match[0]);
  // A distance or an amount.
  for (const match of text.matchAll(/\b\d+(?:[.,]\d+)?\s*(?:km|kilometri|kilometres|kilometers|m)\b/gi)) found.push(match[0]);
  for (const match of text.matchAll(/\b\d+(?:[.,]\d+)?\s*(?:lei|ron|eur|euro)\b|€\s*\d/gi)) found.push(match[0]);
  // An address or a site of anybody's but the authority's.
  for (const match of text.matchAll(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+|\bwww\.[\w-]+(?:\.[\w-]+)+|https?:\/\/\S+/g)) {
    if (!AUTHORITY_CONTACT.has(match[0])) found.push(match[0]);
  }
  return found;
}

describe("§357 no hardcoded value in a legal template", () => {
  it("finds what it looks for, so a clean result means something", () => {
    // The checker itself, on sentences the rule forbids.
    expect(hardcodedValuesIn("Crosul are loc pe Tâmpa, lângă Brașov")).toContain(CLUB_LOCALITY);
    expect(hardcodedValuesIn("aprobat de Brașov Runners")).toEqual(expect.arrayContaining([CLUB_NAME]));
    expect(hardcodedValuesIn("pe 21 noiembrie, la 09:00")).toEqual(expect.arrayContaining(["21 noiembrie", "09:00"]));
    expect(hardcodedValuesIn("on November 21, 21.11.2026")).toEqual(expect.arrayContaining(["november 21", "21.11.2026"]));
    expect(hardcodedValuesIn("un traseu de 21 km, taxa 50 lei")).toEqual(expect.arrayContaining(["21 km", "50 lei"]));
    expect(hardcodedValuesIn("scrie la club@example.test sau www.example.test")).toEqual(["club@example.test", "www.example.test"]);
    // And lets through what is not a value of the club or of an event.
    expect(hardcodedValuesIn("Legea nr. 214/2024, art. 6(1)(b) GDPR, sun la 112, în 48 de ore, trei ani")).toEqual([]);
    expect(hardcodedValuesIn("www.dataprotection.ro, anspdcp@dataprotection.ro")).toEqual([]);
  });

  for (const key of KEYS) {
    for (const locale of ["ro", "en"] as const) {
      it(`${key} ${locale}: the template names no event, place, date, time, distance, amount or club fact`, () => {
        const translation = LEGAL_TEMPLATES[key][locale];
        expect(hardcodedValuesIn([translation.title, ...texts(translation.body)].join("\n"))).toEqual([]);
      });

      it(`${key} ${locale}: nor does the seeded sample, banner and review note included`, () => {
        const sample = SAMPLE_DOCUMENTS.find((document) => document.key === key)!.translations.find((t) => t.locale === locale)!;
        expect(hardcodedValuesIn([sample.title, ...texts(sample.body)].join("\n"))).toEqual([]);
      });
    }
  }

  it("says where the event is only through the merge fields", () => {
    for (const locale of ["ro", "en"] as const) {
      const [opening] = LEGAL_TEMPLATES.EVENT_DECLARATION[locale].body.sections[0].paragraphs;
      for (const field of ["{{event}}", "{{eventDate}}", "{{eventLocation}}"]) expect(opening, `${locale} ${field}`).toContain(field);
    }
  });

  it("names the courts by the club's seat, never a town", () => {
    const ro = texts(LEGAL_TEMPLATES.TERMS.ro.body).join(" ");
    const en = texts(LEGAL_TEMPLATES.TERMS.en.body).join(" ");
    expect(ro).toContain("instanțele de la sediul clubului");
    expect(en).toContain("the courts of the club's registered seat");
  });
});

describe("§369 the declaration's token legend: made-up examples, in both languages", () => {
  const example = (token: string) => DECLARATION_TOKENS.find((entry) => entry.token === token)!.example;

  it("gives every token an example in each language, and none names the club or its town", () => {
    for (const entry of DECLARATION_TOKENS) {
      for (const locale of ["ro", "en"] as const) {
        const value = entry.example[locale];
        expect(value.trim(), `${entry.token} ${locale}`).not.toBe("");
        for (const name of [CLUB_NAME, WORDMARK, CLUB_LOCALITY]) expect(fold(value), `${entry.token} ${locale}`).not.toContain(fold(name));
      }
    }
  });

  it("calls the example event a made-up title, in each language", () => {
    expect(example("{{event}}")).toEqual({ ro: "Crosul de toamnă", en: "The autumn cross" });
  });

  it("writes the example dates with the helper a signature uses, in each language (§349)", () => {
    for (const locale of ["ro", "en"] as const) {
      expect(example("{{eventDate}}")[locale]).toBe(
        formatDay(TOKEN_EXAMPLE_EVENT_STARTS_AT, { locale, timeZone: CLUB_TIME_ZONE, style: "long", position: "inline" }),
      );
      expect(example("{{signedAt}}")[locale]).toBe(
        formatDay(TOKEN_EXAMPLE_SIGNED_AT, { locale, timeZone: CLUB_TIME_ZONE, style: "long", withTime: true, position: "inline" }),
      );
    }
    expect(example("{{eventDate}}")).toEqual({ ro: "sâmbătă, 21 nov. 2026", en: "Saturday, 21 Nov 2026" });
    expect(example("{{signedAt}}").ro).toBe("duminică, 20 sept. 2026, 19:42");
  });

  it("gives the declarant the words a minor's signature actually produces", () => {
    for (const locale of ["ro", "en"] as const) {
      expect(example("{{declarant}}")[locale]).toBe(declarantValues("Ana Popescu", "Mihai Popescu", locale).declarant);
    }
  });
});
