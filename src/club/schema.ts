/**
 * The shape of `club/club.json` (§882): the club's identity, its place, its clock and its logo — what makes
 * this platform one club's rather than another's, read at build time and never from the database.
 *
 * Types only, and on purpose. `config.ts` reaches every client island that shows the club's name (the theme
 * imports `theme/brand.ts`), so neither Zod nor `shared/config/env.ts` may come with it
 * (`tests/unit/shared/public-islands-weight.test.ts`). What a schema would check — a zone `Intl` knows,
 * coordinates in range, both languages of every pair, a slug of `[a-z0-9-]` — is checked by
 * `tests/unit/club/club-config.test.ts`, on every commit, rather than in every visitor's browser.
 *
 * The region stays Romania (§882): the platform's languages are `ro` and `en`, its legal texts cite Romanian
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
  /**
   * The zone in words beside a time, as the emails say it: «ora României» / "Romanian time" (the legal texts'
   * digest, `notifications/templates.ts`; the editor's zone summary says it so too). Not the signed PDF's proof
   * lines nor «Sarcini»'s stalled-email row, which say "Romania time" in English
   * (`registrations/declaration-labels.ts`, `Admin.tasks.emailStalled`): a change that wires this there brings
   * that form beside this one, never this one in its place (`dates.ts#ZONE_WORDS`).
   */
  readonly zoneWords: ClubWords;
  /** Where the sun is read for when an event names no point (`sun.ts#DEFAULT_CLUB_COORDINATES`). */
  readonly coordinates: { readonly latitude: number; readonly longitude: number };
  /** An identity card's series and number as a hint shows one («BV 123456»). */
  readonly idExample: string;
};

/** The four shades an accent wears in one scheme (`brand.ts#LOOK_ACCENT`), each `#rrggbb`. */
export type ClubShades = { readonly accent: string; readonly accentInk: string; readonly accentDeep: string; readonly accentTint: string };

/**
 * The club's colours (§NNN), by role, each `#rrggbb` in lower case: what `theme/brand.ts` turns into the tokens it
 * always exported — the role here, the hue name there (`primary` is `COLOR.blue`, `secondary` is `COLOR.orange`).
 * Five are required — the primary and its ink, the same two after dark, the secondary and the accent; everything else
 * is the hand-picked value it was in the code, and a club that leaves one out gets it derived from those by the same arithmetic the backoffice's typed accent uses (`brand.ts#shadesOf`, `mix`).
 * The platform's neutrals — the ink, the paper, the kinds' fills, the calendar picture's other themes — are not here:
 * they are the platform's, the same for every club, and every pair of them is held at AA by `brand.test.ts`.
 */
export type ClubPalette = {
  /** The logo's own colour: links, outlines, a filled button. `logo.svg`'s fill (`brand.test.ts`). */
  readonly primary: string;
  /** Its deeper ink: a hover, the large flat areas, the sheets' header row. */
  readonly primaryInk: string;
  /** The second colour, a fill under the body's ink: the rule's far end, the event kinds' chips. */
  readonly secondary: string;
  /** «Aspectul nou»'s default accent (the preset «Roz» in Brașov's case). */
  readonly accent: string;
  /** The primary and its ink after dark, lighter so they read on the dark page (7 : 1 or so on the dark card). */
  readonly dark: { readonly primary: string; readonly primaryInk: string };
  /** The kit's gradient, shoulders to hem: a surface that carries no text, and the calendar picture's navy band. */
  readonly kit?: { readonly deep: string; readonly mid: string; readonly light: string };
  /** The primary walked pale (or dark): the page tints, the hero's ends, the poster's hairline, the sheet's member fill, the blue preset's pressed shade. */
  readonly tints?: {
    readonly faint?: string;
    readonly light?: string;
    readonly grey?: string;
    readonly hero?: string;
    readonly heroDark?: string;
    readonly rule?: string;
    readonly sheet?: string;
    readonly deep?: string;
    readonly deepDark?: string;
    /** The band behind the white lockup in `public/brand/logo-white-email.png`, which delivered emails link: `yarn brand:assets` paints it, the primary when left out (§NNN). */
    readonly emailBand?: string;
  };
  /** The accent's four shades by day and after dark; derived from `accent` when left out. */
  readonly look?: { readonly light: ClubShades; readonly dark: ClubShades };
  /** The secondary's four shades, the look's second preset; derived from `secondary` when left out. */
  readonly secondaryLook?: { readonly light: ClubShades; readonly dark: ClubShades };
};

export type ClubConfig = {
  /** The club's name, the one place it is written (§369, §882): `brand.ts#CLUB_NAME`. */
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
  readonly palette: ClubPalette;
  readonly logo: { readonly lockup: ClubLogoFile; readonly mark: ClubLogoFile };
};

/**
 * The shape of `club/guard-words.json` (§882): the club's own places and names that no code should spell out.
 * Its own file, beside `club.json` rather than in it, because the theme brings `club.json` whole into every
 * public client island and the application never needs these: only the literal guard reads them
 * (`tests/unit/club/club-literals.test.ts`), and nothing under `src/` imports the file
 * (`tests/unit/club/import-surface.test.ts`).
 */
export type ClubGuardWords = readonly string[];
