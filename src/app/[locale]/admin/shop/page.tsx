import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { routing } from "@/i18n/routing";
import { listProductsForAdmin } from "@/modules/content/shop/repository";
import ProductList from "@/modules/content/shop/ui/ProductList";
import ShopTabs from "@/modules/content/shop/ui/ShopTabs";
import { noticeDescribesMembersShop } from "@/modules/legal-documents/repository";
import { canManageShop, canReadShop } from "@/modules/staff-identity/domain/roles";
import { requireStaff } from "@/modules/staff-identity/session";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
};

export const dynamic = "force-dynamic";

/**
 * «Magazin» → «Produse» (§687, §NNN): the product list, the first of the shop's three tabs — the
 * owner found the one card of folds «not intuitive at all», so the products, the orders and the
 * settings are each a page, and a product is a page of its own.
 *
 * Read by whoever reads the shop (`canReadShop`): the Organizer and the Administrators by role, and
 * a holder of the grant whatever their rung — the layout asks it first, for the status code, and
 * this page again. The arrows and «Adaugă un produs» are offered to `canManageShop` and asserted by
 * every action and service (BR-REQ-060-01).
 */
export default async function AdminShopPage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const actor = await requireStaff();
  if (!canReadShop(actor)) notFound();

  const { saved, error } = await searchParams;
  const t = await getTranslations("Admin");
  const db = getDb();
  const [products, noticeDescribes] = await Promise.all([listProductsForAdmin(db), noticeDescribesMembersShop(db, new Date())]);
  const mayManage = canManageShop(actor);
  const visible = products.filter((product) => product.visible).length;

  return (
    <Stack spacing={3}>
      <ShopTabs locale={locale} active="products" />

      <Box id="admin-alert" tabIndex={-1} sx={{ scrollMarginTop: 16 }}>
        {saved && <Alert severity="success">{t("saved")}</Alert>}
        {error && <Alert severity="error">{t(`errors.${error}`)}</Alert>}
      </Box>

      {!noticeDescribes && (
        <Alert severity={visible > 0 ? "warning" : "info"} data-testid="shop-notice-missing">
          {t("members.shop.noticeMissing")}
        </Alert>
      )}
      {!mayManage && <Alert severity="info">{t("members.shop.readOnly")}</Alert>}

      <ProductList products={products} locale={locale} words={t} mayManage={mayManage} />
    </Stack>
  );
}
