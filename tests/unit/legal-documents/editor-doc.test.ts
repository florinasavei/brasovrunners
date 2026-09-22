import { describe, expect, it } from "vitest";
import { bodyToText, textToBody } from "@/modules/legal-documents/domain/body-text";
import { computeContentHash } from "@/modules/legal-documents/domain/content-hash";
import { editorDocToText, textToEditorDoc } from "@/modules/legal-documents/domain/editor-doc";
import { LEGAL_TEMPLATES } from "@/modules/legal-documents/templates/catalogue";
import type { LegalDocumentKey } from "@/db/schema/legal-documents";

/**
 * BR-REQ-053-01, `DECISIONS.md` §279 — the club writes a legal document in an editor that shows
 * what the page will show, and the document it stores is byte for byte the one the textarea
 * stored.
 *
 * The hash is the point of these. `content-hash.ts` is what an approved version is identified
 * by, what the participant's acceptance points at, and what the PDF is drawn from; the club's
 * three texts are approved on production against those exact bytes. So the assertion that
 * matters is not that the editor works — it is that opening a stored document in it and saving
 * it again changes nothing at all.
 */
describe("DECISIONS.md §279 the legal editor is a view over the stored text", () => {
  const KEYS: LegalDocumentKey[] = ["PRIVACY_NOTICE", "TERMS", "EVENT_DECLARATION"];

  it("round-trips all three of the platform's templates, in both languages, without moving the hash", () => {
    for (const key of KEYS) {
      for (const locale of ["ro", "en"] as const) {
        const stored = LEGAL_TEMPLATES[key][locale].body;
        const text = bodyToText(stored);
        const reopened = editorDocToText(textToEditorDoc(text));
        expect(reopened, `${key}/${locale}`).toBe(text);
        // The whole point: same bytes in, same identity out.
        const one = computeContentHash([{ locale, title: "t", body: stored }]);
        const two = computeContentHash([{ locale, title: "t", body: textToBody(reopened) }]);
        expect(two, `${key}/${locale} hash`).toBe(one);
      }
    }
  });

  it("reads a heading, a paragraph, a link and a picture as the things they are", () => {
    const doc = textToEditorDoc(
      [
        "## Cine suntem",
        "Clubul, la [adresa noastră](https://example.test/contact).",
        "![Harta traseului](https://example.test/harta.webp)",
      ].join("\n\n"),
    );
    expect(doc.content.map((block) => block.type)).toEqual(["heading", "paragraph", "image"]);
    const paragraph = doc.content[1];
    expect(paragraph.type === "paragraph" && paragraph.content?.[1]).toEqual({
      type: "text",
      text: "adresa noastră",
      marks: [{ type: "link", attrs: { href: "https://example.test/contact" } }],
    });
    // And back out as the marks they were written with, not as HTML.
    expect(editorDocToText(doc)).toContain("[adresa noastră](https://example.test/contact)");
    expect(editorDocToText(doc)).toContain("![Harta traseului](https://example.test/harta.webp)");
  });

  it("keeps a line break inside a paragraph as a break, not as a new paragraph", () => {
    const text = "Str. Lungă 1\nBrașov";
    const doc = textToEditorDoc(text);
    expect(doc.content).toHaveLength(1);
    expect(doc.content[0].type === "paragraph" && doc.content[0].content).toEqual([
      { type: "text", text: "Str. Lungă 1" },
      { type: "hardBreak" },
      { type: "text", text: "Brașov" },
    ]);
    expect(editorDocToText(doc)).toBe(text);
  });

  it("keeps a merge field exactly as typed, because the declaration is signed on it", () => {
    const text = "Subsemnatul {{participant}}, la {{event}} din {{eventDate}}, declar pe propria răspundere.";
    expect(editorDocToText(textToEditorDoc(text))).toBe(text);
  });

  it("is empty rather than wrong when what comes back is not a document", () => {
    expect(editorDocToText(null)).toBe("");
    expect(editorDocToText({ type: "doc" })).toBe("");
    expect(editorDocToText({ type: "doc", content: [{ type: "paragraph", content: [] }] })).toBe("");
  });
});
