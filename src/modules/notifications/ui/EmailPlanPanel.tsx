import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import Panel from "@/shared/ui/Panel";
import { getTranslations } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { updateEmailPlanAction } from "@/app/[locale]/admin/emails/actions";
import { registrationsLeftToday } from "@/modules/diagnostics/platform-plans";
import { EMAIL_PLAN_IDS, EMAIL_PLANS, EMAIL_PLANS_CHECKED_ON } from "@/modules/notifications/domain/email-plan";
import type { EmailPlanState } from "@/modules/notifications/email-plan";
import { type EmailVolumeToday, PARTICIPANT_MESSAGES_PER_COMPLETED_REGISTRATION } from "@/modules/notifications/volume";
import SubmitButton from "@/shared/ui/SubmitButton";

type Props = {
  locale: Locale;
  plan: EmailPlanState;
  volume: EmailVolumeToday;
  /**
   * Whether the reader may change the plan (§291). The figures are for everyone who may open
   * the page; the form is the Administrator's, and `updateEmailPlan` refuses anybody else — so
   * without this the Organizer was shown a "Salvează planul" that could only answer FORBIDDEN.
   */
  mayEdit: boolean;
};

/**
 * Which Mailgun plan the club is on, and the counts that would expose a wrong answer
 * (`DECISIONS.md` §100). A Server Component with one form: the select and the two numbers
 * post as ordinary fields, the numbers only mattering for `CUSTOM`. No JavaScript decides
 * anything here; the service validates and the audit row records who said what.
 */
export default async function EmailPlanPanel({ locale, plan, volume, mayEdit }: Props) {
  const t = await getTranslations("Admin");
  const unlimited = t("emails.plan.unlimited");
  const ceiling = (value: number | null) => (value === null ? unlimited : value.toLocaleString(locale === "ro" ? "ro-RO" : "en-GB"));
  /*
    What one registration costs and how many more fit — the same arithmetic `/admin/tasks` prints
    (`registrationsLeftToday`, `messagesPerCompletedRegistration`), read from the one figure
    `volume.ts` computed, so the two pages cannot disagree. Since 2026-09-22 the figure counts the
    hidden copies the club asked for on every participant message, which is why it is said here,
    next to the list that sets them, and not only on the task board.
  */
  const registrationsLeft = registrationsLeftToday({
    emailAllowance: volume.allowance,
    emailSentToday: volume.period === "month" ? volume.sentThisMonth : volume.sentMessages,
    messagesPerRegistration: volume.messagesPerRegistration,
  });

  return (
    <Panel title={t("emails.plan.title")} intro={t("emails.plan.intro")}>

      {/* The counts first: a plan set wrong shows here before it shows on race day. */}
      <Typography variant="body2" sx={{ fontWeight: 500 }}>
        {t(`emails.plan.status.${volume.period}`, {
          plan: volume.planName,
          sent: volume.period === "month" ? volume.sentThisMonth : volume.sentMessages,
          allowance: ceiling(volume.allowance),
          remaining: volume.remaining === null ? unlimited : ceiling(volume.remaining),
          waiting: volume.waitingMessages,
        })}
      </Typography>
      {/*
        One account, two deployments (§100, §163): the club's Mailgun allowance is shared by
        QA and production, and the count above is this environment's own outbox rows — so
        "99 left" on production is silent about whatever QA sent on the same account this
        morning. Said here rather than left to be discovered on race day.
      */}
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
        {t("emails.plan.shared")}
      </Typography>
      {/* The forecast: what a registration costs today, and how many more the allowance pays for. */}
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }} data-testid="email-forecast">
        {registrationsLeft === null
          ? t("emails.plan.forecastUnlimited", { count: volume.messagesPerRegistration })
          : t("emails.plan.forecast", { count: volume.messagesPerRegistration, left: registrationsLeft })}
        {volume.participantBccCount > 0 &&
          ` ${t("emails.plan.forecastBcc", {
            bcc: volume.participantBccCount,
            extra: volume.participantBccCount * PARTICIPANT_MESSAGES_PER_COMPLETED_REGISTRATION,
          })}`}
      </Typography>
      {plan.updatedAt && (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1.5 }}>
          {t("emails.plan.updatedAt", {
            when: new Intl.DateTimeFormat(locale === "ro" ? "ro-RO" : "en-GB", { dateStyle: "medium", timeStyle: "short", hourCycle: "h23", timeZone: "Europe/Bucharest" }).format(plan.updatedAt),
            note: plan.note || "—",
          })}
        </Typography>
      )}

      {!mayEdit ? (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
          {t("emails.plan.readOnly")}
        </Typography>
      ) : (
      <Box component="form" action={updateEmailPlanAction} sx={{ mt: 1.5 }}>
        <input type="hidden" name="uiLocale" value={locale} />
        <Stack spacing={1.5} sx={{ maxWidth: 520 }}>
          <TextField
            select
            name="plan"
            label={t("emails.plan.field")}
            defaultValue={plan.plan}
            size="small"
            slotProps={{ select: { native: true } }}
            helperText={t("emails.plan.fieldHelp", { checkedOn: EMAIL_PLANS_CHECKED_ON })}
          >
            {EMAIL_PLAN_IDS.map((id) => {
              const entry = id === "CUSTOM" ? null : EMAIL_PLANS[id];
              const label = entry
                ? t("emails.plan.option", {
                    name: entry.name,
                    ceiling: entry.dailyAllowance !== null ? t("emails.plan.perDay", { count: entry.dailyAllowance }) : t("emails.plan.perMonth", { count: ceiling(entry.monthlyAllowance) }),
                    price: entry.usdPerMonth === 0 ? t("emails.plan.free") : `$${entry.usdPerMonth}/${t("emails.plan.month")}`,
                  })
                : t("emails.plan.custom");
              return (
                <option key={id} value={id}>
                  {label}
                </option>
              );
            })}
          </TextField>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
            <TextField
              name="dailyAllowance"
              type="number"
              label={t("emails.plan.dailyAllowance")}
              defaultValue={plan.plan === "CUSTOM" && plan.dailyAllowance !== null ? plan.dailyAllowance : ""}
              size="small"
              slotProps={{ htmlInput: { min: 1, max: 1_000_000, inputMode: "numeric" } }}
              fullWidth
            />
            <TextField
              name="monthlyAllowance"
              type="number"
              label={t("emails.plan.monthlyAllowance")}
              defaultValue={plan.plan === "CUSTOM" && plan.monthlyAllowance !== null ? plan.monthlyAllowance : ""}
              size="small"
              slotProps={{ htmlInput: { min: 1, max: 10_000_000, inputMode: "numeric" } }}
              fullWidth
            />
          </Stack>
          <Typography variant="caption" color="text.secondary">
            {t("emails.plan.customHelp")}
          </Typography>
          <TextField name="note" label={t("emails.plan.note")} defaultValue={plan.note} size="small" slotProps={{ htmlInput: { maxLength: 200 } }} />
          <Box>
            <SubmitButton label={t("emails.plan.save")} pendingLabel={t("emails.plan.saving")} icon="save" />
          </Box>
        </Stack>
      </Box>
      )}
    </Panel>
  );
}
