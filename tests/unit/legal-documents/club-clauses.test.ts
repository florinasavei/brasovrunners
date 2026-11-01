import { describe, expect, it } from "vitest";
import clubLegal from "@club/legal.json";
import type { LegalDocumentBody } from "@/modules/legal-documents/domain/content-hash";
import { LEGAL_DOCUMENT_KEYS } from "@/modules/legal-documents/domain/keys";
import { LEGAL_TEMPLATES } from "@/modules/legal-documents/templates/catalogue";
import { CLUB_CLAUSES, type ClubLegalClauses, remainingPlaceholders, withClubClauses } from "@/modules/legal-documents/templates/club-facts";
import { SAFETY_PROGRAMME } from "@/theme/brand";

/**
 * BR-REQ-101-01 (§NNN) — the club's own choices in its legal texts are `club/legal.json`'s, written into the
 * platform's templates where each `<PLACEHOLDER>` stands, in both languages or neither; a choice the file does not
 * say stays its placeholder, for the club to type and for `approveVersion` to refuse until it does (BR-REQ-053-01).
 */
const LOCALES = ["ro", "en"] as const;

/** A body made of every choice's placeholder in one language, one paragraph each. */
const blanks = (locale: (typeof LOCALES)[number]): LegalDocumentBody => ({
  sections: [{ heading: "Test", paragraphs: CLUB_CLAUSES.map(({ placeholder }) => `— ${placeholder[locale]} —`) }],
});

/** Every `{ ro, en }` pair in the file, by its path. */
function pairs(value: unknown, at = ""): Array<[string, Record<string, unknown>]> {
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  if ("ro" in record || "en" in record) return [[at, record]];
  return Object.entries(record).flatMap(([key, inner]) => pairs(inner, at ? `${at}.${key}` : key));
}

describe("BR-REQ-101-01: the club's legal clauses come from club/legal.json (§NNN)", () => {
  it("says every choice in both languages, words and nothing else", () => {
    const found = pairs(clubLegal);
    expect(found.map(([at]) => at).sort()).toEqual([
      "dataProtectionOfficer",
      "mailbox.account",
      "mailbox.company",
      "mailbox.name",
      "mailbox.providerTerms",
      "mailbox.theClubs",
      "mailbox.withCompany",
      "photoChannels",
      "prizeMoney",
    ]);
    for (const [at, words] of found) {
      expect(Object.keys(words).sort(), at).toEqual(["en", "ro"]);
      for (const locale of LOCALES) {
        expect(typeof words[locale], `${at} ${locale}`).toBe("string");
        expect(String(words[locale]).trim(), `${at} ${locale}`).not.toBe("");
        // The club's words, never a blank of their own: a value that is a placeholder fills nothing.
        expect(String(words[locale]), `${at} ${locale}`).not.toMatch(/<[^<>]+>/);
      }
    }
  });

  it("writes every choice in, each in its language, the safety form's name from club.json", () => {
    for (const locale of LOCALES) {
      const filled = withClubClauses(locale, blanks(locale));
      expect(remainingPlaceholders(filled), locale).toEqual([]);
      const text = filled.sections[0].paragraphs.join("\n");
      expect(text).toContain(clubLegal.prizeMoney[locale]);
      expect(text).toContain(clubLegal.mailbox.withCompany[locale]);
      expect(text).toContain(SAFETY_PROGRAMME[locale]);
    }
  });

  it("leaves every choice the file does not say standing as its placeholder", () => {
    for (const locale of LOCALES) {
      const filled = withClubClauses(locale, blanks(locale), {}, {});
      expect(filled).toEqual(blanks(locale));
      expect(remainingPlaceholders(filled).sort(), locale).toEqual(CLUB_CLAUSES.map(({ placeholder }) => placeholder[locale]).sort());
    }
  });

  it("fills a choice in both languages or in neither", () => {
    const romanianOnly: ClubLegalClauses = { prizeMoney: { ro: "Nu se acordă premii în bani." } };
    const blankEnglish: ClubLegalClauses = { prizeMoney: { ro: "Nu se acordă premii în bani.", en: "  " } };
    for (const clauses of [romanianOnly, blankEnglish]) {
      for (const locale of LOCALES) {
        const filled = withClubClauses(locale, blanks(locale), clauses, SAFETY_PROGRAMME);
        expect(remainingPlaceholders(filled), locale).toContain(locale === "ro" ? "<PREMIILE ÎN BANI>" : "<PRIZE MONEY>");
      }
    }
  });

  it("leaves no choice blank in this club's templates: only the four facts the environment gives stay", () => {
    const facts = new Set([
      "<DENUMIREA JURIDICĂ COMPLETĂ A CLUBULUI>",
      "<THE CLUB'S FULL LEGAL NAME>",
      "<EMAIL DE CONTACT>",
      "<CONTACT EMAIL>",
      "<ADRESA SEDIULUI>",
      "<REGISTERED ADDRESS>",
      "<NUMĂR DE ÎNREGISTRARE / CUI>",
      "<REGISTRATION NUMBER>",
    ]);
    for (const key of LEGAL_DOCUMENT_KEYS) {
      for (const locale of LOCALES) {
        const left = remainingPlaceholders(LEGAL_TEMPLATES[key][locale].body).filter((placeholder) => !facts.has(placeholder));
        expect(left, `${key} ${locale}`).toEqual([]);
      }
    }
  });
});
