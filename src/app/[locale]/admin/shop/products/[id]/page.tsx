import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { routing } from "@/i18n/routing";
import GlyphChip from "@/modules/events/ui/GlyphChip";
import { richTextEditorLabels } from "@/modules/content/rich-text/ui/labels";
import { formatPrice } from "@/modules/content/shop/domain";
import { readProductForAdmin } from "@/modules/content/shop/repository";
import { shopPhotoLabels } from "@/modules/content/shop/ui/photo-labels";
import { productRefusalMessages } from "@/modules/content/shop/ui/product-words";
import ProductForm from "@/modules/content/shop/ui/ProductForm";
import ProductPicturesCard from "@/modules/content/shop/ui/ProductPicturesCard";
import ProductRemoveCard from "@/modules/content/shop/ui/ProductRemoveCard";
import ShopTabs from "@/modules/content/shop/ui/ShopTabs";
import { noticeDescribesMembersShop } from "@/modules/legal-documents/repository";
import { isStorageConfigured } from "@/modules/media/storage";
import { canManageShop, canReadShop } from "@/modules/staff-identity/domain/roles";
import { requireStaff } from "@/modules/staff-identity/session";
import { confirmWords } from "@/shared/feedback/confirm-words";
import GlyphButtonLink from "@/shared/ui/GlyphButtonLink";
import { TAP_TARGET } from "@/shared/ui/tap-target";

type Props = {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
};

export const dynamic = "force-dynamic";

/**
 * One product's page (§NNN): «Fotografiile» first — the strip with its own small forms — then the
 * product's one form in four cards (the name and the price, the description, the sizes and the
 * stock, the publication), and last «Șterge» / «Arhivează». Read by `canReadShop` (the Organizer sees
 * the cards and no button); every verb is `canManageShop`'s, asserted by its action and its service
 * (BR-REQ-060-01). A malformed id, an unknown one and an archived product are the same 404, after
 * the role check (criterion 21).
 */
export default async function AdminShopProductPage({ params, searchParams }: Props) {
  const { locale, id } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const actor = await requireStaff();
  if (!canReadShop(actor)) notFound();

  const db = getDb();
  const product = await readProductForAdmin(db, id);
  if (!product) notFound();

  const { saved, error } = await searchParams;
  const t = await getTranslations("Admin");
  const words = await confirmWords();
  const rich = richTextEditorLabels(await getTranslations("Admin.richText"));
  const noticeDescribes = await noticeDescribesMembersShop(db, new Date());
  const messages = await productRefusalMessages(t);
  const mayManage = canManageShop(actor);
  const title = locale === "en" ? product.titleEn : product.titleRo;

  return (
    <Stack spacing={3}>
      <ShopTabs locale={locale} active="products" />

      <Box id="admin-alert" tabIndex={-1} sx={{ scrollMarginTop: 16 }}>
        {saved && <Alert severity="success">{t("saved")}</Alert>}
        {error && <Alert severity="error">{t(`errors.${error}`)}</Alert>}
      </Box>

      <Stack direction="row" sx={{ alignItems: "center", flexWrap: "wrap", gap: 1.5 }}>
        <GlyphButtonLink icon="undo" href="/admin/shop" variant="text" size="small" sx={TAP_TARGET}>
          {t("members.shop.backToList")}
        </GlyphButtonLink>
        <Typography variant="h1" sx={{ fontSize: "1.5rem", overflowWrap: "anywhere" }} data-testid="product-title">
          {title}
        </Typography>
        <GlyphChip glyph="shop" variant="outlined" label={formatPrice(product.priceBani, product.currency, locale)} />
        <GlyphChip glyph={product.visible ? "visible" : "hidden"} color={product.visible ? "success" : "default"} label={product.visible ? t("members.shop.visible") : t("members.shop.hidden")} />
      </Stack>
      {!mayManage && <Alert severity="info">{t("members.shop.readOnly")}</Alert>}

      <ProductPicturesCard
        product={product}
        locale={locale}
        words={t}
        cancel={words.cancel}
        messages={messages}
        photoLabels={shopPhotoLabels(t, rich, t("members.shop.photo"))}
        storage={isStorageConfigured()}
        mayManage={mayManage}
      />
      {mayManage ? (
        <>
          <ProductForm product={product} locale={locale} words={t} cancel={words.cancel} messages={messages} rich={rich} noticeDescribes={noticeDescribes} />
          <ProductRemoveCard product={product} locale={locale} words={t} cancel={words.cancel} />
        </>
      ) : (
        <ReadOnlyProduct product={product} locale={locale} words={t} />
      )}
    </Stack>
  );
}

/** What a reader who may not manage the shop sees of the product beyond its pictures: the facts, no box. */
function ReadOnlyProduct({ product, locale, words: t }: { product: NonNullable<Awaited<ReturnType<typeof readProductForAdmin>>>; locale: "ro" | "en"; words: Awaited<ReturnType<typeof getTranslations<"Admin">>> }) {
  const sizes = product.variants.map((variant) => `${variant.label ?? t("members.shop.oneSize")}${variant.stock === null ? "" : `: ${variant.stock}`}`).join(" · ");
  const description = locale === "en" ? product.descriptionEn : product.descriptionRo;
  return (
    <Stack spacing={1} data-testid="product-read-only">
      <Typography variant="body2">{t("members.shop.sizesLine", { sizes })}</Typography>
      {description && (
        <Typography variant="body2" sx={{ whiteSpace: "pre-line" }}>
          {description}
        </Typography>
      )}
    </Stack>
  );
}
