import { describe, expect, it } from "vitest";
import { AWARD_PLACES, type Awardable, awardsOf, DEFAULT_AWARD_RULES, isValidAwardPlaces } from "@/modules/results/domain/awards";

/**
 * §850, BR-REQ-050-02 — «Premii»: the podium by sex and in every category, read from the ranking's own positions, in the order the
 * awards are given; a tie shares a step; a group with nobody placed is left out.
 */
const row = (bibNumber: number, sex: Awardable["sex"], positionSex: number | null, positionCategory: number | null, categoryKey: string | null, name: string | null = `Runner ${bibNumber}`): Awardable => ({
  bibNumber,
  name,
  sex,
  gunTimeMs: 40 * 60_000 + bibNumber * 1000,
  positionSex,
  positionCategory,
  categoryKey,
});

describe("§850 awardsOf", () => {
  it("awards three places and the categories unless the race says otherwise, one to ten places", () => {
    expect(AWARD_PLACES).toBe(3);
    expect(DEFAULT_AWARD_RULES).toEqual({ places: 3, categories: true });
    expect([0, 1, 10, 11, 2.5].map(isValidAwardPlaces)).toEqual([false, true, true, false, false]);
  });

  it("lists the overall podium alone, five deep, for a race that awards «top 5 women and top 5 men»", () => {
    const rows = [1, 2, 3, 4, 5, 6].map((bib) => row(bib, "FEMALE", bib, bib, bib <= 3 ? "FEMALE:from30" : "FEMALE:from40"));
    rows.push(row(7, "MALE", 1, 1, "MALE:from30"));
    const groups = awardsOf(rows, { places: 5, categories: false });
    expect(groups.map((group) => (group.kind === "sex" ? `sex:${group.sex}` : group.key))).toEqual(["sex:FEMALE", "sex:MALE"]);
    expect(groups[0].rows.map((r) => r.position)).toEqual([1, 2, 3, 4, 5]);
    expect(awardsOf(rows, { places: 5, categories: true }).map((group) => (group.kind === "sex" ? `sex:${group.sex}` : group.key))).toEqual(["sex:FEMALE", "FEMALE:from30", "FEMALE:from40", "sex:MALE", "MALE:from30"]);
  });

  it("lists women then men, each sex's overall podium first and then its categories, youngest band first", () => {
    const groups = awardsOf([
      row(1, "MALE", 1, 1, "MALE:from40"),
      row(2, "FEMALE", 1, 1, "FEMALE:from30"),
      row(3, "FEMALE", 2, 1, "FEMALE:under18"),
      row(4, "FEMALE", 3, 2, "FEMALE:from30"),
      row(5, "FEMALE", 4, 3, "FEMALE:from30"),
      row(6, "MALE", 2, 1, "MALE:from18"),
    ]);
    expect(groups.map((group) => (group.kind === "sex" ? `sex:${group.sex}` : group.key))).toEqual(["sex:FEMALE", "FEMALE:under18", "FEMALE:from30", "sex:MALE", "MALE:from18", "MALE:from40"]);
    expect(groups[0].rows.map((r) => [r.position, r.bibNumber])).toEqual([[1, 2], [2, 3], [3, 4]]);
    expect(groups[2].rows.map((r) => [r.position, r.bibNumber])).toEqual([[1, 2], [2, 4], [3, 5]]);
    expect(groups[0].rows[0]).toEqual({ position: 1, bibNumber: 2, name: "Runner 2", gunTimeMs: 40 * 60_000 + 2000 });
  });

  it("stops after the places awarded, keeps a tie on the same step, and leaves out a group with nobody placed", () => {
    const groups = awardsOf([row(1, "MALE", 1, 1, "MALE:from30"), row(2, "MALE", 2, 2, "MALE:from30"), row(3, "MALE", 2, 2, "MALE:from30"), row(4, "MALE", 4, 4, "MALE:from30"), row(5, "MALE", null, null, "MALE:from30"), row(6, "FEMALE", null, null, null)]);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ kind: "sex", sex: "MALE" });
    expect(groups[0].rows.map((r) => [r.position, r.bibNumber])).toEqual([[1, 1], [2, 2], [2, 3]]);
    expect(groups[1]).toMatchObject({ kind: "category", key: "MALE:from30" });
    expect(awardsOf([], { places: 3, categories: true })).toEqual([]);
    expect(awardsOf([row(1, "MALE", 1, 1, "MALE:from30"), row(2, "MALE", 2, 2, "MALE:from30")], { places: 1, categories: true })[0].rows).toHaveLength(1);
  });

  it("keeps a nameless runner (an erased registration) on the podium by number, and a runner with no category only in the sex's podium", () => {
    const groups = awardsOf([row(1, "FEMALE", 1, null, null, null), row(2, "FEMALE", 2, 1, "FEMALE:from30")]);
    expect(groups.map((group) => (group.kind === "sex" ? `sex:${group.sex}` : group.key))).toEqual(["sex:FEMALE", "FEMALE:from30"]);
    expect(groups[0].rows[0]).toMatchObject({ bibNumber: 1, name: null });
    expect(groups[1].rows.map((r) => r.bibNumber)).toEqual([2]);
  });
});
