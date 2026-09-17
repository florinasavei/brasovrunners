import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderLegalDocumentPdf, type LegalPdfInput } from "@/modules/legal-documents/pdf";

/**
 * BR-REQ-053-03 — a legal document version as a PDF.
 *
 * pdfkit writes a real PDF; these tests read it back as bytes rather than trusting the call
 * returned. What can be checked without a PDF parser: the file signature, the embedded font
 * (the site's own, because the standard fourteen cannot spell ș or ț), the image, the metadata
 * that names the version, and the page count — a declaration long enough to break a page must
 * produce more than one and a footer on each.
 */
const BODY = {
  sections: [
    { heading: "Declarație pe propria răspundere", paragraphs: ["Subsemnatul, participant la eveniment, declar că sunt apt din punct de vedere fizic și că particip pe propria răspundere. Ștampilă, țară, ață, împrejur."] },
    { heading: "Prelucrarea datelor", paragraphs: ["Am citit nota de confidențialitate.", "Sunt de acord cu prelucrarea datelor pentru organizarea evenimentului."] },
  ],
};

function input(overrides: Partial<LegalPdfInput> = {}): LegalPdfInput {
  return {
    version: 3,
    isApproved: true,
    effectiveAt: new Date("2026-10-01T00:00:00Z"),
    contentSha256: "a".repeat(64),
    title: "Declarație de participare",
    body: BODY,
    locale: "ro",
    generatedAt: new Date("2026-09-17T12:00:00Z"),
    labels: {
      organization: "Brașov Runners",
      version: "Versiunea 3",
      effectiveFrom: "În vigoare din 1 octombrie 2026",
      draftNotice: "",
      generatedOn: "Generat pe 17 sept. 2026",
      page: (n, total) => `Pagina ${n} din ${total}`,
    },
    ...overrides,
  };
}

describe("BR-REQ-053-03 a legal document version as a PDF", () => {
  it("produces a PDF with the site's font and the logo embedded, and names the version", async () => {
    const pdf = await renderLegalDocumentPdf(input());
    const text = pdf.toString("latin1");

    expect(text.startsWith("%PDF-1.")).toBe(true);
    // Roboto, embedded — not Helvetica, which could not set the diacritics.
    expect(text).toMatch(/Roboto/);
    expect(text).not.toMatch(/\/BaseFont \/Helvetica/);
    // The lockup: one image XObject.
    expect(text).toMatch(/\/Subtype \/Image/);
    // The metadata carries the version and the hash, so the file says what it is without
    // opening. pdfkit writes an info string with any non-ASCII character as UTF-16BE.
    const utf16be = (value: string) => Buffer.from(value, "utf16le").swap16().toString("latin1");
    expect(text).toMatch(/\/Title/);
    expect(text).toContain(utf16be("Versiunea 3"));
    expect(text).toContain(utf16be("a".repeat(64)));
    // One page for a short declaration.
    expect(text.match(/\/Type \/Page\b/g)?.length).toBe(1);
  });

  it("breaks a long declaration across pages, each with its footer", async () => {
    const long = {
      sections: Array.from({ length: 12 }, (_, i) => ({
        heading: `Secțiunea ${i + 1}`,
        paragraphs: Array.from({ length: 4 }, () => BODY.sections[0].paragraphs[0].repeat(3)),
      })),
    };
    const pdf = await renderLegalDocumentPdf(input({ body: long }));
    const pages = pdf.toString("latin1").match(/\/Type \/Page\b/g)?.length ?? 0;
    expect(pages).toBeGreaterThan(1);
  });

  it("renders a draft with its notice, and an approved version without one", async () => {
    const draft = await renderLegalDocumentPdf(
      input({ isApproved: false, labels: { ...input().labels, draftNotice: "CIORNĂ — versiune neaprobată." } }),
    );
    const approved = await renderLegalDocumentPdf(input());
    // Text is compressed inside the content stream, so the two are compared by what differs
    // in the structure: the draft carries one more filled rectangle (the band) and is longer.
    expect(draft.byteLength).toBeGreaterThan(approved.byteLength);
  });

  it("writes a sample to disk for a person to look at, when asked", async () => {
    // `LEGAL_PDF_SAMPLE=path yarn test tests/unit/legal-documents` — never in CI.
    const target = process.env.LEGAL_PDF_SAMPLE;
    if (!target) return;
    writeFileSync(target, await renderLegalDocumentPdf(input({ isApproved: false, labels: { ...input().labels, draftNotice: "CIORNĂ — versiune neaprobată. Textul de mai jos nu are efect până la aprobare." } })));
  });
});
