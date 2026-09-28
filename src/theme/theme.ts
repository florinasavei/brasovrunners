import { createTheme } from "@mui/material/styles";
import { COLOR, COLOR_DARK, FONT, HEADER_CLEARANCE_PX } from "./brand";
import { KEYFRAMES } from "./motion";

/** Material's filled "Error" glyph (a circle with an exclamation mark), as a mask for invalid fields (§309). */
const EXCLAMATION_SVG =
  "data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 24 24%27%3E%3Cpath d=%27M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2m1 15h-2v-2h2zm0-4h-2V7h2z%27/%3E%3C/svg%3E";

/**
 * The MUI theme, assembled from the brand tokens. No colour is named here: `brand.ts` is the only
 * file in `src/` allowed to (AGENTS.md §3.2). The secondary is a placeholder (AGENTS.md §29).
 */
/** What the theme lab may vary (`theme/preview.ts`, BR-REQ-090-06); the rest is the brand. */
export type ThemeOptions = { display: string; body: string; radius: number };

export const DEFAULT_THEME_OPTIONS: ThemeOptions = { display: FONT.display, body: FONT.body, radius: 10 };

export const buildTheme = (options: ThemeOptions) => createTheme({
  // CSS variables avoid the App Router's server/client flicker; `InitColorSchemeScript` sets
  // `data-light` / `data-dark` on <html> before paint (§93).
  cssVariables: { colorSchemeSelector: "data" },
  modularCssLayers: true,
  colorSchemes: {
    light: {
      palette: {
        primary: {
          main: COLOR.blue,
          // Hover and pressed states, not a contrast fix (the blue passes AA; `brand.test.ts`).
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
    // Self-hosted by the locale layout (§460), latin-ext included for ș, ț, ă, â, î.
    fontFamily: `${options.body}, ${FONT.fallback}`,
    // Headings take the display role (see `FONT` in brand.ts).
    h1: { fontFamily: `${options.display}, ${FONT.fallback}`, fontSize: "2rem", fontWeight: 500 },
    h2: { fontFamily: `${options.display}, ${FONT.fallback}`, fontSize: "1.5rem", fontWeight: 500 },
  },
  shape: { borderRadius: options.radius },
  // `xl` is wider than MUI's default (§252): every page's `PAGE_WIDTH` is `xl`, so this one
  // number sets the page width; prose stays within `PROSE_MEASURE`.
  breakpoints: { values: { xs: 0, sm: 600, md: 900, lg: 1200, xl: 2040 } },
  components: {
    /*
      An exclamation mark inside every invalid field (§309), CSS only so every form gets it:
      on a server-refused field (`Mui-error`) and a browser-refused one (`:user-invalid`, never
      on a pristine form). Decorative — the helper text and error summary carry the words (§47).
      Skipped on a select and on a field with an end adornment; top-aligned when multi-line.
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
    // Tighter than MUI's 16/24px card padding (§252).
    MuiCardContent: {
      styleOverrides: {
        root: { padding: 12, "&:last-child": { paddingBottom: 12 } },
      },
    },
    MuiCssBaseline: {
      styleOverrides: (theme) => ({
        /**
         * Room for the sticky header above any anchor or focus target the browser scrolls to
         * (`#admin-alert`, skip links, error-summary links), and for the sticky footer below
         * (§324, §372; WCAG 2.4.11 focus not obscured): at most 28px on a phone, 44px from `sm`,
         * plus border and air.
         */
        html: {
          scrollPaddingTop: HEADER_CLEARANCE_PX.xs,
          scrollPaddingBottom: 40,
          "@media (min-width:600px)": { scrollPaddingTop: HEADER_CLEARANCE_PX.sm, scrollPaddingBottom: 52 },
        },

        /** The site's keyframes, emitted once; `motion.ts` names and guards them. */
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
        // The loader's stride (§166). Transform only, so it never reflows the skeleton.
        [`@keyframes ${KEYFRAMES.run}`]: {
          "0%, 100%": { transform: "translateY(0) rotate(-3deg)" },
          "50%": { transform: "translateY(-3px) rotate(3deg)" },
        },
      }),
    },
  },
});

export const theme = buildTheme(DEFAULT_THEME_OPTIONS);
