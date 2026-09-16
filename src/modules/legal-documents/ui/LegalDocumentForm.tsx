import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import type { LegalDocumentKey } from "@/db/schema/legal-documents";
import { bodyToText } from "../domain/body-text";
import type { LegalDocumentBody } from "../domain/content-hash";

export type LegalDocumentFormValues = {
  key: LegalDocumentKey;
  ro: { title: string; body: LegalDocumentBody };
  en: { title: string; body: LegalDocumentBody };
};

/**
 * One form for writing a legal document, used to create a version and to correct a draft.
 *
 * Both languages on one screen rather than a tab each: they must both exist before the version
 * can be approved (BR-REQ-040-02 forbids falling back to the other), and a form that lets
 * somebody finish one and leave is a form that produces half a document.
 *
 * A textarea, not a rich-text editor. The Tiptap body contract is M5, and pulling it forward to
 * type a privacy notice would decide that schema for the wrong reason. The format is the one
 * everybody already knows: a blank line between paragraphs, `## ` for a heading. `body-text.ts`
 * converts, and round-trips, so nothing an organizer typed is reshaped behind their back.
 */
export default async function LegalDocumentForm({
  action,
  locale,
  versionId,
  values,
  keyLocked,
  submitLabel,
}: {
  action: (form: FormData) => Promise<void>;
  /** The interface language, so a failed save comes back on the page it left. */
  locale: string;
  /** Present when correcting an existing draft, absent when writing a new version. */
  versionId?: string;
  values?: LegalDocumentFormValues;
  /** Editing an existing version cannot change which document it is. */
  keyLocked?: boolean;
  submitLabel: string;
}) {
  const t = await getTranslations("Admin.legal");

  return (
    <form action={action}>
      <Stack spacing={3}>
        <input type="hidden" name="uiLocale" value={locale} />
        {versionId && <input type="hidden" name="versionId" value={versionId} />}

        <Alert severity="warning">{t("editorWarning")}</Alert>

        <TextField
          name="key"
          label={t("document")}
          select
          required
          defaultValue={values?.key ?? "PRIVACY_NOTICE"}
          disabled={keyLocked}
          helperText={keyLocked ? t("keyLocked") : undefined}
          sx={{ maxWidth: 420 }}
        >
          {(["PRIVACY_NOTICE", "TERMS", "EVENT_DECLARATION"] as const).map((key) => (
            <MenuItem key={key} value={key}>
              {t(`keys.${key}`)}
            </MenuItem>
          ))}
        </TextField>
        {/* A disabled select posts nothing, and the action still needs to know the key. */}
        {keyLocked && <input type="hidden" name="key" value={values?.key} />}

        {(["ro", "en"] as const).map((locale) => (
          <Paper key={locale} variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
            <Typography variant="overline" color="text.secondary">
              {locale.toUpperCase()}
            </Typography>
            <Stack spacing={2} sx={{ mt: 1 }}>
              <TextField
                name={`${locale}Title`}
                label={t("titleField")}
                required
                defaultValue={values?.[locale].title ?? ""}
              />
              <TextField
                name={`${locale}Body`}
                label={t("bodyField")}
                helperText={t("bodyHelp")}
                required
                multiline
                minRows={12}
                defaultValue={values ? bodyToText(values[locale].body) : ""}
                slotProps={{ htmlInput: { style: { fontFamily: "monospace", fontSize: "0.875rem" } } }}
              />
            </Stack>
          </Paper>
        ))}

        <Box>
          <Button type="submit" variant="contained">
            {submitLabel}
          </Button>
        </Box>
      </Stack>
    </form>
  );
}
