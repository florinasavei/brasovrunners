import { getTranslations } from "next-intl/server";
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
 * «Setări»'s one row of secondary tabs (§360, §NNN): «Emailuri», «Termene», «Contact», «Aspect»,
 * «Costuri», «Platformă», and «Configurație» (`/devs`) last — each role offered the tabs its gates
 * open (`visibleSettingsTabs`, `offersConfigurationTab`), the current one marked with
 * `aria-current`. Every tab page renders this first and nothing above it, `/devs` included: the row
 * is the way between them, and the main bar's «Setări» is the way back — no tab carries an
 * «← Înapoi la …» of its own.
 *
 * **One row, never two (§360, §NNN).** `/devs` has three panels of its own (§265); it hands them in as
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
  /** `/devs`'s own panels, drawn in place of the single «Configurație» entry (§NNN). */
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
        })),
        ...(!offersConfigurationTab(role)
          ? []
          : configurationPanels && configurationPanels.length > 0
            ? configurationPanels
            : [{ href: getPathname({ locale, href: "/devs" }), label: t("settingsTabs.configuration"), active: active === CONFIGURATION_TAB }]),
      ]}
    />
  );
}
