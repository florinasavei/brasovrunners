import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { updatePublicPhoneAction } from "@/app/[locale]/admin/pages/contact/actions";
import { CLUB_TIME_ZONE, formatDay } from "@/i18n/dates";
import type { Locale } from "@/i18n/routing";
import { PUBLIC_PHONE_MAX } from "@/modules/contact/domain/public-phone";
import type { PublicPhoneState } from "@/modules/contact/public-phone";
import ActionForm from "@/shared/forms/ActionForm";
import RecallField from "@/shared/forms/recall";
import { refusalMessages } from "@/shared/forms/refusal-messages";
import { confirmWords } from "@/shared/feedback/confirm-words";
import type { FoldOpenWhen } from "@/shared/ui/fold";
import GlyphSubmitButton from "@/shared/ui/GlyphSubmitButton";
import Panel from "@/shared/ui/Panel";

type Props = {
  locale: Locale;
  state: PublicPhoneState;
  /** Administrator only (§291, §450); the service refuses anybody else. */
  mayEdit: boolean;
  openWhen?: FoldOpenWhen;
};

/**
 * «Telefon public» (§NNN): one optional number, shown under «Contact» in the footer's identity
 * block on every page — and nowhere while the box is empty. The shown address's shape (§442): a
 * Server Component, one form, one box and its «Salvează», behind the §384 confirmation.
 */
export default async function PublicPhonePanel({ locale, state, mayEdit, openWhen }: Props) {
  const t = await getTranslations("Admin");
  const words = await confirmWords();

  return (
    <Panel
      glyph="publicPhone"
      title={t("emails.publicPhone.title")}
      intro={t("emails.publicPhone.intro")}
      aside={state.phone ? t("emails.publicPhone.aside", { phone: state.phone }) : t("emails.publicPhone.asideNone")}
      collapsible
      openWhen={openWhen}
      id="public-phone"
      data-testid="public-phone"
    >
      {state.updatedAt && (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
          {t("emails.publicPhone.updatedAt", {
            when: formatDay(state.updatedAt, { locale, timeZone: CLUB_TIME_ZONE, style: "short", withTime: true, position: "inline" }),
          })}
        </Typography>
      )}

      {!mayEdit ? (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
          {t("emails.publicPhone.readOnly")}
        </Typography>
      ) : (
        <Box sx={{ mt: 1.5 }}>
          <ActionForm
            action={updatePublicPhoneAction}
            messages={await refusalMessages({ phone: t("emails.publicPhone.field") })}
            confirm={{
              title: t("confirm.publicPhoneTitle"),
              body: t("confirm.publicPhoneBody"),
              confirmLabel: t("emails.publicPhone.save"),
              cancelLabel: words.cancel,
            }}
            scope="publicPhone"
            data-testid="public-phone-form"
          >
            <input type="hidden" name="uiLocale" value={locale} />
            <Stack spacing={1.5} sx={{ maxWidth: 360 }}>
              <RecallField
                name="phone"
                type="tel"
                label={t("emails.publicPhone.field")}
                defaultValue={state.phone ?? ""}
                size="small"
                helperText={t("emails.publicPhone.help")}
                slotProps={{ htmlInput: { maxLength: PUBLIC_PHONE_MAX, autoComplete: "off", inputMode: "tel" } }}
              />
              <Box>
                <GlyphSubmitButton label={t("emails.publicPhone.save")} pendingLabel={t("emails.publicPhone.saving")} icon="save" />
              </Box>
            </Stack>
          </ActionForm>
        </Box>
      )}
    </Panel>
  );
}
