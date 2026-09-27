import { describe, expect, it } from "vitest";
import {
  DIFFICULTY_BANDS,
  DIFFICULTY_LEVEL_COUNT,
  difficultyBandOf,
  difficultyLevel,
  difficultyLevelOf,
  difficultyStepOf,
  isDifficultyLevel,
  storedDifficulty,
} from "@/modules/events/domain/difficulty";
import { matchesListingFilter, NO_FILTER, parseListingFilter } from "@/modules/events/domain/listing-filter";

/**
 * BR-REQ-041-01 (`DECISIONS.md` §NNN) — the club's scale of fifteen: five bands (§412) of three
 * steps, one level 1 … 15, and the one reader of the two columns while the band still stands
 * beside the level.
 */
describe("§NNN the level is the band and the step", () => {
  it("numbers the fifteen levels band by band, easiest step first", () => {
    const all = DIFFICULTY_BANDS.flatMap((band) => [1, 2, 3].map((step) => difficultyLevel(band, step as 1 | 2 | 3)));
    expect(all).toEqual(Array.from({ length: 15 }, (_, index) => index + 1));
    expect(DIFFICULTY_LEVEL_COUNT).toBe(15);
  });

  it("puts a band with no step at its middle — what migration 0101 gave every band", () => {
    expect(DIFFICULTY_BANDS.map((band) => difficultyLevel(band))).toEqual([2, 5, 8, 11, 14]);
  });

  it("reads the band and the step back from any level", () => {
    for (let level = 1; level <= 15; level++) {
      expect(difficultyLevel(difficultyBandOf(level), difficultyStepOf(level))).toBe(level);
    }
    expect(difficultyBandOf(9)).toBe("MODERATE");
    expect(difficultyStepOf(9)).toBe(3);
    expect(difficultyBandOf(10)).toBe("HARD");
    expect(difficultyStepOf(10)).toBe(1);
  });

  it("knows the scale's ends and refuses what is off it", () => {
    expect(isDifficultyLevel(1)).toBe(true);
    expect(isDifficultyLevel(15)).toBe(true);
    for (const off of [0, 16, 2.5, "8", null, undefined, Number.NaN]) expect(isDifficultyLevel(off), String(off)).toBe(false);
    expect(() => difficultyBandOf(16)).toThrow(RangeError);
    expect(() => difficultyStepOf(0)).toThrow(RangeError);
  });

  it("writes a level with its band, and nothing as nothing", () => {
    expect(storedDifficulty(12)).toEqual({ difficulty: "HARD", difficultyLevel: 12 });
    expect(storedDifficulty(null)).toEqual({ difficulty: null, difficultyLevel: null });
  });
});

describe("§NNN difficultyLevelOf — the band says whether and where, the level refines it", () => {
  it("reads a level that agrees with its band", () => {
    expect(difficultyLevelOf({ difficulty: "HARD", difficultyLevel: 12 })).toBe(12);
    expect(difficultyLevelOf({ difficulty: "VERY_EASY", difficultyLevel: 1 })).toBe(1);
  });

  it("puts a band whose level is missing, absent or in another band at the band's middle", () => {
    expect(difficultyLevelOf({ difficulty: "MODERATE", difficultyLevel: null })).toBe(8);
    expect(difficultyLevelOf({ difficulty: "MODERATE" })).toBe(8);
    // The release before this one moved the band to EASY and left the level of HARD.
    expect(difficultyLevelOf({ difficulty: "EASY", difficultyLevel: 12 })).toBe(5);
  });

  it("has no difficulty without a band, whatever the level says", () => {
    expect(difficultyLevelOf({ difficulty: null, difficultyLevel: 12 })).toBeNull();
    expect(difficultyLevelOf({ difficulty: null, difficultyLevel: null })).toBeNull();
  });
});

describe("§NNN the listing's difficulty boxes tick a band — every step of it", () => {
  const event = (difficultyLevel: number | null) => ({
    type: "GROUP_RUN",
    surface: null,
    distanceMeters: null,
    costType: null,
    coHosts: null,
    coHostName: null,
    coHostUrl: null,
    ...storedDifficulty(difficultyLevel),
  });
  const facts = { night: () => false, door: () => false };

  it("«Greu» matches levels 10, 11 and 12 and nothing else", () => {
    const filter = parseListingFilter({ difficulty: "HARD" });
    expect(filter.difficulty).toEqual(["HARD"]);
    for (let level = 1; level <= 15; level++) {
      expect(matchesListingFilter(event(level), filter, facts), `level ${level}`).toBe(level >= 10 && level <= 12);
    }
    expect(matchesListingFilter(event(null), filter, facts)).toBe(false);
    expect(matchesListingFilter(event(null), NO_FILTER, facts)).toBe(true);
  });
});
