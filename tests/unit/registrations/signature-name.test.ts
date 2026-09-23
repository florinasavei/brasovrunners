import { describe, expect, it } from "vitest";
import { foldName } from "@/modules/registrations/domain/name-fold";
import { expectedSignatureName, signatureNameMatches } from "@/modules/registrations/domain/signature-name";

/**
 * BR-REQ-033-02 criterion 15, §314 — the signature is the declarant's name, typed exactly.
 *
 * The owner, looking at a signature of "Florin Munca2" under "You registered as Florin Munca":
 * "can I also have this validation here? So I have to type the exact name?" This reverses the
 * "a hint, not a validation" half of §283.
 *
 * "Exactly" has to survive a phone keyboard, or the check becomes the thing that stops somebody
 * entering a race: case, runs of whitespace, diacritics — Romanian writes ș three ways — and the
 * typographic shape of an apostrophe are forgiven. Everything that makes it a different name is
 * not: a letter, a digit, a hyphen, an apostrophe, a missing or extra word, the order.
 *
 * The browser's live check imports this same function, so these cases are the browser's too.
 */
describe("BR-REQ-033-02 §314 the signature must be the declarant's exact name", () => {
  it("accepts the name exactly as registered", () => {
    expect(signatureNameMatches("Florin Munca", "Florin Munca")).toBe(true);
  });

  it("refuses an extra character — the signature the owner saw", () => {
    expect(signatureNameMatches("Florin Munca2", "Florin Munca")).toBe(false);
    expect(signatureNameMatches("Florin Munca.", "Florin Munca")).toBe(false);
  });

  it("refuses the names in another order", () => {
    expect(signatureNameMatches("Munca Florin", "Florin Munca")).toBe(false);
  });

  it("refuses a missing or an extra name", () => {
    expect(signatureNameMatches("Florin", "Florin Munca")).toBe(false);
    expect(signatureNameMatches("Munca", "Florin Munca")).toBe(false);
    expect(signatureNameMatches("Florin Ion Munca", "Florin Munca")).toBe(false);
  });

  it("keeps a hyphen a hyphen: Ana Maria is not Ana-Maria", () => {
    expect(signatureNameMatches("Ana Maria Pop", "Ana-Maria Pop")).toBe(false);
    expect(signatureNameMatches("Ana-Maria Pop", "Ana Maria Pop")).toBe(false);
    expect(signatureNameMatches("AnaMaria Pop", "Ana-Maria Pop")).toBe(false);
    expect(signatureNameMatches("ana-maria pop", "Ana-Maria Pop")).toBe(true);
  });

  it("keeps digits and apostrophes: they are part of the name", () => {
    expect(signatureNameMatches("Ion Pop 2", "Ion Pop 2")).toBe(true);
    expect(signatureNameMatches("Ion Pop", "Ion Pop 2")).toBe(false);
    expect(signatureNameMatches("OBrien Sean", "O'Brien Sean")).toBe(false);
  });

  it("forgives case and the whitespace around and between the names", () => {
    expect(signatureNameMatches("florin  munca ", "Florin Munca")).toBe(true);
    expect(signatureNameMatches("FLORIN MUNCA", "Florin Munca")).toBe(true);
    expect(signatureNameMatches("  Florin\tMunca", "Florin Munca")).toBe(true);
    // The non-breaking space a phone's autocorrection leaves behind.
    expect(signatureNameMatches("Florin\u00A0Munca", "Florin Munca")).toBe(true);
  });

  /**
   * `Ș` is U+0218 (comma below) on a Romanian layout, `Ş` U+015E (cedilla) on an older one, and a
   * phone gives plain `S`; a name can also arrive decomposed, as a letter plus a combining mark.
   * Four strings, one person.
   */
  it("forgives the ways Romanian writes the same letter", () => {
    expect(signatureNameMatches("Ștefan", "Ștefan")).toBe(true);
    expect(signatureNameMatches("Stefan", "Ștefan")).toBe(true);
    expect(signatureNameMatches("\u015ETEFAN", "Ștefan")).toBe(true); // U+015E, the cedilla
    expect(signatureNameMatches("\u015Ftefan", "Ștefan")).toBe(true); // U+015F
    expect(signatureNameMatches("S\u0326tefan", "Ștefan")).toBe(true); // decomposed, comma below
    expect(signatureNameMatches("Ștefan Tănase", "Stefan Tanase")).toBe(true);
    expect(signatureNameMatches("tutu ala", "Țuțu Ăla")).toBe(true);
    expect(signatureNameMatches("Ioana Mărginean", "IOANA MARGINEAN")).toBe(true);
    // Folding the marks does not make two different names one.
    expect(signatureNameMatches("Stefan Tanase", "Ștefan Tănăsescu")).toBe(false);
  });

  it("forgives the shape of an apostrophe, never its absence", () => {
    // An iPhone turns ' into ’ by itself; the registration may have been typed on a laptop.
    expect(signatureNameMatches("O\u2019Brien Sean", "O'Brien Sean")).toBe(true);
    expect(signatureNameMatches("O'Brien Sean", "O\u2019Brien Sean")).toBe(true);
    // A Unicode hyphen is a hyphen; a space is not.
    expect(signatureNameMatches("Ana\u2010Maria Pop", "Ana-Maria Pop")).toBe(true);
  });

  it("forgives characters nobody can see", () => {
    expect(signatureNameMatches("Florin\u200B Munca", "Florin Munca")).toBe(true);
    expect(signatureNameMatches("Flo\u00ADrin Munca", "Florin Munca")).toBe(true);
  });

  it("refuses a blank signature, whatever the expected name", () => {
    expect(signatureNameMatches("", "Florin Munca")).toBe(false);
    expect(signatureNameMatches("   ", "Florin Munca")).toBe(false);
    // And a registration with no name to match is not a licence to sign with nothing.
    expect(signatureNameMatches("", "")).toBe(false);
    expect(signatureNameMatches("anything", "  ")).toBe(false);
  });

  it("folds, and does not rewrite what is kept: the fold is for comparing only", () => {
    expect(foldName("  Ștefan   O\u2019Brien-Tănase ")).toBe("stefan o'brien-tanase");
  });
});

describe("BR-REQ-033-02 §314 §108 whose name the signature must be", () => {
  it("is the participant's own name for an adult", () => {
    expect(expectedSignatureName({ registeredName: "Florin Munca", guardianName: null })).toBe("Florin Munca");
  });

  it("is the parent's or guardian's for a minor — the parent signs", () => {
    const minor = { registeredName: "Maria Popescu", guardianName: "Ion Popescu" };
    expect(expectedSignatureName(minor)).toBe("Ion Popescu");
    expect(signatureNameMatches("Ion Popescu", expectedSignatureName(minor))).toBe(true);
    expect(signatureNameMatches("Maria Popescu", expectedSignatureName(minor))).toBe(false);
  });
});
