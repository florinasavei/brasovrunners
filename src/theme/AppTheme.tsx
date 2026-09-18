"use client";

import CssBaseline from "@mui/material/CssBaseline";
import GlobalStyles from "@mui/material/GlobalStyles";
import { ThemeProvider } from "@mui/material/styles";
import { type ReactNode, useMemo, useSyncExternalStore } from "react";
import { parseThemePreview, PREVIEW_FONTS, THEME_PREVIEW_COOKIE, type ThemePreview } from "./preview";
import { buildTheme, theme } from "./theme";

/**
 * The one client boundary the theme needs. Everything below it can stay a Server Component.
 *
 * It also applies the theme lab's preview (`preview.ts`, BR-REQ-090-06), read from a cookie
 * *here*, in the browser, and never on the server: reading a cookie in the root layout would
 * make every page of the site dynamic for everybody, to serve a setting one person chose for
 * one browser. The cost is a repaint for that one person after hydration, which is what a
 * preview is. The server snapshot is "no preview", so the first client render matches it.
 */
function readPreviewCookie(): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${THEME_PREVIEW_COOKIE}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

const noSubscription = () => () => undefined;

export default function AppTheme({ children }: { children: ReactNode }) {
  const raw = useSyncExternalStore(noSubscription, readPreviewCookie, () => null);
  const preview: ThemePreview | null = useMemo(() => parseThemePreview(raw), [raw]);

  const active = useMemo(
    () =>
      preview
        ? buildTheme({
            display: PREVIEW_FONTS[preview.display].family,
            body: PREVIEW_FONTS[preview.body].family,
            radius: preview.radius,
          })
        : theme,
    [preview],
  );

  return (
    // "system" until the visitor chooses; the choice lives in localStorage under MUI's own key
    // and the script in the layout applies it before the first paint (§93).
    <ThemeProvider theme={active} defaultMode="system">
      <CssBaseline />
      {/* Every rem on the site — MUI's own type scale included — follows the root size. */}
      {preview && preview.scale !== 100 && <GlobalStyles styles={{ html: { fontSize: `${preview.scale}%` } }} />}
      {children}
    </ThemeProvider>
  );
}
