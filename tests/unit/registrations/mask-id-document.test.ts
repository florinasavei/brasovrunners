import { describe, expect, it } from "vitest";
import { ID_DOCUMENT } from "@/modules/registrations/fields";
import { ID_DOCUMENT_MASK, maskIdDocument } from "@/modules/registrations/declaration-pdf";

/**
 * BR-REQ-033-02 criterion 11 as amended by §NNN — the identity document in every copy of a signed
 * declaration that leaves the platform for a club mailbox.
 *
 * The PDF draws whatever `maskIdDocument` returns, and pdfkit writes an embedded font's text as
 * glyph ids inside a deflated stream, so the drawn page cannot be searched for the number; the
 * function is what is asserted, here on its own and, in the integration suite, on the entry the
 * renderer hands the PDF for the archive copy.
 */
describe("BR-REQ-033-02 criterion 11 the identity document masked in the club's copy (§NNN)", () => {
  it("keeps the first two and the last two characters of a Romanian identity card, and hides the number", () => {
    expect(maskIdDocument("BV 123456")).toBe("BV ••••56");
    expect(maskIdDocument("BV123456")).toBe("BV ••••56");
    expect(maskIdDocument("bv 123456")).toBe("bv ••••56");
    expect(maskIdDocument("BV 123456")).not.toContain("1234");
  });

  it("counts characters without spaces, whatever way the card was typed", () => {
    // Spaces, runs of spaces and tabs are not characters of the document.
    expect(maskIdDocument("  BV   123 456 ")).toBe("BV ••••56");
    // Written out the way the paper form reads, the words are kept and the number is not.
    expect(maskIdDocument("CI seria BV nr. 123456")).toBe("CI ••••56");
    // A passport number from abroad.
    expect(maskIdDocument("X12345678")).toBe("X1 ••••78");
  });

  it("hides everything while the kept characters would be most of the document", () => {
    // The form accepts four to thirty characters (`ID_DOCUMENT`); under eight, showing four
    // would leave half or less hidden, so nothing is shown.
    for (const value of ["AB12", "AB123", "AB1234", "AB 12345", "AB1-234"]) {
      expect(ID_DOCUMENT.test(value), value).toBe(true);
      expect(maskIdDocument(value), value).toBe(ID_DOCUMENT_MASK);
    }
    expect(maskIdDocument("")).toBe(ID_DOCUMENT_MASK);
    expect(maskIdDocument("   ")).toBe(ID_DOCUMENT_MASK);
  });

  it("never returns more than four characters of what was typed, for any shape the form accepts", () => {
    for (const value of ["BV 123456", "SB-987654", "RX.765432", "Passport 12345678", "A1B2C3D4E5F6G7H8"]) {
      expect(ID_DOCUMENT.test(value), value).toBe(true);
      const masked = maskIdDocument(value);
      expect(masked).toContain(ID_DOCUMENT_MASK);
      expect(masked.replace(ID_DOCUMENT_MASK, "").replace(/\s/g, "").length, value).toBeLessThanOrEqual(4);
    }
  });
});
