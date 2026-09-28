import Box from "@mui/material/Box";
import { getTranslations } from "next-intl/server";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { canManageStaff, canReadContent, type StaffRole } from "@/modules/staff-identity/domain/roles";
import { canOpenSettingsTab } from "@/modules/staff-identity/domain/settings-tabs";
import { type TaskTarget, targetRoute } from "../domain/task-targets";

/**
 * Where a row of «Sarcini» → «Club» is done (§516): one link under the row, named by the
 * navigation's own words — «Setări → Costuri», «Pagini → Contact», «Documente legale» — and opening the card through
 * its `#` (`OpenFoldFromHash`, §336). Nothing for a row with no target, or for a place the reader
 * may not open (the rows are the Administrator's, who opens them all; the gate is asked all the same).
 *
 * A Server Component of one anchor, 44 pixels tall (BR-REQ-041-01 criterion 6).
 */
export default async function TaskTargetLink({ locale, role, target }: { locale: Locale; role: StaffRole; target: TaskTarget | undefined }) {
  if (!target) return null;
  const allowed =
    target.kind === "settings"
      ? canOpenSettingsTab(role, target.tab)
      : target.kind === "pages"
        ? canReadContent(role)
        : target.section === "staff"
          ? canManageStaff(role)
          : canReadContent(role);
  if (!allowed) return null;
  const t = await getTranslations("Admin");
  const route = targetRoute(target);
  const path = getPathname({ locale, href: route.pathname });
  const label =
    target.kind === "settings"
      ? `${t("nav.settings")} → ${t(`settingsTabs.${target.tab}`)}`
      : target.kind === "pages"
        ? `${t("nav.pages")} → ${t("pages.tabContact")}`
        : t(`nav.${target.section}`);

  return (
    <Box
      component="a"
      href={route.hash ? `${path}#${route.hash}` : path}
      data-testid="task-target"
      sx={{ display: "inline-flex", alignItems: "center", minHeight: 44, fontSize: "0.875rem", fontWeight: 500 }}
    >
      {label}
    </Box>
  );
}
