import { describe, expect, it } from "vitest";
import { identityDocumentsOf } from "@/modules/registrations/domain/identity-documents";
import { maskIdDocument } from "@/modules/registrations/declaration-pdf";
import { identityDocumentValues } from "@/modules/registrations/signed-declaration";

/**
 * §NNN — a minor's declaration carries two identity documents: the parent's, in the column that
 * has always held the declarant's (`id_document`), and the minor's own (`minor_id_document`).
 * Every screen, file and merge asks these functions whose is whose, so none can print the
 * parent's document under the child's name.
 */
describe("§NNN whose identity document is whose", () => {
  it("gives an adult's one document to the participant, and no guardian", () => {
    expect(identityDocumentsOf({ guardianName: null, idDocument: "BV 123456", minorIdDocument: null })).toEqual({ participant: "BV 123456", guardian: null });
  });

  it("gives a minor's own document to the participant, and the declarant's to the guardian", () => {
    expect(identityDocumentsOf({ guardianName: "Ion Pop", idDocument: "BV 123456", minorIdDocument: "MP 654321" })).toEqual({
      participant: "MP 654321",
      guardian: "BV 123456",
    });
  });

  it("never passes a parent's document off as the child's on a declaration signed before two signatures", () => {
    // One signature, the parent's (§108): the document is the guardian's, and the minor has none on record.
    expect(identityDocumentsOf({ guardianName: "Ion Pop", idDocument: "BV 123456", minorIdDocument: null })).toEqual({ participant: null, guardian: "BV 123456" });
  });

  it("has nothing to show once both are cleared, seven days after the event (§95)", () => {
    expect(identityDocumentsOf({ guardianName: "Ion Pop", idDocument: null, minorIdDocument: null })).toEqual({ participant: null, guardian: null });
  });
});

describe("§NNN the declaration's three document fields", () => {
  it("keeps {{idDocument}} the declarant's, and fills each signer's own field", () => {
    // An adult: the participant's document is the declarant's, and no guardian signs — a dash, like {{guardian}}.
    expect(identityDocumentValues(null, { idDocument: "BV 123456" })).toEqual({
      idDocument: "BV 123456",
      participantIdDocument: "BV 123456",
      guardianIdDocument: "—",
    });
    // A minor: the parent declares, so {{idDocument}} reads the parent's, as every text approved before does.
    expect(identityDocumentValues("Ion Pop", { idDocument: "BV 123456", minorIdDocument: "MP 654321" })).toEqual({
      idDocument: "BV 123456",
      participantIdDocument: "MP 654321",
      guardianIdDocument: "BV 123456",
    });
  });

  it("leaves a document not yet typed as a blank, but the adult's guardian a dash", () => {
    expect(identityDocumentValues(null, {})).toEqual({ idDocument: undefined, participantIdDocument: undefined, guardianIdDocument: "—" });
    expect(identityDocumentValues("Ion Pop", {})).toEqual({ idDocument: undefined, participantIdDocument: undefined, guardianIdDocument: undefined });
  });

  it("masks both documents alike when the club's copy passes them masked (§320)", () => {
    const values = identityDocumentValues("Ion Pop", { idDocument: maskIdDocument("BV 123456"), minorIdDocument: maskIdDocument("MP 654321") });
    expect(values).toEqual({ idDocument: "BV ••••56", participantIdDocument: "MP ••••21", guardianIdDocument: "BV ••••56" });
  });
});
