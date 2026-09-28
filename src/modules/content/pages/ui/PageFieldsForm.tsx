import Stack from "@mui/material/Stack";
import { getTranslations } from "next-intl/server";
import { routing } from "@/i18n/routing";
import RichTextEditor from "@/modules/content/rich-text/ui/RichTextEditor";
import { textFieldConstraints } from "@/shared/forms/constraints";
import RecallField from "@/shared/forms/recall";
import LocaleTabPanels from "@/shared/ui/LocaleTabPanels";
import { richTextEditorLabels } from "@/modules/content/rich-text/ui/labels";
import TranslateAllButton from "@/modules/translate/ui/TranslateAllButton";
import TranslateFieldButton from "@/modules/translate/ui/TranslateFieldButton";
import { pageInputConstraints, pageTranslationConstraints } from "../constraints";

export type EditablePageTranslation = {
  locale: string;
  slug: string;
  title: string;
  bodyJson: unknown;
  seoTitle: string | null;
  seoDescription: string | null;
};

/**
 * The page editor's fields: the nav order, then one tab per language (§259). Every box comes back
 * as typed after a refused submit, rich text included (§315).
 */
export default async function PageFieldsForm({
  navOrder,
  translations,
  slugLocked,
  pageId,
}: {
  navOrder: number;
  translations: readonly EditablePageTranslation[];
  /** AGENTS.md §11.5: a published page's address is stable. */
  slugLocked: boolean;
  /** «Din galerie» in the text opens on «Această pagină» (§485). None on create. */
  pageId?: string;
}) {
  const t = await getTranslations("Admin.pages");
  // The client editor cannot read the catalogue, so its labels are resolved here (AGENTS.md §9.3).
  const rt = await getTranslations("Admin.richText");
  const box = (field: Parameters<typeof pageTranslationConstraints>[0]) => textFieldConstraints(pageTranslationConstraints(field));

  return (
    <Stack spacing={3}>
      <RecallField
        name="navOrder"
        label={t("navOrder")}
        helperText={t("navOrderHelp")}
        defaultValue={String(navOrder)}
        {...textFieldConstraints(pageInputConstraints("navOrder"), { inputMode: "numeric" })}
        sx={{ maxWidth: 220 }}
      />

      {/* §464, §482. */}
      <TranslateAllButton />

      <LocaleTabPanels
        idPrefix="locale"
        // §514.
        translateCard
        panels={routing.locales.map((locale) => {
          const translation = translations.find((row) => row.locale === locale);
          const name = (field: string) => `translations.${locale}.${field}`;
          // Under each English box only (§464).
          const translate = (field: string) => (locale === "en" ? <TranslateFieldButton en={name(field)} /> : null);

          return {
            locale,
            label: t(`language.${locale}`),
            content: (
              <Stack spacing={2} sx={{ pt: 2 }}>
              <RecallField
                name={name("title")}
                label={t("fields.title")}
                defaultValue={translation?.title ?? ""}
                {...box("title")}
              />
              {translate("title")}
              <RecallField
                name={name("slug")}
                label={t("fields.slug")}
                helperText={slugLocked ? t("slugLocked") : t("slugHelp")}
                defaultValue={translation?.slug ?? ""}
                {...box("slug")}
                slotProps={{ input: { readOnly: slugLocked }, htmlInput: pageTranslationConstraints("slug") }}
              />
              <RichTextEditor
                name={name("body")}
                label={t("fields.body")}
                initialBody={translation?.bodyJson}
                accessibleSuffix={t(`language.${locale}`)}
                pictureScope={pageId ? { kind: "page", id: pageId } : undefined}
                labels={richTextEditorLabels(rt)}
              />
              {translate("body")}
              <RecallField
                name={name("seoTitle")}
                label={t("fields.seoTitle")}
                helperText={t("seoHelp")}
                defaultValue={translation?.seoTitle ?? ""}
                {...box("seoTitle")}
              />
              {translate("seoTitle")}
              <RecallField
                name={name("seoDescription")}
                label={t("fields.seoDescription")}
                helperText={t("seoHelp")}
                defaultValue={translation?.seoDescription ?? ""}
                multiline
                minRows={2}
                {...box("seoDescription")}
              />
              {translate("seoDescription")}
              </Stack>
            ),
          };
        })}
      />
    </Stack>
  );
}
