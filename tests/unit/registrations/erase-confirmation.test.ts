import { describe, expect, it } from "vitest";
import { eraseConfirmationMatches } from "@/modules/registrations/domain/erase-confirmation";

/**
 * BR-REQ-037-06, §180 — the typed name that stands between an Administrator and an erasure.
 *
 * Erasing from the registrations list is a different risk from erasing on somebody's own page:
 * twenty-five rows that re-sort under you, the row you meant one line from its neighbour, and
 * the same "⋮" menu on both. A dialog with a button is answered yes by reflex. A name that has
 * to be transcribed cannot be — and cannot be transcribed while looking at the wrong row, which
 * is the property these tests are about.
 *
 * The second property matters just as much: a guard nobody can satisfy is a guard that gets
 * removed. Romanian writes ș and ț three ways depending on the keyboard, so a check that
 * demanded the exact code points would leave the club with rows it was unable to erase.
 */
describe("BR-REQ-037-06 the typed name that confirms an erasure", () => {
  it("accepts the name exactly as the row shows it", () => {
    expect(eraseConfirmationMatches("Ana Popescu", "Ana Popescu")).toBe(true);
  });

  it("refuses a different person, which is the whole point of asking", () => {
    expect(eraseConfirmationMatches("Ana Popescu", "Ana Popa")).toBe(false);
    expect(eraseConfirmationMatches("Ana", "Ana Popescu")).toBe(false);
    expect(eraseConfirmationMatches("Popescu", "Ana Popescu")).toBe(false);
    // Every word, in order: a surname-first transcription is somebody working from a different
    // list than the one in front of them.
    expect(eraseConfirmationMatches("Popescu Ana", "Ana Popescu")).toBe(false);
  });

  it("refuses an empty field, whatever the row is called", () => {
    expect(eraseConfirmationMatches("", "Ana Popescu")).toBe(false);
    expect(eraseConfirmationMatches("   ", "Ana Popescu")).toBe(false);
  });

  /**
   * A registration with no name is not a licence to erase it by submitting nothing. There should
   * be no such row — `registeredName` is NOT NULL — but the guard must not be the thing that
   * assumes so.
   */
  it("refuses everything when the row itself has no name to match", () => {
    expect(eraseConfirmationMatches("", "")).toBe(false);
    expect(eraseConfirmationMatches("anything", "   ")).toBe(false);
  });

  it("forgives case, because a keyboard and a hurried hand disagree about it", () => {
    expect(eraseConfirmationMatches("ana popescu", "Ana Popescu")).toBe(true);
    expect(eraseConfirmationMatches("ANA POPESCU", "Ana Popescu")).toBe(true);
  });

  it("forgives the whitespace a name copied off the row arrives with", () => {
    expect(eraseConfirmationMatches("  Ana   Popescu ", "Ana Popescu")).toBe(true);
    expect(eraseConfirmationMatches("Ana Popescu", "  Ana  Popescu  ")).toBe(true);
  });

  /**
   * The one that would otherwise strand the club. `Ș` is U+0218 (comma below) on a Romanian
   * layout, `Ş` is U+015E (cedilla) on an older one, and a phone gives plain `S` — three ways to
   * write the same person. `admin-repository.ts` folds the same five letters when searching, for
   * the same reason.
   */
  it("forgives the three ways Romanian writes the same letter", () => {
    expect(eraseConfirmationMatches("Stefan Tanase", "Ștefan Tănase")).toBe(true);
    expect(eraseConfirmationMatches("Ştefan Tănase", "Ștefan Tănase")).toBe(true);
    expect(eraseConfirmationMatches("ștefan tănase", "Stefan Tanase")).toBe(true);
    expect(eraseConfirmationMatches("Andrei Mărginean", "Andrei Marginean")).toBe(true);
    // A name typed with a combining comma below rather than the precomposed letter looks
    // identical on screen and is a different string; NFD is what makes the two agree.
    expect(eraseConfirmationMatches("Ștefan", "Ștefan")).toBe(true);
  });

  it("still refuses a different name once the diacritics are folded away", () => {
    expect(eraseConfirmationMatches("Stefan Tanase", "Ștefan Tănăsescu")).toBe(false);
  });
});
