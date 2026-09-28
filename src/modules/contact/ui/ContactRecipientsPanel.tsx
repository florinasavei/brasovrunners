import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Panel from "@/shared/ui/Panel";
import type { FoldOpenWhen } from "@/shared/ui/fold";
import { confirmWords } from "@/shared/feedback/confirm-words";
import ActionForm from "@/shared/forms/ActionForm";
import RecallField from "@/shared/forms/recall";
import { getTranslations } from "next-intl/server";
import { updateContactRecipientsAction } from "@/app/[locale]/admin/pages/contact/actions";
import { refusalMessages } from "@/shared/forms/refusal-messages";
import { formatAddressList, type ResolvedContactRecipients } from "@/modules/contact/domain/recipients";
import type { ContactRecipientsState } from "@/modules/contact/recipients";
import type { Locale } from "@/i18n/routing";
import { CLUB_TIME_ZONE, formatDay } from "@/i18n/dates";
import GlyphSubmitButton from "@/shared/ui/GlyphSubmitButton";

type Props = {
  locale: Locale;
  recipients: ContactRecipientsState;
  resolved: ResolvedContactRecipients;
  /** Administrator only (§291); the service refuses anybody else. */
  mayEdit: boolean;
  /** Opens the fold after this panel's save (§336). */
  openWhen?: FoldOpenWhen;
};

/**
 * Who receives "Scrie-ne" messages (§164). The sending account stays in the environment, never
 * in a table the backoffice reads (AGENTS.md §14.5).
 */
export default async function ContactRecipientsPanel({ locale, recipients, resolved, mayEdit, openWhen }: Props) {
  const t = await getTranslations("Admin");
  const words = await confirmWords();

  // Closed by default (§336); the summary names only the "to" list.
  return (
    <Panel glyph="contacts"
      title={t("emails.contacts.title")}
      intro={t("emails.contacts.intro")}
      aside={t("emails.contacts.aside", { to: formatAddressList(resolved.to) || t("emails.contacts.asideNobody") })}
      collapsible
      openWhen={openWhen}
      id="contact-recipients"
      data-testid="contact-recipients"
    >

      <Typography variant="body2" sx={{ fontWeight: 500 }}>
        {t(`emails.contacts.source.${resolved.source}`, {
          to: formatAddressList(resolved.to) || "—",
          cc: formatAddressList(resolved.cc) || "—",
          bcc: formatAddressList(resolved.bcc) || "—",
        })}
      </Typography>
      {recipients.updatedAt && (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
          {t("emails.contacts.updatedAt", {
            when: formatDay(recipients.updatedAt, { locale, timeZone: CLUB_TIME_ZONE, style: "short", withTime: true, position: "inline" }),
          })}
        </Typography>
      )}

      {!mayEdit ? (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
          {t("emails.contacts.readOnly")}
        </Typography>
      ) : (
      <Box sx={{ mt: 1.5 }}>
      {/* A refused list comes back as typed, so one mistyped address is corrected, not retyped (§315). */}
      <ActionForm
        action={updateContactRecipientsAction}
        messages={await refusalMessages({ to: t("emails.contacts.to"), cc: t("emails.contacts.cc"), bcc: t("emails.contacts.bcc") })}
        // Several forms share the page; `scope` prefixes each id.
        confirm={{ title: t("confirm.contactRecipientsTitle"), body: t("confirm.contactRecipientsBody"), confirmLabel: t("emails.contacts.save"), cancelLabel: words.cancel }}
        scope="contacts"
        data-testid="contact-recipients-form"
      >
        <input type="hidden" name="uiLocale" value={locale} />
        <Stack spacing={1.5} sx={{ maxWidth: 520 }}>
          <RecallField
            name="to"
            label={t("emails.contacts.to")}
            defaultValue={formatAddressList(recipients.to)}
            size="small"
            helperText={t("emails.contacts.toHelp")}
            slotProps={{ htmlInput: { maxLength: 2000, autoComplete: "off", spellCheck: false } }}
          />
          <RecallField
            name="cc"
            label={t("emails.contacts.cc")}
            defaultValue={formatAddressList(recipients.cc)}
            size="small"
            helperText={t("emails.contacts.ccHelp")}
            slotProps={{ htmlInput: { maxLength: 2000, autoComplete: "off", spellCheck: false } }}
          />
          <RecallField
            name="bcc"
            label={t("emails.contacts.bcc")}
            defaultValue={formatAddressList(recipients.bcc)}
            size="small"
            helperText={t("emails.contacts.bccHelp")}
            slotProps={{ htmlInput: { maxLength: 2000, autoComplete: "off", spellCheck: false } }}
          />
          <Box>
            <GlyphSubmitButton label={t("emails.contacts.save")} pendingLabel={t("emails.contacts.saving")} icon="save" />
          </Box>
        </Stack>
      </ActionForm>
      </Box>
      )}

      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1.5 }}>
        {t("emails.contacts.sender")}
      </Typography>
    </Panel>
  );
}
