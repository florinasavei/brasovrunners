import { describe, expect, it } from "vitest";
import { mapLinkKey, placeKey, samePlace } from "@/modules/events/domain/same-place";

/**
 * BR-REQ-020-01 criterion 13 (`DECISIONS.md` §122, amended by §NNN) — two dates of a series are at
 * the same place when their map links are the same link, or their names say the same place once
 * read; a real move is still a move.
 *
 * The strings are the real ones. Happy Monday's dates were made with "Parcul Sportiv Tractorul –
 * intrarea dinspre Patinoarul Olimpic" (QA's copy of the series still reads so, with no map link);
 * a date saved later read "…, Brasov" with the map link, and was marked "Nu în locul obișnuit"
 * beside the dates it is the same entrance as. The English pages name it "Tractorul Sports Park –
 * entrance from the Olympic Ice Rink".
 */
const TRACTORUL = "Parcul Sportiv Tractorul – intrarea dinspre Patinoarul Olimpic";
const MAP = ["https:/", "maps.example.test", "vuCwrzFtgLTDE5H68"].join("/");
const OTHER_MAP = ["https:/", "maps.example.test", "rqrDhWj6JPqWAUNv5"].join("/");

const at = (locationName: string | null, mapUrl: string | null = null) => ({ locationName, mapUrl });

describe("§NNN the same place, written two ways, is the same place", () => {
  it("reads the owner's Happy Monday: the name with ', Brasov' after it is the name without", () => {
    expect(samePlace(at(`${TRACTORUL}, Brasov`, MAP), at(TRACTORUL))).toBe(true);
    expect(samePlace(at(TRACTORUL), at(`${TRACTORUL}, Brasov`, MAP))).toBe(true);
  });

  it("drops diacritics, the comma-below and the cedilla forms alike", () => {
    expect(samePlace(at(`${TRACTORUL}, Brașov`), at(`${TRACTORUL}, Brasov`))).toBe(true);
    // ş (s with cedilla, U+015F) is what a Romanian keyboard of the 1990s still types.
    expect(samePlace(at(`${TRACTORUL}, Braşov`), at(`${TRACTORUL}, Brașov`))).toBe(true);
    expect(samePlace(at("Stația de telecabină Tâmpa"), at("Statia de telecabina Tampa"))).toBe(true);
  });

  it("takes a longer address off the end: street, number, postcode, city, county, country", () => {
    expect(samePlace(at(`${TRACTORUL}, Strada Turnului 5, 500152 Brașov, România`), at(TRACTORUL))).toBe(true);
    expect(samePlace(at(`${TRACTORUL}, str. Turnului nr. 5, jud. Brașov`), at(`${TRACTORUL}, Brasov`))).toBe(true);
    expect(samePlace(at(`${TRACTORUL}, Bd. Eroilor, 500030, Romania`), at(TRACTORUL))).toBe(true);
    expect(placeKey(`${TRACTORUL}, Strada Turnului 5, 500152 Brașov, România`)).toBe(
      "parcul sportiv tractorul intrarea dinspre patinoarul olimpic",
    );
  });

  it("reads every dash, spacing and case as the same", () => {
    expect(samePlace(at("Parcul Sportiv Tractorul - intrarea dinspre Patinoarul Olimpic"), at(TRACTORUL))).toBe(true);
    expect(samePlace(at("Parcul Sportiv Tractorul — intrarea dinspre Patinoarul Olimpic"), at(TRACTORUL))).toBe(true);
    expect(samePlace(at("  parcul sportiv  TRACTORUL –intrarea dinspre patinoarul olimpic "), at(TRACTORUL))).toBe(true);
    // A comma inside the place reads like the dash it replaces.
    expect(samePlace(at("Parcul Sportiv Tractorul, intrarea dinspre Patinoarul Olimpic"), at(TRACTORUL))).toBe(true);
  });

  it("compares the English names on the English page the same way", () => {
    expect(
      samePlace(at("Tractorul Sports Park – entrance from the Olympic Ice Rink, Brasov, Romania"), at("Tractorul Sports Park - entrance from the Olympic Ice Rink")),
    ).toBe(true);
  });

  it("is the same place when the map link is the same link, whatever the names say", () => {
    expect(samePlace(at("Tractorul", MAP), at(TRACTORUL, MAP))).toBe(true);
    // A share button's own parameter, a trailing slash, "www." and the host's case are not the place.
    expect(samePlace(at("Tractorul", `${MAP}?g_st=ic`), at(TRACTORUL, `${MAP}/`))).toBe(true);
    expect(mapLinkKey(`${MAP}?g_st=iw&utm_source=share#x`)).toBe(mapLinkKey(MAP));
    expect(mapLinkKey(["https:/", "WWW.Maps.Example.test", "place?q=45.64,25.60"].join("/"))).toBe("maps.example.test/place?q=45.64%2C25.60");
    expect(mapLinkKey("not a link")).toBeNull();
    expect(mapLinkKey(null)).toBeNull();
  });
});

describe("§NNN a real move is still a move", () => {
  it("marks a different park", () => {
    expect(samePlace(at("Parcul Noua"), at(TRACTORUL))).toBe(false);
    expect(samePlace(at("Stația de telecabină Tâmpa, Brașov"), at(`${TRACTORUL}, Brasov`))).toBe(false);
  });

  it("marks a different entrance of the same park, dash or comma", () => {
    expect(samePlace(at("Parcul Sportiv Tractorul – intrarea dinspre Strada Turnului"), at(TRACTORUL))).toBe(false);
    // "intrarea de nord" is no address part: an entrance after a comma is still a difference.
    expect(samePlace(at("Parcul Tractorul, intrarea de nord"), at("Parcul Tractorul"))).toBe(false);
  });

  it("marks a different street given as the whole name, and a different kilometre", () => {
    expect(samePlace(at("Strada Turnului 5"), at("Strada Lungă 12"))).toBe(false);
    expect(samePlace(at("Drumul Poienii, km 3"), at("Drumul Poienii, km 7"))).toBe(false);
  });

  it("does not call two different map links the same place when the names differ", () => {
    expect(samePlace(at("Parcul Noua", OTHER_MAP), at(TRACTORUL, MAP))).toBe(false);
  });

  it("keeps the first part even when it looks like an address", () => {
    // "Brașov" alone is a place name, not an empty key.
    expect(placeKey("Brașov, România")).toBe("brasov");
    expect(samePlace(at("Brașov"), at("Brasov, Romania"))).toBe(true);
    expect(samePlace(at(null), at(null))).toBe(false);
  });
});
