import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { routing } from "@/i18n/routing";
import RichTextEditor from "@/modules/content/rich-text/ui/RichTextEditor";
import { richTextEditorLabels } from "@/modules/content/rich-text/ui/labels";

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
 * ## Why both languages are on one screen rather than behind tabs
 *
 * The event editor uses a tab per language, and it is right there: an event carries thirty
 * fields and two panels of thirty do not fit. A page carries four. Both languages visible at
 * once is what makes "the English one is empty" obvious *before* somebody presses publish and
 * is told so by a validation error (`AGENTS.md` §11.2).
 *
 * ## Why a textarea rather than a rich-text editor
 *
 * The same reason `DECISIONS.md` §46 gave for legal documents: the Tiptap body contract is M5,
 * and pulling it forward to write an About page would decide that schema for the wrong reason.
 * The format is the one the legal editor already uses and this converts with the same module —
 * a blank line between paragraphs, `## ` for a heading, and it round-trips, so nothing an
 * organizer typed is reshaped behind their back.
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

  return (
    <Stack spacing={3}>
      <TextField
        name="navOrder"
        label={t("navOrder")}
        helperText={t("navOrderHelp")}
        defaultValue={String(navOrder)}
        inputMode="numeric"
        sx={{ maxWidth: 220 }}
      />

      {routing.locales.map((locale) => {
        const translation = translations.find((row) => row.locale === locale);
        const name = (field: string) => `translations.${locale}.${field}`;

        return (
          <Box
            key={locale}
            sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: { xs: 2, sm: 3 } }}
          >
            <Typography variant="h2" sx={{ fontSize: "1.125rem", mb: 2 }}>
              {t(`language.${locale}`)}
            </Typography>
            <Stack spacing={2}>
              <TextField
                name={name("title")}
                label={t("fields.title")}
                defaultValue={translation?.title ?? ""}
                required
              />
              <TextField
                name={name("slug")}
                label={t("fields.slug")}
                helperText={slugLocked ? t("slugLocked") : t("slugHelp")}
                defaultValue={translation?.slug ?? ""}
                required
                slotProps={{ input: { readOnly: slugLocked } }}
              />
              <RichTextEditor
                name={name("body")}
                label={t("fields.body")}
                initialBody={translation?.bodyJson}
                accessibleSuffix={t(`language.${locale}`)}
                labels={richTextEditorLabels(rt)}
              />
              <TextField
                name={name("seoTitle")}
                label={t("fields.seoTitle")}
                defaultValue={translation?.seoTitle ?? ""}
              />
              <TextField
                name={name("seoDescription")}
                label={t("fields.seoDescription")}
                defaultValue={translation?.seoDescription ?? ""}
                multiline
                minRows={2}
              />
            </Stack>
          </Box>
        );
      })}
    </Stack>
  );
}

