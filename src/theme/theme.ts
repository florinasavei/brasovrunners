import { createTheme } from "@mui/material/styles";

// PLACEHOLDER PALETTE. Final branding needs owner approval (AGENTS.md §29). It is deliberately
// not the MUI default blue so the site never reads as an admin template (AGENTS.md §3.2).
// Change the values here; nothing else in the app names a colour.
export const theme = createTheme({
  // CSS variables avoid the server/client flicker MUI documents for the App Router.
  cssVariables: true,
  modularCssLayers: true,
  palette: {
    primary: { main: "#1f5f3f" },
    secondary: { main: "#d98a2b" },
    background: { default: "#fafaf7" },
  },
  typography: {
    // Provided by next/font in the locale layout; latin-ext covers ș, ț, ă, â, î.
    fontFamily: "var(--font-roboto)",
    h1: { fontSize: "2rem", fontWeight: 500 },
    h2: { fontSize: "1.5rem", fontWeight: 500 },
  },
  shape: { borderRadius: 10 },
});
