import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import type { LegalDocumentKey } from "@/db/schema/legal-documents";
import { refusalMessages } from "@/modules/staff-identity/ui/refusal-messages";
import ActionForm, { type ActionFormAction } from "@/shared/forms/ActionForm";
import RecallField from "@/shared/forms/recall";
import SubmitButton from "@/shared/ui/SubmitButton";
import { bodyToText } from "../domain/body-text";
import LegalBodyEditor from "./LegalBodyEditor";
import TokenLegend from "./TokenLegend";
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
 * The body is written in `LegalBodyEditor` — what the club sees is what the page and the signed
 * PDF will show (§279) — and it posts the same plain text the textarea posted, under the same
 * field name: `## ` for a heading, a blank line between paragraphs, `[words](url)` for a link.
 * The stored shape, the content hash and the action are untouched, which is what makes the
 * already-approved texts on production safe to open in it.
 *
 * A refusal — a language left empty — comes back with both texts still in their boxes and the
 * summary naming the language (§305). A legal text is tens of kilobytes, so it is the action's
 * returned state that carries it, never a cookie.
 */
export default async function LegalDocumentForm({
  action,
  locale,
  versionId,
  values,
  keyLocked,
  submitLabel,
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
}) {
  const t = await getTranslations("Admin.legal");
  const tAdmin = await getTranslations("Admin");
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
          {(["PRIVACY_NOTICE", "TERMS", "EVENT_DECLARATION"] as const).map((key) => (
            <MenuItem key={key} value={key}>
              {t(`keys.${key}`)}
            </MenuItem>
          ))}
        </RecallField>
        {/* A disabled select posts nothing, and the action still needs to know the key. */}
        {keyLocked && <input type="hidden" name="key" value={values?.key} />}

        {/* What every `{{token}}` becomes, beside the boxes rather than under them (§190).
            Shown whatever the document is, because the key can still be changed above and a
            legend that appears only after the choice is a legend nobody sees in time. */}
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
                slotProps={{ htmlInput: { maxLength: 300 } }}
              />
              {/* The declaration's merge fields (§95): named here, filled in per person and event. */}
              <LegalBodyEditor
                name={`${locale}Body`}
                label={t("bodyField")}
                accessibleSuffix={locale.toUpperCase()}
                help={`${t("bodyHelp")} ${t("tokensHelp")}`}
                initialText={values ? bodyToText(values[locale].body) : ""}
                labels={{
                  heading: t("editor.heading"),
                  paragraph: t("editor.paragraph"),
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
          <SubmitButton label={submitLabel} pendingLabel={tAdmin("editor.saving")} incompleteHintNamed={tAdmin("forms.incompleteFirst")} size="medium" />
        </Box>
      </Stack>
    </ActionForm>
  );
}
