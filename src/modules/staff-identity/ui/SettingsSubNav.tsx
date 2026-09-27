import { getTranslations } from "next-intl/server";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import SubNav from "@/shared/ui/SubNav";
import type { StaffRole } from "../domain/roles";
import { SETTINGS_TAB_ROUTE, type SettingsTab, visibleSettingsTabs } from "../domain/settings-tabs";

/**
 * «Setări»'s one row of secondary tabs (§360, §NNN): «Emailuri», «Termene», «Contact», «Aspect»,
 * «Costuri», «Platformă» — each role offered the tabs its gates open (`visibleSettingsTabs`), the
 * current one marked with `aria-current`. Every tab page renders this first and nothing above it:
 * the row is the way between them, and the main bar's «Setări» is the way back — no tab carries
 * an «← Înapoi la …» of its own.
 *
 * A Server Component of anchors, like every `SubNav`: the hrefs are resolved here, because
 * `getPathname` is a server function and `SubNav` takes strings.
 */
export default async function SettingsSubNav({ locale, role, active }: { locale: Locale; role: StaffRole; active: SettingsTab }) {
  const t = await getTranslations("Admin");

  return (
    <SubNav
      label={t("nav.settings")}
      items={visibleSettingsTabs(role).map((tab) => ({
        href: getPathname({ locale, href: SETTINGS_TAB_ROUTE[tab] }),
        label: t(`settingsTabs.${tab}`),
        active: tab === active,
      }))}
    />
  );
}
