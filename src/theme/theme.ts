import { createTheme } from "@mui/material/styles";
import { COLOR, COLOR_DARK, FONT } from "./brand";
import { KEYFRAMES } from "./motion";

/**
 * The MUI theme, assembled from the brand tokens.
 *
 * No colour is named here and none may be: `src/theme/brand.ts` is the only file in `src/`
 * allowed to hold a hex value, so replacing the placeholder identity with the club's is one
 * edit to one file (AGENTS.md §3.2 — no wrappers, no second way to do this).
 *
 * The primary is the club's own blue, taken from their logo file. The secondary is still a
 * placeholder awaiting owner approval (AGENTS.md §29).
 */
/**
 * What the theme lab may vary (`theme/preview.ts`, BR-REQ-090-06): the two font roles and the
 * corner radius. Everything else — colour, spacing, the header — is the brand and stays.
 */
export type ThemeOptions = { display: string; body: string; radius: number };

export const DEFAULT_THEME_OPTIONS: ThemeOptions = { display: FONT.display, body: FONT.body, radius: 10 };

export const buildTheme = (options: ThemeOptions) => createTheme({
  // CSS variables avoid the server/client flicker MUI documents for the App Router. The
  // scheme is chosen by `data-light` / `data-dark` on <html>, which `InitColorSchemeScript`
  // sets before paint from what the visitor chose or what their device says (§93).
  cssVariables: { colorSchemeSelector: "data" },
  modularCssLayers: true,
  colorSchemes: {
    light: {
      palette: {
        primary: {
          main: COLOR.blue,
          // Hover and pressed states. Not a contrast fix: the club's blue is 8.22:1 on the page
          // background and passes AA as text on its own — `tests/unit/theme/brand.test.ts`
          // asserts that rather than assuming it.
          dark: COLOR.blueInk,
          contrastText: COLOR.paper,
        },
        secondary: { main: COLOR.orange, contrastText: COLOR.ink },
        background: { default: COLOR.paper, paper: COLOR.surface },
        text: { primary: COLOR.ink, secondary: COLOR.inkMuted },
        divider: COLOR.line,
      },
    },
    dark: {
      palette: {
        primary: { main: COLOR_DARK.blue, dark: COLOR_DARK.blueInk, contrastText: COLOR_DARK.paper },
        secondary: { main: COLOR.orange, contrastText: COLOR.ink },
        background: { default: COLOR_DARK.paper, paper: COLOR_DARK.surface },
        text: { primary: COLOR_DARK.ink, secondary: COLOR_DARK.inkMuted },
        divider: COLOR_DARK.line,
      },
    },
  },
  typography: {
    // Provided by next/font in the locale layout; latin-ext covers ș, ț, ă, â, î.
    fontFamily: `${options.body}, ${FONT.fallback}`,
    // Headings take the display role, so an arriving club typeface changes these and leaves
    // body text alone. Both resolve to Roboto until one arrives — see brand.ts.
    h1: { fontFamily: `${options.display}, ${FONT.fallback}`, fontSize: "2rem", fontWeight: 500 },
    h2: { fontFamily: `${options.display}, ${FONT.fallback}`, fontSize: "1.5rem", fontWeight: 500 },
  },
  shape: { borderRadius: options.radius },
  /*
    The page is wider than MUI's own `xl` (§252; the owner: "the website can span a bit wider
    and there is too much whitespace overall").

    `PAGE_WIDTH` is `xl` and every page reads it, so widening the page is this one number
    rather than nineteen `maxWidth` props. 1760 is about as wide as a two-column card row wants
    to be before the eye has to travel; prose inside it is still held to `PROSE_MEASURE`, so
    nothing that is read line by line got wider — only the room the cards, the calendar grid
    and the backoffice tables have.
  */
  breakpoints: { values: { xs: 0, sm: 600, md: 900, lg: 1200, xl: 2040 } },
  components: {
    /*
      Cards carry less air (§252; the owner: "there is too much whitespace overall and padding").

      MUI's default is 16 pixels and 24 at the bottom of the last block, which on a listing of
      cards is a third of what the eye has to travel between two titles. Twelve, and the same
      at the foot, so a card is its content and a margin rather than a frame around a frame.
    */
    MuiCardContent: {
      styleOverrides: {
        root: { padding: 12, "&:last-child": { paddingBottom: 12 } },
      },
    },
    MuiCssBaseline: {
      styleOverrides: (theme) => ({
        /**
         * Room for the sticky header above anything the browser scrolls to.
         *
         * The header is `position: sticky` on every page, so an anchor jump — `#admin-alert`
         * after a backoffice action, a skip link, an error summary's link to the field it
         * names — lands the target at the very top of the viewport, underneath it. The
         * backoffice was the visible case: every Server Action redirects to `#admin-alert`
         * precisely so the outcome is not missed at the top of a long list, and after a long
         * list the alert arrived hidden behind the header. The elements set
         * `scrollMarginTop: 16`, which was written for a page with no sticky header and
         * clears nothing.
         *
         * `scroll-padding-top` on the scroll container fixes every anchor on the site at once,
         * rather than each element remembering the header's height. The two values are the
         * header's own two heights: one row everywhere since 2026-09-17, 8px of padding on a
         * phone and 16px from `sm` up.
         */
        html: {
          scrollPaddingTop: 72,
          "@media (min-width:600px)": { scrollPaddingTop: 76 },
        },

        /**
         * The site's motion, as named keyframes emitted once (`theme/motion.ts` says where
         * each is used and why every one of them sits behind `prefers-reduced-motion`).
         */
        [`@keyframes ${KEYFRAMES.fade}`]: {
          from: { opacity: 0 },
          to: { opacity: 1 },
        },
        [`@keyframes ${KEYFRAMES.rise}`]: {
          from: { opacity: 0, transform: "translateY(8px)" },
          to: { opacity: 1, transform: "none" },
        },
        [`@keyframes ${KEYFRAMES.headerShadow}`]: {
          from: { boxShadow: "none" },
          to: { boxShadow: theme.shadows[2] },
        },
        // The loader's stride (§166). Transform only, so it composites and never reflows the
        // skeleton it sits in; the lean is two degrees, which reads as running rather than
        // wobbling at the 20–24px the figure is drawn at.
        [`@keyframes ${KEYFRAMES.run}`]: {
          "0%, 100%": { transform: "translateY(0) rotate(-3deg)" },
          "50%": { transform: "translateY(-3px) rotate(3deg)" },
        },
      }),
    },
  },
});

export const theme = buildTheme(DEFAULT_THEME_OPTIONS);
