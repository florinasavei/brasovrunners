import Stack from "@mui/material/Stack";
import { getTranslations } from "next-intl/server";
import { routing } from "@/i18n/routing";
import RichTextEditor from "@/modules/content/rich-text/ui/RichTextEditor";
import { textFieldConstraints } from "@/shared/forms/constraints";
import RecallField from "@/shared/forms/recall";
import LocaleTabPanels from "@/shared/ui/LocaleTabPanels";
import { richTextEditorLabels } from "@/modules/content/rich-text/ui/labels";
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
 * The whole page editor's fields: the nav order, then one block per language.
 *
 * ## One tab per language, as everywhere else (§259)
 *
 * This form stacked the two languages and argued for it: a page carries four fields, and both
 * languages at once makes "the English one is empty" obvious before somebody presses publish.
 * The argument stopped being true when the body became a rich-text editor — two editors stacked
 * is two screens of scrolling to reach the English title — and the owner asked for the
 * consistency outright: "hai să fim consistenți". The incompleteness it was protecting is still
 * caught, by the publish rule itself (`AGENTS.md` §11.2) and by the tab's own "incomplet" mark.
 *
 * ## Why a textarea rather than a rich-text editor
 *
 * The same reason `DECISIONS.md` §46 gave for legal documents: the Tiptap body contract is M5,
 * and pulling it forward to write an About page would decide that schema for the wrong reason.
 * The format is the one the legal editor already uses and this converts with the same module —
 * a blank line between paragraphs, `## ` for a heading, and it round-trips, so nothing an
 * organizer typed is reshaped behind their back.
 *
 * ## After a refused submit
 *
 * Every box comes back as typed, the rich text included (§315): the fields are `RecallField`s
 * and the editor re-mounts from the posted document. Each box carries what `fields.ts`
 * requires of it, so the browser refuses a missing title or a malformed address first.
 */
export default async function PageFieldsForm({
  navOrder,
  translations,
  slugLocked,
}: {
  navOrder: number;
  translations: readonly EditablePageTranslation[];
  /** AGENTS.md §11.5: a published page's address is stable. */
  slugLocked: boolean;
}) {
  const t = await getTranslations("Admin.pages");
  // The editor is a client island and cannot read the catalogue itself, so its control names are
  // resolved here and passed down (AGENTS.md §9.3: no user-facing string in code).
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

      <LocaleTabPanels
        idPrefix="locale"
        panels={routing.locales.map((locale) => {
          const translation = translations.find((row) => row.locale === locale);
          const name = (field: string) => `translations.${locale}.${field}`;

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
                labels={richTextEditorLabels(rt)}
              />
              <RecallField
                name={name("seoTitle")}
                label={t("fields.seoTitle")}
                helperText={t("seoHelp")}
                defaultValue={translation?.seoTitle ?? ""}
                {...box("seoTitle")}
              />
              <RecallField
                name={name("seoDescription")}
                label={t("fields.seoDescription")}
                helperText={t("seoHelp")}
                defaultValue={translation?.seoDescription ?? ""}
                multiline
                minRows={2}
                {...box("seoDescription")}
              />
              </Stack>
            ),
          };
        })}
      />
    </Stack>
  );
}
