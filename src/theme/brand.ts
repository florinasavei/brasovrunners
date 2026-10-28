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

  /*
    The new look's tokens (§708; `docs/REDESIGN.md` § The visual system, decision 1): drawn only
    under «Aspectul nou», on the public pages, never in the backoffice, an email, a PDF, a race
    number or a share card — those keep the logo blue. Each has a twin in `COLOR_DARK` and its pairs
    in `brand-pairs.ts` (`LOOK_PAIRS`), held at AA by `tests/unit/theme/brand.test.ts`.
  */
  /** The hot pink: the mark, a rule, a large word. 4.77:1 on the page, white on it 4.99:1. */
  accent: "#d6176f",
  /**
   * The pink that carries words: `primary` under the new look — a link, an outline, a contained
   * button's fill under white text (7.6:1). No lighter than `inkMuted`, so every page tint the club
   * may choose (§488 holds `inkMuted` at AA on it) carries it too — the test asserts the order.
   */
  accentInk: "#a01650",
  /** A contained pink button under the pointer: deeper still, white on it 10.4:1. */
  accentDeep: "#7e0e3c",
  /** A pale pink band or chip under ink or `accentInk` (the weekly runs' chip in a later phase). */
  accentTint: "#fde8f1",
  /** A special event's fill in the calendar and its chips (a later phase): a pale green. */
  kindSpecial: "#dcefe0",
  /** The words on `kindSpecial`, and a green as text on the page or a card. */
  kindSpecialInk: "#1d5e2a",
  /** Any other event's fill: a warm grey under ink. */
  kindOther: "#ecebe6",
  /** Headings under the new look, a step darker than the body's ink. */
  inkStrong: "#0f0e0d",
} as const;

/**
 * The same brand after dark (`DECISIONS.md` §93; the owner: "I need a dark theme switcher").
 *
 * Not an inversion: pure blue on near-black is 2.4:1 and unreadable, so the primary lifts to
 * a lighter blue of the same hue (`blue`), and the ink-blue hover becomes the lighter `blueInk`
 * so the order — resting, then hover — reads the same way. Paper and surface are warm greys,
 * not black, for the reason `paper` is not white. The orange stays; it was chosen as a fill
 * under dark text, and that pair holds on either scheme. Every pair below is asserted in
 * `tests/unit/theme/brand.test.ts` exactly as the light ones are.
 */
export const COLOR_DARK = {
  /** Primary as text and outlines: 7.6:1 on the dark page. */
  blue: "#7b9cff",
  /** Hover and pressed states, lighter still. */
  blueInk: "#a3b8ff",
  /** Page background. */
  paper: "#111318",
  /** Card and surface background, one step lighter than the page. */
  surface: "#1a1d24",
  /** Body text. */
  ink: "#f3f2ee",
  /** Secondary text. */
  inkMuted: "#b5b2a9",
  /** Hairlines and dividers. */
  line: "#2c3038",

  /*
    The new look's twins (§708): lighter pinks of the same hue on the dark page, as the blue lifts
    (the order resting → hover reads the same way), and the fills walked towards the dark surface.
  */
  /** The hot pink after dark: 6.56:1 on the page. */
  accent: "#ff5fa2",
  /** `primary` under the new look after dark: text 8.64:1 on the page, and a fill under the dark page colour. */
  accentInk: "#ff8cc0",
  /** A contained pink button under the pointer, lighter still. */
  accentDeep: "#ffb3d6",
  /** The pale pink band after dark. */
  accentTint: "#3b1a2a",
  /** A special event's fill after dark. */
  kindSpecial: "#173b22",
  /** The words on it, and green as text on the dark page. */
  kindSpecialInk: "#8fd9a0",
  /** Any other event's fill after dark. */
  kindOther: "#2a2d33",
  /** Headings under the new look after dark. */
  inkStrong: "#ffffff",
} as const;

/**
 * The calendar apps' own marks in the subscribe box (`SubscribeBox`): Google's four colours and
 * Outlook's two blues, as each company draws them, so a reader finds their app by its logo. Not the
 * club's palette and never a surface: a logo keeps its colours in both schemes, as the companies ask.
 */
export const PROVIDER_LOGO = {
  googleBlue: "#4285F4",
  googleGreen: "#34A853",
  googleYellow: "#FBBC05",
  googleRed: "#EA4335",
  outlookBlue: "#0078D4",
  outlookLight: "#28A8EA",
  outlookInk: "#FFFFFF",
} as const;

/**
 * The public pages' background tints the club may choose from (§488, «Aspectul site-ului» under
 * Pagini → «Aspect»). Light scheme only: after dark the page stays `COLOR_DARK.paper`.
 *
 * The owner asked for "a slight shade of blue (club colours)": white, the club's blue laid over
 * white at about 4 % and about 8 %, and a blue-grey. Each is a page colour under white cards, so
 * every text colour that sits on it has to clear AA and the cards have to stay visible without the
 * page turning into a wash — `tests/unit/theme/brand.test.ts` asserts both over every preset, and
 * the same two rules refuse a «Personalizat» colour the club types
 * (`modules/appearance/domain/tint-contrast.ts`).
 */
export const SITE_TINT = {
  /** «Alb»: the platform's page colour, unchanged — the default. */
  paper: COLOR.paper,
  /** «Albastru abia vizibil»: `COLOR.blue` at 4 % over white (255 − 0.04 × 255 = 245). */
  faintBlue: "#f5f5ff",
  /** «Albastru deschis»: `COLOR.blue` at 8 % over white (255 − 0.08 × 255 ≈ 235). */
  lightBlue: "#ebebff",
  /** «Gri albăstrui»: a cool grey leaning to the club's blue. */
  blueGrey: "#eef1f5",
} as const;

/**
 * The emails' highlighted line (§580, amending §68 and §392; the owner, 2026-09-30: «I need more bold
 * and highlight in the emails sent to participants»): the one fact a message is about — the race
 * number and the desk code, the deadline, the start and the place — on a soft band in the club's
 * blue, the same in every message. No new colour: the band is the club's blue at about 8 % over
 * white (`SITE_TINT.lightBlue`), its left edge the ink blue, its words the body's ink.
 *
 * A message declares itself light (`templates.ts#card`), and Gmail's app darkens it anyway by
 * inverting it; the pairs hold either way — `tests/unit/notifications/email-emphasis.test.ts`
 * asserts the words on the band, the edge beside it and the band against the card, as sent and
 * inverted.
 */
export const EMAIL_EMPHASIS = {
  band: SITE_TINT.lightBlue,
  edge: COLOR.blueInk,
  ink: COLOR.ink,
  /** The quieter sentences — "ignore this if it was not you", where the data came from. */
  quiet: COLOR.inkMuted,
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

  /**
   * The two tints the site's own surfaces are allowed to end on (`DECISIONS.md` §166; the
   * owner: "I need more gradients and shiny Front-End stuff").
   *
   * NOT the kit ramp above. A hero carries a heading, two paragraphs, a countdown and a
   * button, so its background has to stay a *surface*: these are the card colour walked a
   * few steps towards the club's blue, which is about as far as a background can move before
   * body text on it stops clearing AA. `tests/unit/theme/brand.test.ts` asserts ink and
   * muted ink against both ends of both schemes, which is what makes that a rule rather than
   * a claim. The kit ramp stays for a surface that carries no text.
   */
  heroTint: "#e9eeff",
  /** The same step after dark: the dark card colour, walked towards the dark blue. */
  heroTintDark: "#232a3c",
} as const;

/**
 * The registrations spreadsheet's tints (§787, amended; the owner, 2026-10-16: «color codes în funcție de status și dacă
 * sunt membri BVR»): the pale fills a row takes by its state, and the club's blue for its runners' cells.
 *
 * Paper-pale on purpose: they sit behind ordinary black text in Excel (the file has no dark mode and its
 * words are the sheet's automatic colour), so each is far past AA under black — `tests/unit/registrations/excel-live.test.ts`
 * measures every one — and none says a thing by colour alone, since the «Status» column spells the state out.
 * One tint per chip colour of the desk (`DeskRow`: confirmed `success`, a waiting or pending state `warning`);
 * the waiting list is the sky blue and a cancelled or expired row is grey, never red — a whole red row shouts.
 * `member` is the club's own blue walked pale, a step stronger than the sky so the two blues are told apart: it
 * follows the person's own tick (§796). `clubRunner` is a pale lavender for the club's runners without the tick (a
 * member account or the club typed in the form), and `guest` a pale peach for a special guest's identity cells (it comes
 * with an italic font, so a guest reads differently even printed in grey); both sit apart from the amber `warning`
 * and from each other, and the sheet's tests hold every pair distinct and every one at AA under black.
 */
export const SHEET_TINT = {
  success: "#d9f0dc",
  warning: "#fff0c2",
  info: "#d7edf8",
  neutral: "#e4e4e4",
  member: "#c5d1ff",
  clubRunner: "#e2d4f4",
  guest: "#ffd9c0",
} as const;

/**
 * The frame of a report sheet (§846; the owner, 2026-10-22, of the volunteers' file: «excel formatat frumos»): the header
 * row the club's deep blue with white words — the same pair as a primary button (`brand.blueInk` under `surface`, far past
 * AA) — and a hairline grid in the paper's own line colour a step darker, so a printed page still reads as a table. Apart
 * from `SHEET_TINT` on purpose: those are the conditional fills the registrations sheet's tests hold to its rules one by one.
 */
export const SHEET_FRAME = {
  header: "#0b2fb8",
  headerInk: "#ffffff",
  grid: "#cfccc2",
} as const;

/**
 * The new look's accent presets (§723, amending §708; the owner, 2026-10-11: «this should be a
 * configuration in the theme»): «Setări» → «Aspect» → «Aspectul nou» → «Culoarea de accent». Each is
 * the four shades the look wears — `accent` (the mark, a rule, a large word), `accentInk` (the words:
 * `primary.main` under the look), `accentDeep` (a pressed button), `accentTint` (a pale band, the
 * weekly runs' chip) — by day and after dark. A colour the club types instead is derived by the same
 * rules (`modules/appearance/domain/accent-shades.ts`), and every preset is held to them, pair by pair,
 * by `tests/unit/appearance/look-accent.test.ts`. The logo stays the club's blue under all of them (§711).
 */
export const LOOK_ACCENT = {
  /** «Roz», the default: phase 1's tokens (§708), unchanged. */
  pink: {
    light: { accent: COLOR.accent, accentInk: COLOR.accentInk, accentDeep: COLOR.accentDeep, accentTint: COLOR.accentTint },
    dark: { accent: COLOR_DARK.accent, accentInk: COLOR_DARK.accentInk, accentDeep: COLOR_DARK.accentDeep, accentTint: COLOR_DARK.accentTint },
  },
  /**
   * «Albastru»: the club's blue as today's look wears it — the logo blue, its ink blue for words, the
   * hero's tint for the band — and one deeper step for the pressed button (white on it 12.4:1; after
   * dark, a lighter step, 10.7:1 on the dark card).
   */
  blue: {
    light: { accent: COLOR.blue, accentInk: COLOR.blueInk, accentDeep: "#092591", accentTint: GRADIENT.heroTint },
    dark: { accent: COLOR_DARK.blue, accentInk: COLOR_DARK.blueInk, accentDeep: "#becdff", accentTint: GRADIENT.heroTintDark },
  },
  /**
   * «Portocaliu»: the club's secondary orange, as the derivation makes it (the test asserts the
   * match). By day the orange itself is 2.6:1 on the page, too light to carry words, so its shades
   * walk towards brown until they do; after dark the orange is kept as it is.
   */
  orange: {
    light: { accent: "#a16620", accentInk: "#794d18", accentDeep: "#5e3c13", accentTint: "#f6f0e9" },
    dark: { accent: COLOR.orange, accentInk: "#df9c4b", accentDeep: "#e8b77c", accentTint: "#352c25" },
  },
} as const;

/**
 * «Echipa»'s canvas (§701; the president's drawing: a blue canvas, white cards, light boxes at the
 * bottom, no lines). The one public surface that keeps the brand's light colours after dark — the
 * blue is the brand, and a white card on it is the drawing — so every token here is a light-scheme
 * value and the components name these rather than the palette, which flips.
 *
 * `canvas` is the ink blue, not the pure one: the large flat area §23 above keeps away from pure
 * blue, and at 9.9:1 under white it is also the blue that carries white text at AA. The cards are
 * the card colour, their words the ink, the role title the club's blue (8.59:1 on a card), the boxes
 * the hero's tint — the card colour walked towards the blue, already asserted under ink and muted
 * ink. `tests/unit/theme/brand.test.ts` holds every pair.
 */
export const TEAM_CANVAS = {
  canvas: COLOR.blueInk,
  card: COLOR.surface,
  box: GRADIENT.heroTint,
  ink: COLOR.ink,
  inkMuted: COLOR.inkMuted,
  title: COLOR.blue,
  line: COLOR.line,
} as const;

/**
 * The gradients as CSS values, light and dark, assembled once.
 *
 * A component picks one of these and its `[data-dark]` twin — MUI writes the scheme onto
 * `<html>` as a valueless `data-light` / `data-dark` attribute (`theme.ts`,
 * `cssVariables.colorSchemeSelector`), so a plain object selector is enough and no component
 * needs `theme.applyStyles`, which is a function and therefore cannot cross into a MUI client
 * component from a Server Component (`AGENTS.md` §14.1). `src/theme/surfaces.ts` holds the
 * ready-made `sx` fragments; this is the vocabulary they are written in.
 */
export const SURFACE_GRADIENT = {
  /** The featured event's box, and any other surface that carries text. 160°: light from above-left. */
  hero: `linear-gradient(160deg, ${COLOR.surface} 0%, ${GRADIENT.heroTint} 100%)`,
  heroDark: `linear-gradient(160deg, ${COLOR_DARK.surface} 0%, ${GRADIENT.heroTintDark} 100%)`,
  /** A filled primary button under the pointer: the blue running into its own ink. */
  accent: `linear-gradient(90deg, ${COLOR.blue} 0%, ${COLOR.blueInk} 100%)`,
  accentDark: `linear-gradient(90deg, ${COLOR_DARK.blue} 0%, ${COLOR_DARK.blueInk} 100%)`,
  /** The short bar under a section heading. Decorative, so it carries no text and needs no ratio. */
  rule: `linear-gradient(90deg, ${COLOR.blue} 0%, ${COLOR.orange} 100%)`,
  ruleDark: `linear-gradient(90deg, ${COLOR_DARK.blue} 0%, ${COLOR.orange} 100%)`,
} as const;

/**
 * Two font roles, not one family.
 *
 * A club typeface almost always arrives as a display face — good in a wordmark and a heading,
 * tiring in a paragraph of event details at 320 px. Splitting the roles now means the arriving
 * font changes `display` and leaves body text alone, rather than forcing a choice between an
 * unbranded site and an unreadable one.
 *
 * Both currently resolve to Roboto, which the locale layout loads through `next/font/local` from
 * `src/theme/fonts/` — never from Google at build (§460) — one WOFF2 per weight carrying the
 * `latin-ext` characters, required for ș, ț, ă, â and î. When the club font arrives:
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
   * `src/theme/fonts/`, and used in exactly one component: `shared/ui/Wordmark`, which heads
   * the listing, the calendar and the contact page (2026-09-22) and nothing else.
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
  /**
   * The headings' face under «Aspectul nou» (§708, the redesign's decision 2): Inter at 800, a
   * repository file like every face (§460), `letter-spacing: -0.02em`. Only the new look's scope
   * names it (`theme/look.ts`), so with the look off no page asks for the file; the body stays
   * `body` (Roboto) under both looks.
   */
  lookDisplay: "var(--font-inter)",
  /** Used when a webfont has not loaded yet, and when it fails to. */
  fallback: '"Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
} as const;

/**
 * The wordmark, as a logotype rather than as the club's name. At the head of the listing, the
 * calendar and the contact page, in the kit face (`shared/ui/Wordmark`).
 *
 * Deliberately unaccented and deliberately not from the message catalogues. It matches the
 * kit, which is printed BRASOV RUNNERS, and it is the same in both locales because a logotype
 * is not translated. `tests/unit/theme/brand.test.ts` asserts it stays ASCII — put an ș in
 * here and Facón cannot render it.
 *
 * The club's actual name, correctly spelled, is `CLUB_NAME` below, and is what prose, page
 * titles and the header link's accessible name use.
 */
export const WORDMARK = "BRASOV RUNNERS";

/**
 * The club's name — the **one** place it is written (§369). A runner's club on their
 * registration (`DECISIONS.md` §215), the From line's default, the page title, the header's and
 * the wordmark's accessible name, the JSON-LD organiser, the share pictures, the calendar, the
 * PDFs' Author, and every catalogue sentence that names the club, which takes it as `{club}`.
 *
 * Until §369 the catalogues carried a second copy under `Site.name`, "free to differ between
 * the locales one day". A proper name is not translated, and two copies are two things to rename
 * and one to forget, so the catalogues no longer hold the name at all:
 * `tests/unit/notifications/no-hardcoded-values.test.ts` refuses it in `src/` outside this file
 * and the seeds, and in every message of both catalogues. The same distinction `WORDMARK` draws
 * above, from the other side: that is a logotype, this is the name.
 */
export const CLUB_NAME = "Brașov Runners";

/**
 * The club's short forms that no rule derives from `CLUB_NAME` — they belong to this club, so they live
 * beside its name. The public list's matcher (`registrations/domain/public-list-club.ts`, §753, §756) reads
 * them as the club's own words: `city` is the county's plate code standing for the name's first word
 * («BV Runners»), each of `nicknames` names the club on its own («BVR»). Folded: lower case, no
 * diacritics. A club renamed here renames these too.
 */
export const CLUB_SHORT_FORMS: { readonly city: string | null; readonly nicknames: readonly string[] } = {
  city: "bv",
  nicknames: ["bvr"],
};

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
   * The mountains alone, with the wordmark cropped out. The header used this for a day; it
   * shows the lockup now, because the club's name belongs in the club's own lettering
   * (`SiteHeader.tsx` records both attempts). Kept for the places a wider, shorter shape fits
   * better than a 2.42:1 lockup.
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
/**
 * The header logo's height. Taller than the 28px the mountains alone used, because the header
 * shows the **lockup** now (2026-09-17, the owner's instruction): the wordmark is roughly the
 * bottom quarter of that artwork, so at 28px it rendered about seven pixels tall — present and
 * unreadable, which is what made the mark-plus-live-text pairing worth trying in the first place.
 * At 44px the lettering is about eleven pixels and reads; at 2.42:1 the logo is then ~107px wide,
 * which still leaves room for the navigation at 320px (BR-REQ-041-01 criterion 1). 40px since
 * §158 (the owner: "the header and the footer must be smaller, on mobile smaller still"):
 * ten pixels of lettering, ~97px wide.
 */
export const HEADER_MARK_HEIGHT_PX = 40;
export const HEADER_MARK_HEIGHT = "clamp(30px, 8vw, 40px)";
/**
 * What clears the sticky site header, in pixels, below `sm` and from `sm` up: the theme's
 * `scroll-padding-top` (`theme.ts`) and the toasts' top offset (`ToastRegion`) read this one
 * pair, so the two never drift apart. The environment notice sits above the header and is not
 * sticky (`SiteHeader`): on QA, at the very top of a page, a toast may overlap the header's lower
 * edge by that notice's height — accepted, since it scrolls away and production shows no notice.
 */
export const HEADER_CLEARANCE_PX = { xs: 72, sm: 76 } as const;
/**
 * How wide the page is. One value, used by the header, the footer, the environment notice and
 * every public and backoffice page, so "allow a wider screen" (the owner, twice on 2026-09-17:
 * `md` → `lg` → `xl`) is this line. MUI's `xl` is 1536px; `false` would make the page fluid
 * with only the gutters. Prose keeps `PROSE_MEASURE` inside it whatever this says.
 */
export const PAGE_WIDTH = "xl" as const;

/**
 * How wide a column of running text may be. About 75 characters at body size: the range
 * typography has settled on for reading, and the reason a wider page (`lg`, 2026-09-17) does
 * not mean wider paragraphs. Applied to prose pages, never to the header or lists.
 */
export const PROSE_MEASURE = "60rem";

/**
 * The wordmark's size from `sm` (`shared/ui/Wordmark`: the listing, the calendar and the contact page). A
 * display face, but a signature rather than a banner — 4rem was "way too big" (the owner,
 * 2026-09-17), 2.5rem still a bit; it caps at 2rem. Measured: the face renders
 * about 10.5× its font size wide, so the 1.25rem floor (210px) fits well inside the 288px a 320px
 * viewport leaves inside the gutters (BR-REQ-041-01 criterion 1).
 *
 * Half of that since §569 (the owner, 2026-09-29: «Textul ăsta de „Evenimente” e mult prea mare,
 * pe mobil ia prea mult spațiu, la fel și la „Calendar”»): the wordmark is not drawn at all below
 * `sm` — the header's lockup already carries the club's name, one brand per screen — and from
 * `sm` it is a flat 1rem, 16px, where it was 30.7px at 768 and 32px at 1280. About 168px wide,
 * so it fits every width it is drawn at; no clamp is needed once a phone never draws it.
 */
export const WORDMARK_SIZE = "1rem";

/**
 * «Salvează ca imagine» (§855): the palettes the calendar picture is drawn in, in the browser, on a
 * `<canvas>`. The picture is one of three layouts (`calendar-image-poster-*.ts`); the theme the visitor
 * picks is only the palette the layout is handed. Each names the page behind the month (`background`, two
 * stops top to bottom), the band that carries the club's name and the foot (`band`, `bandInk`), a day's
 * cell (`cell`, `cellInk`), the weekday heads' row and the legend's panels (`cellMuted`), the grid's
 * hairlines (`line`), the hours and the legend's notes (`title`), and the three kinds of date — the weekly
 * runs, the special editions and the rest (`weekly`, `special`, `other`, each a fill and its ink). «Sezon»
 * is four palettes, one per season, chosen by the month drawn.
 *
 * The layouts read the slots in pairs, which `tests/unit/theme/brand.test.ts` holds at 4.5:1 on every
 * palette: `bandInk` on `band` (the band, the foot, a series' strip, the weekly chips), on `special[1]`
 * and `other[1]` (the legend's «Evenimente speciale» pill, a series' strip of that kind) and on `cellInk`
 * (a third series' strip on one weekday); `band` on `cell` (a series' outlined strip, its hour) and on
 * `weekly[0]` (the agenda's day number on a weekly date's card); `title` on `cellMuted` (the weekdays, the
 * legend's notes) and on `cell` and the two tinted days (the hours); `cellInk` on `cell`, on `cellMuted`
 * and on `special[0]`, `other[0]` and `weekly[0]` (the numbers and the titles); `special[1]` and `other[1]`
 * on `cell` and on their own tints («Anulat», the glyphs, the agenda's day numbers) and `weekly[1]` on its
 * own (the glyph on a weekly date's card); each series' ink on its fill, and each series' fill as the
 * words of its cancelled chip on `cell`. `line` is only seen, not read: a hairline on `cell`.
 */
export type CalendarImagePalette = {
  background: readonly [string, string];
  band: string;
  bandInk: string;
  cell: string;
  cellInk: string;
  cellMuted: string;
  line: string;
  /** The hours, the legend's notes and the weekday heads. */
  title: string;
  weekly: readonly [string, string];
  special: readonly [string, string];
  other: readonly [string, string];
  /**
   * Each weekly series' own colour, in the order the month's legend lists them — a series' dates are chips
   * of that colour in their days, and the legend's chip of the same colour names it. A fill under its ink,
   * each pair at least 4.5:1; the fill alone writes «Anulat» on a cancelled chip, so it reads on `cell` too.
   */
  series: readonly (readonly [string, string])[];
};

/** A burnt orange: white on it 5.1:1, and itself 4.7:1 on the poster's cream day and 5.1:1 on a white cell. */
const BURNT_ORANGE = "#b4511d";

/**
 * The series' colours on a white cell: the club's blue first, then a teal, a violet and the burnt orange,
 * white words on each — none the specials' pink or cream, so a special date is told from a series at a glance.
 */
const SERIES_ON_WHITE: CalendarImagePalette["series"] = [
  [COLOR.blue, COLOR.surface],
  ["#00796b", COLOR.surface],
  ["#6b2fc2", COLOR.surface],
  [BURNT_ORANGE, COLOR.surface],
];

/** The poster's weekday row and its hairlines: the club's blue, very pale — the blue themes' too. */
const PALE_BLUE_ROW = "#e9eeff";
const PALE_BLUE_LINE = "#c7d2ff";

/** «Întunecat»'s day cell: a blue-grey a step above its page, and a weekly date's bare card on it. */
const DARK_CELL = "#1b1e2b";

/** «Monocrom»'s sheet and ink: pure white and near-black, as a printer and a black-and-white feed want them. */
const MONO_SHEET = "#ffffff";
const MONO_INK = "#111111";

/** «Cald»'s day cell: a warm white a step above its cream page. */
const WARM_CELL = "#fffdf8";

/**
 * The club's colours on a white cell, which «Sezon» draws on each season's page: the hours a deep blue, the
 * weekday row and the hairlines a neutral grey that sits on any page, a special day the site's pale green
 * and a social one its warm grey, a weekly date's own card bare, as «Afiș» has it. The band is each theme's
 * own, so none is held here.
 */
const CLUB_PALETTE: Omit<CalendarImagePalette, "band"> = {
  background: [COLOR.blue, COLOR.blueInk],
  bandInk: COLOR.surface,
  cell: COLOR.surface,
  cellInk: COLOR.ink,
  cellMuted: COLOR.line,
  line: COLOR.line,
  title: COLOR.blueInk,
  weekly: [COLOR.surface, COLOR.blue],
  special: [COLOR.kindSpecial, COLOR.kindSpecialInk],
  other: [COLOR.kindOther, COLOR.ink],
  series: SERIES_ON_WHITE,
};

export const CALENDAR_IMAGE_THEMES = {
  /**
   * «Clubul»: the club's blue page, from the logo's blue to its ink blue. The band, the foot and the hours
   * are the kit's navy (`GRADIENT.deep`) rather than the ink blue, which the page's lower half is — a foot
   * the colour of the page under it was no band at all; the row and the hairlines the poster's pale blue,
   * which the grey fought.
   */
  club: { ...CLUB_PALETTE, band: GRADIENT.deep, title: GRADIENT.deep, cellMuted: PALE_BLUE_ROW, line: PALE_BLUE_LINE },
  /** «Luminos»: the site's paper under the club's colours, the logo's blue for the band. */
  light: {
    ...CLUB_PALETTE,
    background: [COLOR.paper, COLOR.paper],
    band: COLOR.blue,
    cellMuted: PALE_BLUE_ROW,
    line: PALE_BLUE_LINE,
  },
  /**
   * «Întunecat»: the dark page and dark cells, the words light. The band is the dark scheme's blue with the
   * page's dark under its words rather than a navy under light ones, because the layouts write the band's
   * colour on a cell too (a series' strip, its hour) and fill the weekly chips with it: on a dark cell only a
   * light fill does both (6.4:1 on the cell, 7.3:1 under the dark words). The same holds for the specials'
   * green and the socials' orange — pills under the dark words, words on the cell — and for the four series:
   * light fills under the dark words, each at least 9:1 on the cell. A special day is a deep green, a
   * social one a warm brown: dark enough for the light words, far enough in hue from the blue-grey cell. A
   * weekly date's own card is the bare cell under the band's blue, as «Afiș» has it bare under its blue.
   */
  dark: {
    background: ["#0e1018", "#171a26"],
    band: COLOR_DARK.blue,
    bandInk: COLOR_DARK.paper,
    cell: DARK_CELL,
    cellInk: "#eceae4",
    cellMuted: "#2c3043",
    line: "#343a52",
    title: COLOR_DARK.blueInk,
    weekly: [DARK_CELL, COLOR_DARK.blue],
    special: ["#1f4a2c", COLOR_DARK.kindSpecialInk],
    other: ["#3a2f1e", COLOR.orange],
    series: [
      [COLOR_DARK.blue, COLOR_DARK.paper],
      ["#4fd1c5", COLOR_DARK.paper],
      ["#c4a7ff", COLOR_DARK.paper],
      ["#ffb067", COLOR_DARK.paper],
    ],
  },
  /**
   * «Afiș» (§855): the club's hand-made monthly poster, as the owner handed it over — a white sheet, the
   * logo's blue band, the weekdays on a pale blue row, a special date's cell in pale pink or pale yellow.
   * The pink that writes on the pink day is the site's deeper one (`accentInk`: the hot pink was 4.27:1 on
   * its tint), and the cream day's is the burnt orange (the site's orange was 2.51:1 on the cream and
   * 2.64:1 on a white cell, where the agenda's day numbers and the glyphs wear it).
   */
  poster: {
    background: [COLOR.surface, COLOR.surface],
    band: COLOR.blue,
    bandInk: COLOR.surface,
    cell: COLOR.surface,
    cellInk: COLOR.blueInk,
    cellMuted: PALE_BLUE_ROW,
    line: PALE_BLUE_LINE,
    title: COLOR.blue,
    weekly: [COLOR.surface, COLOR.blue],
    special: [COLOR.accentTint, COLOR.accentInk],
    other: ["#fff4d6", BURNT_ORANGE],
    series: SERIES_ON_WHITE,
  },
  winter: { ...CLUB_PALETTE, background: ["#3f6fb5", "#9cc3e6"], band: "#1e3f73", title: "#1e3f73" },
  spring: { ...CLUB_PALETTE, background: ["#3f8f4f", "#a6d4a0"], band: "#22552d", title: "#22552d" },
  summer: { ...CLUB_PALETTE, background: ["#0b8fa8", "#f2c14e"], band: "#075e6f", title: "#075e6f" },
  autumn: { ...CLUB_PALETTE, background: [BURNT_ORANGE, COLOR.orange], band: "#6e2f10", title: "#6e2f10" },
  /**
   * «Monocrom» (the owner, 2026-10-27: «I need more styles and configs»): a white sheet, an ink-black band
   * and foot, grey tints and four grey series by lightness alone — for the club's printer and a
   * black-and-white feed. The lightest series grey is the classic 4.5:1 one on white; the two tints are
   * told apart by their depth, a special day the darker, and the series by lightness alone — fine for a
   * colour-blind reader, less so for a faint print, which is why they step from ink to a mid grey, never paler.
   */
  mono: {
    background: [MONO_SHEET, MONO_SHEET],
    band: MONO_INK,
    bandInk: MONO_SHEET,
    cell: MONO_SHEET,
    cellInk: MONO_INK,
    cellMuted: "#ededed",
    line: "#d0d0d0",
    title: "#3d3d3d",
    weekly: [MONO_SHEET, MONO_INK],
    special: ["#dedede", "#1f1f1f"],
    other: ["#f1f1f1", "#555555"],
    series: [
      [MONO_INK, MONO_SHEET],
      ["#3a3a3a", MONO_SHEET],
      ["#5c5c5c", MONO_SHEET],
      ["#757575", MONO_SHEET],
    ],
  },
  /**
   * «Cald»: a cream sheet, the burnt orange for the band and the hours' deep burnt brown, the poster's tints
   * warmed — a peach special day, a straw social one — and the series the orange, a pine green, a plum and
   * a coffee brown, white words on each.
   */
  warm: {
    background: ["#fbf3e6", "#f5e6d0"],
    band: BURNT_ORANGE,
    bandInk: COLOR.surface,
    cell: WARM_CELL,
    cellInk: "#3b2314",
    cellMuted: "#f6e7d2",
    line: "#e9d3b8",
    title: "#8a3a12",
    weekly: [WARM_CELL, BURNT_ORANGE],
    special: ["#fde3d3", "#8f2a1b"],
    other: ["#f8ecc4", "#5d4a1f"],
    series: [
      [BURNT_ORANGE, COLOR.surface],
      ["#2f6f5e", COLOR.surface],
      ["#7a3b8f", COLOR.surface],
      ["#5a4634", COLOR.surface],
    ],
  },
} as const satisfies Record<string, CalendarImagePalette>;

export type CalendarImagePaletteName = keyof typeof CALENDAR_IMAGE_THEMES;
