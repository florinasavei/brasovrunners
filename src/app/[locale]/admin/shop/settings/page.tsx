import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { routing } from "@/i18n/routing";
import { readShopSettings } from "@/modules/content/shop/settings";
import ShopSettingsCard from "@/modules/content/shop/ui/ShopSettingsCard";
import ShopTabs from "@/modules/content/shop/ui/ShopTabs";
import { canManageShop, canReadShop } from "@/modules/staff-identity/domain/roles";
import { requireStaff } from "@/modules/staff-identity/session";
import { confirmWords } from "@/shared/feedback/confirm-words";
import { refusalMessages } from "@/shared/forms/refusal-messages";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
};

export const dynamic = "force-dynamic";

/**
 * «Magazin» → «Setări» (§683; its own page since §697): «Cum se plătește» and «Cine primește
 * comenzile». Read by `canReadShop`; written by `canManageShop`, asserted by the action and the
 * service (BR-REQ-060-01).
 */
export default async function AdminShopSettingsPage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const actor = await requireStaff();
  if (!canReadShop(actor)) notFound();

  const { saved, error } = await searchParams;
  const t = await getTranslations("Admin");
  const words = await confirmWords();
  const settings = await readShopSettings(getDb());
  const messages = await refusalMessages({
    paymentRo: t("members.shop.paymentRo"),
    paymentEn: t("members.shop.paymentEn"),
    ordersTo: t("members.shop.ordersTo"),
  });

  return (
    <Stack spacing={3}>
      <ShopTabs locale={locale} active="settings" />

      <Box id="admin-alert" tabIndex={-1} sx={{ scrollMarginTop: 16 }}>
        {saved && <Alert severity="success">{t("saved")}</Alert>}
        {error && <Alert severity="error">{t(`errors.${error}`)}</Alert>}
      </Box>

      <ShopSettingsCard settings={settings} locale={locale} words={t} cancel={words.cancel} messages={messages} mayManage={canManageShop(actor)} />
    </Stack>
  );
}
