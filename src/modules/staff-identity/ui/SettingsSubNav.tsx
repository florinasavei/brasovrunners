import MailIcon from "@mui/icons-material/Mail";
import PaidIcon from "@mui/icons-material/Paid";
import PaletteIcon from "@mui/icons-material/Palette";
import SettingsIcon from "@mui/icons-material/Settings";
import ShieldIcon from "@mui/icons-material/Shield";
import TimerIcon from "@mui/icons-material/Timer";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import SubNav, { type SubNavItem } from "@/shared/ui/SubNav";
import type { StaffRole } from "../domain/roles";
import {
  CONFIGURATION_TAB,
  offersConfigurationTab,
  SETTINGS_TAB_ROUTE,
  type SettingsRowEntry,
  visibleSettingsTabs,
} from "../domain/settings-tabs";

/**
 * The picture before each tab's words (§318 as amended 2026-09-27: a glyph before every tab, fold
 * and button; the owner, 2026-10-18: «vreau și la subtaburi să am iconițe»). The same files as the
 * cards' glyphs (`shared/ui/panel-glyphs.ts`) where the subject is the same — the mail, the timer
 * of «Termene», the palette of «Aspect», the coin of «Costuri» — so a tab and the card it opens
 * read as one thing; the shield is the anti-robot check, the gear the platform's configuration.
 * Elements, not names, as «Pagini» does (`PagesSubNav`): `SubNav` is a Server Component end to
 * end, so nothing here crosses into a client island.
 */
const TAB_GLYPH: Record<SettingsRowEntry, ReactNode> = {
  emails: <MailIcon />,
  deadlines: <TimerIcon />,
  appearance: <PaletteIcon />,
  costs: <PaidIcon />,
  platform: <ShieldIcon />,
  configuration: <SettingsIcon />,
};

/**
 * «Setări»'s one row of secondary tabs (§360, §516): «Emailuri», «Termene», «Aspect», «Costuri»,
 * «Anti-robot», and «Configurație» (`/devs`) last — each role offered the tabs its gates
 * open (`visibleSettingsTabs`, `offersConfigurationTab`), the current one marked with
 * `aria-current`. Every tab page renders this first and nothing above it, `/devs` included: the row
 * is the way between them, and the main bar's «Setări» is the way back — no tab carries an
 * «← Înapoi la …» of its own.
 *
 * **One row, never two (§360, §520).** `/devs` has three panels of its own (§265); it hands them in as
 * `configurationPanels`, and they take «Configurație»'s place in this row — «Configurație» (the
 * status), «Configurație · General», «Configurație · Emailuri» — rather than drawing a second row of
 * tabs under this one.
 *
 * A Server Component of anchors, like every `SubNav`: the hrefs are resolved here, because
 * `getPathname` is a server function and `SubNav` takes strings.
 */
export default async function SettingsSubNav({
  locale,
  role,
  active,
  configurationPanels,
}: {
  locale: Locale;
  role: StaffRole;
  active: SettingsRowEntry;
  /** `/devs`'s own panels, drawn in place of the single «Configurație» entry (§520). */
  configurationPanels?: readonly SubNavItem[];
}) {
  const t = await getTranslations("Admin");

  return (
    <SubNav
      label={t("nav.settings")}
      items={[
        ...visibleSettingsTabs(role).map((tab) => ({
          href: getPathname({ locale, href: SETTINGS_TAB_ROUTE[tab] }),
          label: t(`settingsTabs.${tab}`),
          active: tab === active,
          glyph: TAB_GLYPH[tab],
        })),
        ...(!offersConfigurationTab(role)
          ? []
          : configurationPanels && configurationPanels.length > 0
            ? configurationPanels.map((panel) => ({ ...panel, glyph: panel.glyph ?? TAB_GLYPH.configuration }))
            : [
                {
                  href: getPathname({ locale, href: "/devs" }),
                  label: t("settingsTabs.configuration"),
                  active: active === CONFIGURATION_TAB,
                  glyph: TAB_GLYPH.configuration,
                },
              ]),
      ]}
    />
  );
}
