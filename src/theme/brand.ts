/**
 * The club's visual identity as named tokens: the theme reads these, components read the theme
 * (`AGENTS.md` §3.2). The only file in `src/` allowed to name a colour.
 *
 * PLACEHOLDER until the club supplies the logo, the t-shirt colours and the typeface: keep the
 * token names, change the values; drop real SVGs over `public/brand/*.svg` (same viewBox, or
 * update LOGO). A typeface needs a licence that permits web embedding before it is self-hosted.
 */

/**
 * `blue` is the logo file's own fill (`#0000ff`), not the t-shirt's gradient; which is the brand
 * blue is open for the club. `blueInk` is for hover and large fills, since pure blue reads as an
 * unstyled link. `ink`/`paper` are near-neutrals, softer than black on white; every pair is
 * asserted in `tests/unit/theme/brand.test.ts`.
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
 * The dark scheme (§93). Not an inversion: pure blue on near-black is 2.4:1, so the primary lifts
 * to a lighter blue of the same hue and hover is lighter still. The orange stays (it sits under
 * dark text on either scheme). Asserted in `tests/unit/theme/brand.test.ts`.
 */
export const COLOR_DARK = {
  /** Primary as text and outlines: 7.6:1 on the dark page. */
  blue: "#7b9cff",
  /** Hover and pressed states, lighter still. */
  blueInk: "#a3b8ff",
  paper: "#111318",
  /** One step lighter than the page. */
  surface: "#1a1d24",
  ink: "#f3f2ee",
  inkMuted: "#b5b2a9",
  line: "#2c3038",
} as const;

/**
 * The public pages' background tints the club may choose (§488). Light scheme only. Text on each
 * must clear AA and white cards must stay visible — asserted in `tests/unit/theme/brand.test.ts`,
 * and the same rules refuse a custom colour (`modules/appearance/domain/tint-contrast.ts`).
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
 * The club kit's gradient, navy at the shoulders to cyan towards the hem. A proposal, not a
 * measurement: sampled from the underexposed `docs/brand/tricou-bvr.jpg`
 * (#0d1c3d → #09254b → #0f3c60 → #295572) with saturation restored. The kit supplier's print
 * file is authoritative.
 */
export const GRADIENT = {
  /** Shoulders. */
  deep: "#0b1f4d",
  /** Mid-body. */
  mid: "#12508f",
  /** Approaching the hem. */
  light: "#3aa0d8",
  /** Top to bottom, the way the shirt is worn. */
  vertical: "linear-gradient(180deg, #0b1f4d 0%, #12508f 55%, #3aa0d8 100%)",

  /**
   * The tints the site's text-carrying surfaces end on (§166): the card colour walked towards the
   * club's blue only as far as body text still clears AA (asserted in `brand.test.ts`). The kit
   * ramp above is for surfaces without text.
   */
  heroTint: "#e9eeff",
  /** The same step after dark: the dark card colour, walked towards the dark blue. */
  heroTintDark: "#232a3c",
} as const;

/**
 * The gradients as CSS values, light and dark. Components pair each with a `[data-dark]` selector
 * (MUI's `colorSchemeSelector`) rather than `theme.applyStyles`, a function that cannot cross into
 * a client component (`AGENTS.md` §14.1). `surfaces.ts` holds the ready-made `sx` fragments.
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
 * Two font roles, so an arriving club display face changes headings and leaves body text alone.
 * Both are Roboto for now, loaded by the locale layout through `next/font/local` from
 * `src/theme/fonts/` (§460), with `latin-ext` for ș, ț, ă, â, î. To add a club font: put the
 * WOFF2 files in `src/theme/fonts/`, add a `localFont({ variable: "--font-brand-display" })` in
 * `src/app/[locale]/layout.tsx`, point `display` at it, and check ș and ț render.
 */
export const FONT = {
  display: "var(--font-roboto)",
  body: "var(--font-roboto)",
  /**
   * Facón, the kit's face, used only by `shared/ui/Wordmark`. It has no Romanian letters at all
   * (no ș, ț, ă, â, î), so it can never be the `display` role. The fallback, Roboto Black Italic,
   * is the face the designer drew Facón from.
   */
  wordmark: "var(--font-facon)",
  /** Used when a webfont has not loaded yet, and when it fails to. */
  fallback: '"Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
} as const;

/**
 * The logotype, as printed on the kit. ASCII on purpose — Facón cannot render ș — and untranslated;
 * asserted in `tests/unit/theme/brand.test.ts`. The club's spelled name is `CLUB_NAME`.
 */
export const WORDMARK = "BRASOV RUNNERS";

/**
 * The club's name — the one place it is written (§369); catalogue sentences take it as `{club}`.
 * `tests/unit/notifications/no-hardcoded-values.test.ts` refuses it elsewhere in `src/` and in
 * the catalogues.
 */
export const CLUB_NAME = "Brașov Runners";

/**
 * The logo assets and their intrinsic proportions, so a layout reserves space before the SVG
 * loads. Root-relative under `public/`; the JSON-LD's absolute logo URL is built from
 * `APP_BASE_URL` at the point of use (`AGENTS.md` §8, BR-REQ-052-02).
 */
export const LOGO = {
  /** The full lockup: the mountain range over BRASOV RUNNERS. */
  lockup: {
    src: "/brand/logo.svg",
    onDark: "/brand/logo-white.svg",
    viewBox: "60 906 2880 1188",
    width: 2880,
    height: 1188,
  },
  /** The mountains alone, with the wordmark cropped out; for places a wider, shorter shape fits. */
  mark: {
    src: "/brand/logo-mark.svg",
    onDark: "/brand/logo-mark-white.svg",
    viewBox: "60 906 2840 889",
    width: 2840,
    height: 889,
  },
} as const;

/**
 * The header lockup's height. `HEADER_MARK_HEIGHT_PX` is the upper bound for the `width`/`height`
 * attributes; the `clamp` scales it with the viewport so the header never overflows a 320px
 * phone (BR-REQ-041-01 criterion 1). At 40px (§158) the lettering is about ten pixels.
 */
export const HEADER_MARK_HEIGHT_PX = 40;
export const HEADER_MARK_HEIGHT = "clamp(30px, 8vw, 40px)";
/**
 * What clears the sticky header, below `sm` and from `sm` up; read by `theme.ts`'s
 * `scroll-padding-top` and `ToastRegion`'s offset. The non-sticky QA notice above the header is
 * not counted.
 */
export const HEADER_CLEARANCE_PX = { xs: 72, sm: 76 } as const;
/** How wide every page is, header to footer. Prose stays within `PROSE_MEASURE`. */
export const PAGE_WIDTH = "xl" as const;

/** How wide running text may be: about 75 characters at body size. Prose pages only. */
export const PROSE_MEASURE = "60rem";

/**
 * The wordmark's size. Facón renders about 10.5× its font size wide, so the 1.25rem floor
 * (210px) fits a 320px viewport's 288px (BR-REQ-041-01 criterion 1).
 */
export const WORDMARK_SIZE = "clamp(1.25rem, 4vw, 2rem)";
