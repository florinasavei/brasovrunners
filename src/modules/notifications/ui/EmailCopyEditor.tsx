import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { updateEmailCopyAction } from "@/app/[locale]/admin/emails/actions";
import type { EmailMessageType } from "@/db/schema/email-outbox";
import type { EmailLocale } from "@/infrastructure/email/adapter";
import type { Locale } from "@/i18n/routing";
import { EMAIL_COPY_PLACEHOLDERS, type EmailCopyEntry } from "@/modules/notifications/domain/email-copy";
import SubmitButton from "@/shared/ui/SubmitButton";

type Props = {
  locale: Locale;
  /** The language being edited — the one the preview above is showing (§96). */
  emailLocale: EmailLocale;
  messageType: EmailMessageType;
  /** The club's words, or null while the platform's own are in force. */
  written: EmailCopyEntry | null;
  /** The platform's text for this message, shown as the starting point. */
  shipped: EmailCopyEntry;
};

/**
 * The club's own wording for one message, in one language (`DECISIONS.md` §247).
 *
 * A plain form inside the message's own disclosure, under the preview it changes: the subject,
 * the paragraphs as one textarea with a blank line between them, and two buttons — save, or go
 * back to the platform's text. No JavaScript: the textarea is the editor, the preview above is
 * the result, and pressing Save re-renders the page with the new words in it.
 *
 * The placeholders are listed under the box, because a field nobody can see the name of is a
 * field nobody uses. What is *not* editable is said there too — the button, the QR and the
 * links are the message's machinery (`domain/email-copy.ts` argues why).
 */
export default async function EmailCopyEditor({ locale, emailLocale, messageType, written, shipped }: Props) {
  const t = await getTranslations("Admin");
  const current = written ?? shipped;

  return (
    <Box
      component="form"
      action={updateEmailCopyAction}
      sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 1.5, mb: 2 }}
      data-testid={`email-copy-${messageType}`}
    >
      <input type="hidden" name="uiLocale" value={locale} />
      <input type="hidden" name="messageType" value={messageType} />
      <input type="hidden" name="lang" value={emailLocale} />

      <Typography variant="body2" sx={{ fontWeight: 600, mb: 1 }}>
        {t(`emails.copy.${written ? "editedTitle" : "title"}`, { lang: t(`emails.lang.${emailLocale}`) })}
      </Typography>

      <Stack spacing={1.5}>
        <TextField
          name="subject"
          label={t("emails.copy.subject")}
          defaultValue={current.subject}
          size="small"
          slotProps={{ htmlInput: { maxLength: 200 } }}
        />
        <TextField
          name="paragraphs"
          label={t("emails.copy.paragraphs")}
          defaultValue={current.paragraphs.join("\n\n")}
          size="small"
          multiline
          minRows={4}
          helperText={t("emails.copy.paragraphsHelp")}
          slotProps={{ htmlInput: { maxLength: 6000 } }}
        />
        <Typography variant="caption" color="text.secondary">
          {t("emails.copy.placeholders", { list: EMAIL_COPY_PLACEHOLDERS.map((name) => `{${name}}`).join(", ") })}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {t("emails.copy.machinery")}
        </Typography>
        <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1 }}>
          <SubmitButton label={t("emails.copy.save")} pendingLabel={t("emails.copy.saving")} />
          {/* A second submit on the same form, named: the browser sends the one that was
              pressed, so no JavaScript decides which verb this form runs. */}
          {written && (
            <Button type="submit" name="reset" value="1" color="inherit" variant="outlined" sx={{ minHeight: 44 }}>
              {t("emails.copy.reset")}
            </Button>
          )}
        </Stack>
      </Stack>
    </Box>
  );
}
