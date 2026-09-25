import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { declarationWords } from "@/modules/registrations/declaration-labels";
import { type DeclarationEntry, idDocumentsNoticeFor } from "@/modules/registrations/declaration-pdf";

/**
 * §NNN — the counsel review of 2026-09-25, on the signing page and the PDF.
 *
 * The box accepts the declaration's liability paragraph expressly (Civil Code art. 1203); an adult
 * is told to sign personally, since whoever holds a family's inbox holds the link (art. 1309, §389);
 * the PDF says the link went to the registration's address, not "the participant's", which is
 * untrue on a family registration; and the event's bundle, which carries whole identity documents,
 * says on every page to delete it within seven days of the event (privacy notice §7).
 */
const NOW = new Date("2026-11-21T08:00:00.000Z");

describe("§NNN the signing page's words", () => {
  it("accepts the liability paragraph expressly, in both languages", () => {
    expect(ro.Registrations.declare.accept).toContain("inclusiv, în mod expres, limitarea răspunderii organizatorului în limitele permise de lege");
    expect(en.Registrations.declare.accept).toContain("including, expressly, the limitation of the organiser's liability to the extent the law allows");
  });

  it("tells an adult to sign personally, naming them, in both languages", () => {
    expect(ro.Registrations.declare.signPersonally).toMatch(/^Declarația trebuie semnată personal de \{participant\}\./);
    expect(ro.Registrations.declare.signPersonally).toContain("nimeni nu semnează în locul altui adult");
    expect(en.Registrations.declare.signPersonally).toMatch(/^\{participant\} must sign this declaration personally\./);
    expect(en.Registrations.declare.signPersonally).toContain("nobody signs for another adult");
  });
});

describe("§NNN the PDF's words", () => {
  it("says the link went to the registration's address, not the participant's", () => {
    const roWords = declarationWords("ro", NOW);
    const enWords = declarationWords("en", NOW);
    expect(roWords.signedByLink("azi")).toContain("din linkul unic trimis pe adresa de email a înscrierii");
    expect(roWords.signedByLink("azi")).not.toContain("a participantului");
    expect(enWords.signedByLink("today")).toContain("from the single-use link sent to the registration's email address");
    expect(enWords.signedByLink("today")).not.toContain("participant's");
  });

  it("gives the bundle's footer its deletion notice, in both languages", () => {
    expect(declarationWords("ro", NOW).idDocumentsNotice).toBe(
      "Conține seria și numărul actelor de identitate — ștergeți fișierul în cel mult șapte zile de la eveniment.",
    );
    expect(declarationWords("en", NOW).idDocumentsNotice).toBe("Contains identity document numbers — delete this file within seven days of the event.");
  });

  it("prints the notice only while a signed entry still carries an identity document", () => {
    const entry = (signature?: DeclarationEntry["signature"]): DeclarationEntry => ({
      title: "Declarație",
      body: { sections: [] },
      eventTitle: "Crosul",
      version: 1,
      contentSha256: "0".repeat(64),
      signature,
    });
    const signed = (idDocument: string | null, minorIdDocument: string | null = null): DeclarationEntry["signature"] => ({
      typedName: "Ana Popescu",
      idDocument,
      minor: minorIdDocument === null ? null : { typedName: "Maria Popescu", idDocument: minorIdDocument },
      signedAt: "azi",
      method: "link",
    });
    const notice = "delete within seven days";
    expect(idDocumentsNoticeFor({ entries: [entry(signed("BV 123456"))], idDocumentsNotice: notice })).toBe(notice);
    // A minor's own document counts, the parent's cleared or not.
    expect(idDocumentsNoticeFor({ entries: [entry(signed(null, "MP 111222"))], idDocumentsNotice: notice })).toBe(notice);
    // After the seven-day sweep, or on the blank form, there is nothing to warn about.
    expect(idDocumentsNoticeFor({ entries: [entry(signed(null))], idDocumentsNotice: notice })).toBeUndefined();
    expect(idDocumentsNoticeFor({ entries: [entry()], idDocumentsNotice: notice })).toBeUndefined();
    expect(idDocumentsNoticeFor({ entries: [], idDocumentsNotice: notice })).toBeUndefined();
    // No notice given (a runner's own copy): none printed.
    expect(idDocumentsNoticeFor({ entries: [entry(signed("BV 123456"))] })).toBeUndefined();
  });
});
