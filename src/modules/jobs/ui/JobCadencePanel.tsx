import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { CLUB_TIME_ZONE, formatDay } from "@/i18n/dates";
import { updateJobCadenceAction } from "@/app/[locale]/admin/tasks/actions";
import type { Locale } from "@/i18n/routing";
import type { JobCadenceState } from "@/modules/jobs/cadence";
import type { JobOverview } from "@/modules/jobs/overview";
import type { DeliveryTiming } from "@/modules/notifications/domain/delivery-timing";
import { JOB_CADENCE_CHOICES, NEXT_DUE_CAP_MINUTES } from "@/modules/jobs/schedule";
import ActionForm from "@/shared/forms/ActionForm";
import RecallField from "@/shared/forms/recall";
import { refusalMessages } from "@/shared/forms/refusal-messages";
import GlyphSubmitButton from "@/shared/ui/GlyphSubmitButton";
import Panel from "@/shared/ui/Panel";

type Props = {
  locale: Locale;
  cadence: JobCadenceState;
  /** One line per job: the last real run, the next at the latest, the last ping (`overview.ts`). */
  jobs: JobOverview[];
  /** The Administrator's, like the Neon plan beside it; `updateJobCadence` refuses anybody else. */
  mayEdit: boolean;
  /**
   * When the club's email leaves (§221): right after the request that queued it, or only on the
   * outbox job. It decides whether the interval chosen here delays email too, so the sentence
   * about email is picked by it rather than stated once and false half the time.
   */
  emailTiming: DeliveryTiming;
};

/**
 * "Cât de des verifică platforma" — the owner's throttle (§334; 2026-09-23: "I want toggles in my
 * admin area, so I can throttle myself when needed").
 *
 * Beside the Neon plan and built the same way (`NeonPlanPanel`): a Server Component with one
 * form, the select posting as an ordinary field, the service validating and writing the audit
 * row, a refusal handed back as the form's state (§315). It says, before the choice, what a
 * longer interval costs the runners and what it does not, and under the choice what it has done:
 * the last real run and the next one at the latest, per job, with the last ping and whether it
 * woke the database.
 */
export default async function JobCadencePanel({ locale, cadence, jobs, mayEdit, emailTiming }: Props) {
  const t = await getTranslations("Admin");
  // A platform timestamp, in the club's zone, with its weekday, inside the line after a colon
  // ("ultima rulare reală: joi, 24 sept. 2026, 10:15") — so the weekday keeps its lower case
  // (§350 weekday on every date).
  const clock = (at: Date) => formatDay(at, { locale, timeZone: CLUB_TIME_ZONE, style: "short", withTime: true, position: "inline" });
  const when = (at: Date | null) => (at ? clock(at) : "—");

  return (
    <Panel title={t("tasks.jobCadence.title")} intro={t("tasks.jobCadence.intro")} data-testid="job-cadence">
      <Typography variant="body2" sx={{ fontWeight: 500 }} data-testid="job-cadence-in-force">
        {cadence.minutes === 0
          ? t("tasks.jobCadence.inForce.onDemand", { cap: NEXT_DUE_CAP_MINUTES })
          : t("tasks.jobCadence.inForce.every", { minutes: cadence.minutes })}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
        {t("tasks.jobCadence.cost")}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
        {t("tasks.jobCadence.safe")}
      </Typography>
      {/* §NNN: why an idle hour costs one wake — the safety look shares the :00 call and the
          health monitor's check, whichever interval is chosen. */}
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }} data-testid="job-cadence-on-the-hour">
        {t("tasks.jobCadence.onTheHour")}
      </Typography>
      {/* Email, as it is on this deployment (§221): untouched by the interval when it leaves
          after the request, delayed by it when the outbox job is the only sender. */}
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }} data-testid="job-cadence-emails">
        {t(emailTiming === "scheduled" ? "tasks.jobCadence.emails.scheduled" : "tasks.jobCadence.emails.immediate")}
      </Typography>

      {/* The measured effect: what each job did last, and when it will look again at the latest. */}
      <Stack component="ul" spacing={0.5} sx={{ mt: 1.5, mb: 0, pl: 2.5 }} data-testid="job-cadence-effect">
        {jobs.map((job) => (
          <Typography component="li" variant="body2" key={job.job}>
            <strong>{t(job.job === "email-outbox" ? "tasks.jobCadence.job.outbox" : "tasks.jobCadence.job.maintenance")}</strong>
            {" — "}
            {t("tasks.jobCadence.lastRun", { when: when(job.lastRealRunAt) })}
            {" · "}
            {job.nextCheckAt
              ? t(job.waitingFor === "cadence" ? "tasks.jobCadence.nextByCadence" : "tasks.jobCadence.nextByWork", {
                  when: when(job.nextCheckAt),
                })
              : t("tasks.jobCadence.nextPing")}
            {job.lastPingAt && (
              <>
                {" · "}
                {t(job.lastPingRan ? "tasks.jobCadence.lastPingRan" : "tasks.jobCadence.lastPingSkipped", {
                  when: when(job.lastPingAt),
                })}
              </>
            )}
          </Typography>
        ))}
      </Stack>
      {cadence.updatedAt && (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
          {t("tasks.jobCadence.updatedAt", { when: clock(cadence.updatedAt) })}
        </Typography>
      )}

      {!mayEdit ? (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
          {t("tasks.jobCadence.readOnly")}
        </Typography>
      ) : (
        <Box sx={{ mt: 1.5 }}>
          <ActionForm
            action={updateJobCadenceAction}
            messages={await refusalMessages({ minutes: t("tasks.jobCadence.field") })}
            scope="cadence"
            data-testid="job-cadence-form"
          >
            <input type="hidden" name="uiLocale" value={locale} />
            <Stack spacing={1.5} sx={{ maxWidth: 520 }}>
              <RecallField
                select
                name="minutes"
                label={t("tasks.jobCadence.field")}
                defaultValue={String(cadence.minutes)}
                size="small"
                slotProps={{ select: { native: true } }}
                helperText={t("tasks.jobCadence.fieldHelp", { cap: NEXT_DUE_CAP_MINUTES })}
              >
                {JOB_CADENCE_CHOICES.map((minutes) => (
                  <option key={minutes} value={String(minutes)}>
                    {minutes === 0
                      ? t("tasks.jobCadence.option.onDemand", { cap: NEXT_DUE_CAP_MINUTES })
                      : minutes > NEXT_DUE_CAP_MINUTES
                        ? t("tasks.jobCadence.option.everyLong", { minutes, cap: NEXT_DUE_CAP_MINUTES })
                        : t("tasks.jobCadence.option.every", { minutes })}
                  </option>
                ))}
              </RecallField>
              <Box>
                <GlyphSubmitButton label={t("tasks.jobCadence.save")} pendingLabel={t("tasks.jobCadence.saving")} icon="save" />
              </Box>
            </Stack>
          </ActionForm>
        </Box>
      )}
    </Panel>
  );
}
