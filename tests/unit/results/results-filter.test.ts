import { describe, expect, it } from "vitest";
import { bibQuery, categoriesPresent, rowMatches } from "@/modules/results/ui/results-filter";

/**
 * §NNN, race results part 2 (BR-REQ-039-01) — what the «Clasament» section's small filter decides: which categories get a chip, in
 * what order, and which rows a chip and the number box leave standing. The island only hides what the server drew, so this rule is
 * all the logic there is.
 */
describe("categoriesPresent", () => {
  it("lists each category once, women then men, the youngest band first — the order of the club's own statistics", () => {
    expect(categoriesPresent(["MALE:from30", "FEMALE:from40", null, "FEMALE:under18", "MALE:from30", "FEMALE:from30", "MALE:under18"])).toEqual([
      "FEMALE:under18",
      "FEMALE:from30",
      "FEMALE:from40",
      "MALE:under18",
      "MALE:from30",
    ]);
  });

  it("gives no chip to a row without a category, and none at all when nobody has one", () => {
    expect(categoriesPresent([null, null, ""])).toEqual([]);
    expect(categoriesPresent([])).toEqual([]);
  });

  it("keeps a category stored by another version, last, rather than losing its chip", () => {
    expect(categoriesPresent(["MALE:from30", "OTHER:band", "FEMALE:from18"])).toEqual(["FEMALE:from18", "MALE:from30", "OTHER:band"]);
  });
});

describe("bibQuery", () => {
  it("keeps the digits and drops a leading zero, so «007» finds number 7 as «pad3» writes it", () => {
    expect(bibQuery("007")).toBe("7");
    expect(bibQuery(" #42 ")).toBe("42");
    expect(bibQuery("0")).toBe("0");
    expect(bibQuery("000")).toBe("0");
    expect(bibQuery("1 0 2")).toBe("102");
  });

  it("is no search at all for an empty box or letters", () => {
    expect(bibQuery("")).toBeNull();
    expect(bibQuery("   ")).toBeNull();
    expect(bibQuery("abc")).toBeNull();
  });
});

describe("rowMatches", () => {
  const ana = { category: "FEMALE:from30", bib: 101 };
  const dan = { category: "MALE:from30", bib: 42 };
  const nobody = { category: null, bib: 7 };

  it("keeps every row when nothing is chosen and nothing is typed", () => {
    for (const row of [ana, dan, nobody]) expect(rowMatches(row, { category: null, bib: "" })).toBe(true);
  });

  it("keeps the rows of the chosen category and hides the others, including a row with none", () => {
    expect(rowMatches(ana, { category: "FEMALE:from30", bib: "" })).toBe(true);
    expect(rowMatches(dan, { category: "FEMALE:from30", bib: "" })).toBe(false);
    expect(rowMatches(nobody, { category: "FEMALE:from30", bib: "" })).toBe(false);
  });

  it("keeps the numbers that contain what was typed — 42 finds 42 and 142, 4 finds both", () => {
    expect(rowMatches(dan, { category: null, bib: "42" })).toBe(true);
    expect(rowMatches({ category: null, bib: 142 }, { category: null, bib: "42" })).toBe(true);
    expect(rowMatches(ana, { category: null, bib: "42" })).toBe(false);
    expect(rowMatches(dan, { category: null, bib: "4" })).toBe(true);
    expect(rowMatches(nobody, { category: null, bib: "007" })).toBe(true);
  });

  it("asks for both at once: the chip AND the number", () => {
    expect(rowMatches(ana, { category: "FEMALE:from30", bib: "101" })).toBe(true);
    expect(rowMatches(ana, { category: "FEMALE:from30", bib: "42" })).toBe(false);
    expect(rowMatches(ana, { category: "MALE:from30", bib: "101" })).toBe(false);
  });

  it("treats letters in the box as no search, so a stray key never hides the whole table", () => {
    expect(rowMatches(ana, { category: null, bib: "a" })).toBe(true);
  });
});
