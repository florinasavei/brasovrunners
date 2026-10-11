import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { getTranslations } from "next-intl/server";
import type { richTextEditorLabels } from "@/modules/content/rich-text/ui/labels";
import LazyRichTextEditor from "@/modules/content/rich-text/ui/LazyRichTextEditor";
import { PRODUCT_DESCRIPTION_MAX } from "@/modules/content/shop/fields";
import type { AdminShopProduct } from "@/modules/content/shop/repository";
import LocaleTabPanels from "@/shared/ui/LocaleTabPanels";
import Panel from "@/shared/ui/Panel";

type Words = Awaited<ReturnType<typeof getTranslations<"Admin">>>;

const LANGUAGES = [
  { locale: "ro", code: "RO", suffix: "Ro" },
  { locale: "en", code: "EN", suffix: "En" },
] as const;

/**
 * «Descrierea» (§697; the owner: «I need that rich text editor so I can add table and pictures»):
 * the product's words in the editor every page and event already uses — tables and pictures allowed,
 * the material, the care, the supplier's drawing — one language per tab (§572), both or neither
 * (§352), each editor mounting only when its fold is opened (§96). The save writes the document and
 * its plain twin (§474).
 */
export default function ProductDescriptionCard({
  product,
  words: t,
  rich,
}: {
  product: AdminShopProduct | null;
  words: Words;
  rich: ReturnType<typeof richTextEditorLabels>;
}) {
  const docs = { ro: product?.descriptionRoJson ?? null, en: product?.descriptionEnJson ?? null };
  return (
    <Panel glyph="description" title={t("members.shop.cards.description")} intro={t("members.shop.cards.descriptionHelp")} id="product-description" data-testid="product-description-card">
      <Stack spacing={1.5}>
        <LocaleTabPanels
          idPrefix="product-description"
          watch={{ names: ["description{Locale}Body"], rule: "parity" }}
          markLabel={t("members.shop.tabEmpty")}
          panels={LANGUAGES.map((language) => ({
            locale: language.locale,
            label: language.code,
            incompleteLabel: docs[language.locale] === null ? t("members.shop.tabEmpty") : undefined,
            content: (
              <LazyRichTextEditor
                name={`description${language.suffix}Body`}
                label={t(`members.shop.description${language.suffix}`)}
                summary={t(`members.shop.description${language.suffix}`)}
                emptyHint={t("members.shop.descriptionEmpty")}
                initialBody={docs[language.locale]}
                accessibleSuffix={language.code}
                labels={rich}
              />
            ),
          }))}
        />
        <Typography variant="caption" color="text.secondary" sx={{ px: 1.75 }}>
          {t("members.shop.descriptionHelp", { max: PRODUCT_DESCRIPTION_MAX })}
        </Typography>
      </Stack>
    </Panel>
  );
}
