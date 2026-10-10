import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { routing } from "@/i18n/routing";
import { richTextEditorLabels } from "@/modules/content/rich-text/ui/labels";
import { shopPhotoLabels } from "@/modules/content/shop/ui/photo-labels";
import { productRefusalMessages } from "@/modules/content/shop/ui/product-words";
import ProductForm from "@/modules/content/shop/ui/ProductForm";
import ProductPicturesCard from "@/modules/content/shop/ui/ProductPicturesCard";
import ShopTabs from "@/modules/content/shop/ui/ShopTabs";
import { noticeDescribesMembersShop } from "@/modules/legal-documents/repository";
import { isStorageConfigured } from "@/modules/media/storage";
import { canManageShop } from "@/modules/staff-identity/domain/roles";
import { requireStaff } from "@/modules/staff-identity/session";
import { confirmWords } from "@/shared/feedback/confirm-words";
import GlyphButtonLink from "@/shared/ui/GlyphButtonLink";
import { TAP_TARGET } from "@/shared/ui/tap-target";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ error?: string }>;
};

export const dynamic = "force-dynamic";

/**
 * «Magazin» → «Adaugă un produs» (§697): the five cards for a product that does not exist yet — the
 * pictures' card saying they come after the first save, then the form. For `canManageShop` alone: a
 * reader of the shop gets the 404 any typed address gets, and the action asserts it again (BR-REQ-060-01).
 */
export default async function AdminShopNewProductPage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const actor = await requireStaff();
  if (!canManageShop(actor)) notFound();

  const { error } = await searchParams;
  const t = await getTranslations("Admin");
  const words = await confirmWords();
  const rich = richTextEditorLabels(await getTranslations("Admin.richText"));
  const noticeDescribes = await noticeDescribesMembersShop(getDb(), new Date());
  const messages = await productRefusalMessages(t);

  return (
    <Stack spacing={3}>
      <ShopTabs locale={locale} active="products" />

      <Box id="admin-alert" tabIndex={-1} sx={{ scrollMarginTop: 16 }}>
        {error && <Alert severity="error">{t(`errors.${error}`)}</Alert>}
      </Box>

      <Stack direction="row" sx={{ alignItems: "center", flexWrap: "wrap", gap: 1.5 }}>
        <GlyphButtonLink icon="undo" href="/admin/shop" variant="text" size="small" sx={TAP_TARGET}>
          {t("members.shop.backToList")}
        </GlyphButtonLink>
        <Typography variant="h1" sx={{ fontSize: "1.5rem" }}>
          {t("members.shop.add")}
        </Typography>
      </Stack>

      <ProductPicturesCard
        product={null}
        locale={locale}
        words={t}
        cancel={words.cancel}
        messages={messages}
        photoLabels={shopPhotoLabels(t, rich, t("members.shop.photo"))}
        storage={isStorageConfigured()}
        mayManage
      />
      <ProductForm product={null} locale={locale} words={t} cancel={words.cancel} messages={messages} rich={rich} noticeDescribes={noticeDescribes} />
    </Stack>
  );
}
