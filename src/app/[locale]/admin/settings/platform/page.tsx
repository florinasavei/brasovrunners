import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { routing } from "@/i18n/routing";
import { readBotCheck } from "@/modules/registrations/bot-check";
import BotCheckPanel from "@/modules/registrations/ui/BotCheckPanel";
import { canManagePlatform } from "@/modules/staff-identity/domain/roles";
import { canOpenSettingsTab } from "@/modules/staff-identity/domain/settings-tabs";
import { requireStaff } from "@/modules/staff-identity/session";
import SettingsSubNav from "@/modules/staff-identity/ui/SettingsSubNav";
import { env } from "@/shared/config/env";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** Returned to straight after a switch, so never cached (§254: it reads the setting it wrote). */
export const dynamic = "force-dynamic";

/**
 * «Setări» → «Anti-robot» (§516, «Platformă» until §NNN; it was `/admin/tasks` → «Anti-robot», which answers 308 here): the
 * anti-robot check — Cloudflare Turnstile and the hidden trap (§254, §282) — the one setting that
 * can stop the service and has no price, which is why it is not on «Costuri» beside the database's
 * brakes (§479 keeps those with their money). The Superadministrator switches it (`canManagePlatform`,
 * §450); an Administrator reads its state and who changes it.
 */
export default async function AdminPlatformPage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const actor = await requireStaff();
  if (!canOpenSettingsTab(actor.role, "platform")) notFound();

  const query = await searchParams;
  const t = await getTranslations("Admin.tasks");
  const tErrors = await getTranslations("Admin.errors");
  // Read straight through, because this page is where it is moved (§254).
  const botCheck = await readBotCheck(getDb());

  return (
    <Stack spacing={3}>
      <SettingsSubNav locale={locale} role={actor.role} active="platform" />

      <Box id="admin-alert" tabIndex={-1} sx={{ scrollMarginTop: 16 }}>
        {query.saved === "botCheckOn" && <Alert severity="success">{t("botCheck.savedOn")}</Alert>}
        {query.saved === "botCheckOff" && <Alert severity="warning">{t("botCheck.savedOff")}</Alert>}
        {query.saved === "honeypotOn" && <Alert severity="success">{t("botCheck.savedHoneypotOn")}</Alert>}
        {query.saved === "honeypotOff" && <Alert severity="warning">{t("botCheck.savedHoneypotOff")}</Alert>}
        {typeof query.error === "string" && <Alert severity="error">{tErrors(query.error)}</Alert>}
      </Box>

      <BotCheckPanel
        locale={locale}
        state={botCheck}
        keysPresent={Boolean(env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET_KEY)}
        mayEdit={canManagePlatform(actor.role)}
      />
    </Stack>
  );
}
