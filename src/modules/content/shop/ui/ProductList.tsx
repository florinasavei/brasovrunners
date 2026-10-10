import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { getTranslations } from "next-intl/server";
import { countForm } from "@/i18n/count-form";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import GlyphChip from "@/modules/events/ui/GlyphChip";
import { formatPrice } from "@/modules/content/shop/domain";
import type { AdminShopProduct } from "@/modules/content/shop/repository";
import TeamPhotoImage from "@/modules/content/team/ui/TeamPhotoImage";
import GlyphButton from "@/shared/ui/GlyphButton";
import GlyphButtonLink from "@/shared/ui/GlyphButtonLink";
import Panel from "@/shared/ui/Panel";
import SubmitButton from "@/shared/ui/SubmitButton";
import { TAP_TARGET } from "@/shared/ui/tap-target";
import { moveShopProductAction } from "@/app/[locale]/admin/shop/actions";

type Words = Awaited<ReturnType<typeof getTranslations<"Admin">>>;

/** The sizes on one line: «XS · S · M · L», «Mărime unică», with a stock after each where one is set. */
function sizesLine(product: AdminShopProduct, t: Words): string {
  return product.variants
    .map((variant) => {
      const label = variant.label ?? t("members.shop.oneSize");
      return variant.stock === null ? label : `${label}: ${variant.stock}`;
    })
    .join(" · ");
}

/**
 * «Produse» (§NNN): every product not archived, in the shop's order — the cover, the name, the
 * price, the sizes with their stock, whether members see it, how many orders name it — each a link
 * to its own page, and ↑ / ↓ for whoever manages the shop (the codes' arrows, which ask nothing).
 * «Adaugă un produs» opens the new product's page. The Organizer reads the list and is offered no arrow.
 */
export default function ProductList({ products, locale, words: t, mayManage }: { products: readonly AdminShopProduct[]; locale: Locale; words: Words; mayManage: boolean }) {
  const count = t(`members.shop.count.${countForm(products.length, locale)}`, { count: products.length });
  return (
    <Panel glyph="members" title={t("members.shop.productsHeading")} aside={count} intro={t("members.shop.help")} id="shop-products" data-testid="members-shop">
      <Stack spacing={1.5}>
        {mayManage && (
          <Box>
            <GlyphButtonLink icon="add" href="/admin/shop/products/new" variant="contained" sx={TAP_TARGET} data-testid="product-add-link">
              {t("members.shop.add")}
            </GlyphButtonLink>
          </Box>
        )}
        {products.length === 0 ? (
          <Typography variant="body2" data-testid="products-empty">
            {t("members.shop.empty")}
          </Typography>
        ) : (
          <Stack component="ol" spacing={1.5} sx={{ listStyle: "none", m: 0, p: 0 }} aria-label={t("members.shop.listLabel")}>
            {products.map((product, index) => (
              <ProductRow key={product.id} product={product} first={index === 0} last={index === products.length - 1} locale={locale} words={t} mayManage={mayManage} />
            ))}
          </Stack>
        )}
      </Stack>
    </Panel>
  );
}

function ProductRow({ product, first, last, locale, words: t, mayManage }: { product: AdminShopProduct; first: boolean; last: boolean; locale: Locale; words: Words; mayManage: boolean }) {
  const title = locale === "en" ? product.titleEn : product.titleRo;
  const href = getPathname({ locale, href: { pathname: "/admin/shop/products/[id]", params: { id: product.id } } });
  const hidden = (
    <>
      <input type="hidden" name="uiLocale" value={locale} />
      <input type="hidden" name="productId" value={product.id} />
    </>
  );
  return (
    <Box component="li" id={`product-${product.id}`} sx={{ border: 1, borderColor: "divider", borderRadius: 2, p: { xs: 1.5, sm: 2 }, scrollMarginTop: 16 }} data-testid="shop-product">
      <Stack direction="row" spacing={1.5} sx={{ alignItems: "flex-start" }}>
        {product.photo && <TeamPhotoImage src={product.photo.thumbUrl} photo={{ width: product.photo.width, height: product.photo.height, crop: product.photo.crop }} width={72} radius={6} />}
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, overflowWrap: "anywhere" }}>
            {title}
          </Typography>
          <Typography variant="body2">{formatPrice(product.priceBani, product.currency, locale)}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: "anywhere" }}>
            {t("members.shop.sizesLine", { sizes: sizesLine(product, t) })}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t(`members.shop.pictures.count.${countForm(product.pictures.length, locale)}`, { count: product.pictures.length })}
          </Typography>
        </Box>
      </Stack>
      <Stack direction="row" sx={{ mt: 0.5, flexWrap: "wrap", gap: 0.5 }}>
        <GlyphChip glyph={product.visible ? "visible" : "hidden"} color={product.visible ? "success" : "default"} label={product.visible ? t("members.shop.visible") : t("members.shop.hidden")} />
        {product.orders > 0 && <GlyphChip glyph="orders" variant="outlined" label={t(`members.shop.orders.${countForm(product.orders, locale)}`, { count: product.orders })} />}
        {(product.descriptionRoJson === null) !== (product.descriptionEnJson === null) && <GlyphChip glyph="language" variant="outlined" color="warning" label={t("members.shop.oneLanguage")} />}
      </Stack>
      <Stack direction="row" sx={{ mt: 1.5, flexWrap: "wrap", gap: 1 }}>
        <GlyphButton icon={mayManage ? "edit" : "preview"} href={href} variant="outlined" sx={TAP_TARGET} data-testid="product-open">
          {mayManage ? t("members.shop.edit") : t("members.shop.open")}
        </GlyphButton>
        {mayManage && !first && (
          <Box component="form" action={moveShopProductAction}>
            {hidden}
            <input type="hidden" name="direction" value="up" />
            <SubmitButton label="↑" pendingLabel="↑" variant="outlined" ariaLabel={t("members.shop.moveUp", { title })} />
          </Box>
        )}
        {mayManage && !last && (
          <Box component="form" action={moveShopProductAction}>
            {hidden}
            <input type="hidden" name="direction" value="down" />
            <SubmitButton label="↓" pendingLabel="↓" variant="outlined" ariaLabel={t("members.shop.moveDown", { title })} />
          </Box>
        )}
      </Stack>
    </Box>
  );
}
