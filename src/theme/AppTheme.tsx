"use client";

import CssBaseline from "@mui/material/CssBaseline";
import GlobalStyles from "@mui/material/GlobalStyles";
import { ThemeProvider } from "@mui/material/styles";
import { type ReactNode, useMemo, useSyncExternalStore } from "react";
import { parseThemePreview, PREVIEW_FONTS, THEME_PREVIEW_COOKIE, type ThemePreview } from "./preview";
import { buildTheme, theme } from "./theme";

/**
 * The theme's one client boundary. It applies the theme lab's preview (BR-REQ-090-06) from a
 * cookie read in the browser only: reading it in the root layout would make every page dynamic.
 * The server snapshot is "no preview", so hydration matches.
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
    // Light until the visitor presses the switch, never the device's setting (§93).
    <ThemeProvider theme={active} defaultMode="light">
      <CssBaseline />
      {/* Every rem on the site — MUI's own type scale included — follows the root size. */}
      {preview && preview.scale !== 100 && <GlobalStyles styles={{ html: { fontSize: `${preview.scale}%` } }} />}
      {children}
    </ThemeProvider>
  );
}
