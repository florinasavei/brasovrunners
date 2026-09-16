"use client";

import Box from "@mui/material/Box";
import Link from "@mui/material/Link";
import Typography from "@mui/material/Typography";
import Flag from "./Flag";
import { useLocale, useTranslations } from "next-intl";
import { usePathname } from "next/navigation";
import { routing } from "@/i18n/routing";

/**
 * Romanian or English, from anywhere on the site.
 *
 * Every link points at `/api/locale`, which resolves the switch on the server. That indirection
 * is the whole point: on an event page the two locales have different slugs — `tura-pe-tampa`
 * and `tampa-trail` are one event — so a switcher that swapped the locale prefix would land the
 * visitor on a 404, which is exactly what BR-REQ-040-01 criterion 5 forbids. Only the database
 * knows the pair, and this component renders in the header, above the page that loaded it.
 *
 * A Client Component for one reason: it needs the path the visitor is on. `usePathname` runs on
 * the server during the initial render too, so the anchors carry real `href`s in the HTML and
 * the switcher works with JavaScript disabled.
 *
 * `rel="nofollow"` because these are not content URLs. The alternate-locale links a crawler
 * should follow are the `hreflang` tags in the page metadata, which point straight at the real
 * page rather than through a redirect.
 */

/**
 * Which flag stands for which language.
 *
 * A language is not a country, so this mapping is a judgement rather than a lookup: Romanian
 * takes Romania, and English takes the United Kingdom because the site formats English as
 * `en-GB`. That is why the two-letter language code stays visible beside the flag and the
 * accessible name is the language in its own words — nobody should have to recognise a flag to
 * find their language.
 *
 * The files come from `flag-icons` (MIT), copied into `public/flags/` by
 * `scripts/sync-flags.mjs`. The set is there for the country field a participant will fill in
 * later; the switcher is its first, small use.
 */
const FLAG: Record<(typeof routing.locales)[number], string> = {
  ro: "ro",
  en: "gb",
};

export default function LocaleSwitcher() {
  const t = useTranslations("Site");
  const active = useLocale();
  const pathname = usePathname();

  return (
    <Box
      component="nav"
      aria-label={t("language")}
      sx={{ display: "flex", alignItems: "center", gap: 0.25, flexShrink: 0 }}
    >
      {routing.locales.map((locale) => {
        const isActive = locale === active;

        const content = (
          <>
            <Flag code={FLAG[locale]} width={16} />
            {t(`languageCode.${locale}`)}
          </>
        );

        const sx = {
          display: "inline-flex",
          alignItems: "center",
          gap: 0.5,
          fontSize: { xs: "0.75rem", sm: "0.8125rem" },
          // 44px is the minimum tap target (BR-REQ-041-01 criterion 6). The active label is not
          // a target, but it matches so the pair does not sit at two different heights.
          minHeight: 44,
          px: { xs: 0.5, sm: 0.75 },
        } as const;

        return isActive ? (
          // The current language is stated, not offered: a link to the page you are already on
          // is a dead control, and `aria-current` is what tells a screen reader which is which.
          <Typography key={locale} component="span" aria-current="true" sx={{ ...sx, fontWeight: 700 }}>
            {content}
          </Typography>
        ) : (
          <Link
            key={locale}
            href={`/api/locale?to=${locale}&from=${encodeURIComponent(pathname)}`}
            rel="nofollow"
            aria-label={t(`languageName.${locale}`)}
            sx={{ ...sx, fontWeight: 500 }}
          >
            {content}
          </Link>
        );
      })}
    </Box>
  );
}
