import { describe, expect, it } from "vitest";
import {
  clubSpellings,
  DEFAULT_PUBLIC_LIST_CLUB,
  memberClubCell,
  namesTheClub,
  PUBLIC_LIST_CLUBS,
  publicListClubOf,
} from "@/modules/registrations/domain/public-list-club";
import { CLUB_NAME } from "@/theme/brand";

/**
 * §NNN (amending §32, §143 and §396) — «Clubul pe lista publică»: the matcher that decides whether a typed
 * club names the club itself. Case, diacritics, punctuation and spaces are folded; the club's usual short
 * forms count; a substring of another club's name never does.
 */
describe("§NNN namesTheClub — what is the club's own name", () => {
  const SPELLED_IN = [
    CLUB_NAME,
    "brasov runners",
    "BRAȘOV RUNNERS",
    "Brașov Runners", // comma below
    "Braşov Runners", // cedilla
    "Brasov Runners Club",
    "Clubul Brașov Runners",
    "Asociația Brașov Runners",
    "Brașov Runners Team",
    "Brașov-Runners",
    "BrasovRunners",
    "  Brașov   Runners  ",
    "Brașov Runners.",
    "Brașov Runner",
    "BVR",
    "bvr",
    "B.V.R.",
    "B V R",
    "BV Runners",
    "BR Brașov",
    "br brasov",
    "Brasov BR",
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
    "Brasov Rangers",
    "Cluj Runners",
    "Brașov Runners Cluj",
    "Super Brașov Runners Fans",
    "Not Brasov Runners",
    "BR",
    "BVRS",
    "bvr2",
    "Runnersbrasov",
    "Club",
    "Clubul",
    "",
    "   ",
    "-",
    "ceva mizerii de fotbal",
  ];

  for (const typed of SPELLED_OUT) {
    it(`does not name the club: «${typed}»`, () => {
      expect(namesTheClub(typed)).toBe(false);
    });
  }

  it("names nobody for a missing value", () => {
    expect(namesTheClub(null)).toBe(false);
    expect(namesTheClub(undefined)).toBe(false);
  });

  it("derives the spellings from the configured name, never from a literal in the code", () => {
    const spellings = clubSpellings("Alba Joggers");
    expect(namesTheClub("Alba Joggers", spellings)).toBe(true);
    expect(namesTheClub("alba jogger", spellings)).toBe(true);
    expect(namesTheClub("AJ Alba", spellings)).toBe(true);
    // The platform's own club is another club under that configuration.
    expect(namesTheClub(CLUB_NAME, spellings)).toBe(false);
    // And the club's own spellings include the name as configured.
    expect(clubSpellings().has("brasovrunners")).toBe(true);
  });

  it("writes the club's own name in the cell, whatever the member typed", () => {
    expect(memberClubCell("bvr")).toBe(CLUB_NAME);
    expect(memberClubCell("BRAȘOV   RUNNERS")).toBe(CLUB_NAME);
    expect(memberClubCell("CS Rapid")).toBeNull();
    expect(memberClubCell(null)).toBeNull();
  });
});

describe("§NNN the event's mode", () => {
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
