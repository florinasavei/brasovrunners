import { describe, expect, it } from "vitest";
import {
  COORDINATES_BOX,
  COORDINATES_TEXT_MAX,
  type Coordinates,
  CoordinatesRefusal,
  formatCoordinates,
  mapUrlOf,
  parseCoordinates,
} from "@/modules/event-checkpoints/domain/coordinates";
import { isDomainError } from "@/shared/errors/domain-error";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";

/**
 * §NNN, BR-REQ-050-02 — where a point of the volunteers' plan is (the owner, 2026-11-17: «să pun nume punct și la ce km e și
 * coordonate punct»): what a person pastes from a maps application is read into a latitude and a longitude of six decimals,
 * or refused with the sentence that says how to write them; the pair is written back one way; and the address that opens
 * it on a map is Google Maps' own. Pure: no database, no network — a link is read for the numbers it carries and never
 * followed.
 */
const PIATA: Coordinates = { latitude: 45.64271, longitude: 25.58871 };

/** What `parseCoordinates` does with a text: the pair, null for «none», or the refusal's reason and the box it names. */
function read(text: string): Coordinates | null | { refused: string; fields: readonly string[] } {
  try {
    return parseCoordinates(text);
  } catch (error) {
    if (!(error instanceof CoordinatesRefusal)) throw error;
    return { refused: error.reason, fields: error.fields };
  }
}
const REFUSED = { refused: "COORDINATES_INVALID", fields: [COORDINATES_BOX] };

describe("§NNN parseCoordinates: what a person pastes from a maps application", () => {
  it.each<[string, string, Coordinates]>([
    ["the shape Google Maps copies", "45.64271, 25.58871", PIATA],
    ["no space after the comma", "45.64271,25.58871", PIATA],
    ["a space between the two", "45.64271 25.58871", PIATA],
    ["several spaces, a tab and a line break", "  45.64271 \t\n 25.58871  ", PIATA],
    ["a semicolon between the two", "45.64271; 25.58871", PIATA],
    ["a semicolon and no space", "45.64271;25.58871", PIATA],
    ["brackets around the pair", "(45.64271, 25.58871)", PIATA],
    ["square brackets around the pair", "[45.64271, 25.58871]", PIATA],
    ["a no-break space, as a copied text may carry", "45.64271, 25.58871", PIATA],
    ["more decimals than are kept, as a computer copies them", "45.642710234567891, 25.588709876543211", PIATA],
    ["the seventh decimal rounded", "45.6427149, 25.5887151", { latitude: 45.642715, longitude: 25.588715 }],
    ["whole numbers", "45, 25", { latitude: 45, longitude: 25 }],
    ["a plus sign", "+45.64271, +25.58871", PIATA],
    ["the south and the west by their signs", "-33.86882, -70.66927", { latitude: -33.86882, longitude: -70.66927 }],
    ["a true minus sign, as a typeset text has it", "−33.86882, 151.2093", { latitude: -33.86882, longitude: 151.2093 }],
    ["the ends of both ranges", "90, -180", { latitude: 90, longitude: -180 }],
    ["the other ends", "-90, 180", { latitude: -90, longitude: 180 }],
    ["the equator at Greenwich", "0, 0", { latitude: 0, longitude: 0 }],
    ["zero written with a minus", "-0.0, -0", { latitude: 0, longitude: 0 }],
  ])("reads %s", (_what, text, expected) => {
    expect(read(text)).toEqual(expected);
  });

  it.each<[string, string, Coordinates]>([
    ["decimal commas with a semicolon between", "45,64271; 25,58871", PIATA],
    ["decimal commas with a space between", "45,64271 25,58871", PIATA],
    ["decimal commas, a comma and a space between", "45,64271, 25,58871", PIATA],
    ["decimal commas and a semicolon, no space", "45,64271;25,58871", PIATA],
    ["four runs of digits joined by commas alone: the middle comma parts them", "45,64271,25,58871", PIATA],
    ["the same with signs", "-33,86882,-70,66927", { latitude: -33.86882, longitude: -70.66927 }],
    ["one number with a point and one with a comma", "45.64271, 25,58871", PIATA],
  ])("reads %s", (_what, text, expected) => {
    expect(read(text)).toEqual(expected);
  });

  it.each<[string, string, Coordinates]>([
    ["a degree sign and letters", "45.64271° N, 25.58871° E", PIATA],
    ["letters with no degree sign and no space", "45.64271N 25.58871E", PIATA],
    ["small letters", "45.64271° n, 25.58871° e", PIATA],
    ["degree signs and no letters", "45.64271°, 25.58871°", PIATA],
    ["the masculine ordinal a keyboard gives for a degree", "45.64271º N, 25.58871º E", PIATA],
    ["letters before the numbers", "N 45.64271, E 25.58871", PIATA],
    ["letters before the numbers, no space", "N45.64271 E25.58871", PIATA],
    ["south and west by their letters", "33.86882° S, 70.66927° W", { latitude: -33.86882, longitude: -70.66927 }],
    ["«V», the Romanian for west", "45.64271° N, 25.58871° V", { latitude: 45.64271, longitude: -25.58871 }],
    ["the longitude first, as the letters say", "25.58871° E, 45.64271° N", PIATA],
    ["a letter on the longitude alone: the other is the latitude", "45.64271, 25.58871 E", PIATA],
    ["a letter on the first number alone, the longitude", "25.58871 E 45.64271", PIATA],
    ["decimal commas with letters", "45,64271° N, 25,58871° E", PIATA],
    ["decimal commas with letters and no space", "45,64271°N,25,58871°E", PIATA],
  ])("reads %s", (_what, text, expected) => {
    expect(read(text)).toEqual(expected);
  });

  it.each<[string, string, Coordinates]>([
    ["degrees, minutes and seconds as Google Maps shows them on a computer", `45°38'33.8"N 25°35'19.4"E`, { latitude: 45.642722, longitude: 25.588722 }],
    ["the same with spaces and a comma", `45° 38' 33.8" N, 25° 35' 19.4" E`, { latitude: 45.642722, longitude: 25.588722 }],
    ["typographic marks for minutes and seconds", "45°38′33.8″N 25°35′19.4″E", { latitude: 45.642722, longitude: 25.588722 }],
    ["two apostrophes for the seconds", "45°38'33.8''N 25°35'19.4''E", { latitude: 45.642722, longitude: 25.588722 }],
    ["a decimal comma in the seconds", `45°38'33,8"N 25°35'19,4"E`, { latitude: 45.642722, longitude: 25.588722 }],
    ["south and west", `33°52'7.8"S 70°40'9.4"W`, { latitude: -33.868833, longitude: -70.669278 }],
    ["degrees and decimal minutes", "45°38.563'N 25°35.323'E", { latitude: 45.642717, longitude: 25.588717 }],
    ["no letters: the latitude first", `45°38'33.8" 25°35'19.4"`, { latitude: 45.642722, longitude: 25.588722 }],
    ["whole minutes and no seconds", "45°30' N, 25°15' E", { latitude: 45.5, longitude: 25.25 }],
  ])("reads %s", (_what, text, expected) => {
    expect(read(text)).toEqual(expected);
  });

  it.each<[string, string, Coordinates]>([
    ["a geo address", "geo:45.64271,25.58871", PIATA],
    ["a geo address in capitals", "GEO:45.64271,25.58871", PIATA],
    ["a geo address with a zoom", "geo:45.64271,25.58871?z=17", PIATA],
    ["a geo address with a height and an uncertainty", "geo:45.64271,25.58871,560;u=35", PIATA],
    ["a geo address whose place is its q, the address itself a placeholder", "geo:0,0?q=45.64271,25.58871(Start)", PIATA],
    ["a link made by pressing on the map: its centre", "https://www.google.com/maps/@45.64271,25.58871,17z", PIATA],
    ["Google Maps' own «open this place»", "https://www.google.com/maps/search/?api=1&query=45.64271%2C25.58871", PIATA],
    ["a q parameter", "https://maps.google.com/?q=45.64271,25.58871", PIATA],
    ["a q parameter with loc: before the pair", "https://maps.google.com/maps?q=loc:45.64271,25.58871", PIATA],
    ["a q parameter with a plus for the space", "https://maps.google.com/?q=45.64271,+25.58871&z=17", PIATA],
    ["an ll parameter, the q being a name", "https://maps.apple.com/?ll=45.64271,25.58871&q=Dropped%20Pin", PIATA],
    ["a destination parameter", "https://www.google.com/maps/dir/?api=1&destination=45.64271%2C25.58871&travelmode=walking", PIATA],
    ["the q before the ll: the place before the map's centre", "https://maps.google.com/?ll=45.7,25.6&q=45.64271,25.58871", PIATA],
    ["a link with no scheme", "www.google.com/maps/@45.64271,25.58871,17z", PIATA],
    ["a host and a path with no scheme and no www", "google.com/maps/@45.64271,25.58871,17z", PIATA],
    ["the place written as the address's own path", "https://www.google.com/maps/place/45.64271,25.58871", PIATA],
    ["a search for the pair", "https://www.google.com/maps/search/45.64271,+25.58871", PIATA],
    [
      "a dropped pin's address on a computer: the pin's own numbers, not the map's centre beside it",
      "https://www.google.com/maps/place/45%C2%B038'33.8%22N+25%C2%B035'19.4%22E/@45.6427222,25.5861473,17z/data=!3m1!4b1!4m4!3m3!8m2!3d45.64271!4d25.58871",
      PIATA,
    ],
    [
      "a named place's address: the pin's own numbers",
      "https://www.google.com/maps/place/Pia%C8%9Ba+Sfatului/@45.6420,25.5880,17z/data=!4m6!3m5!1s0x0:0x0!8m2!3d45.64271!4d25.58871!16s",
      PIATA,
    ],
    ["a named place's address with no pin: the centre the map looked at", "https://www.google.com/maps/place/Pia%C8%9Ba+Sfatului/@45.64271,25.58871,17z", PIATA],
    ["words before the link, as a shared text has them", "Punctul 3 https://www.google.com/maps/@45.64271,25.58871,17z", PIATA],
    ["a link in the southern and western halves", "https://www.google.com/maps/@-33.86882,-70.66927,15z", { latitude: -33.86882, longitude: -70.66927 }],
  ])("reads %s", (_what, text, expected) => {
    expect(read(text)).toEqual(expected);
  });

  it.each([
    ["nothing", ""],
    ["spaces alone", "   "],
    ["a line break alone", "\n\t"],
  ])("reads %s as «none», refusing nothing", (_what, text) => {
    expect(read(text)).toBeNull();
  });

  it.each([
    ["a latitude past 90", "90.000001, 25.58871"],
    ["a latitude past −90", "-90.5, 25.58871"],
    ["a longitude past 180", "45.64271, 180.000001"],
    ["a longitude past −180", "45.64271, -180.5"],
    ["the two the wrong way round, with nothing to say so", "125.58871, 45.64271"],
    ["a latitude past 90 by its letter", "95° N, 25° E"],
    ["a longitude past 180 in a link", "https://www.google.com/maps/@45.64271,181,17z"],
    ["one number", "45.64271"],
    ["one number with a decimal comma, which reads as a pair that is no place", "45,64271"],
    ["three numbers", "45.64271, 25.58871, 560"],
    ["three runs of digits joined by commas: two readings", "45,5,25"],
    ["three runs, whichever is longer", "45,64271,25"],
    ["a dash between the two", "45.64271 - 25.58871"],
    ["a slash between the two", "45.64271 / 25.58871"],
    ["words", "Piața Sfatului"],
    ["a word after the numbers", "45.64271, 25.58871 nord"],
    ["a word for the side", "45.64271 Nord, 25.58871 Est"],
    ["labels before the numbers", "lat 45.64271 lon 25.58871"],
    ["two latitudes", "45.64271 N, 46 N"],
    ["two longitudes", "25.58871 E, 26 V"],
    ["a minus and a letter on one number", "-45.64271 S, 25.58871 E"],
    ["a letter on each side of one number", "N 45.64271 N, 25.58871 E"],
    ["sixty minutes", `45°60'0"N 25°35'19.4"E`],
    ["sixty seconds", `45°38'60"N 25°35'19.4"E`],
    ["a number too long before its decimal mark", "1045.64271, 25.58871"],
    ["an exponent", "4.5e1, 2.5e1"],
    ["a shortened share link, which carries no numbers", "https://maps.app.goo.gl/AbCdEf123456"],
    ["another shortened link", "https://goo.gl/maps/Xy12Z"],
    ["a shortened link with the words a telephone shares before it", "Dropped pin https://maps.app.goo.gl/AbCdEf123456"],
    ["a link to a named place with no numbers", "https://www.google.com/maps/place/Pia%C8%9Ba+Sfatului"],
    ["a link whose q is a name", "https://maps.google.com/?q=Piata+Sfatului"],
    ["a geo address that asks for a search", "geo:0,0?q=Piata Sfatului"],
    ["a geo address with one number", "geo:45.64271"],
    ["a text longer than anything a maps application copies", `45.64271, 25.58871${" ".repeat(10)}${"x".repeat(COORDINATES_TEXT_MAX)}`],
  ])("refuses %s, naming the box", (_what, text) => {
    expect(read(text)).toEqual(REFUSED);
  });

  it("refuses with a validation error whose reason is a sentence of both catalogues, and names another box when told to", () => {
    let caught: unknown;
    try {
      parseCoordinates("nowhere", "edit.coordinates");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(CoordinatesRefusal);
    expect(isDomainError(caught) && caught.code).toBe("VALIDATION_ERROR");
    expect((caught as CoordinatesRefusal).fields).toEqual(["edit.coordinates"]);
    // The sentence says how to write them, with the example the box's helper gives.
    for (const catalogue of [ro, en]) {
      const sentence = (catalogue.Admin.errors as Record<string, string>)[(caught as CoordinatesRefusal).reason];
      expect(sentence).toContain("Google Maps");
      expect(sentence).toContain("45.64271, 25.58871");
    }
  });

  it("never fetches: a link is read with no network at all", () => {
    const fetched = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (() => {
      calls += 1;
      throw new Error("no network in a parser");
    }) as typeof fetch;
    try {
      expect(read("https://maps.app.goo.gl/AbCdEf123456")).toEqual(REFUSED);
      expect(read("https://www.google.com/maps/@45.64271,25.58871,17z")).toEqual(PIATA);
    } finally {
      globalThis.fetch = fetched;
    }
    expect(calls).toBe(0);
  });
});

describe("§NNN formatCoordinates: one fixed shape", () => {
  it.each<[Coordinates, string]>([
    [PIATA, "45.64271, 25.58871"],
    // Up to six decimals, the zeros at the end left out: what was typed reads as it was typed.
    [{ latitude: 45.642715, longitude: 25.588715 }, "45.642715, 25.588715"],
    [{ latitude: 45.5, longitude: 25.25 }, "45.5, 25.25"],
    [{ latitude: 45, longitude: 25 }, "45, 25"],
    [{ latitude: 10, longitude: 100 }, "10, 100"],
    [{ latitude: -33.86882, longitude: -70.66927 }, "-33.86882, -70.66927"],
    [{ latitude: 0, longitude: 0 }, "0, 0"],
    [{ latitude: -0, longitude: -0.0000001 }, "0, 0"],
    // Never an exponent, never more than six decimals.
    [{ latitude: 0.000001, longitude: 0.0000004 }, "0.000001, 0"],
    [{ latitude: 45.6427149999, longitude: 25.5887150001 }, "45.642715, 25.588715"],
  ])("writes %j as %s", (coordinates, expected) => {
    expect(formatCoordinates(coordinates)).toBe(expected);
  });

  it("is read back as the pair it was written from", () => {
    for (const pair of [PIATA, { latitude: -33.86882, longitude: -70.66927 }, { latitude: 45, longitude: 25 }, { latitude: 90, longitude: -180 }, { latitude: 0.000001, longitude: 179.999999 }]) {
      expect(parseCoordinates(formatCoordinates(pair))).toEqual(pair);
    }
  });

  it("writes points as decimal marks whatever the reader's language: it is what a maps application takes back", () => {
    expect(formatCoordinates(PIATA)).not.toContain("45,");
    expect(formatCoordinates(PIATA).split(", ")).toEqual(["45.64271", "25.58871"]);
  });
});

describe("§NNN mapUrlOf: Google Maps' own «open this place»", () => {
  it("builds the address from the pair, the comma between them encoded", () => {
    expect(mapUrlOf(PIATA)).toBe("https://www.google.com/maps/search/?api=1&query=45.64271%2C25.58871");
    expect(mapUrlOf({ latitude: -33.86882, longitude: -70.66927 })).toBe("https://www.google.com/maps/search/?api=1&query=-33.86882%2C-70.66927");
    expect(mapUrlOf({ latitude: 45, longitude: 25.5 })).toBe("https://www.google.com/maps/search/?api=1&query=45%2C25.5");
  });

  it("is an address the parser reads back as the same pair", () => {
    for (const pair of [PIATA, { latitude: -33.86882, longitude: -70.66927 }, { latitude: 0, longitude: 0 }]) {
      expect(parseCoordinates(mapUrlOf(pair))).toEqual(pair);
    }
  });

  it("carries the numbers and nothing else: no name, no key, no word of a person", () => {
    const url = new URL(mapUrlOf(PIATA));
    expect(url.origin).toBe("https://www.google.com");
    expect(url.pathname).toBe("/maps/search/");
    expect([...url.searchParams.entries()]).toEqual([
      ["api", "1"],
      ["query", "45.64271,25.58871"],
    ]);
  });
});
