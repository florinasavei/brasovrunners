import { describe, expect, it } from "vitest";
import { numberForm } from "@/i18n/number-form";

/**
 * §NNN — which of a counted phrase's three keys (`one`, `few`, `other`) a number reads with.
 *
 * The catalogues carry no ICU plurals (`docs/VIBECODING.md`), so every counted sentence is
 * three message keys and this is what chooses among them. It wraps `Intl.PluralRules`, which is
 * CLDR and therefore already knows Romanian's "de" rule — these are fixed points against that
 * platform behaviour, not a reimplementation of it, so what is under test is the two things
 * this file adds: collapsing CLDR's five-way Romanian split into the three keys the catalogues
 * carry, and reading nought as a plural rather than as its own fourth case.
 */
describe("§NNN numberForm — Romanian", () => {
  it("is singular for one, and for nothing else", () => {
    expect(numberForm("ro", 1)).toBe("one");
  });

  it("reads nought with the plural — '0 înscriși', not a fourth wording", () => {
    expect(numberForm("ro", 0)).toBe("few");
  });

  it("takes the 'no de' plural from two to nineteen", () => {
    for (const n of [2, 3, 12, 19]) expect(numberForm("ro", n), String(n)).toBe("few");
  });

  it("takes the 'de' plural from twenty up", () => {
    for (const n of [20, 21, 50, 100]) expect(numberForm("ro", n), String(n)).toBe("other");
  });

  it("falls back under twenty for the hundreds whose last two digits do — '101 înscriși'", () => {
    expect(numberForm("ro", 101)).toBe("few");
    expect(numberForm("ro", 119)).toBe("few");
  });

  it("takes the 'de' plural again once the last two digits reach twenty — '120 de locuri'", () => {
    expect(numberForm("ro", 120)).toBe("other");
    expect(numberForm("ro", 121)).toBe("other");
  });
});

describe("§NNN numberForm — English", () => {
  it("is singular for one and plural for everything else, including nought", () => {
    expect(numberForm("en", 1)).toBe("one");
    expect(numberForm("en", 0)).toBe("other");
    expect(numberForm("en", 2)).toBe("other");
    expect(numberForm("en", 20)).toBe("other");
  });

  it("never returns 'few' — the catalogues keep the key only because both locales share it", () => {
    for (const n of [0, 1, 2, 3, 11, 20, 100, 101]) expect(numberForm("en", n)).not.toBe("few");
  });
});
