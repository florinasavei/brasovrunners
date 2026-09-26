import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { updateEmailTransportAction } from "@/app/[locale]/admin/emails/actions";
import type { EmailMessageType } from "@/db/schema/email-outbox";
import { CLUB_TIME_ZONE, formatDay } from "@/i18n/dates";
import type { Locale } from "@/i18n/routing";
import {
  EMAIL_GROUP_OF,
  EMAIL_GROUPS,
  EMAIL_TRANSPORTS,
  GMAIL_AT_CAP,
  GMAIL_DAILY_CAP_MAX,
  GMAIL_PACE_SECONDS_MAX,
} from "@/modules/notifications/domain/email-transport";
import type { EmailTransportState } from "@/modules/notifications/email-transport";
import type { EmailVolumeToday } from "@/modules/notifications/volume";
import { confirmWords } from "@/shared/feedback/confirm-words";
import ActionForm from "@/shared/forms/ActionForm";
import RecallField from "@/shared/forms/recall";
import { refusalMessages } from "@/shared/forms/refusal-messages";
import type { FoldOpenWhen } from "@/shared/ui/fold";
import GlyphSubmitButton from "@/shared/ui/GlyphSubmitButton";
import Panel from "@/shared/ui/Panel";

type Props = {
  locale: Locale;
  setting: EmailTransportState;
  volume: EmailVolumeToday;
  /** The Administrator's form (§291): everybody else reads the figures and the choice. */
  mayEdit: boolean;
  openWhen?: FoldOpenWhen;
  /** Nothing queues these any more (§331); left out of the group's list of names. */
  neverQueued: ReadonlySet<EmailMessageType>;
};

/**
 * "Prin ce pleacă emailurile" (§NNN): per group of messages, Mailgun or the club's Gmail; Gmail's
 * cap per 24 hours and its pause between messages; whether Mailgun's spent day spills over into
 * Gmail. A Server Component with one form, beside the Mailgun plan it spends less of — the same
 * shape as `EmailPlanPanel`: native selects and numbers that post as ordinary fields, the service
 * validating, an audit row recording who said what.
 */
export default async function EmailTransportPanel({ locale, setting, volume, mayEdit, openWhen, neverQueued }: Props) {
  const t = await getTranslations("Admin");
  const words = await confirmWords();
  const viaGmail = EMAIL_GROUPS.filter((group) => setting.groups[group] === "gmail").length;
  // Recent: within the rolling day Gmail's cap counts — older, it is history, not a warning.
  const recentFailure = volume.gmailFailedLastDay;
  const namesOf = (group: (typeof EMAIL_GROUPS)[number]) =>
    (Object.keys(EMAIL_GROUP_OF) as EmailMessageType[])
      .filter((type) => EMAIL_GROUP_OF[type] === group && !neverQueued.has(type))
      .map((type) => t(`emails.types.${type}`))
      .join(", ");
  // A group with no message queued on this deployment says nothing rather than an empty list.
  const listOf = (group: (typeof EMAIL_GROUPS)[number]) => {
    const names = namesOf(group);
    return names ? ` ${t("emails.transport.messages", { names })}` : "";
  };

  return (
    <Panel
      title={t("emails.transport.title")}
      intro={t("emails.transport.intro")}
      aside={
        volume.gmailConfigured
          ? t("emails.transport.aside.on", { sent: volume.gmailSentLastDay, cap: volume.gmailDailyCap, groups: viaGmail, total: EMAIL_GROUPS.length })
          : t("emails.transport.aside.off")
      }
      collapsible
      // Gmail at its cap is the one state here that asks for a decision: a higher cap, or Mailgun.
      openWhen={{ ...openWhen, attention: volume.gmailConfigured && (volume.gmailSentLastDay >= volume.gmailDailyCap || recentFailure) }}
      id="email-transport"
      data-testid="email-transport"
    >
      {volume.gmailConfigured ? (
        <Typography variant="body2" sx={{ fontWeight: 500 }} data-testid="email-transport-status">
          {t(`emails.transport.status.${setting.atGmailCap}`, { sent: volume.gmailSentLastDay, cap: volume.gmailDailyCap })}
        </Typography>
      ) : (
        <Alert severity="info" data-testid="email-transport-unconfigured">
          {t("emails.transport.unconfigured")}
        </Alert>
      )}
      {/* A Gmail failure falls back to Mailgun or waits for a retry; said here, or nobody would know (§NNN). */}
      {volume.gmailLastFailure && (
        <Alert severity={recentFailure ? "warning" : "info"} sx={{ mt: 1 }} data-testid="email-transport-failure">
          {t("emails.transport.lastFailure", {
            when: formatDay(volume.gmailLastFailure.at, { locale, timeZone: CLUB_TIME_ZONE, style: "short", withTime: true, position: "inline" }),
            error: volume.gmailLastFailure.error,
          })}
        </Alert>
      )}
      <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
        {t("emails.transport.privacy")}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
        {t("emails.transport.caveat")}
      </Typography>
      {setting.updatedAt && (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
          {t("emails.transport.updatedAt", {
            when: formatDay(setting.updatedAt, { locale, timeZone: CLUB_TIME_ZONE, style: "short", withTime: true, position: "inline" }),
          })}
        </Typography>
      )}

      {!mayEdit ? (
        <Box sx={{ mt: 1.5 }}>
          <Stack component="ul" spacing={0.5} sx={{ m: 0, pl: 2.5 }}>
            {EMAIL_GROUPS.map((group) => (
              <Typography component="li" variant="body2" key={group} data-testid={`email-transport-${group}`}>
                {t(`emails.transport.groups.${group}.label`)}: {t(`emails.transport.options.${setting.groups[group]}`)}
              </Typography>
            ))}
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {t("emails.transport.readOnly")}
          </Typography>
        </Box>
      ) : (
        <Box sx={{ mt: 1.5 }}>
          <ActionForm
            action={updateEmailTransportAction}
            messages={await refusalMessages({
              links: t("emails.transport.groups.links.label"),
              confirmations: t("emails.transport.groups.confirmations.label"),
              reminders: t("emails.transport.groups.reminders.label"),
              announcements: t("emails.transport.groups.announcements.label"),
              club: t("emails.transport.groups.club.label"),
              newsletter: t("emails.transport.groups.newsletter.label"),
              gmailDailyCap: t("emails.transport.dailyCap"),
              gmailPaceSeconds: t("emails.transport.pace"),
              atGmailCap: t("emails.transport.atCap"),
              overflowToGmail: t("emails.transport.overflow"),
            })}
            confirm={{
              title: t("confirm.emailTransportTitle"),
              body: t("confirm.emailTransportBody"),
              confirmLabel: t("emails.transport.save"),
              cancelLabel: words.cancel,
            }}
            // Several forms share /admin/emails; each summary and box id carries its own prefix.
            scope="transport"
            data-testid="email-transport-form"
          >
            <input type="hidden" name="uiLocale" value={locale} />
            <Stack spacing={2} sx={{ maxWidth: 560 }}>
              {EMAIL_GROUPS.map((group) => (
                <RecallField
                  key={group}
                  select
                  name={group}
                  label={t(`emails.transport.groups.${group}.label`)}
                  defaultValue={setting.groups[group]}
                  size="small"
                  slotProps={{ select: { native: true } }}
                  helperText={`${t(`emails.transport.groups.${group}.help`)}${listOf(group)}`}
                >
                  {EMAIL_TRANSPORTS.map((transport) => (
                    <option key={transport} value={transport}>
                      {t(`emails.transport.options.${transport}`)}
                    </option>
                  ))}
                </RecallField>
              ))}
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
                <RecallField
                  name="gmailDailyCap"
                  type="number"
                  label={t("emails.transport.dailyCap")}
                  defaultValue={setting.gmailDailyCap}
                  size="small"
                  slotProps={{ htmlInput: { min: 1, max: GMAIL_DAILY_CAP_MAX, inputMode: "numeric" } }}
                  helperText={t("emails.transport.dailyCapHelp", { max: GMAIL_DAILY_CAP_MAX })}
                  fullWidth
                />
                <RecallField
                  name="gmailPaceSeconds"
                  type="number"
                  label={t("emails.transport.pace")}
                  defaultValue={setting.gmailPaceSeconds}
                  size="small"
                  slotProps={{ htmlInput: { min: 0, max: GMAIL_PACE_SECONDS_MAX, inputMode: "numeric" } }}
                  helperText={t("emails.transport.paceHelp", { max: GMAIL_PACE_SECONDS_MAX })}
                  fullWidth
                />
              </Stack>
              <RecallField
                select
                name="atGmailCap"
                label={t("emails.transport.atCap")}
                defaultValue={setting.atGmailCap}
                size="small"
                slotProps={{ select: { native: true } }}
                helperText={t("emails.transport.atCapHelp")}
              >
                {GMAIL_AT_CAP.map((choice) => (
                  <option key={choice} value={choice}>
                    {t(`emails.transport.atCapOptions.${choice}`)}
                  </option>
                ))}
              </RecallField>
              <RecallField
                select
                name="overflowToGmail"
                label={t("emails.transport.overflow")}
                defaultValue={setting.overflowToGmail ? "yes" : "no"}
                size="small"
                slotProps={{ select: { native: true } }}
              >
                <option value="yes">{t("emails.transport.overflowOptions.yes")}</option>
                <option value="no">{t("emails.transport.overflowOptions.no")}</option>
              </RecallField>
              <Box>
                <GlyphSubmitButton label={t("emails.transport.save")} pendingLabel={t("emails.transport.saving")} icon="save" />
              </Box>
            </Stack>
          </ActionForm>
        </Box>
      )}
    </Panel>
  );
}
