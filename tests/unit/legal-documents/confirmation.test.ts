import { describe, expect, it } from "vitest";
import type { LegalDocumentKey } from "@/db/schema/legal-documents";
import {
  DOCUMENT_CODES,
  confirmationPhrase,
  matchesConfirmation,
} from "@/modules/legal-documents/domain/confirmation";

/**
 * BR-REQ-053-02 — the phrase typed to delete a version of the club's legal text (§151).
 *
 * The field's whole purpose is to be impossible to satisfy by accident, and the property that
 * makes that true is not "it is hard to type" — it is that no two versions share a phrase.
 */
const KEYS: LegalDocumentKey[] = ["PRIVACY_NOTICE", "TERMS", "EVENT_DECLARATION"];

describe("the deletion confirmation phrase", () => {
  it("names one version and no other", () => {
    const phrases = KEYS.flatMap((key) => [1, 2, 3].map((version) => confirmationPhrase(key, version)));
    expect(new Set(phrases).size).toBe(phrases.length);
  });

  it("is the same string in both languages", () => {
    // A code, not a translated title: `Termeni de concurs 2` and `Racing TOS 2` would be one
    // row with two confirmations, depending on which language the backoffice happened to be in.
    for (const code of Object.values(DOCUMENT_CODES)) {
      expect(code).toMatch(/^[A-Z]+$/);
    }
    expect(confirmationPhrase("PRIVACY_NOTICE", 2)).toBe("GDPR 2");
  });

  it("forgives case and spacing, and nothing else", () => {
    expect(matchesConfirmation("GDPR 2", "PRIVACY_NOTICE", 2)).toBe(true);
    expect(matchesConfirmation("  gdpr   2 ", "PRIVACY_NOTICE", 2)).toBe(true);

    // The number is the whole point: five versions of one document share a title, so a phrase
    // that tolerated the wrong number would identify no row at all.
    expect(matchesConfirmation("GDPR 3", "PRIVACY_NOTICE", 2)).toBe(false);
    expect(matchesConfirmation("GDPR", "PRIVACY_NOTICE", 2)).toBe(false);
    expect(matchesConfirmation("2", "PRIVACY_NOTICE", 2)).toBe(false);
    expect(matchesConfirmation("", "PRIVACY_NOTICE", 2)).toBe(false);
    // Nor another document's phrase with the right number.
    expect(matchesConfirmation("TERMS 2", "PRIVACY_NOTICE", 2)).toBe(false);
    expect(matchesConfirmation("GDPR 2", "TERMS", 2)).toBe(false);
  });
});
