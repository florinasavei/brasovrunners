import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import type { LegalDocumentKey } from "@/db/schema/legal-documents";
import { refusalMessages } from "@/shared/forms/refusal-messages";
import ActionForm, { type ActionFormAction } from "@/shared/forms/ActionForm";
import RecallField from "@/shared/forms/recall";
import GlyphSubmitButton from "@/shared/ui/GlyphSubmitButton";
import { bodyToText } from "../domain/body-text";
import LegalBodyEditor from "./LegalBodyEditor";
import TokenLegend from "./TokenLegend";
import type { LegalDocumentBody } from "../domain/content-hash";
import { LEGAL_DOCUMENT_KEYS } from "../domain/keys";

export type LegalDocumentFormValues = {
  key: LegalDocumentKey;
  ro: { title: string; body: LegalDocumentBody };
  en: { title: string; body: LegalDocumentBody };
};

/**
 * One form to create a version or correct a draft. Both languages on one screen, since both
 * must exist before approval (BR-REQ-040-02). `LegalBodyEditor` posts the same plain text a
 * textarea would (§279), so stored shape and hash are unchanged. A refusal returns the texts
 * through the action's state, never a cookie — they are tens of kilobytes (§315).
 */
export default async function LegalDocumentForm({
  action,
  locale,
  versionId,
  values,
  keyLocked,
  submitLabel,
  pendingLabel,
  incompleteHint,
}: {
  action: ActionFormAction;
  /** The interface language, so a failed save comes back on the page it left. */
  locale: string;
  /** Present when correcting an existing draft, absent when writing a new version. */
  versionId?: string;
  values?: LegalDocumentFormValues;
  /** Editing an existing version cannot change which document it is. */
  keyLocked?: boolean;
  submitLabel: string;
  pendingLabel: string;
  /** "Fill in first: {field}" — the button's sentence while a box is missing (§315). */
  incompleteHint: string;
}) {
  const t = await getTranslations("Admin.legal");
  const messages = await refusalMessages({
    key: t("document"),
    roTitle: `RO: ${t("titleField")}`,
    roBody: `RO: ${t("bodyField")}`,
    enTitle: `EN: ${t("titleField")}`,
    enBody: `EN: ${t("bodyField")}`,
  });

  return (
    <ActionForm action={action} messages={messages} data-testid="legal-document-form">
      <Stack spacing={3}>
        <input type="hidden" name="uiLocale" value={locale} />
        {versionId && <input type="hidden" name="versionId" value={versionId} />}

        <Alert severity="warning">{t("editorWarning")}</Alert>

        <RecallField
          name="key"
          label={t("document")}
          select
          required
          defaultValue={values?.key ?? "PRIVACY_NOTICE"}
          disabled={keyLocked}
          helperText={keyLocked ? t("keyLocked") : undefined}
          sx={{ maxWidth: 420 }}
        >
          {LEGAL_DOCUMENT_KEYS.map((key) => (
            <MenuItem key={key} value={key}>
              {t(`keys.${key}`)}
            </MenuItem>
          ))}
        </RecallField>
        {/* A disabled select posts nothing, and the action still needs to know the key. */}
        {keyLocked && <input type="hidden" name="key" value={values?.key} />}

        {/* Shown for every key: the key can still change above (§190). */}
        <TokenLegend body={values ? bodyToText(values.ro.body) : undefined} />

        {(["ro", "en"] as const).map((locale) => (
          <Paper key={locale} variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
            <Typography variant="overline" color="text.secondary">
              {locale.toUpperCase()}
            </Typography>
            <Stack spacing={2} sx={{ mt: 1 }}>
              <RecallField
                name={`${locale}Title`}
                label={t("titleField")}
                required
                defaultValue={values?.[locale].title ?? ""}
              />
              <LegalBodyEditor
                name={`${locale}Body`}
                label={t("bodyField")}
                accessibleSuffix={locale.toUpperCase()}
                help={`${t("bodyHelp")} ${t("tokensHelp")}`}
                initialText={values ? bodyToText(values[locale].body) : ""}
                labels={{
                  heading: t("editor.heading"),
                  paragraph: t("editor.paragraph"),
                  paragraphShort: t("editor.paragraphShort"),
                  link: t("editor.link"),
                  linkUrl: t("editor.linkUrl"),
                  linkApply: t("editor.linkApply"),
                  linkRemove: t("editor.linkRemove"),
                  linkCancel: t("editor.linkCancel"),
                  image: t("editor.image"),
                  imageUrl: t("editor.imageUrl"),
                  imageAlt: t("editor.imageAlt"),
                  imageApply: t("editor.imageApply"),
                  imageCancel: t("editor.imageCancel"),
                  imageInvalid: t("editor.imageInvalid"),
                  undo: t("editor.undo"),
                  redo: t("editor.redo"),
                }}
              />
            </Stack>
          </Paper>
        ))}

        <Box>
          <GlyphSubmitButton
            label={submitLabel}
            pendingLabel={pendingLabel}
            icon="save"
            incompleteHintNamed={incompleteHint}
            size="medium"
          />
        </Box>
      </Stack>
    </ActionForm>
  );
}
