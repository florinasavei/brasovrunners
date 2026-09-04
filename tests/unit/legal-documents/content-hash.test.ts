import { describe, expect, it } from "vitest";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";

/**
 * AGENTS.md §10.8 — "deterministic content SHA-256 over canonical serialized JSON."
 *
 * The hash is what `declaration_acceptances.content_sha256` records as evidence of exactly
 * what a participant accepted, so it must depend only on the content — never on incidental
 * things like array/object construction order.
 */
describe("legal document content hash", () => {
  const ro: LegalDocumentTranslationInput = {
    locale: "ro",
    title: "Titlu",
    body: { sections: [{ heading: "Secțiune", paragraphs: ["Paragraf unu.", "Paragraf doi."] }] },
  };
  const en: LegalDocumentTranslationInput = {
    locale: "en",
    title: "Title",
    body: { sections: [{ heading: "Section", paragraphs: ["Paragraph one.", "Paragraph two."] }] },
  };

  it("is a 64-character lowercase hex digest", () => {
    expect(computeContentHash([ro, en])).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is independent of the order translations are passed in", () => {
    expect(computeContentHash([ro, en])).toBe(computeContentHash([en, ro]));
  });

  it("changes when a paragraph changes", () => {
    const changed: LegalDocumentTranslationInput = {
      ...ro,
      body: { sections: [{ heading: "Secțiune", paragraphs: ["Paragraf unu.", "Paragraf trei."] }] },
    };

    expect(computeContentHash([ro, en])).not.toBe(computeContentHash([changed, en]));
  });

  it("treats an omitted heading the same as an explicitly undefined one", () => {
    const withHeading: LegalDocumentTranslationInput = {
      locale: "ro",
      title: "T",
      body: { sections: [{ heading: undefined, paragraphs: ["p"] }] },
    };
    const withoutHeading: LegalDocumentTranslationInput = {
      locale: "ro",
      title: "T",
      body: { sections: [{ paragraphs: ["p"] }] },
    };

    expect(computeContentHash([withHeading])).toBe(computeContentHash([withoutHeading]));
  });

  it("is stable across repeated calls with the same content", () => {
    expect(computeContentHash([ro, en])).toBe(computeContentHash([ro, en]));
  });
});
