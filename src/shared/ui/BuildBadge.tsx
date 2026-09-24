import Box from "@mui/material/Box";
import { getLocale, getTranslations } from "next-intl/server";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { formatBuildDate, formatVersion } from "@/shared/config/build-info";
import { env } from "@/shared/config/env";
import BuildBadgeLink from "./BuildBadgeLink";

/**
 * When this site was built — and, for the club's own people, the way in.
 *
 * **The fold's own line below `md`, and pinned to the bar's own bottom-right corner from `md`
 * (`SiteFooter`, §NNN).** It was once fixed to the bottom-right corner from `md` and a label under the bar below that,
 * so every visitor on every page read "app-ver · BR-V1.77 · 960b3c0 · 2026-09-24 17:12" — on a
 * phone as a third line of footer, 37 pixels under a bar that was already two. The owner,
 * 2026-09-24: "version shows by default". Nobody the public site is for has a use for it; the
 * people who do — the owner checking a release, a developer, staff looking for the door — open
 * "Despre club" once, and `/api/health` and `/devs` report the same values exactly. One rule at
 * every width and in every environment: QA says it is QA in words above the header
 * (`EnvironmentNotice`), so the stamp's "qa ·" prefix was never the only place that fact was
 * read, and a rule keyed on the environment would need a production build to test at all.
 *
 * The visible text is deliberately short: which deployment this is, and when the code behind it
 * last changed. The exact build — the baseline and the commit — is in the `title` and the
 * accessible name too.
 *
 * Where a staff sign-in exists, this is also the entrance: a double-click, a long press on a
 * phone, or `Enter` when it has focus, opens it (`BuildBadgeLink`, §34). That replaced a "Staff"
 * link in the footer — a permanent invitation on a page every visitor reads — and in the fold it
 * is one step further out of a visitor's way. Where `STAFF_AUTH_MODE=disabled` there is no door
 * at all, so the stamp is a label with `pointerEvents: "none"`.
 *
 * A Server Component either way: the values are inlined at build time and never change while
 * the page is open. Only the interactive half is a client island, and only where it is real.
 */
export default async function BuildBadge() {
  const locale = await getLocale();
  const t = await getTranslations("Site");

  const version = formatVersion();
  const builtOn = formatBuildDate();

  /**
   * Which deployment this is, first, and only where it is not production.
   *
   * qa and production run the same code from the same repository on hostnames nobody
   * memorises. On the club's real site that prefix is noise; everywhere else it names the
   * environment every safety rule in `shared/config/env.ts` keys on.
   */
  const parts = [
    ...(env.APP_ENV === "production" ? [] : [env.APP_ENV]),
    t("appVersion"),
    version,
    ...(builtOn ? [builtOn] : []),
  ];
  const text = parts.join(" · ");

  /**
   * A quiet line, not a pill over the page: small, muted, as wide as its words (`alignSelf`, so
   * a press beside it — on the panel, or on the bar's corner from `md` — is not a press on it)
   * and wrapping rather than cut when a phone is narrower than the stamp. 44 pixels tall, like
   * everything else in the panel below `md`, because a long press is aimed at it (BR-REQ-041-01
   * criterion 6).
   */
  const sx = {
    alignSelf: "flex-start",
    display: "flex",
    alignItems: "center",
    minHeight: 44,
    maxWidth: "100%",
    m: 0,
    color: "text.disabled",
    fontSize: "0.6875rem",
    lineHeight: 1.4,
    fontVariantNumeric: "tabular-nums",
    overflowWrap: "anywhere",
    pointerEvents: "none",
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
