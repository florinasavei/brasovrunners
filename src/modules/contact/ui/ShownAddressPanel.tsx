import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { updateShownContactAddressAction } from "@/app/[locale]/admin/pages/contact/actions";
import { CLUB_TIME_ZONE, formatDay } from "@/i18n/dates";
import type { Locale } from "@/i18n/routing";
import { CONTACT_ADDRESS_MODES, joinContactAddresses, replyToHeader } from "@/modules/contact/domain/shown-address";
import type { ShownContactAddressState } from "@/modules/contact/shown-address";
import ActionForm from "@/shared/forms/ActionForm";
import { RecallRadio } from "@/shared/forms/recall";
import { refusalMessages } from "@/shared/forms/refusal-messages";
import { confirmWords } from "@/shared/feedback/confirm-words";
import type { FoldOpenWhen } from "@/shared/ui/fold";
import GlyphSubmitButton from "@/shared/ui/GlyphSubmitButton";
import Panel from "@/shared/ui/Panel";

type Props = {
  locale: Locale;
  state: ShownContactAddressState;
  /** `EMAIL_REPLY_TO`. */
  mailbox: string | null;
  /** `CONTACT_SMTP_USER` when it is an address. */
  configuredGmail: string | null;
  /** `resolveShownContactAddresses`. */
  resolved: readonly string[];
  /** Administrator only (§291); the service refuses anybody else. */
  mayEdit: boolean;
  openWhen?: FoldOpenWhen;
};

/** «Adresa de contact afișată» (§442 as amended): three modes, the Gmail read-only from configuration. */
export default async function ShownAddressPanel({ locale, state, mailbox, configuredGmail, resolved, mayEdit, openWhen }: Props) {
  const t = await getTranslations("Admin");
  const words = await confirmWords();
  const shown = joinContactAddresses(resolved, locale) || "—";
  const replyTo = replyToHeader(resolved) ?? "—";

  return (
    <Panel glyph="shownAddress"
      title={t("emails.shownAddress.title")}
      intro={t("emails.shownAddress.intro")}
      aside={t("emails.shownAddress.aside", { shown })}
      collapsible
      openWhen={openWhen}
      id="shown-contact-address"
      data-testid="shown-contact-address"
    >
      <Typography variant="body2" sx={{ fontWeight: 500, overflowWrap: "anywhere" }} data-testid="shown-contact-address-preview">
        {t("emails.shownAddress.preview", { shown, replyTo })}
      </Typography>
      {state.updatedAt && (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
          {t("emails.shownAddress.updatedAt", {
            when: formatDay(state.updatedAt, { locale, timeZone: CLUB_TIME_ZONE, style: "short", withTime: true, position: "inline" }),
          })}
        </Typography>
      )}

      {!mayEdit ? (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
          {t("emails.shownAddress.readOnly")}
        </Typography>
      ) : (
        <Box sx={{ mt: 1.5 }}>
          <ActionForm
            action={updateShownContactAddressAction}
            messages={await refusalMessages({ mode: t("emails.shownAddress.legend") })}
            confirm={{
              title: t("confirm.shownAddressTitle"),
              body: t("confirm.shownAddressBody"),
              confirmLabel: t("emails.shownAddress.save"),
              cancelLabel: words.cancel,
            }}
            scope="shownAddress"
            data-testid="shown-contact-address-form"
          >
            <input type="hidden" name="uiLocale" value={locale} />
            <Stack spacing={1.5} sx={{ maxWidth: 520 }}>
              <Box component="fieldset" sx={{ border: 0, p: 0, m: 0 }}>
                <Typography component="legend" variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
                  {t("emails.shownAddress.legend")}
                </Typography>
                {CONTACT_ADDRESS_MODES.map((mode) => (
                  // A plain label with children, never `FormControlLabel`'s element prop (§370); 44px to a thumb.
                  <Box
                    key={mode}
                    component="label"
                    sx={{ display: "flex", alignItems: "center", gap: 1, minHeight: 44, cursor: "pointer" }}
                  >
                    <RecallRadio
                      name="mode"
                      value={mode}
                      defaultChecked={state.mode === mode}
                      disabled={mode !== "mailbox" && !configuredGmail}
                      style={{ width: 20, height: 20 }}
                    />
                    <Typography component="span" variant="body2" sx={{ overflowWrap: "anywhere" }}>
                      {t(`emails.shownAddress.modes.${mode}`, {
                        mailbox: mailbox ?? t("emails.shownAddress.noMailbox"),
                        gmail: configuredGmail ?? t("emails.shownAddress.noGmail"),
                      })}
                    </Typography>
                  </Box>
                ))}
              </Box>
              <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: "anywhere" }} data-testid="shown-contact-address-gmail">
                {configuredGmail
                  ? t("emails.shownAddress.gmailConfigured", { gmail: configuredGmail })
                  : t("emails.shownAddress.gmailMissing")}
              </Typography>
              <Box>
                <GlyphSubmitButton label={t("emails.shownAddress.save")} pendingLabel={t("emails.shownAddress.saving")} icon="save" />
              </Box>
            </Stack>
          </ActionForm>
        </Box>
      )}

      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1.5 }}>
        {t("emails.shownAddress.sender")}
      </Typography>
    </Panel>
  );
}
