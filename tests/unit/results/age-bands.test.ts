import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { bandWordsFrom, categoryLabelOf } from "@/modules/results/category-words";
import {
  AGE_BAND_STARTS_MAX,
  ageBandStartsOf,
  bandBoundsOf,
  bandKeyOf,
  bandKeysOf,
  bandLabelOf,
  bandStartOf,
  categoryKeyOf,
  DEFAULT_AGE_BAND_STARTS,
  formatAgeBandStarts,
  isValidAgeBandStarts,
  parseAgeBandStarts,
  sameAgeBandStarts,
} from "@/modules/results/domain/age-bands";
import { rankResults } from "@/modules/results/domain/ranking";
import { categoriesPresent } from "@/modules/results/ui/results-filter";

/**
 * §850, BR-REQ-050-02 — a race's own age categories: the ages the bands start at, how the box that sets them is read, which band an
 * age falls in, what each band is called in both languages, and that the ranking, the words and the filter's order all follow the list.
 */
const statistics = (locale: "ro" | "en") => (key: string) => (locale === "ro" ? ro : en).Admin.registrations.statistics[key as "category"] as string;

describe("§850 the platform's bands are the statistics' (§787)", () => {
  it("are the ordinary ones of a road race, and a list the column does not hold reads as them", () => {
    expect(DEFAULT_AGE_BAND_STARTS).toEqual([18, 30, 40, 50, 60]);
    expect(ageBandStartsOf(null)).toEqual(DEFAULT_AGE_BAND_STARTS);
    expect(ageBandStartsOf(undefined)).toEqual(DEFAULT_AGE_BAND_STARTS);
    expect(ageBandStartsOf("18,30")).toEqual(DEFAULT_AGE_BAND_STARTS);
    expect(ageBandStartsOf([30, 18])).toEqual(DEFAULT_AGE_BAND_STARTS);
    expect(ageBandStartsOf([18, "30"])).toEqual(DEFAULT_AGE_BAND_STARTS);
    expect(ageBandStartsOf([])).toEqual(DEFAULT_AGE_BAND_STARTS);
    expect(ageBandStartsOf([18, 35, 45, 55])).toEqual([18, 35, 45, 55]);
  });

  it("holds one to twelve ascending whole ages between 1 and 99", () => {
    expect(isValidAgeBandStarts([18])).toBe(true);
    expect(isValidAgeBandStarts([1, 99])).toBe(true);
    expect(isValidAgeBandStarts([])).toBe(false);
    expect(isValidAgeBandStarts([0, 18])).toBe(false);
    expect(isValidAgeBandStarts([18, 100])).toBe(false);
    expect(isValidAgeBandStarts([18, 18])).toBe(false);
    expect(isValidAgeBandStarts([18.5])).toBe(false);
    expect(isValidAgeBandStarts(Array.from({ length: AGE_BAND_STARTS_MAX + 1 }, (_, index) => index + 1))).toBe(false);
  });
});

describe("§850 the «Categorii de vârstă» box", () => {
  it("reads ages separated by a comma, a semicolon, a space or a new line, in any order, and sorts them", () => {
    expect(parseAgeBandStarts("18, 35, 45, 55")).toEqual({ ok: true, starts: [18, 35, 45, 55] });
    expect(parseAgeBandStarts("55;18 45\n35")).toEqual({ ok: true, starts: [18, 35, 45, 55] });
    expect(parseAgeBandStarts(" 40 ")).toEqual({ ok: true, starts: [40] });
  });

  it("is the platform's bands when empty, so the column forgets the choice", () => {
    expect(parseAgeBandStarts("")).toEqual({ ok: true, starts: null });
    expect(parseAgeBandStarts("  \n ")).toEqual({ ok: true, starts: null });
  });

  it("names what is wrong and refuses the rest", () => {
    expect(parseAgeBandStarts("18, abc")).toEqual({ ok: false, problem: "notNumbers" });
    expect(parseAgeBandStarts("18-29")).toEqual({ ok: false, problem: "notNumbers" });
    expect(parseAgeBandStarts("18, 0")).toEqual({ ok: false, problem: "range" });
    expect(parseAgeBandStarts("18, 120")).toEqual({ ok: false, problem: "range" });
    expect(parseAgeBandStarts("18, 30, 18")).toEqual({ ok: false, problem: "order" });
    expect(parseAgeBandStarts(Array.from({ length: 13 }, (_, index) => index + 10).join(","))).toEqual({ ok: false, problem: "tooMany" });
  });

  it("writes a list back the way it was typed, and tells two lists apart", () => {
    expect(formatAgeBandStarts([18, 35, 45])).toBe("18, 35, 45");
    expect(sameAgeBandStarts([18, 30], [18, 30])).toBe(true);
    expect(sameAgeBandStarts([18, 30], [18, 35])).toBe(false);
    expect(sameAgeBandStarts([18], [18, 30])).toBe(false);
  });
});

describe("§850 which band an age is in", () => {
  it("is «under» the first start below it, else the last start reached — the key says where the band begins", () => {
    const starts = [18, 35, 45, 55];
    expect([10, 17, 18, 34, 35, 44, 45, 54, 55, 80].map((age) => bandKeyOf(age, starts))).toEqual(["under18", "under18", "from18", "from18", "from35", "from35", "from45", "from45", "from55", "from55"]);
    expect(bandKeyOf(null, starts)).toBeNull();
    expect(bandKeyOf(undefined, starts)).toBeNull();
    expect(bandKeyOf(-1, starts)).toBeNull();
  });

  it("gives the platform's keys under the platform's bands, so every stored category reads as before", () => {
    expect([13, 18, 29, 30, 40, 50, 60, 99].map((age) => bandKeyOf(age, DEFAULT_AGE_BAND_STARTS))).toEqual(["under18", "from18", "from18", "from30", "from40", "from50", "from60", "from60"]);
    expect(categoryKeyOf("FEMALE", 35, DEFAULT_AGE_BAND_STARTS)).toBe("FEMALE:from30");
    expect(categoryKeyOf("FEMALE", 35, [18, 35])).toBe("FEMALE:from35");
    expect(categoryKeyOf(null, 35, DEFAULT_AGE_BAND_STARTS)).toBeNull();
    expect(categoryKeyOf("MALE", null, DEFAULT_AGE_BAND_STARTS)).toBeNull();
  });

  it("lists every band of a race youngest first, and sorts a key by the age it starts at", () => {
    expect(bandKeysOf([18, 35, 45])).toEqual(["under18", "from18", "from35", "from45"]);
    expect(bandStartOf("under18")).toBe(-1);
    expect(bandStartOf("from35")).toBe(35);
    expect(bandStartOf("band")).toBe(Number.MAX_SAFE_INTEGER);
    expect(bandBoundsOf("under18", [18, 35])).toEqual({ from: null, to: 17 });
    expect(bandBoundsOf("from18", [18, 35])).toEqual({ from: 18, to: 34 });
    expect(bandBoundsOf("from35", [18, 35])).toEqual({ from: 35, to: null });
    expect(bandBoundsOf("x", [18, 35])).toBeNull();
  });
});

describe("§850 a band in words, in both languages", () => {
  it("says the band's ages from the race's list: the same key reads differently under different bands", () => {
    const ro_ = bandWordsFrom(statistics("ro"));
    const en_ = bandWordsFrom(statistics("en"));
    expect(bandLabelOf("under18", DEFAULT_AGE_BAND_STARTS, ro_)).toBe("sub 18 ani");
    expect(bandLabelOf("from30", DEFAULT_AGE_BAND_STARTS, ro_)).toBe("30-39 ani");
    expect(bandLabelOf("from60", DEFAULT_AGE_BAND_STARTS, ro_)).toBe("60+ ani");
    expect(bandLabelOf("from30", [18, 30, 45], ro_)).toBe("30-44 ani");
    expect(bandLabelOf("under16", [16, 40], en_)).toBe("under 16");
    expect(bandLabelOf("from40", [16, 40], en_)).toBe("40+");
    // A key of a band the race no longer has (stored before the bands changed, until the next save) reads as the ages it covers, not as a code.
    expect(bandLabelOf("from18", [16, 40], en_)).toBe("18-39");
    expect(bandLabelOf("band", [16, 40], en_)).toBe("band");
  });

  it("joins the sex and the band the way the statistics do, under the race's bands", () => {
    expect(categoryLabelOf("FEMALE:from35", statistics("ro"), [18, 35, 45, 55])).toBe("Feminin, 35-44 ani");
    expect(categoryLabelOf("MALE:from55", statistics("en"), [18, 35, 45, 55])).toBe("Male, 55+");
    expect(categoryLabelOf("FEMALE:from30", statistics("ro"))).toBe("Feminin, 30-39 ani");
  });
});

describe("§850 the ranking and the filter follow the race's bands", () => {
  const runner = (bibNumber: number, gunMinutes: number, sex: "FEMALE" | "MALE", ageOnRaceDay: number) => ({ bibNumber, status: "FINISHED" as const, gunTimeMs: gunMinutes * 60_000, sex, ageOnRaceDay });

  it("puts two women of 36 and 44 in one category under «18, 35, 45» and in two under the platform's bands", () => {
    const rows = [runner(1, 40, "FEMALE", 36), runner(2, 41, "FEMALE", 44)];
    const own = rankResults(rows, [18, 35, 45]);
    expect([1, 2].map((bib) => [own.get(bib)?.categoryKey, own.get(bib)?.positionCategory])).toEqual([["FEMALE:from35", 1], ["FEMALE:from35", 2]]);
    const platform = rankResults(rows);
    expect([1, 2].map((bib) => [platform.get(bib)?.categoryKey, platform.get(bib)?.positionCategory])).toEqual([["FEMALE:from30", 1], ["FEMALE:from40", 1]]);
  });

  it("orders the chips by the age a band starts at, whatever the bands are", () => {
    expect(categoriesPresent(["MALE:from35", "FEMALE:from55", "FEMALE:under16", "FEMALE:from35", "MALE:under16"])).toEqual(["FEMALE:under16", "FEMALE:from35", "FEMALE:from55", "MALE:under16", "MALE:from35"]);
  });
});
