/**
 * The shape of `club/club.json` (§NNN): the club's identity, its place, its clock and its logo — what makes
 * this platform one club's rather than another's, read at build time and never from the database.
 *
 * Types only, and on purpose. `config.ts` reaches every client island that shows the club's name (the theme
 * imports `theme/brand.ts`), so neither Zod nor `shared/config/env.ts` may come with it
 * (`tests/unit/shared/public-islands-weight.test.ts`). What a schema would check — a zone `Intl` knows,
 * coordinates in range, both languages of every pair, a slug of `[a-z0-9-]` — is checked by
 * `tests/unit/club/club-config.test.ts`, on every commit, rather than in every visitor's browser.
 *
 * The region stays Romania (§NNN): the platform's languages are `ro` and `en`, its legal texts cite Romanian
 * law, its prices are in RON — so a club running it is in Romania, and `country` says exactly that.
 */

/** A text the club says in both of the platform's languages, both or neither (`shared/forms/both-languages.ts`). */
export type ClubWords = { readonly ro: string; readonly en: string };

/** The one country the platform's laws, languages and currency are written for. */
export type HomeCountry = "RO";

/** One of the logo's two drawings: its files under `public/` and its intrinsic proportions. */
export type ClubLogoFile = {
  readonly src: string;
  readonly onDark: string;
  readonly viewBox: string;
  readonly width: number;
  readonly height: number;
};

export type ClubPlace = {
  /** The city every event happens in when none is announced yet («Brașov»): `place.ts#CLUB_LOCALITY`. */
  readonly locality: string;
  /** The county, as «județul …» names it. */
  readonly county: string;
  /** The county's plate code, which also stands for the city in a typed address («jud. BV»). */
  readonly countyCode: string;
  readonly country: HomeCountry;
  readonly countryName: ClubWords;
  /** An IANA zone `Intl` knows: every timestamp that belongs to no event (`dates.ts#CLUB_TIME_ZONE`). */
  readonly timeZone: string;
  /** The zone in words, as the emails and the signed PDFs say it beside a time («ora României»). */
  readonly zoneWords: ClubWords;
  /** Where the sun is read for when an event names no point (`sun.ts#DEFAULT_CLUB_COORDINATES`). */
  readonly coordinates: { readonly latitude: number; readonly longitude: number };
  /** An identity card's series and number as a hint shows one («BV 123456»). */
  readonly idExample: string;
};

export type ClubConfig = {
  /** The club's name, the one place it is written (§369, §NNN): `brand.ts#CLUB_NAME`. */
  readonly name: string;
  /** Lower-case letters, digits and hyphens: the export file's format, the Instagram example. */
  readonly slug: string;
  /** The club's own short mark («BVR»). */
  readonly shortName: string;
  /** The logotype, ASCII, as the kit prints it: `brand.ts#WORDMARK`. */
  readonly wordmark: string;
  /** The public list's matcher inputs no rule derives from the name (§753, §756): `brand.ts#CLUB_SHORT_FORMS`. */
  readonly shortForms: { readonly city: string | null; readonly nicknames: readonly string[] };
  readonly place: ClubPlace;
  /** As the calendar picture prints them, each with its `#`. */
  readonly hashtags: readonly string[];
  /** The club's confidential safety form's name in both languages. */
  readonly safetyProgramme: ClubWords;
  readonly logo: { readonly lockup: ClubLogoFile; readonly mark: ClubLogoFile };
  /**
   * The club's own places and names that no code should spell out — read only by the literal guard
   * (`tests/unit/club/club-literals.test.ts`), never by the application.
   */
  readonly guardWords: readonly string[];
};
