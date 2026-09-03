/**
 * The club's visual identity, in one file.
 *
 * PLACEHOLDER. Every value below is a stand-in until the club supplies the real logo, the
 * t-shirt colours and the club typeface. It is written as a single set of named tokens so that
 * arrival is an edit to this file and nothing else: `AGENTS.md` §3.2 forbids wrappers around
 * MUI, so the theme reads these and components read the theme.
 *
 * What must be replaced, and what to replace it with:
 *
 *   colour   sampled from the t-shirt, as hex. Keep the token names; change the values.
 *   logo     drop the real SVGs over `public/brand/*.svg`, same filenames, same viewBox
 *            proportions, or update LOGO below if the proportions differ.
 *   font     see FONT below. A licence permitting web embedding is required before a typeface
 *            is self-hosted — many licences that cover print do not, and shipping one that
 *            does not is redistribution the club would be liable for.
 *
 * Nothing here is a rule that carries trust, so this file is not priority-1. It is, however,
 * the only place in `src/` allowed to name a colour.
 */

/**
 * The palette.
 *
 * `green` and `orange` are the values the scaffold started with — deliberately not MUI's
 * default blue, so the site never reads as an admin template. They are kept rather than
 * invented over, because guessing at branding twice is worse than guessing at it once.
 *
 * `ink` is not pure black and `paper` is not pure white: full-contrast black on white is
 * harsher on a phone in daylight than the near-neutrals below, and both still clear the
 * contrast ratio asserted in `tests/unit/theme/brand.test.ts`.
 */
export const COLOR = {
  /** Primary. Buttons, links, the logo mark. */
  green: "#1f5f3f",
  /** Darker green for text-on-paper, where the primary alone is too light to pass AA. */
  greenInk: "#164630",
  /** Secondary. Accents and the event-kind chips. */
  orange: "#d98a2b",
  /** Body text. */
  ink: "#1c1b19",
  /** Secondary text: captions, field labels. */
  inkMuted: "#5b574f",
  /** Page background. */
  paper: "#fafaf7",
  /** Card and surface background, one step lighter than the page. */
  surface: "#ffffff",
  /** Hairlines and dividers. */
  line: "#e2e0d8",
} as const;

/**
 * Two font roles, not one family.
 *
 * A club typeface almost always arrives as a display face — good in a wordmark and a heading,
 * tiring in a paragraph of event details at 320 px. Splitting the roles now means the arriving
 * font changes `display` and leaves body text alone, rather than forcing a choice between an
 * unbranded site and an unreadable one.
 *
 * Both currently resolve to Roboto, which the locale layout loads through `next/font` with the
 * `latin-ext` subset — required for ș, ț, ă, â and î. When the club font arrives:
 *
 *   1. put the files in `src/theme/fonts/` (WOFF2; convert OTF/TTF first),
 *   2. in `src/app/[locale]/layout.tsx` add
 *        const brand = localFont({ src: "...", variable: "--font-brand-display", display: "swap" })
 *      from `next/font/local`, and add `brand.variable` to the body class,
 *   3. change `display` below to `var(--font-brand-display)`,
 *   4. check ș and ț actually render — a display face often omits them, and a missing glyph
 *      falls back mid-word, which looks worse than not branding the heading at all.
 */
export const FONT = {
  display: "var(--font-roboto)",
  body: "var(--font-roboto)",
  /** Used when a webfont has not loaded yet, and when it fails to. */
  fallback: '"Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
} as const;

/**
 * The logo assets and their intrinsic proportions.
 *
 * Dimensions are here so a layout can reserve the right space before the SVG loads; a logo
 * that changes size on load pushes the page around on a slow connection.
 *
 * Paths are root-relative and resolve under `public/`. They are not absolute URLs, so
 * `AGENTS.md` §8 does not apply — nothing here needs `APP_BASE_URL`. The `SportsOrganization`
 * JSON-LD does need an absolute logo URL (BR-REQ-052-02) and must build it from
 * `APP_BASE_URL` at the point of use, never by pasting a host in here.
 */
export const LOGO = {
  /** Horizontal lockup: mark plus wordmark. Rendered by the site header. */
  lockup: { src: "/brand/logo.svg", width: 180, height: 32 },
  /**
   * The mark alone, square.
   *
   * Its consumer is not an import: `src/app/icon.svg` is a Next file convention, so the
   * framework picks it up by filename and emits the `<link rel="icon">`. That means the two
   * files can silently drift — a new mark in `public/brand/`, the old one still in the browser
   * tab. `tests/unit/theme/brand.test.ts` asserts they stay identical.
   */
  mark: { src: "/brand/logo-mark.svg", width: 32, height: 32 },
} as const;
