import { describe, expect, it } from "vitest";
import {
  clubVocabulary,
  DEFAULT_PUBLIC_LIST_CLUB,
  memberClubCell,
  namesTheClub,
  PUBLIC_LIST_CLUBS,
  publicListClubOf,
} from "@/modules/registrations/domain/public-list-club";
import { CLUB_NAME } from "@/theme/brand";

/**
 * §753 and §756 (amending §32, §143 and §396) — «Clubul pe lista publică»: the matcher that decides whether a
 * typed club names the club itself. Case, diacritics, punctuation, spaces and filler words are folded; what
 * is left must be the club's own words, initials, short forms or nicknames and nothing else, and must name
 * the club; one typo is forgiven in a long word of the club's name; another club's name never matches.
 */
describe("§756 namesTheClub — what is the club's own name", () => {
  const SPELLED_IN = [
    CLUB_NAME,
    "brasov runners",
    "BRAȘOV RUNNERS",
    "Brașov Runners", // comma below
    "Braşov Runners", // cedilla
    "Brasov Runners Club",
    "Clubul Brașov Runners",
    "CLUB BRASOV RUNNERS",
    "Asociația Brașov Runners",
    "Asociatia Sportiva Brasov Runners",
    "ACS Brașov Runners",
    "AS Brasov Runners",
    "Echipa Brașov Runners",
    "Brașov Runners Team",
    "Brasov Runners Team",
    "Brașov-Runners",
    "BrasovRunners",
    "brasovrunners",
    "clubbrasovrunners",
    "  Brașov   Runners  ",
    "Brașov Runners.",
    "Brasov Runners!!!",
    "Brasov Runners 🏃",
    "Brașov Runner",
    "Brasov Runner's",
    "BVR",
    "bvr",
    "B.V.R.",
    "B V R",
    "BV Runners",
    "bvrunners",
    "BR Brașov",
    "br brasov",
    "Brasov BR",
    "Brașov Runners (BVR)",
    "BVR - Brasov Runners",
    "brasov runners / bvr",
    "Brașov Runners BVR",
    "Brasov Runers", // one letter dropped
    "Brashov Runners", // one letter added
    "Brasov Runnres", // two letters swapped
    "Brasob Runners", // one letter changed
    "brasovruners", // glued, with a typo
    "Brasov  R unners", // the club's exact word, only cut
    "Brasov Runners Romania",
    // The site's address typed as the club folds the same: a dot splits words like a space (no hostname here).
    "Brasovrunners ro",
    "brasovrunners / com",
    "Brașov Runners RO",
  ];

  for (const typed of SPELLED_IN) {
    it(`names the club: «${typed}»`, () => {
      expect(namesTheClub(typed)).toBe(true);
    });
  }

  const SPELLED_OUT = [
    "CS Rapid",
    "Runners",
    "Brașov",
    "BR",
    "BV",
    "Brasov Rangers",
    "Brasov Gunners", // one letter off, but the first one: another word
    "Brașov Running",
    "Brașov Trail Runners",
    "Cluj Runners",
    "Brașov Runners Cluj",
    "Runners Brașov Marathon Club Cluj",
    "Super Brașov Runners Fans",
    "Not Brasov Runners",
    "Brasov Runners 2",
    "Brasov Runners 2024", // a digit is never a letter of the name
    // A typo stays inside one typed word: a stray letter beside the name is not an «added letter».
    "Brasov Runners A",
    "Brasov Runners X",
    "brasov runners e",
    "B Brasov Runners",
    "Romania",
    "ro",
    "Brasil Runners",
    "Bravo Runners",
    "BVRS",
    "bvr2",
    "Runnersbrasov",
    "Runners Brașov",
    "Club",
    "Clubul",
    "Asociația Sportivă",
    "",
    "   ",
    "-",
    "ceva mizerii de fotbal",
    "Brașov Runners".repeat(8),
  ];

  for (const typed of SPELLED_OUT) {
    it(`does not name the club: «${typed.slice(0, 40)}»`, () => {
      expect(namesTheClub(typed)).toBe(false);
    });
  }

  it("forgives one typo in each long word, and no more than one in a word", () => {
    expect(namesTheClub("Brasoov Runnners")).toBe(true);
    expect(namesTheClub("Brasoovv Runners")).toBe(false);
    expect(namesTheClub("Brasov Runnnnners")).toBe(false);
  });

  it("names nobody for a missing value", () => {
    expect(namesTheClub(null)).toBe(false);
    expect(namesTheClub(undefined)).toBe(false);
  });

  it("derives the vocabulary from the configured name, and the short forms from the club's constants beside it", () => {
    const vocabulary = clubVocabulary("Alba Joggers");
    expect(namesTheClub("Alba Joggers", vocabulary)).toBe(true);
    expect(namesTheClub("alba jogger", vocabulary)).toBe(true);
    expect(namesTheClub("AJ Alba", vocabulary)).toBe(true);
    expect(namesTheClub("Alba Jogers", vocabulary)).toBe(true);
    expect(namesTheClub("Joggers", vocabulary)).toBe(false);
    // The platform's own club is another club under that configuration, its short forms too.
    expect(namesTheClub(CLUB_NAME, vocabulary)).toBe(false);
    expect(namesTheClub("BVR", vocabulary)).toBe(false);
    expect(namesTheClub("BV Joggers", vocabulary)).toBe(false);
    // Another club's short forms are given, never assumed.
    const withOwn = clubVocabulary("Alba Joggers", { city: "ab", nicknames: ["abj"] });
    expect(namesTheClub("ABJ", withOwn)).toBe(true);
    expect(namesTheClub("AB Joggers", withOwn)).toBe(true);
    expect(namesTheClub("AB", withOwn)).toBe(false);
    // A name of nothing but filler names nothing.
    expect(namesTheClub("Club", clubVocabulary("Club"))).toBe(false);
  });

  it("writes the club's own name in the cell, whoever typed it", () => {
    expect(memberClubCell("bvr")).toBe(CLUB_NAME);
    expect(memberClubCell("BRAȘOV   RUNNERS")).toBe(CLUB_NAME);
    expect(memberClubCell("Brasov Runers")).toBe(CLUB_NAME);
    expect(memberClubCell("CS Rapid")).toBeNull();
    expect(memberClubCell("alergam pe tavan")).toBeNull();
    expect(memberClubCell(null)).toBeNull();
  });
});

describe("§753 the event's mode", () => {
  it("offers three modes, the first the default", () => {
    expect(PUBLIC_LIST_CLUBS).toEqual(["members_only", "as_typed", "hidden"]);
    expect(DEFAULT_PUBLIC_LIST_CLUB).toBe("members_only");
  });

  it("reads a row without the setting, or with a value it does not know, as the default — the safe side of a disclosure", () => {
    expect(publicListClubOf(null)).toBe("members_only");
    expect(publicListClubOf(undefined)).toBe("members_only");
    expect(publicListClubOf({})).toBe("members_only");
    expect(publicListClubOf({ publicListClub: "something_else" })).toBe("members_only");
    expect(publicListClubOf({ publicListClub: "as_typed" })).toBe("as_typed");
    expect(publicListClubOf({ publicListClub: "hidden" })).toBe("hidden");
  });
});
