import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { updateCalendarRsvpAction } from "@/app/[locale]/admin/settings/emails/actions";
import { CLUB_TIME_ZONE, formatDay } from "@/i18n/dates";
import type { Locale } from "@/i18n/routing";
import type { CalendarRsvpState } from "@/modules/notifications/calendar-rsvp";
import ActionForm from "@/shared/forms/ActionForm";
import RecallField from "@/shared/forms/recall";
import { refusalMessages } from "@/shared/forms/refusal-messages";
import { confirmWords } from "@/shared/feedback/confirm-words";
import type { FoldOpenWhen } from "@/shared/ui/fold";
import GlyphSubmitButton from "@/shared/ui/GlyphSubmitButton";
import Panel from "@/shared/ui/Panel";

type Props = {
  locale: Locale;
  state: CalendarRsvpState;
  /** Administrator only (§291); `updateCalendarRsvpTo` refuses anybody else. */
  mayEdit: boolean;
  openWhen?: FoldOpenWhen;
};

/**
 * «Răspunsurile din calendar merg la» (§NNN): one optional address, beside «Copiile clubului»
 * because it answers the same question — what the club receives. Empty, the calendar goes out as
 * the file it always was (§174); with an address, as an invitation the runner answers «Da / Nu /
 * Poate», and the answer lands there. The «Telefon public» shape (§565): a Server Component, one
 * box, its «Salvează», behind the §384 confirmation — every runner's invitation changes with it.
 */
export default async function CalendarRsvpPanel({ locale, state, mayEdit, openWhen }: Props) {
  const t = await getTranslations("Admin");
  const words = await confirmWords();

  return (
    <Panel
      glyph="calendarRsvp"
      title={t("emails.calendarRsvp.title")}
      intro={t("emails.calendarRsvp.intro")}
      aside={state.to ? t("emails.calendarRsvp.aside", { address: state.to }) : t("emails.calendarRsvp.asideNone")}
      collapsible
      openWhen={openWhen}
      id="calendar-rsvp"
      data-testid="calendar-rsvp"
    >
      {/* The address in force, named, so a save that changed nothing reads as such (§457). */}
      <Typography variant="body2" sx={{ fontWeight: 500 }}>
        {state.to ? t("emails.calendarRsvp.inForce", { address: state.to }) : t("emails.calendarRsvp.inForceNone")}
      </Typography>
      {state.updatedAt && (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
          {t("emails.calendarRsvp.updatedAt", {
            when: formatDay(state.updatedAt, { locale, timeZone: CLUB_TIME_ZONE, style: "short", withTime: true, position: "inline" }),
          })}
        </Typography>
      )}

      {!mayEdit ? (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
          {t("emails.calendarRsvp.readOnly")}
        </Typography>
      ) : (
        <Box sx={{ mt: 1.5 }}>
          <ActionForm
            action={updateCalendarRsvpAction}
            messages={await refusalMessages({ calendarRsvpTo: t("emails.calendarRsvp.field") })}
            confirm={{
              title: t("confirm.calendarRsvpTitle"),
              body: t("confirm.calendarRsvpBody"),
              confirmLabel: t("emails.calendarRsvp.save"),
              cancelLabel: words.cancel,
            }}
            // Several forms share «Emailuri»; this one's summary and box ids carry their own prefix.
            scope="calendarRsvp"
            data-testid="calendar-rsvp-form"
          >
            <input type="hidden" name="uiLocale" value={locale} />
            <Stack spacing={1.5} sx={{ maxWidth: 560 }}>
              <RecallField
                name="calendarRsvpTo"
                label={t("emails.calendarRsvp.field")}
                defaultValue={state.to}
                size="small"
                helperText={t("emails.calendarRsvp.help")}
                slotProps={{ htmlInput: { maxLength: 320, autoComplete: "off", spellCheck: false, inputMode: "email" } }}
              />
              <Box>
                <GlyphSubmitButton label={t("emails.calendarRsvp.save")} pendingLabel={t("emails.calendarRsvp.saving")} icon="save" />
              </Box>
            </Stack>
          </ActionForm>
        </Box>
      )}
    </Panel>
  );
}
