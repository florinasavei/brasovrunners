import { createTheme } from "@mui/material/styles";
import { COLOR, FONT } from "./brand";

/**
 * The MUI theme, assembled from the brand tokens.
 *
 * No colour is named here and none may be: `src/theme/brand.ts` is the only file in `src/`
 * allowed to hold a hex value, so replacing the placeholder identity with the club's is one
 * edit to one file (AGENTS.md §3.2 — no wrappers, no second way to do this).
 *
 * Both colours are still placeholders awaiting owner approval (AGENTS.md §29). They are
 * deliberately not MUI's default blue, so the site never reads as an admin template.
 */
export const theme = createTheme({
  // CSS variables avoid the server/client flicker MUI documents for the App Router.
  cssVariables: true,
  modularCssLayers: true,
  palette: {
    primary: {
      main: COLOR.green,
      // Links and small text on the page background use the darker green: the primary alone
      // does not reach 4.5:1 on paper, and a link is the smallest coloured text on the site.
      dark: COLOR.greenInk,
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
});
