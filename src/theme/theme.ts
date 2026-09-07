import { createTheme } from "@mui/material/styles";
import { COLOR, FONT } from "./brand";

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
export const theme = createTheme({
  // CSS variables avoid the server/client flicker MUI documents for the App Router.
  cssVariables: true,
  modularCssLayers: true,
  palette: {
    primary: {
      main: COLOR.blue,
      // Hover and pressed states. Not a contrast fix: the club's blue is 8.22:1 on the page
      // background and passes AA as text on its own — `tests/unit/theme/brand.test.ts` asserts
      // that rather than assuming it.
      dark: COLOR.blueInk,
      contrastText: COLOR.paper,
    },
    secondary: { main: COLOR.orange, contrastText: COLOR.ink },
    background: { default: COLOR.paper, paper: COLOR.surface },
    text: { primary: COLOR.ink, secondary: COLOR.inkMuted },
    divider: COLOR.line,
  },
  typography: {
    // Provided by next/font in the locale layout; latin-ext covers ș, ț, ă, â, î.
    fontFamily: `${FONT.body}, ${FONT.fallback}`,
    // Headings take the display role, so an arriving club typeface changes these and leaves
    // body text alone. Both resolve to Roboto until one arrives — see brand.ts.
    h1: { fontFamily: `${FONT.display}, ${FONT.fallback}`, fontSize: "2rem", fontWeight: 500 },
    h2: { fontFamily: `${FONT.display}, ${FONT.fallback}`, fontSize: "1.5rem", fontWeight: 500 },
  },
  shape: { borderRadius: 10 },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
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
         * header's own two shapes: at `xs` the navigation takes a second row, above `sm` it
         * sits beside the lockup on one.
         */
        html: {
          scrollPaddingTop: 120,
          "@media (min-width:600px)": { scrollPaddingTop: 76 },
        },
      },
    },
  },
});
