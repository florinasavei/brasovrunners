import Stack from "@mui/material/Stack";
import type { getTranslations } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import type { richTextEditorLabels } from "@/modules/content/rich-text/ui/labels";
import type { AdminShopProduct } from "@/modules/content/shop/repository";
import ActionForm, { type RefusalMessages } from "@/shared/forms/ActionForm";
import { RecallHidden } from "@/shared/forms/recall";
import { createShopProductAction, saveShopProductAction } from "@/app/[locale]/admin/shop/actions";
import ProductDescriptionCard from "./ProductDescriptionCard";
import ProductNameCard from "./ProductNameCard";
import ProductPublishCard from "./ProductPublishCard";
import ProductSizesCard from "./ProductSizesCard";

type Words = Awaited<ReturnType<typeof getTranslations<"Admin">>>;

/** The scope every box of the product form carries, so its ids never collide with a picture form's on the same page. */
export const PRODUCT_FORM_SCOPE = "product";

/**
 * The product's one form (§697): four cards in the order a person fills them — the name and the
 * price, the description, the sizes and the stock, the publication with the one button — posting
 * to `createShopProductAction` for a new product and `saveShopProductAction` for one that exists,
 * against the version it was loaded with (AGENTS.md §11.5). The pictures are not in it: they are
 * rows of their own with their own forms (`ProductPicturesCard`), drawn above this on the page.
 * A refusal returns every box as typed (§315) and names its card.
 */
export default function ProductForm({
  product,
  locale,
  words: t,
  cancel,
  messages,
  rich,
  noticeDescribes,
}: {
  product: AdminShopProduct | null;
  locale: Locale;
  words: Words;
  cancel: string;
  messages: RefusalMessages;
  rich: ReturnType<typeof richTextEditorLabels>;
  noticeDescribes: boolean;
}) {
  const cards = (
    <Stack spacing={2}>
      <ProductNameCard product={product} words={t} />
      <ProductDescriptionCard product={product} words={t} rich={rich} />
      <ProductSizesCard product={product} words={t} scope={PRODUCT_FORM_SCOPE} />
      <ProductPublishCard product={product} words={t} noticeDescribes={noticeDescribes} />
    </Stack>
  );
  // Two elements rather than one with a chosen action: the §384 guard reads each posting site's
  // question beside its action's name, so each form says its own.
  if (!product) {
    return (
      <ActionForm
        action={createShopProductAction}
        messages={messages}
        scope={PRODUCT_FORM_SCOPE}
        id="product-form"
        data-testid="product-create-form"
        confirm={{ title: t("members.shop.createTitle"), body: t("members.shop.createBody"), confirmLabel: t("members.shop.create"), cancelLabel: cancel }}
      >
        <input type="hidden" name="uiLocale" value={locale} />
        {cards}
      </ActionForm>
    );
  }
  const title = locale === "en" ? product.titleEn : product.titleRo;
  return (
    <ActionForm
      action={saveShopProductAction}
      messages={messages}
      scope={PRODUCT_FORM_SCOPE}
      id="product-form"
      data-testid={`product-save-${product.id}`}
      confirm={{ title: t("members.shop.saveTitle", { title }), body: t("members.shop.saveBody"), confirmLabel: t("editor.save"), cancelLabel: cancel }}
    >
      <input type="hidden" name="uiLocale" value={locale} />
      <input type="hidden" name="productId" value={product.id} />
      <RecallHidden name="expectedVersion" value={product.version} />
      {cards}
    </ActionForm>
  );
}
