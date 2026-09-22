import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import Panel from "@/shared/ui/Panel";
import { getTranslations } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { updateEmailPlanAction } from "@/app/[locale]/admin/emails/actions";
import { EMAIL_PLAN_IDS, EMAIL_PLANS, EMAIL_PLANS_CHECKED_ON } from "@/modules/notifications/domain/email-plan";
import type { EmailPlanState } from "@/modules/notifications/email-plan";
import type { EmailVolumeToday } from "@/modules/notifications/volume";
import SubmitButton from "@/shared/ui/SubmitButton";

type Props = {
  locale: Locale;
  plan: EmailPlanState;
  volume: EmailVolumeToday;
};

/**
 * Which Mailgun plan the club is on, and the counts that would expose a wrong answer
 * (`DECISIONS.md` §100). A Server Component with one form: the select and the two numbers
 * post as ordinary fields, the numbers only mattering for `CUSTOM`. No JavaScript decides
 * anything here; the service validates and the audit row records who said what.
 */
export default async function EmailPlanPanel({ locale, plan, volume }: Props) {
  const t = await getTranslations("Admin");
  const unlimited = t("emails.plan.unlimited");
  const ceiling = (value: number | null) => (value === null ? unlimited : value.toLocaleString(locale === "ro" ? "ro-RO" : "en-GB"));

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
      {plan.updatedAt && (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1.5 }}>
          {t("emails.plan.updatedAt", {
            when: new Intl.DateTimeFormat(locale === "ro" ? "ro-RO" : "en-GB", { dateStyle: "medium", timeStyle: "short", hourCycle: "h23", timeZone: "Europe/Bucharest" }).format(plan.updatedAt),
            note: plan.note || "—",
          })}
        </Typography>
      )}

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
            <SubmitButton label={t("emails.plan.save")} pendingLabel={t("emails.plan.saving")} />
          </Box>
        </Stack>
      </Box>
    </Panel>
  );
}
