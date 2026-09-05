import Box from "@mui/material/Box";
import { getLocale, getTranslations } from "next-intl/server";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { formatLastUpdated, formatVersion } from "@/shared/config/build-info";
import { env } from "@/shared/config/env";
import BuildBadgeLink from "./BuildBadgeLink";

/**
 * When this site was last updated — and, for the club's own people, the way in.
 *
 * Fixed to the bottom-right corner so the answer is on every page without any page having to
 * carry it. The visible text is deliberately short: which deployment this is, and when the code
 * behind it last changed. The exact build — the baseline and the commit — moved into the badge's
 * `title` and its accessible name, because a corner label that nobody can read at a glance is
 * two facts too many, and `/api/health` reports the same values to anybody who needs them
 * exactly.
 *
 * Where a staff sign-in exists, this is also the entrance: a double-click, or `Enter` when it
 * has focus, opens it (`BuildBadgeLink`). That replaced a "Staff" link in the footer — a
 * permanent invitation on a page every visitor reads. Where `STAFF_AUTH_MODE=disabled` there is
 * no door at all, so the badge stays exactly what it was: a label with `pointerEvents: "none"`,
 * which is what keeps a fixed element from swallowing a tap in the corner a thumb lands in on a
 * 320px screen.
 *
 * A Server Component either way: the values are inlined at build time and never change while
 * the page is open. Only the interactive half is a client island, and only where it is real.
 */
export default async function BuildBadge() {
  const locale = await getLocale();
  const t = await getTranslations("Site");

  const version = formatVersion();
  const lastUpdated = formatLastUpdated(locale);

  /**
   * Which deployment this is, first, and only where it is not production.
   *
   * The commonest confusion this badge exists to settle is not "which build" but "which of the
   * two sites am I looking at" — qa and production run the same code from the same repository
   * on hostnames nobody memorises. On the club's real site that prefix is noise; everywhere
   * else it is the whole point, and it is the same value every safety rule in
   * `shared/config/env.ts` keys on.
   */
  const parts = [
    ...(env.APP_ENV === "production" ? [] : [env.APP_ENV]),
    t("lastBuild"),
    ...(lastUpdated ? [lastUpdated] : []),
  ];
  const text = parts.join(" · ");

  const sx = {
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
  };

  if (env.STAFF_AUTH_MODE === "disabled") {
    return (
      <Box component="p" aria-label={t("buildBadgeLabel")} title={version} sx={sx}>
        {text}
      </Box>
    );
  }

  return (
    <BuildBadgeLink
      href={getPathname({ locale: locale as Locale, href: "/sign-in" })}
      label={`${t("buildBadgeLabel")} — ${version}. ${t("buildBadgeSignIn")}`}
      title={version}
      sx={sx}
    >
      {text}
    </BuildBadgeLink>
  );
}
