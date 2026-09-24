"use client";

import DarkModeIcon from "@mui/icons-material/DarkMode";
import LightModeIcon from "@mui/icons-material/LightMode";
import IconButton from "@mui/material/IconButton";
import { useColorScheme } from "@mui/material/styles";
import { useTranslations } from "next-intl";
import { useSyncExternalStore } from "react";
import { footerTargetSx } from "./footer-target";

/**
 * Light or dark, from the footer's bottom-left corner (`DECISIONS.md` §93, moved there in
 * §115 — the owner: "the theme switcher should be in the bottom left corner").
 *
 * `useColorScheme` is MUI's own: the choice is kept in `localStorage`, applied before paint by
 * `InitColorSchemeScript` in the layout, and light until somebody presses this — never the
 * device's setting (the owner, 2026-09-18: "by default we are on white"). The button shows the mode it would switch *to*, which is what every phone's
 * quick-settings tile does. Until mounted the mode is unknown on the client, so the same-sized
 * button renders disabled rather than nothing, and the header does not shift.
 *
 * A square the footer bar's size (`footer-target.ts`, §NNN): 24 pixels below 360, 28 from 360,
 * 44 from `sm` up. The footer is the only place this renders. The padding is 2 pixels at every
 * width so the 20-pixel glyph fits the 24; from `sm` the 44-pixel minimum centres it as before.
 */
export default function ThemeModeToggle() {
  const t = useTranslations("Site");
  const { mode, systemMode, setMode } = useColorScheme();
  // "Mounted" without an effect: the server snapshot is false, the client's is true.
  const mounted = useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false,
  );

  const resolved = mode === "system" ? (systemMode ?? "light") : mode;
  const dark = resolved === "dark";

  return (
    <IconButton
      aria-label={mounted ? (dark ? t("themeLight") : t("themeDark")) : t("themeDark")}
      title={mounted ? (dark ? t("themeLight") : t("themeDark")) : undefined}
      disabled={!mounted}
      onClick={() => setMode(dark ? "light" : "dark")}
      size="small"
      sx={{ ...footerTargetSx(["minHeight", "minWidth"]), p: "2px", color: "text.secondary" }}
    >
      {mounted && dark ? <LightModeIcon fontSize="small" /> : <DarkModeIcon fontSize="small" />}
    </IconButton>
  );
}
