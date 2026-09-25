"use client";

import Box from "@mui/material/Box";
import Link from "@mui/material/Link";
import Typography from "@mui/material/Typography";
import Flag from "./Flag";
import { useLocale, useTranslations } from "next-intl";
import { usePathname } from "next/navigation";
import { routing } from "@/i18n/routing";
import { footerTargetSx, SM_UP } from "./footer-target";

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
 * `en-GB`. That is why, from `sm` up, the two-letter language code stays visible beside the
 * flag, and why at every width the accessible name and the tooltip are the language in its own
 * words — nobody should have to recognise a flag to find their language. On a phone the flag is
 * all that shows (§372, below); the name and the tooltip still say it in words.
 *
 * The files come from `flag-icons` (MIT), copied into `public/flags/` by
 * `scripts/sync-flags.mjs`. The set is there for the country field a participant will fill in
 * later; the switcher is its first, small use.
 */
const FLAG: Record<(typeof routing.locales)[number], string> = {
  ro: "ro",
  en: "gb",
};

/**
 * The two-letter code, on screen from `sm` up and read by a screen reader at every width. On a
 * phone it is clipped rather than `display: none`, so the current language — a `<span>`, which
 * cannot take a name of its own — still says "RO" to a screen reader.
 */
const CODE_SX = {
  position: "absolute",
  width: "1px",
  height: "1px",
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
  [SM_UP]: { position: "static", width: "auto", height: "auto", overflow: "visible", clip: "auto" },
} as const;

export default function LocaleSwitcher() {
  const t = useTranslations("Site");
  const active = useLocale();
  const pathname = usePathname();

  return (
    <Box
      component="nav"
      aria-label={t("language")}
      /*
        Side by side at every width since §365 — RO and EN on one line.

        It was stacked on a phone, RO over EN, by the owner's instruction on 2026-09-17: side by
        side the pair is ~100px wide, stacked ~46px, and that difference is what let the first
        section of the site sit on the header row beside the menu at 320px. Since §262 a phone's
        switcher is not on the header row at all — the header's copy is `display: none` below
        `sm` — but on the footer's bar.

        Since §372 (the owner, 2026-09-24: the bar keeps every item but not every word) the
        footer's bar is one row on a phone, and the pair is two flags there: no letters, each a
        square of the bar's target (`footer-target.ts`: 24px below 360, 28px from 360), the
        current one ringed as well as `aria-current`. From `sm` up — the header's copy, the only
        one shown there — it is the flag and the code at 44px, as before.
      */
      sx={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: { xs: 0, sm: 0.25 },
        flexShrink: 0,
      }}
    >
      {routing.locales.map((locale) => {
        const isActive = locale === active;
        const name = t(`languageName.${locale}`);

        const content = (
          <>
            <Box
              component="span"
              sx={{
                display: "inline-flex",
                borderRadius: "2px",
                // The current language, ringed on a phone where no bold code says which it is;
                // from `sm` the code's weight does, as it always did.
                ...(isActive && {
                  outline: "2px solid",
                  outlineColor: "primary.main",
                  outlineOffset: "1px",
                  [SM_UP]: { outline: "none" },
                }),
              }}
            >
              <Flag code={FLAG[locale]} width={16} />
            </Box>
            <Box component="span" sx={CODE_SX}>
              {t(`languageCode.${locale}`)}
            </Box>
          </>
        );

        const sx = {
          // A square of the bar's target on a phone (`footer-target.ts`), 44px — the minimum tap
          // target, BR-REQ-041-01 criterion 6 — from `sm` up and everywhere else this renders.
          ...footerTargetSx(["minHeight", "minWidth"]),
          position: "relative",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 0.5,
          fontSize: "0.8125rem",
          lineHeight: 1,
          px: { xs: 0, sm: 0.75 },
        } as const;

        return isActive ? (
          // The current language is stated, not offered: a link to the page you are already on
          // is a dead control, and `aria-current` is what tells a screen reader which is which.
          <Typography key={locale} component="span" aria-current="true" title={name} sx={{ ...sx, fontWeight: 700 }}>
            {content}
          </Typography>
        ) : (
          <Link
            key={locale}
            href={`/api/locale?to=${locale}&from=${encodeURIComponent(pathname)}`}
            rel="nofollow"
            aria-label={name}
            title={name}
            sx={{ ...sx, fontWeight: 500 }}
          >
            {content}
          </Link>
        );
      })}
    </Box>
  );
}
