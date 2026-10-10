import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import type { getTranslations } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import type { AdminShopProduct } from "@/modules/content/shop/repository";
import ActionForm from "@/shared/forms/ActionForm";
import GlyphButton from "@/shared/ui/GlyphButton";
import Panel from "@/shared/ui/Panel";
import { deleteShopProductAction } from "@/app/[locale]/admin/shop/actions";

type Words = Awaited<ReturnType<typeof getTranslations<"Admin">>>;

/**
 * The product page's last card (§697, the rule of §683): «Șterge» a product no order names, «Arhivează»
 * one with any order — out of the shop and the list, its row kept for the orders' filter, every order
 * keeping its own copy. Asked first; the answer lands on the list.
 */
export default function ProductRemoveCard({ product, locale, words: t, cancel }: { product: AdminShopProduct; locale: Locale; words: Words; cancel: string }) {
  const title = locale === "en" ? product.titleEn : product.titleRo;
  const archives = product.orders > 0;
  return (
    <Panel glyph="publication" tone="danger" title={archives ? t("members.shop.archive") : t("members.shop.delete")} intro={archives ? t("members.shop.archiveBody") : t("members.shop.deleteBody")} id="product-remove" data-testid="product-remove-card">
      <ActionForm
        action={deleteShopProductAction}
        confirm={{
          title: t("members.shop.deleteTitle", { title }),
          body: archives ? t("members.shop.archiveBody") : t("members.shop.deleteBody"),
          confirmLabel: archives ? t("members.shop.archive") : t("members.shop.delete"),
          cancelLabel: cancel,
          destructive: true,
        }}
      >
        <input type="hidden" name="uiLocale" value={locale} />
        <input type="hidden" name="productId" value={product.id} />
        <Box>
          <GlyphButton icon={archives ? "archive" : "delete"} type="submit" variant="outlined" color="error" sx={{ minHeight: 44 }}>
            {archives ? t("members.shop.archive") : t("members.shop.delete")}
          </GlyphButton>
        </Box>
        {archives && (
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
            {t("members.shop.archiveWhy")}
          </Typography>
        )}
      </ActionForm>
    </Panel>
  );
}
