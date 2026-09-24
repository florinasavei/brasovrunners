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
      /*
        Side by side at every width since §365 — RO and EN on one line, each 44px tall.

        It was stacked on a phone, RO over EN, by the owner's instruction on 2026-09-17: side by
        side the pair is ~100px wide, stacked ~46px, and that difference is what let the first
        section of the site sit on the header row beside the menu at 320px. Since §262 a phone's
        switcher is not on the header row at all — the header's copy is `display: none` below
        `sm` — but the footer's row, beside the privacy notice.

        Since §NNN (the owner, 2026-09-24: "all in 1 row … all visible, smaller") the footer's
        whole bar is one row on a phone, so the pair shrinks there too: the flag drops (the
        language code alone still says which is which) and the target is 32px, not 44 — this
        component's only user below `sm` is the footer, so the shrink never reaches the header's
        own copy, which stays hidden there and full-size from `sm` up.
      */
      sx={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        // Zero at `xs` (§NNN): the footer's one row needs every pixel it can get at 320px
        // (finding 1); `sm` up is the header's own copy, unchanged.
        gap: { xs: 0, sm: 0.25 },
        flexShrink: 0,
      }}
    >
      {routing.locales.map((locale) => {
        const isActive = locale === active;

        const content = (
          <>
            <Box component="span" sx={{ display: { xs: "none", sm: "inline-flex" } }}>
              <Flag code={FLAG[locale]} width={16} />
            </Box>
            {t(`languageCode.${locale}`)}
          </>
        );

        const sx = {
          display: "inline-flex",
          alignItems: "center",
          gap: 0.5,
          fontSize: { xs: "0.75rem", sm: "0.8125rem" },
          // The footer's own exception, 32px on a phone (§NNN); 44px, the minimum tap target
          // (BR-REQ-041-01 criterion 6), from `sm` up and everywhere else this renders.
          minHeight: { xs: 32, sm: 44 },
          lineHeight: 1,
          // Tighter at `xs` (§NNN, finding 1): the footer's one row leaves 47px for the fold's
          // label at 320px unless every other item gives up its own air first.
          px: { xs: 0.25, sm: 0.75 },
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
