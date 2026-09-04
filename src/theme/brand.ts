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
 * `blue` is taken from the club's own logo file, where every path is filled `#0000ff` — pure
 * sRGB blue. It is not sampled from the t-shirt, whose blue is a navy-to-cyan gradient and
 * visibly not this colour. Which of the two is the brand blue is an open question for the club;
 * until it is answered, the supplied vector file wins, because it is the only place the colour
 * is stated as a value rather than photographed under a lamp.
 *
 * `blueInk` exists because pure blue is a poor UI colour even when it passes contrast: it is
 * the default unvisited-link colour of every browser, so buttons and headings set in it read
 * as unstyled. It is used for large flat areas; the logo keeps its exact blue.
 *
 * `ink` is not pure black and `paper` is not pure white: full-contrast black on white is
 * harsher on a phone in daylight than the near-neutrals below, and both still clear the
 * contrast ratio asserted in `tests/unit/theme/brand.test.ts`.
 */
export const COLOR = {
  /** Primary, exactly as the supplied logo states it. 8.22:1 on paper, 8.59:1 on a card. */
  blue: "#0000ff",
  /** Hover and pressed states, and any large fill where pure blue would vibrate. */
  blueInk: "#0b2fb8",
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
 * The club kit's gradient: deep navy at the shoulders, running lighter and more cyan down the
 * body, to white at the hem. It is the most distinctive thing the club already owns, and the
 * one part of the identity that is theirs rather than generic.
 *
 * DERIVED FROM A PHOTOGRAPH, and that is a real caveat. Sampling a vertical line down
 * `docs/brand/tricou-bvr.jpg` gives this ramp:
 *
 *   #0d1c3d → #09254b → #0f3c60 → #295572 → (white)
 *
 * The photo is warm-lit and underexposed, so those samples are duller and greyer than the
 * garment: the shirt reads as a vivid royal-to-cyan on a screen, and the measured values do
 * not. The stops below keep the sampled *structure* — same hue progression, same direction —
 * with saturation restored to what the fabric actually looks like. They are a proposal, not a
 * measurement. The authoritative values are in the print file the kit supplier holds; ask for
 * them before this ships anywhere a member will compare it against a shirt.
 */
export const GRADIENT = {
  /** Shoulders. */
  deep: "#0b1f4d",
  /** Mid-body. */
  mid: "#12508f",
  /** Approaching the hem. */
  light: "#3aa0d8",
  /**
   * Top to bottom, the way the shirt is worn. Kept as a CSS value rather than assembled at
   * each use, so every surface that carries it carries the same one.
   */
  vertical: "linear-gradient(180deg, #0b1f4d 0%, #12508f 55%, #3aa0d8 100%)",
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
  /**
   * Facón, the face the club's kit is printed in. Loaded by the locale layout from
   * `src/theme/fonts/`, and used in exactly one place: the header wordmark.
   *
   * It is confined to that one string for a hard reason, not a stylistic one. The font
   * contains 129 characters and NONE of them are Romanian — not ș or ț in either encoding,
   * and not ă, â or î either. `Brașov` cannot be set in it; the ș falls back mid-word to
   * Roboto. Anything rendered from the message catalogues would eventually hit one of those
   * letters, which is why this is not the `display` role.
   *
   * Its fallback is Roboto 900 italic, which is not an approximation chosen by eye: the
   * designer's read-me names "Roboto Black Italic" as the base font Facón was drawn from.
   */
  wordmark: "var(--font-facon)",
  /** Used when a webfont has not loaded yet, and when it fails to. */
  fallback: '"Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
} as const;

/**
 * The header wordmark, as a logotype rather than as the club's name.
 *
 * Deliberately unaccented and deliberately not from the message catalogues. It matches the
 * kit, which is printed BRASOV RUNNERS, and it is the same in both locales because a logotype
 * is not translated. `tests/unit/theme/brand.test.ts` asserts it stays ASCII — put an ș in
 * here and Facón cannot render it.
 *
 * The club's actual name, correctly spelled, lives in `messages/*.json` under `Site.name` and
 * is what prose, page titles and the header link's accessible name use.
 */
export const WORDMARK = "BRASOV RUNNERS";

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
  /**
   * The full lockup: the mountain range over BRASOV RUNNERS.
   *
   * Too wide and too detailed for a header — at a height that fits one, the wordmark inside it
   * is about four pixels tall. Use it where the logo is the subject: the brand sheet, an Open
   * Graph image, print.
   */
  lockup: {
    src: "/brand/logo.svg",
    onDark: "/brand/logo-white.svg",
    viewBox: "60 906 2880 1188",
    width: 2880,
    height: 1188,
  },
  /**
   * The mountains alone, cropped from the same artwork.
   *
   * This is what the header uses, beside the club's name set as live text. That pairing is
   * deliberate: the supplied wordmark reads BRASOV, without the ș, and the site's own name is
   * Brașov. Live text lets the page spell it correctly while the artwork stays untouched.
   */
  mark: {
    src: "/brand/logo-mark.svg",
    onDark: "/brand/logo-mark-white.svg",
    viewBox: "60 906 2840 889",
    width: 2840,
    height: 889,
  },
} as const;

/**
 * The size of the header lockup, as fluid CSS rather than fixed pixels.
 *
 * The mark is 3.2:1 and the wordmark is a wide, heavy face, so at a fixed 28px the two came to
 * 307px beside each other — wider than the 288px of content a 320px phone leaves after the
 * container's padding, which pushed the whole page into a horizontal scroll (BR-REQ-041-01
 * criterion 1). A fixed size that fits the narrowest phone would then look undersized on a
 * desktop, so both scale with the viewport and stop at a maximum.
 *
 * `clamp` rather than a breakpoint: the failure is continuous — every width below roughly
 * 360px overflows by a different amount — so the fix should be continuous too. A breakpoint at
 * 360 would leave 361px overflowing.
 *
 * MARK_HEIGHT_PX is the upper bound, used for the `width`/`height` attributes that reserve the
 * box before the SVG loads; the CSS below overrides the drawn size.
 */
export const HEADER_MARK_HEIGHT_PX = 28;
export const HEADER_MARK_HEIGHT = "clamp(20px, 5.5vw, 28px)";
export const HEADER_WORDMARK_SIZE = "clamp(0.95rem, 4.2vw, 1.25rem)";
