import { createTheme } from "@mui/material/styles";
import { COLOR, COLOR_DARK, FONT } from "./brand";
import { KEYFRAMES } from "./motion";

/** Material's filled "Error" glyph (a circle with an exclamation mark), as a mask for invalid fields (§309). */
const EXCLAMATION_SVG =
  "data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 24 24%27%3E%3Cpath d=%27M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2m1 15h-2v-2h2zm0-4h-2V7h2z%27/%3E%3C/svg%3E";

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
      An invalid field says so on the field itself (§309; the owner: "I want an exclamation
      adornment on the invalid fields so it stands out!"). The red helper text under a field
      is easy to scroll past on a phone; a red mark inside the box is not.

      CSS only, in the theme, so every form on the site gets it — the registration form, the
      contact form, the declaration, the backoffice — with no component edited and no
      JavaScript: it shows on a field the server refused (MUI marks it `Mui-error`) and on one
      the browser refused (`:user-invalid` — only once the person has typed and left it, or
      pressed send, never on a pristine form), which also gets the red outline MUI keeps for
      the first case. A masked pseudo-element painted in the error colour, so it follows the
      dark scheme through the CSS variables; decorative (the helper text and the error summary
      carry the words, §47), so it is invisible to a screen reader, which is right.

      Not on a select (its arrow lives there), not on a field that already has an end
      adornment (a unit, a button), and at the top rather than the middle of a multi-line box.
    */
    MuiOutlinedInput: {
      styleOverrides: {
        root: ({ theme }) => {
          const error = (theme.vars ?? theme).palette.error.main;
          const invalid = "&.Mui-error, &:has(input:user-invalid), &:has(textarea:user-invalid)";
          return {
            "&:has(input:user-invalid) .MuiOutlinedInput-notchedOutline, &:has(textarea:user-invalid) .MuiOutlinedInput-notchedOutline": {
              borderColor: error,
            },
            "&:not(.MuiInputBase-adornedEnd):not(:has(.MuiSelect-select))": {
              [invalid]: {
                paddingRight: 36,
                "&::after": {
                  content: "\"\"",
                  position: "absolute",
                  right: 12,
                  top: "50%",
                  width: 20,
                  height: 20,
                  marginTop: -10,
                  backgroundColor: error,
                  mask: `url("${EXCLAMATION_SVG}") center / contain no-repeat`,
                  WebkitMask: `url("${EXCLAMATION_SVG}") center / contain no-repeat`,
                  pointerEvents: "none",
                },
                "&.MuiInputBase-multiline::after": { top: 16, marginTop: 0 },
              },
            },
          };
        },
      },
    },
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
         *
         * And room for the sticky footer below it (§324), for the same reason at the other
         * edge: what the browser scrolls into view at the bottom — a field or a button reached
         * with Tab, the send button under a long form — landed behind the bar (WCAG 2.4.11,
         * focus not obscured). The footer is one row at every width since §372 (`SiteFooter`):
         * at most 28px tall on a phone and 44px from `sm` up, plus its border and a little air.
         */
        html: {
          scrollPaddingTop: 72,
          scrollPaddingBottom: 40,
          "@media (min-width:600px)": { scrollPaddingTop: 76, scrollPaddingBottom: 52 },
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
