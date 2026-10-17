import { describe, expect, it } from "vitest";
import { categoryKeyOf, STATISTICS_AGE_BANDS } from "@/modules/registrations/statistics";
import { type Rankable, rankResults, RESULT_STATUSES, splitCategoryKey } from "@/modules/results/domain/ranking";

/**
 * §NNN, BR-REQ-050-02 — the rankings a save stores: overall among the finishers by gun time, by sex, by category (the Excel's
 * own bands, §787). Ties share the position and the next one skips; a runner who did not finish has none; a missing answer is
 * never guessed into a category.
 */
const MIN = 60_000;
const runner = (bibNumber: number, gunMinutes: number | null, sex: Rankable["sex"], ageOnRaceDay: number | null, status: Rankable["status"] = "FINISHED"): Rankable => ({
  bibNumber,
  status,
  gunTimeMs: gunMinutes === null ? null : gunMinutes * MIN,
  sex,
  ageOnRaceDay,
});

describe("§NNN rankResults — overall", () => {
  it("orders the finishers by gun time, fastest first", () => {
    const ranked = rankResults([runner(3, 50, "MALE", 30), runner(1, 40, "MALE", 30), runner(2, 45, "FEMALE", 30)]);
    expect([1, 2, 3].map((bib) => ranked.get(bib)?.positionOverall)).toEqual([1, 2, 3]);
  });

  it("shares a position between equal times and skips the next (1, 2, 2, 4)", () => {
    const ranked = rankResults([runner(1, 40, "MALE", 30), runner(2, 45, "MALE", 30), runner(3, 45, "MALE", 30), runner(4, 50, "MALE", 30)]);
    expect([1, 2, 3, 4].map((bib) => ranked.get(bib)?.positionOverall)).toEqual([1, 2, 2, 4]);
  });

  it("gives no position to a runner who did not finish, and counts none of them among the finishers", () => {
    const ranked = rankResults([runner(1, 40, "MALE", 30), runner(2, null, "MALE", 30, "DNF"), runner(3, null, "FEMALE", 30, "DNS"), runner(4, null, "MALE", 30, "DSQ"), runner(5, 41, "MALE", 30)]);
    expect(ranked.get(1)?.positionOverall).toBe(1);
    expect(ranked.get(5)?.positionOverall).toBe(2);
    for (const bib of [2, 3, 4]) {
      expect(ranked.get(bib), String(bib)).toMatchObject({ positionOverall: null, positionSex: null, positionCategory: null });
    }
  });

  it("is the same whatever order the rows come in", () => {
    const rows = [runner(5, 41, "MALE", 30), runner(1, 40, "MALE", 30), runner(2, 45, "FEMALE", 52), runner(3, 45, "FEMALE", 52)];
    const forward = rankResults(rows);
    const backward = rankResults([...rows].reverse());
    for (const bib of [1, 2, 3, 5]) expect(backward.get(bib), String(bib)).toEqual(forward.get(bib));
  });

  it("ranks an empty list as nothing", () => {
    expect(rankResults([]).size).toBe(0);
  });
});

describe("§NNN rankResults — by sex", () => {
  it("counts each sex apart, ties sharing as overall does", () => {
    const ranked = rankResults([runner(1, 40, "MALE", 30), runner(2, 41, "FEMALE", 30), runner(3, 42, "MALE", 30), runner(4, 42, "FEMALE", 30), runner(5, 50, "FEMALE", 30)]);
    expect([1, 3].map((bib) => ranked.get(bib)?.positionSex)).toEqual([1, 2]);
    expect([2, 4, 5].map((bib) => ranked.get(bib)?.positionSex)).toEqual([1, 2, 3]);
  });

  it("gives a finisher with no sex an overall position and none by sex or category", () => {
    const ranked = rankResults([runner(1, 40, null, 30), runner(2, 41, "MALE", 30)]);
    expect(ranked.get(1)).toMatchObject({ positionOverall: 1, positionSex: null, positionCategory: null, categoryKey: null });
    expect(ranked.get(2)).toMatchObject({ positionOverall: 2, positionSex: 1 });
  });
});

describe("§NNN rankResults — by category, the statistics' own bands", () => {
  it("is the sex and the band of the age on the race's day", () => {
    const ranked = rankResults([runner(1, 40, "FEMALE", 29), runner(2, 41, "FEMALE", 30), runner(3, 42, "FEMALE", 39), runner(4, 43, "FEMALE", 40), runner(5, 44, "MALE", 30)]);
    expect([1, 2, 3, 4, 5].map((bib) => ranked.get(bib)?.categoryKey)).toEqual(["FEMALE:from18", "FEMALE:from30", "FEMALE:from30", "FEMALE:from40", "MALE:from30"]);
    // Two women of 30 to 39: the faster is first in the category; the others are first of theirs.
    expect([1, 2, 3, 4, 5].map((bib) => ranked.get(bib)?.positionCategory)).toEqual([1, 1, 2, 1, 1]);
  });

  it("reuses the statistics' bands and never a table of its own: every band of §787 is a category", () => {
    for (const band of STATISTICS_AGE_BANDS) {
      const ranked = rankResults([runner(1, 40, "MALE", band.from)]);
      expect(ranked.get(1)?.categoryKey, band.key).toBe(`MALE:${band.key}`);
      expect(categoryKeyOf("MALE", band.from), band.key).toBe(`MALE:${band.key}`);
    }
  });

  it("gives no category to a runner with no age, but keeps the position by sex", () => {
    const ranked = rankResults([runner(1, 40, "FEMALE", null), runner(2, 41, "FEMALE", 35)]);
    expect(ranked.get(1)).toMatchObject({ positionOverall: 1, positionSex: 1, positionCategory: null, categoryKey: null });
    expect(ranked.get(2)).toMatchObject({ positionSex: 2, positionCategory: 1, categoryKey: "FEMALE:from30" });
  });

  it("keeps the category of a runner who did not finish, without a position in it", () => {
    const ranked = rankResults([runner(1, null, "MALE", 45, "DNF"), runner(2, 50, "MALE", 45)]);
    expect(ranked.get(1)).toMatchObject({ categoryKey: "MALE:from40", positionCategory: null });
    expect(ranked.get(2)).toMatchObject({ categoryKey: "MALE:from40", positionCategory: 1 });
  });
});

describe("§NNN the closed set and the stored key", () => {
  it("offers the four states in the order the select does", () => {
    expect(RESULT_STATUSES).toEqual(["FINISHED", "DNF", "DNS", "DSQ"]);
  });

  it("splits a stored key into its two halves, and a key nobody wrote into nothing", () => {
    expect(splitCategoryKey("FEMALE:from30")).toEqual({ sex: "FEMALE", band: "from30" });
    expect(splitCategoryKey("OTHER:from30")).toBeNull();
    expect(splitCategoryKey("MALE")).toBeNull();
    expect(splitCategoryKey(null)).toBeNull();
  });
});
