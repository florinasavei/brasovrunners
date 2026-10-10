import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { getTranslations } from "next-intl/server";
import type { AdminShopProduct } from "@/modules/content/shop/repository";
import { RecallCheckbox } from "@/shared/forms/recall";
import GlyphSubmitButton from "@/shared/ui/GlyphSubmitButton";
import Panel from "@/shared/ui/Panel";

type Words = Awaited<ReturnType<typeof getTranslations<"Admin">>>;

/**
 * «Publicarea» (§NNN): «Vizibil în magazin» — members see the product and may order it — and the
 * form's one button: «Adaugă produsul» for a new product (which then opens on its own page, where
 * its pictures are added), «Salvează» for one that exists. A hidden product is being prepared;
 * the club may still place an order on it for a member (§690).
 */
export default function ProductPublishCard({ product, words: t, noticeDescribes }: { product: AdminShopProduct | null; words: Words; noticeDescribes: boolean }) {
  return (
    <Panel glyph="publication" title={t("members.shop.cards.publish")} intro={noticeDescribes ? t("members.shop.cards.publishHelp") : t("members.shop.noticeMissing")} id="product-publish" data-testid="product-publish-card">
      <Stack spacing={1.5}>
        <Box component="label" sx={{ display: "inline-flex", alignItems: "center", gap: 1, minHeight: 44, cursor: "pointer" }}>
          <RecallCheckbox name="visible" defaultChecked={product?.visible ?? false} style={{ width: 20, height: 20 }} />
          <Typography component="span" variant="body2">
            {t("members.shop.visibleSwitch")}
          </Typography>
        </Box>
        {!product && (
          <Typography variant="body2" color="text.secondary">
            {t("members.shop.pictures.afterSave")}
          </Typography>
        )}
        <Box>
          <GlyphSubmitButton label={product ? t("editor.save") : t("members.shop.create")} pendingLabel={t("editor.saving")} icon={product ? "save" : "add"} size="medium" />
        </Box>
      </Stack>
    </Panel>
  );
}
