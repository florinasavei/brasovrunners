import Box from "@mui/material/Box";
import { getLocale, getTranslations } from "next-intl/server";
import { formatLastUpdated, formatVersion } from "@/shared/config/build-info";

/**
 * Which build is this, and when did the code behind it last change.
 *
 * Fixed to the bottom-right corner so the answer is on every page without any page having to
 * carry it. A Server Component: the values are inlined at build time and never change while
 * the page is open, so there is nothing for client JavaScript to do here.
 *
 * `pointerEvents: "none"` because it is a label, not a control — a fixed element that swallows
 * clicks in the corner is a bug on a 320px screen, where the corner is also where a thumb
 * lands. It sits above content and below MUI's modal layer, so a dialog still covers it.
 */
export default async function BuildBadge() {
  const locale = await getLocale();
  const t = await getTranslations("Site");

  const version = formatVersion();
  const lastUpdated = formatLastUpdated(locale);

  return (
    <Box
      component="p"
      aria-label={t("buildBadgeLabel")}
      sx={{
        position: "fixed",
        right: 8,
        bottom: 8,
        m: 0,
        px: 0.75,
        py: 0.25,
        borderRadius: 1,
        pointerEvents: "none",
        // The literal rather than `theme.zIndex.fab`: an `sx` callback is a function, and a
        // function cannot cross the server/client boundary this Box sits on. 1050 is what the
        // default theme's `fab` resolves to — above content, below modal (1300).
        zIndex: 1050,
        bgcolor: "background.paper",
        color: "text.disabled",
        border: 1,
        borderColor: "divider",
        opacity: 0.75,
        fontSize: "0.6875rem",
        lineHeight: 1.4,
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {lastUpdated ? `${version} · ${lastUpdated}` : version}
    </Box>
  );
}
