import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { routing } from "@/i18n/routing";
import { readSiteTint } from "@/modules/appearance/site-tint";
import SiteTintPanel from "@/modules/appearance/ui/SiteTintPanel";
import PagesSubNav from "@/modules/content/pages/ui/PagesSubNav";
import { canManageClubSettings, canReadContent } from "@/modules/staff-identity/domain/roles";
import { requireStaff } from "@/modules/staff-identity/session";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ saved?: string }>;
};

export const dynamic = "force-dynamic";

/**
 * Pagini → «Aspect» (§488): how the public pages look. Today one setting, the site's light
 * background tint. Read by whoever reads the club's content, like «Echipa» beside it (§459);
 * changed by the Administrator (`canManageClubSettings`, §450), which the action and the service
 * assert again (BR-REQ-060-01).
 */
export default async function AdminAppearancePage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const actor = await requireStaff();
  if (!canReadContent(actor.role)) notFound();

  const { saved } = await searchParams;
  const t = await getTranslations("Admin");
  const state = await readSiteTint(getDb());

  return (
    <Stack spacing={3}>
      <PagesSubNav locale={locale} active="appearance" />

      <Box id="admin-alert" tabIndex={-1} sx={{ scrollMarginTop: 16 }}>
        {saved === "siteTint" && <Alert severity="success">{t("appearance.saved")}</Alert>}
      </Box>

      <SiteTintPanel locale={locale} state={state} mayEdit={canManageClubSettings(actor.role)} />
    </Stack>
  );
}
