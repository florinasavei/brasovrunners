import { describe, expect, it } from "vitest";
import {
  DIFFICULTY_BANDS,
  DIFFICULTY_LEVEL_COUNT,
  difficultyBandOf,
  difficultyLevel,
  difficultyLevelOf,
  difficultyStepOf,
  isDifficultyLevel,
  legacyDifficultyOf,
  storedDifficulty,
} from "@/modules/events/domain/difficulty";
import { matchesListingFilter, NO_FILTER, parseListingFilter } from "@/modules/events/domain/listing-filter";

/**
 * BR-REQ-041-01 (`DECISIONS.md` §526) — the club's scale of fifteen: the owner's five bands, «ușor,
 * mediu, greuț, greu, foarte greu», of three steps each, one level 1 … 15 and the one column read.
 */
describe("§526 the level is the band and the step", () => {
  it("has the owner's five bands, in order", () => {
    expect([...DIFFICULTY_BANDS]).toEqual(["EASY", "MEDIUM", "FAIRLY_HARD", "HARD", "VERY_HARD"]);
  });

  it("numbers the fifteen levels band by band, easiest step first", () => {
    const all = DIFFICULTY_BANDS.flatMap((band) => [1, 2, 3].map((step) => difficultyLevel(band, step as 1 | 2 | 3)));
    expect(all).toEqual(Array.from({ length: 15 }, (_, index) => index + 1));
    expect(DIFFICULTY_LEVEL_COUNT).toBe(15);
  });

  it("derives the band as ceil(level / 3) and the step from the level alone, round-tripping 1 … 15", () => {
    for (let level = 1; level <= 15; level++) {
      expect(DIFFICULTY_BANDS.indexOf(difficultyBandOf(level)) + 1, `level ${level}`).toBe(Math.ceil(level / 3));
      expect(difficultyLevel(difficultyBandOf(level), difficultyStepOf(level))).toBe(level);
      expect(difficultyLevelOf({ difficultyLevel: level })).toBe(level);
      expect(difficultyLevelOf(storedDifficulty(level))).toBe(level);
    }
    expect([difficultyBandOf(4), difficultyStepOf(4)]).toEqual(["MEDIUM", 1]);
    expect([difficultyBandOf(9), difficultyStepOf(9)]).toEqual(["FAIRLY_HARD", 3]);
    expect([difficultyBandOf(10), difficultyStepOf(10)]).toEqual(["HARD", 1]);
  });

  it("knows the scale's ends and refuses what is off it", () => {
    expect(isDifficultyLevel(1)).toBe(true);
    expect(isDifficultyLevel(15)).toBe(true);
    for (const off of [0, 16, 2.5, "8", null, undefined, Number.NaN]) expect(isDifficultyLevel(off), String(off)).toBe(false);
    expect(() => difficultyBandOf(16)).toThrow(RangeError);
    expect(() => difficultyStepOf(0)).toThrow(RangeError);
  });
});

describe("§526 difficultyLevelOf reads the level column alone", () => {
  it("has no difficulty when the level is null, absent (a cached row) or off the scale", () => {
    expect(difficultyLevelOf({ difficultyLevel: null })).toBeNull();
    expect(difficultyLevelOf({})).toBeNull();
    expect(difficultyLevelOf({ difficultyLevel: 16 })).toBeNull();
  });

  it("never reads the retired column, whatever it holds", () => {
    const row = { difficulty: "VERY_EASY", difficultyLevel: 14 } as const;
    expect(difficultyLevelOf(row)).toBe(14);
    expect(difficultyLevelOf({ difficulty: "HARD", difficultyLevel: null } as { difficultyLevel: null })).toBeNull();
  });
});

describe("§526 the retired column gets a best-effort word, the inverse of migration 0104", () => {
  it("maps every backfilled level back to the word it came from", () => {
    expect([1, 2, 5, 11, 14].map(legacyDifficultyOf)).toEqual(["VERY_EASY", "EASY", "MODERATE", "HARD", "VERY_HARD"]);
  });

  it("writes a word for every level, «greuț» as the old HARD, and nothing as nothing", () => {
    expect(Array.from({ length: 15 }, (_, index) => legacyDifficultyOf(index + 1))).toEqual([
      "VERY_EASY", "EASY", "EASY",
      "MODERATE", "MODERATE", "MODERATE",
      "HARD", "HARD", "HARD",
      "HARD", "HARD", "HARD",
      "VERY_HARD", "VERY_HARD", "VERY_HARD",
    ]);
    expect(storedDifficulty(8)).toEqual({ difficulty: "HARD", difficultyLevel: 8 });
    expect(storedDifficulty(null)).toEqual({ difficulty: null, difficultyLevel: null });
  });
});

describe("§526 the listing's difficulty boxes tick a band — every step of it", () => {
  const event = (difficultyLevel: number | null) => ({
    type: "GROUP_RUN",
    surface: null,
    distanceMeters: null,
    costType: null,
    coHosts: null,
    coHostName: null,
    coHostUrl: null,
    difficultyLevel,
  });
  const facts = { night: () => false, door: () => false };

  it("«Greuț» matches levels 7, 8 and 9 and nothing else", () => {
    const filter = parseListingFilter({ difficulty: "FAIRLY_HARD" });
    expect(filter.difficulty).toEqual(["FAIRLY_HARD"]);
    for (let level = 1; level <= 15; level++) {
      expect(matchesListingFilter(event(level), filter, facts), `level ${level}`).toBe(level >= 7 && level <= 9);
    }
    expect(matchesListingFilter(event(null), filter, facts)).toBe(false);
    expect(matchesListingFilter(event(null), NO_FILTER, facts)).toBe(true);
  });
});
