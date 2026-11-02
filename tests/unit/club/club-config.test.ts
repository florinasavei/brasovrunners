import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import guardWords from "@club/guard-words.json";
import { CLUB } from "@/club/config";
import type { ClubConfig, ClubGuardWords, ClubWords } from "@/club/schema";
import { CLUB_COUNTY, CLUB_COUNTY_CODE, CLUB_LOCALITY, HOME_COUNTRY, HOME_COUNTRY_NAME, ID_DOCUMENT_EXAMPLE } from "@/modules/events/domain/place";
import { CLUB_TIME_ZONE, ZONE_WORDS } from "@/i18n/dates";
import { CLUB_HASHTAGS, CLUB_NAME, CLUB_SHORT_FORMS, CLUB_SHORT_NAME, CLUB_SLUG, LOGO, SAFETY_PROGRAMME, WORDMARK } from "@/theme/brand";

/**
 * BR-REQ-101-01 (§882): `club/club.json` is validated here rather than by a schema in the application.
 *
 * `src/club/config.ts` reaches the public client islands through the theme, so it may carry neither Zod nor the
 * environment (`tests/unit/shared/public-islands-weight.test.ts`); its types come from `satisfies`. What the types
 * cannot say — a zone `Intl` knows, coordinates on the globe, a text in both languages, a slug a file name can
 * carry, a logo whose proportions are the drawing's — is said here, and fails the commit that breaks it. And the
 * guard words stay in `club/guard-words.json`, out of the file the bundler carries to every visitor.
 */
const ROOT = path.resolve(__dirname, "../../..");

/** Every `{ ro, en }` pair of the file, by its path. */
function bilingualPairs(value: unknown, at = ""): [string, unknown][] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const keys = Object.keys(value);
  if (keys.includes("ro") || keys.includes("en")) return [[at, value]];
  return Object.entries(value).flatMap(([key, child]) => bilingualPairs(child, at ? `${at}.${key}` : key));
}

const viewBoxOf = (file: string) => /viewBox="([^"]+)"/.exec(readFileSync(path.join(ROOT, "public", file), "utf8"))?.[1];

describe("BR-REQ-101-01: club/club.json is a club the platform can run (§882)", () => {
  it("names a time zone Intl knows", () => {
    expect(Intl.supportedValuesOf("timeZone")).toContain(CLUB.place.timeZone);
  });

  it("is in Romania: the platform's laws, languages and currency are Romania's", () => {
    expect(CLUB.place.country).toBe("RO");
  });

  it("puts the club on the globe", () => {
    const { latitude, longitude } = CLUB.place.coordinates;
    expect(Number.isFinite(latitude) && Math.abs(latitude) <= 90).toBe(true);
    expect(Number.isFinite(longitude) && Math.abs(longitude) <= 180).toBe(true);
  });

  it("says every bilingual text in both languages, and nothing else", () => {
    const pairs = bilingualPairs(CLUB);
    expect(pairs.map(([at]) => at).sort()).toEqual(["place.countryName", "place.zoneWords", "safetyProgramme"]);
    for (const [at, pair] of pairs) {
      expect(Object.keys(pair as object).sort(), at).toEqual(["en", "ro"]);
      for (const text of Object.values(pair as ClubWords)) expect(typeof text === "string" && text.trim() !== "", at).toBe(true);
    }
  });

  it("keeps the guard words in their own file, out of the one the bundler carries to the browser", () => {
    // Every key the schema names, and no other: a `guardWords` written back into club.json fails here.
    const schemaKeys: Record<keyof ClubConfig, true> = {
      name: true,
      slug: true,
      shortName: true,
      wordmark: true,
      shortForms: true,
      place: true,
      hashtags: true,
      safetyProgramme: true,
      palette: true,
      logo: true,
    };
    const file = JSON.parse(readFileSync(path.join(ROOT, "club/club.json"), "utf8")) as Record<string, unknown>;
    expect(Object.keys(file).sort()).toEqual(Object.keys(schemaKeys).sort());
    const words: ClubGuardWords = guardWords;
    expect(Array.isArray(words) && words.length > 0).toBe(true);
    for (const word of words) expect(typeof word === "string" && word.trim() === word && word !== "", JSON.stringify(word)).toBe(true);
    expect(new Set(words).size).toBe(words.length);
  });

  it("BR-REQ-101-01: writes every colour of its palette as #rrggbb in lower case, and names no role the platform does not read (§885)", () => {
    const colours = (value: unknown, at: string): [string, unknown][] =>
      value && typeof value === "object" ? Object.entries(value).flatMap(([key, child]) => colours(child, `${at}.${key}`)) : [[at, value]];
    const found = colours(CLUB.palette, "palette");
    expect(found.length).toBeGreaterThan(3);
    for (const [at, hex] of found) expect(hex, at).toMatch(/^#[0-9a-f]{6}$/);
    const roles: Record<keyof ClubConfig["palette"], true> = {
      primary: true,
      primaryInk: true,
      secondary: true,
      accent: true,
      dark: true,
      kit: true,
      tints: true,
      look: true,
      secondaryLook: true,
    };
    for (const key of Object.keys(CLUB.palette)) expect(roles, key).toHaveProperty(key);
  });

  it("has a slug of lower-case letters, digits and hyphens", () => {
    expect(CLUB.slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  });

  it("writes the wordmark in ASCII (the kit face draws no ș) and every name non-empty", () => {
    expect(CLUB.wordmark).toMatch(/^[\x20-\x7e]+$/);
    for (const text of [CLUB.name, CLUB.shortName, CLUB.place.locality, CLUB.place.county, CLUB.place.countyCode, CLUB.place.idExample]) {
      expect(text.trim()).not.toBe("");
    }
    for (const tag of CLUB.hashtags) expect(tag).toMatch(/^#[\p{L}\p{N}_]+$/u);
  });

  it("gives the logo the proportions of the files it names", () => {
    for (const drawing of [CLUB.logo.lockup, CLUB.logo.mark]) {
      expect(viewBoxOf(drawing.src), drawing.src).toBe(drawing.viewBox);
      expect(viewBoxOf(drawing.onDark), drawing.onDark).toBe(drawing.viewBox);
      const [, , width, height] = drawing.viewBox.split(/\s+/).map(Number);
      expect({ width, height }).toEqual({ width: drawing.width, height: drawing.height });
    }
    expect(viewBoxOf("brand/logo.svg")).toBe(CLUB.logo.lockup.viewBox);
    expect(viewBoxOf("brand/logo-mark.svg")).toBe(CLUB.logo.mark.viewBox);
  });

  it("reaches the platform through the constants it always read, and the new ones", () => {
    expect({ CLUB_NAME, WORDMARK, CLUB_SLUG, CLUB_SHORT_NAME, CLUB_HASHTAGS, SAFETY_PROGRAMME }).toEqual({
      CLUB_NAME: CLUB.name,
      WORDMARK: CLUB.wordmark,
      CLUB_SLUG: CLUB.slug,
      CLUB_SHORT_NAME: CLUB.shortName,
      CLUB_HASHTAGS: CLUB.hashtags,
      SAFETY_PROGRAMME: CLUB.safetyProgramme,
    });
    expect(CLUB_SHORT_FORMS).toEqual({ city: "bv", nicknames: ["bvr"] });
    expect(LOGO).toEqual(CLUB.logo);
    expect({ CLUB_LOCALITY, CLUB_COUNTY, CLUB_COUNTY_CODE, HOME_COUNTRY, HOME_COUNTRY_NAME, ID_DOCUMENT_EXAMPLE }).toEqual({
      CLUB_LOCALITY: "Brașov",
      CLUB_COUNTY: "Brașov",
      CLUB_COUNTY_CODE: "BV",
      HOME_COUNTRY: "RO",
      HOME_COUNTRY_NAME: { ro: "România", en: "Romania" },
      ID_DOCUMENT_EXAMPLE: "BV 123456",
    });
    expect({ CLUB_TIME_ZONE, ZONE_WORDS }).toEqual({ CLUB_TIME_ZONE: "Europe/Bucharest", ZONE_WORDS: { ro: "ora României", en: "Romanian time" } });
    expect({ CLUB_SLUG, CLUB_SHORT_NAME, CLUB_HASHTAGS, SAFETY_PROGRAMME }).toEqual({
      CLUB_SLUG: "brasovrunners",
      CLUB_SHORT_NAME: "BVR",
      CLUB_HASHTAGS: ["#NoOneLeftBehind", "#brasovrunners"],
      SAFETY_PROGRAMME: { ro: "Girl Zone", en: "Girl Zone" },
    });
  });
});
