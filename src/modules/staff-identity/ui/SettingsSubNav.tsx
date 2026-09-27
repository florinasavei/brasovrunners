import { getTranslations } from "next-intl/server";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import SubNav from "@/shared/ui/SubNav";
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
 * A Server Component of anchors, like every `SubNav`: the hrefs are resolved here, because
 * `getPathname` is a server function and `SubNav` takes strings.
 */
export default async function SettingsSubNav({ locale, role, active }: { locale: Locale; role: StaffRole; active: SettingsRowEntry }) {
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
        ...(offersConfigurationTab(role)
          ? [{ href: getPathname({ locale, href: "/devs" }), label: t("settingsTabs.configuration"), active: active === CONFIGURATION_TAB }]
          : []),
      ]}
    />
  );
}
