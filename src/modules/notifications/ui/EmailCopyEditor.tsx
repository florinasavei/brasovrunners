import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
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
import type { EmailCopyEntry, EmailCopyPlaceholder } from "@/modules/notifications/domain/email-copy";
import { emailDocFromParagraphs } from "@/modules/notifications/domain/email-rich-text";
import type { EmailSampleHit } from "@/modules/notifications/domain/email-sample";
import type { EmailCopyPrefill } from "@/modules/notifications/email-copy-fields";
import EmailFieldLegend from "@/modules/notifications/ui/EmailFieldLegend";
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
  /**
   * The platform's text for this message, shown as the starting point: its words with the fields
   * written as placeholders, never the preview's sample values (§359, `email-copy-fields.ts`).
   */
  shipped: EmailCopyPrefill;
  /** The sample values the club's saved words still hold (§359); empty when there are none. */
  samples: readonly EmailSampleHit[];
};

/**
 * The club's own wording for one message, in one language (`DECISIONS.md` §247).
 *
 * A form inside the message's own disclosure, under the preview it changes: the subject, the
 * words in the same rich-text editor a page is written in (§270), and two buttons — save, or go
 * back to the platform's text. The preview above is the result, and pressing Save re-renders the
 * page with the new words in it.
 *
 * **The box starts from the platform's words with the fields in them** (§359): "Ai început
 * înscrierea la {eventTitle}", never the preview's "…la Crosul de toamnă". It used to start from
 * the preview itself, and a Redactor who saved it stored the sample's title for every participant.
 * A saved text that still holds a sample value is said so in amber, naming each value and its
 * field, with a third button that rewrites them — and the save refuses to store a new one.
 *
 * **The toolbar is the half an inbox can draw**: bold, italic, the two headings, lists, a quote,
 * links and alignment. No picture, no film, no table — `domain/email-rich-text.ts` argues each
 * refusal, and the server refuses them whatever a browser posts. If the island never loads, its
 * hidden input still carries the document it was given, so a save writes the words back
 * unchanged rather than blanking a message.
 *
 * The fields are a legend under the box (`EmailFieldLegend`, §373 email follow-up): one row each,
 * this message's own first, with what each becomes and the preview's value for it — because a
 * field nobody can see the name of is a field nobody uses. What is *not* editable is said under it
 * — the button, the QR and the links are the message's machinery (`domain/email-copy.ts` argues why).
 */
export default async function EmailCopyEditor({ locale, emailLocale, messageType, written, shipped, samples }: Props) {
  const t = await getTranslations("Admin");
  const rt = await getTranslations("Admin.richText");
  const current = written ?? shipped;
  const field = (name: EmailCopyPlaceholder) => `{${name}}`;

  /*
    Each sample value once, with the boxes it is in and what goes in its place — a field, or for the
    sample colleague's address the platform's own words ("aceasta").
  */
  const found = samples
    .filter((hit, index) => samples.findIndex((other) => other.value === hit.value) === index)
    .map((hit) => {
      const inSubject = samples.some((other) => other.value === hit.value && other.field === "subject");
      const inBody = samples.some((other) => other.value === hit.value && other.field === "body");
      return {
        value: hit.value,
        replacement: hit.placeholder ? field(hit.placeholder) : t("emails.copy.sampleWords", { words: hit.words ?? "" }),
        where: inSubject && inBody ? t("emails.copy.sampleWhere.both") : inSubject ? t("emails.copy.sampleWhere.subject") : t("emails.copy.sampleWhere.body"),
      };
    });

  return (
    <Box
      sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 1.5, mb: 2 }}
      data-testid={`email-copy-${messageType}`}
    >
    {/* A refused wording — a placeholder misspelt, a sample value left in — comes back as typed (§315). */}
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

      {found.length > 0 && (
        <Alert severity="warning" sx={{ mb: 1.5 }} data-testid="email-copy-samples">
          <AlertTitle>{t("emails.copy.samplesTitle")}</AlertTitle>
          <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
            {found.map((hit) => (
              <li key={hit.value}>{t("emails.copy.samplePairWhere", hit)}</li>
            ))}
          </Box>
          <Box component="p" sx={{ m: 0, mt: 1 }}>
            {t("emails.copy.samplesHelp")}
          </Box>
        </Alert>
      )}

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
            paragraphs turned into one, otherwise the platform's words with the fields. One block
            per paragraph and the platform's `**bold**` as bold (§359): the old conversion put every
            paragraph in one block, which an email's HTML ran together.
          */
          initialBody={written ? (written.body ?? emailDocFromParagraphs(written.paragraphs)) : shipped.body}
          features={{ media: false, tables: false }}
          labels={richTextEditorLabels(rt)}
        />
        <Typography variant="caption" color="text.secondary">
          {t("emails.copy.paragraphsHelp")}
        </Typography>
        {/* The fields, as the declaration's editor lists its tokens (§373, email follow-up): a named card, closed. */}
        <EmailFieldLegend locale={locale} emailLocale={emailLocale} messageType={messageType} />
        <Typography variant="caption" color="text.secondary">
          {t("emails.copy.machinery")}
        </Typography>
        <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1 }}>
          {/* Save first: the browser's Enter in the subject presses the form's first submit. */}
          <GlyphSubmitButton label={t("emails.copy.save")} pendingLabel={t("emails.copy.saving")} icon="save" />
          {/* A second and a third submit on the same form, named: the browser sends the one that
              was pressed, so no JavaScript decides which verb this form runs. */}
          {found.length > 0 && (
            <GlyphButton icon="edit" type="submit" name="replace" value="1" color="warning" variant="outlined" sx={{ minHeight: 44 }}>
              {t("emails.copy.replace")}
            </GlyphButton>
          )}
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
