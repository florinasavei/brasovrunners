"use client";

import Box from "@mui/material/Box";
import Link from "@mui/material/Link";
import { useLocale, useTranslations } from "next-intl";
import { usePathname } from "next/navigation";
import { routing } from "@/i18n/routing";
import { onlyUnderLook } from "@/theme/look";
import Flag, { LANGUAGE_FLAG } from "./Flag";
import { localeSwitchHref } from "./LocaleSwitcher";

/** The round button's side: the minimum tap target (BR-REQ-041-01 criterion 6). */
export const FLOATING_SWITCH_SIZE = 44;

/** How far above the footer's bar the button floats, in pixels. */
export const FLOATING_SWITCH_GAP = 12;

/**
 * The language under «Aspectul nou» (§NNN, amending §708 and §262): one small round button in the
 * bottom-right corner of the screen, on every public page, that stays there while the page scrolls.
 * The owner, 2026-10-11: «the language switchers are always on the bottom right». Under the look the
 * header's copy of `LocaleSwitcher` (from `sm`) and the footer's (on a phone) are `display: none`, so
 * exactly one «Limbă» navigation is announced at every width, and the header row has the room back.
 *
 * **One button, the other language.** The site has two languages, so the one press a visitor needs
 * is to the language they are not reading: the button shows that language's flag over its code
 * («EN» on a Romanian page, «RO» on an English one), and its name and tooltip are that language in
 * its own words («English», «Română») — never a flag alone. The link is `LocaleSwitcher`'s own:
 * `/api/locale`, which finds the page's other-language address on the server (an event's slugs
 * differ by language, BR-REQ-040-01 criterion 5), so it works with scripts off.
 *
 * **Where it floats.** The footer renders it, inside its sticky bar (`position: sticky; bottom: 0`),
 * absolutely placed just above the bar's top edge: the bar is on screen at every scroll position, so
 * the button is too, and when the «Despre club» fold opens the bar grows upward and carries the button
 * with it — it never sits over the bar's items or the fold's links. At the foot of a page the
 * mountain watermark (`LookWatermark`, drawn under the same setting) is the room above the bar, so the
 * page's own last control ends clear of it. The footer's stacking layer (1000) puts it over the page
 * and under the header, the ☰'s menu and every dialog.
 *
 * Drawn only inside the new look's scope (`onlyUnderLook`), so the backoffice, which renders the same
 * footer, never shows it. `inline` draws it in the flow, for the design page's side-by-side.
 *
 * A Client Component for `LocaleSwitcher`'s one reason: it needs the path the visitor is on.
 */
export default function FloatingLocaleSwitch({ inline = false }: { inline?: boolean }) {
  const t = useTranslations("Site");
  const active = useLocale();
  const pathname = usePathname();
  const other = routing.locales.find((locale) => locale !== active) ?? routing.defaultLocale;
  const name = t(`languageName.${other}`);

  return (
    <Box
      component="nav"
      aria-label={t("language")}
      data-testid="floating-language"
      sx={{
        ...onlyUnderLook("flex"),
        // A printed page has no use for a floating control (§NNN).
        "@media print": { display: "none !important" },
        ...(inline
          ? {}
          : {
              position: "absolute",
              right: "max(16px, env(safe-area-inset-right))",
              bottom: `calc(100% + ${FLOATING_SWITCH_GAP}px)`,
            }),
      }}
    >
      <Link
        href={localeSwitchHref(other, pathname)}
        rel="nofollow"
        hrefLang={other}
        aria-label={name}
        title={name}
        underline="none"
        sx={{
          width: FLOATING_SWITCH_SIZE,
          height: FLOATING_SWITCH_SIZE,
          borderRadius: "50%",
          display: "inline-flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "2px",
          bgcolor: "background.paper",
          color: "text.primary",
          border: 1,
          borderColor: "divider",
          boxShadow: 3,
          fontSize: "0.6875rem",
          fontWeight: 700,
          lineHeight: 1,
          "&:hover": { borderColor: "primary.main" },
        }}
      >
        <Flag code={LANGUAGE_FLAG[other]} width={16} />
        <Box component="span" aria-hidden="true">
          {t(`languageCode.${other}`)}
        </Box>
      </Link>
    </Box>
  );
}
