import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import type { getTranslations } from "next-intl/server";
import { minorAsTyped, SHOP_CURRENCIES, type ShopCurrency } from "@/modules/content/shop/domain";
import { PRODUCT_TITLE_MAX } from "@/modules/content/shop/fields";
import type { AdminShopProduct } from "@/modules/content/shop/repository";
import TranslateAllButton from "@/modules/translate/ui/TranslateAllButton";
import RecallField from "@/shared/forms/recall";
import Panel from "@/shared/ui/Panel";

type Words = Awaited<ReturnType<typeof getTranslations<"Admin">>>;

/** Each currency's word in «Moneda», by its code — typed on `ShopCurrency`, so a third currency is a compile error here (§686). */
const CURRENCY_WORD: Record<ShopCurrency, "currencyRon" | "currencyEur"> = { RON: "currencyRon", EUR: "currencyEur" };

/**
 * «Denumirea și prețul» (§NNN): the product's name in Română and English — both required at every
 * save (§352) — and its price with «Moneda» beside it (lei or euro, never converted, §686).
 * The form's one «Copiază și tradu tot: RO → EN» (§482) sits at the top of this first card and
 * fills every English box of the form, the description's included.
 */
export default function ProductNameCard({ product, words: t }: { product: AdminShopProduct | null; words: Words }) {
  const pairSx = { display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 2 } as const;
  return (
    <Panel glyph="title" title={t("members.shop.cards.name")} intro={t("members.shop.cards.nameHelp")} id="product-name" data-testid="product-name-card">
      <Stack spacing={2}>
        <TranslateAllButton />
        <Box sx={pairSx}>
          <RecallField name="titleRo" label={t("members.shop.titleRo")} required fullWidth defaultValue={product?.titleRo ?? ""} slotProps={{ htmlInput: { maxLength: PRODUCT_TITLE_MAX, lang: "ro" } }} />
          <RecallField name="titleEn" label={t("members.shop.titleEn")} required fullWidth defaultValue={product?.titleEn ?? ""} slotProps={{ htmlInput: { maxLength: PRODUCT_TITLE_MAX, lang: "en" } }} />
        </Box>
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 2, alignItems: "flex-start" }}>
          <RecallField
            name="price"
            label={t("members.shop.price")}
            required
            defaultValue={product ? minorAsTyped(product.priceBani) : ""}
            helperText={t("members.shop.priceHelp")}
            slotProps={{ htmlInput: { inputMode: "decimal", maxLength: 12 } }}
            sx={{ flex: "1 1 160px", maxWidth: 260 }}
          />
          <RecallField
            select
            name="currency"
            label={t("members.shop.currency")}
            defaultValue={product?.currency ?? SHOP_CURRENCIES[0]}
            slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
            sx={{ flex: "0 1 180px", minWidth: 160 }}
          >
            {SHOP_CURRENCIES.map((currency) => (
              <option key={currency} value={currency}>
                {t(`members.shop.${CURRENCY_WORD[currency]}`)}
              </option>
            ))}
          </RecallField>
        </Box>
      </Stack>
    </Panel>
  );
}
