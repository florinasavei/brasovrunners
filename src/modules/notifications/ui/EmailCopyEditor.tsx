import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { updateEmailCopyAction } from "@/app/[locale]/admin/emails/actions";
import { refusalMessages } from "@/shared/forms/refusal-messages";
import ActionForm from "@/shared/forms/ActionForm";
import RecallField from "@/shared/forms/recall";
import type { EmailMessageType } from "@/db/schema/email-outbox";
import type { EmailLocale } from "@/infrastructure/email/adapter";
import type { Locale } from "@/i18n/routing";
import { EMAIL_COPY_PLACEHOLDERS, type EmailCopyEntry } from "@/modules/notifications/domain/email-copy";
import { fromPlainText } from "@/modules/content/rich-text/domain/schema";
import RichTextEditor from "@/modules/content/rich-text/ui/RichTextEditor";
import { richTextEditorLabels } from "@/modules/content/rich-text/ui/labels";
import GlyphButton from "@/shared/ui/GlyphButton";
import GlyphSubmitButton from "@/shared/ui/GlyphSubmitButton";

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
 * A form inside the message's own disclosure, under the preview it changes: the subject, the
 * words in the same rich-text editor a page is written in (§270), and two buttons — save, or go
 * back to the platform's text. The preview above is the result, and pressing Save re-renders the
 * page with the new words in it.
 *
 * **The toolbar is the half an inbox can draw**: bold, italic, the two headings, lists, a quote,
 * links and alignment. No picture, no film, no table — `domain/email-rich-text.ts` argues each
 * refusal, and the server refuses them whatever a browser posts. If the island never loads, its
 * hidden input still carries the document it was given, so a save writes the words back
 * unchanged rather than blanking a message.
 *
 * The placeholders are listed under the box, because a field nobody can see the name of is a
 * field nobody uses. What is *not* editable is said there too — the button, the QR and the
 * links are the message's machinery (`domain/email-copy.ts` argues why).
 */
export default async function EmailCopyEditor({ locale, emailLocale, messageType, written, shipped }: Props) {
  const t = await getTranslations("Admin");
  const rt = await getTranslations("Admin.richText");
  const current = written ?? shipped;

  return (
    <Box
      sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 1.5, mb: 2 }}
      data-testid={`email-copy-${messageType}`}
    >
    {/* A refused wording — a placeholder misspelt — comes back as typed (§315). */}
    <ActionForm
      action={updateEmailCopyAction}
      messages={await refusalMessages({ subject: t("emails.copy.subject"), body: t("emails.copy.paragraphs") })}
      // One form per message and language on the same page, each with a "subject" (`fieldId`).
      scope={`${messageType}-${emailLocale}`}
    >
      <input type="hidden" name="uiLocale" value={locale} />
      <input type="hidden" name="messageType" value={messageType} />
      <input type="hidden" name="lang" value={emailLocale} />

      <Typography variant="body2" sx={{ fontWeight: 600, mb: 1 }}>
        {t(`emails.copy.${written ? "editedTitle" : "title"}`, { lang: t(`emails.lang.${emailLocale}`) })}
      </Typography>

      <Stack spacing={1.5}>
        <RecallField
          name="subject"
          label={t("emails.copy.subject")}
          defaultValue={current.subject}
          size="small"
          slotProps={{ htmlInput: { maxLength: 200 } }}
        />
        <RichTextEditor
          name="body"
          label={t("emails.copy.paragraphs")}
          accessibleSuffix={t(`emails.lang.${emailLocale}`)}
          /*
            What is in the box: the club's own document if it wrote one, otherwise its plain
            paragraphs turned into one, otherwise the platform's text. `fromPlainText` is the
            same conversion the event editor uses for a summary written before the editor
            existed — nobody's words are lost on the way in.
          */
          initialBody={written?.body ?? fromPlainText(current.paragraphs.join("\n\n"))}
          features={{ media: false, tables: false }}
          labels={richTextEditorLabels(rt)}
        />
        <Typography variant="caption" color="text.secondary">
          {t("emails.copy.paragraphsHelp")}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {t("emails.copy.placeholders", { list: EMAIL_COPY_PLACEHOLDERS.map((name) => `{${name}}`).join(", ") })}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {t("emails.copy.machinery")}
        </Typography>
        <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1 }}>
          <GlyphSubmitButton label={t("emails.copy.save")} pendingLabel={t("emails.copy.saving")} icon="save" />
          {/* A second submit on the same form, named: the browser sends the one that was
              pressed, so no JavaScript decides which verb this form runs. */}
          {written && (
            <GlyphButton icon="reset" type="submit" name="reset" value="1" color="inherit" variant="outlined" sx={{ minHeight: 44 }}>
              {t("emails.copy.reset")}
            </GlyphButton>
          )}
        </Stack>
      </Stack>
    </ActionForm>
    </Box>
  );
}
