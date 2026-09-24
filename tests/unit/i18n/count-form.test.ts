import { describe, expect, it } from "vitest";
import { countForm } from "@/i18n/count-form";

/**
 * `DECISIONS.md` §341 — the owner, of a series row reading "Ciornă · 1 date": "ce înseamnă
 * această 1 ciornă?". Romanian's three plural forms, without ICU (`docs/VIBECODING.md`), picked
 * by a tiny pure function so every counted phrase in the catalogues reads as Romanian.
 */
describe("§341 countForm — which of Romanian's three plural forms a count takes", () => {
  it("is 'one' for exactly 1, in every locale", () => {
    expect(countForm(1, "ro")).toBe("one");
    expect(countForm(1, "en")).toBe("one");
  });

  it("is 'few' for 0 and 2–19 in Romanian", () => {
    expect(countForm(0, "ro")).toBe("few");
    expect(countForm(2, "ro")).toBe("few");
    expect(countForm(19, "ro")).toBe("few");
  });

  it("is 'other' from 20 up, and again for a last-two-digits of 00 or 20–99", () => {
    expect(countForm(20, "ro")).toBe("other");
    expect(countForm(21, "ro")).toBe("other");
    expect(countForm(100, "ro")).toBe("other");
  });

  it("reads 101 as 'few' — its last two digits, 01, are in the 01–19 band", () => {
    expect(countForm(101, "ro")).toBe("few");
  });

  it("has only 'one' and 'other' for a non-Romanian locale, the plural repeated under both", () => {
    for (const count of [0, 2, 19, 20, 21, 101]) {
      expect(countForm(count, "en")).toBe("other");
    }
  });

  it("reads a locale other than 'ro' as English, the site's only other language", () => {
    expect(countForm(2, "fr")).toBe("other");
  });
});

/*
  §346's fill line ("12 înscriși din 20 de locuri") had its own helper, which asked
  `Intl.PluralRules` rather than writing the rule out; the two answered alike and one is kept.
  Its fixed points follow, and the agreement it stood for is checked number by number.
*/
describe("§346 countForm — Romanian", () => {
  it("is singular for one, and for nothing else", () => {
    expect(countForm(1, "ro")).toBe("one");
  });

  it("reads nought with the plural — '0 înscriși', not a fourth wording", () => {
    expect(countForm(0, "ro")).toBe("few");
  });

  it("takes the 'no de' plural from two to nineteen", () => {
    for (const n of [2, 3, 12, 19]) expect(countForm(n, "ro"), String(n)).toBe("few");
  });

  it("takes the 'de' plural from twenty up", () => {
    for (const n of [20, 21, 50, 100]) expect(countForm(n, "ro"), String(n)).toBe("other");
  });

  it("falls back under twenty for the hundreds whose last two digits do — '101 înscriși'", () => {
    expect(countForm(101, "ro")).toBe("few");
    expect(countForm(119, "ro")).toBe("few");
  });

  it("takes the 'de' plural again once the last two digits reach twenty — '120 de locuri'", () => {
    expect(countForm(120, "ro")).toBe("other");
    expect(countForm(121, "ro")).toBe("other");
  });
});

describe("§346 countForm — English", () => {
  it("is singular for one and plural for everything else, including nought", () => {
    expect(countForm(1, "en")).toBe("one");
    expect(countForm(0, "en")).toBe("other");
    expect(countForm(2, "en")).toBe("other");
    expect(countForm(20, "en")).toBe("other");
  });

  it("never returns 'few' — the catalogues keep the key only because both locales share it", () => {
    for (const n of [0, 1, 2, 3, 11, 20, 100, 101]) expect(countForm(n, "en")).not.toBe("few");
  });
});

describe("§341/§346 countForm agrees with CLDR", () => {
  it("picks the key Intl.PluralRules names, collapsed to the three the catalogues carry, for 0–1000", () => {
    for (const locale of ["ro", "en"]) {
      const rule = new Intl.PluralRules(locale);
      for (let n = 0; n <= 1000; n++) {
        const category = rule.select(n);
        expect(countForm(n, locale), `${locale} ${n}`).toBe(category === "one" || category === "few" ? category : "other");
      }
    }
  });
});
