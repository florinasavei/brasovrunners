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
