import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import type { EmailMessageType } from "@/db/schema/email-outbox";
import { countForm } from "@/i18n/count-form";
import type { Locale } from "@/i18n/routing";
import type { EmailLocale } from "@/infrastructure/email/adapter";
import type { Deadlines } from "@/modules/deadlines/domain/deadlines";
import { emailFieldLegend } from "@/modules/notifications/email-copy-fields";
import FieldLegend, { type FieldLegendMark } from "@/shared/ui/FieldLegend";
import Panel from "@/shared/ui/Panel";

type Props = {
  /** The backoffice's language: the legend's words and its counted summary. */
  locale: Locale;
  /** The language being edited: the examples are this language's sample (§96). */
  emailLocale: EmailLocale;
  messageType: EmailMessageType;
  /** The club's deadlines in force (§377), so the four deadline rows show what the preview prints. */
  deadlines?: Deadlines;
};

/**
 * The fields a message's words may use, as a legend under the editor (§373, email follow-up; the
 * owner, 2026-09-24: "I like how the placeholders are listed here on the documents — need to have
 * the same on emails, because now they are just plain inline text").
 *
 * It replaces one sentence under the box that listed twelve `{names}` separated by commas. The
 * declaration's editor has had the better answer since §190 (`legal-documents/ui/TokenLegend`):
 * one row per field, the field in a code chip, what it becomes in words and a real-looking value —
 * and this is that layout (`shared/ui/FieldLegend`), with what an email adds:
 *
 * - **the fields this message's platform text uses come first, marked** "folosit în textul
 *   platformei" — the ones a Redactor rewriting the message most likely wants;
 * - **the example is the preview's**: the value the sample (`domain/email-sample.ts`, the one
 *   constant the preview and the save's guard read) gives the field in the language being edited;
 * - **a fact a send may lack is marked** "poate lipsi", with the one rule that comes with it said
 *   once above the rows: a paragraph that names only such facts, and has none of them, is not sent;
 * - **a field this message never carries is last and dimmed**, "nu se completează în acest mesaj",
 *   with no example — `{staffRole}` outside the staff invitation, `{bibNumber}` in a message that
 *   never has a number (`placeholdersFilledBy`). The preview leaves it empty too. When it is one of
 *   the facts above, the row adds that a paragraph with only it is not sent: the intro's "stays
 *   empty" would otherwise be wrong for it (`dropsParagraph`).
 *
 * A legend fold under the editor, closed (§336), whose closed line counts the fields and the
 * ones this message uses ("12 câmpuri · 4 folosite aici") — drawn a little differently from an
 * ordinary card (§398; the owner, 11:10, on this exact accordion: "trebuie să fie un pic diferit
 * de celelalte acordeoane și cu un «i» button"): `Panel`'s `help` variant, no border, led by an
 * "i". A Server Component: the fold is `<details>`, the rows are text.
 */
export default async function EmailFieldLegend({ locale, emailLocale, messageType, deadlines }: Props) {
  const t = await getTranslations("Admin");
  const entries = emailFieldLegend(messageType, emailLocale, deadlines);
  const used = entries.filter((entry) => entry.used).length;
  const summary = [
    t(`emails.copy.legend.count.${countForm(entries.length, locale)}`, { count: entries.length }),
    used > 0 ? t(`emails.copy.legend.used.${countForm(used, locale)}`, { count: used }) : t("emails.copy.legend.noneUsed"),
  ].join(" · ");

  return (
    <Panel
      title={t("emails.copy.legend.title")}
      intro={t("emails.copy.legend.intro")}
      aside={summary}
      collapsible
      variant="help"
      legendIcon="info"
      id={`email-fields-${messageType}`}
      data-testid={`email-fields-${messageType}`}
    >
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        {t("emails.copy.legend.missing")}
      </Typography>
      <FieldLegend
        data-testid="email-field-legend"
        rows={entries.map((entry) => {
          const marks: FieldLegendMark[] = [
            ...(entry.used ? [{ label: t("emails.copy.legend.usedMark"), tone: "success" as const }] : []),
            ...(entry.mayBeMissing ? [{ label: t("emails.copy.legend.mayBeMissing"), tone: "neutral" as const }] : []),
          ];
          return {
            token: `{${entry.name}}`,
            meaning: t(`emails.copy.legend.fields.${entry.name}`),
            ...(entry.filled
              ? { example: entry.example }
              : { note: t(entry.dropsParagraph ? "emails.copy.legend.notFilledDropped" : "emails.copy.legend.notFilled"), muted: true }),
            ...(marks.length > 0 ? { marks } : {}),
          };
        })}
      />
    </Panel>
  );
}
