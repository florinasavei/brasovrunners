import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import Panel from "@/shared/ui/Panel";
import { getTranslations } from "next-intl/server";
import { updateContactRecipientsAction } from "@/app/[locale]/admin/emails/actions";
import { formatAddressList, type ResolvedContactRecipients } from "@/modules/contact/domain/recipients";
import type { ContactRecipientsState } from "@/modules/contact/recipients";
import type { Locale } from "@/i18n/routing";
import SubmitButton from "@/shared/ui/SubmitButton";

type Props = {
  locale: Locale;
  recipients: ContactRecipientsState;
  resolved: ResolvedContactRecipients;
};

/**
 * Who reads what "Scrie-ne" sends (`DECISIONS.md` §164; the owner: "I wanna allow CC on the
 * contact form so that Amalia can receive emails… configurable in the app").
 *
 * The email plan's own shape (§100): a Server Component with one form, two ordinary text
 * boxes and a Save. No JavaScript decides anything; the service validates each address and
 * writes the audit row. The account the message *leaves* from is not here and never will be —
 * a Gmail app password belongs in the environment, not in a table the backoffice can read
 * (AGENTS.md §14.5) — so the panel names the two variables and shows neither's value.
 */
export default async function ContactRecipientsPanel({ locale, recipients, resolved }: Props) {
  const t = await getTranslations("Admin");

  return (
    <Panel
      title={t("emails.contacts.title")}
      intro={t("emails.contacts.intro")}
      collapsible
      defaultOpen={false}
    >

      {/* Where the list in force comes from, so "I saved it and nothing changed" cannot happen. */}
      <Typography variant="body2" sx={{ fontWeight: 500 }}>
        {t(`emails.contacts.source.${resolved.source}`, {
          to: formatAddressList(resolved.to) || "—",
          cc: formatAddressList(resolved.cc) || "—",
        })}
      </Typography>
      {recipients.updatedAt && (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
          {t("emails.contacts.updatedAt", {
            when: new Intl.DateTimeFormat(locale === "ro" ? "ro-RO" : "en-GB", {
              dateStyle: "medium",
              timeStyle: "short",
              hourCycle: "h23",
              timeZone: "Europe/Bucharest",
            }).format(recipients.updatedAt),
          })}
        </Typography>
      )}

      <Box component="form" action={updateContactRecipientsAction} sx={{ mt: 1.5 }}>
        <input type="hidden" name="uiLocale" value={locale} />
        <Stack spacing={1.5} sx={{ maxWidth: 520 }}>
          <TextField
            name="to"
            label={t("emails.contacts.to")}
            defaultValue={formatAddressList(recipients.to)}
            size="small"
            helperText={t("emails.contacts.toHelp")}
            slotProps={{ htmlInput: { maxLength: 2000, autoComplete: "off", spellCheck: false } }}
          />
          <TextField
            name="cc"
            label={t("emails.contacts.cc")}
            defaultValue={formatAddressList(recipients.cc)}
            size="small"
            helperText={t("emails.contacts.ccHelp")}
            slotProps={{ htmlInput: { maxLength: 2000, autoComplete: "off", spellCheck: false } }}
          />
          <Box>
            <SubmitButton label={t("emails.contacts.save")} pendingLabel={t("emails.contacts.saving")} />
          </Box>
        </Stack>
      </Box>

      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1.5 }}>
        {t("emails.contacts.sender")}
      </Typography>
    </Panel>
  );
}
