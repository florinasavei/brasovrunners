import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getFormatter, getTranslations } from "next-intl/server";
import { updateNeonPlanAction } from "@/app/[locale]/admin/tasks/actions";
import type { Locale } from "@/i18n/routing";
import { NEON_PLAN_IDS, NEON_PLANS, NEON_PLANS_CHECKED_ON, type NeonBlockModel } from "@/modules/diagnostics/domain/neon-plan";
import type { NeonPlanState } from "@/modules/diagnostics/neon-plan";
import ActionForm from "@/shared/forms/ActionForm";
import RecallField from "@/shared/forms/recall";
import { refusalMessages } from "@/shared/forms/refusal-messages";
import Panel from "@/shared/ui/Panel";
import GlyphSubmitButton from "@/shared/ui/GlyphSubmitButton";

type Props = {
  locale: Locale;
  plan: NeonPlanState;
  /**
   * Where the plan in force came from (§NNN): Neon's own answer, or — when the key is not set
   * or Neon did not answer — the setting below.
   */
  source: "neon" | "setting";
  /** The month as `/devs` reads it, so a plan set wrong shows here before it shows on the invoice. */
  block: NeonBlockModel;
  /**
   * Whether the reader may change the plan (§291). The plan in force and its sentence are for
   * everyone who may open the page; the form is the Administrator's, and `updateNeonPlan`
   * refuses anybody else — so a role that may not press is not shown the button.
   */
  mayEdit: boolean;
};

/**
 * Which Neon plan the club is on — Free or Launch — and the figures that follow it
 * (`DECISIONS.md` §280's follow-up; the owner, with the billing console beside `/devs`: "faza
 * asta cu DB-ul Neon nu e actualizata! pt ca am zis ca am cumparat urmatorul plan!").
 *
 * The same panel as the Mailgun plan's (§100). It was written believing Neon's API gives this
 * code the consumption and never the plan; the project row names the owning account's plan
 * (`owner.subscription_type`), so the pages read that first and the select below is the
 * fallback for an environment with no key or a Neon that did not answer (§NNN). The day the
 * plan changes is still not a deployment, and now not even a click. A Server Component with
 * one form: the select and
 * the note post as ordinary fields; the service validates and the audit row records who said
 * what. The options quote the catalogue's own figures through placeholders, so the price lives
 * in `domain/neon-plan.ts` and nowhere else.
 *
 * Like its twin on `/admin/emails`, a refusal comes back as the form's state with the plan and
 * the note as they were chosen (`DECISIONS.md` §315), rather than a redirect that dropped the note.
 */
export default async function NeonPlanPanel({ locale, plan, source, block, mayEdit }: Props) {
  const t = await getTranslations("Admin");
  const format = await getFormatter();
  const usd = (value: number) => format.number(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const rate = (value: number) => format.number(value, { maximumFractionDigits: 3 });

  return (
    <Panel title={t("tasks.neonPlan.title")} intro={t("tasks.neonPlan.intro")} data-testid="neon-plan">
      {/* The plan in force, and what this month looks like on it — the figures a wrong answer would expose. */}
      <Typography variant="body2" sx={{ fontWeight: 500 }} data-testid="neon-plan-in-force">
        {block.plan === "LAUNCH"
          ? block.compute
            ? t("tasks.neonPlan.inForce.launchMeasured", {
                cu: format.number(block.compute.cuHours, { maximumFractionDigits: 1 }),
                usd: usd(block.compute.estimatedUsd ?? 0),
                rate: rate(block.rates?.usdPerCuHour ?? 0),
              })
            : t("tasks.neonPlan.inForce.launch", { rate: rate(block.rates?.usdPerCuHour ?? 0) })
          : block.compute
            ? t("tasks.neonPlan.inForce.freeMeasured", {
                cu: format.number(block.compute.cuHours, { maximumFractionDigits: 1 }),
                of: block.compute.ceilingCuHours ?? 0,
                percent: block.compute.percent ?? 0,
              })
            : t("tasks.neonPlan.inForce.free", { of: NEON_PLANS.FREE.cuHoursPerMonth ?? 0 })}
      </Typography>
      {/* Where that plan came from: Neon's answer, or the setting below standing in for it. */}
      <Typography variant="body2" sx={{ mt: 0.5 }} data-testid="neon-plan-source">
        {source === "neon"
          ? t("tasks.neonPlan.source.neon", { name: NEON_PLANS[block.plan].name })
          : t("tasks.neonPlan.source.setting")}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
        {t("tasks.neonPlan.estimate")}
      </Typography>
      {plan.updatedAt && (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
          {t("tasks.neonPlan.updatedAt", {
            when: new Intl.DateTimeFormat(locale === "ro" ? "ro-RO" : "en-GB", {
              dateStyle: "medium",
              timeStyle: "short",
              hourCycle: "h23",
              timeZone: "Europe/Bucharest",
            }).format(plan.updatedAt),
            note: plan.note || "—",
          })}
        </Typography>
      )}

      {!mayEdit ? (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
          {t("tasks.neonPlan.readOnly")}
        </Typography>
      ) : (
        <Box sx={{ mt: 1.5 }}>
        <ActionForm
          action={updateNeonPlanAction}
          messages={await refusalMessages({ plan: t("tasks.neonPlan.field"), note: t("tasks.neonPlan.note") })}
          scope="neon"
          data-testid="neon-plan-form"
        >
          <input type="hidden" name="uiLocale" value={locale} />
          <Stack spacing={1.5} sx={{ maxWidth: 520 }}>
            <RecallField
              select
              name="plan"
              label={t("tasks.neonPlan.field")}
              defaultValue={plan.plan}
              size="small"
              slotProps={{ select: { native: true } }}
              helperText={t("tasks.neonPlan.fieldHelp", { checkedOn: NEON_PLANS_CHECKED_ON })}
            >
              {NEON_PLAN_IDS.map((id) => {
                const entry = NEON_PLANS[id];
                return (
                  <option key={id} value={id}>
                    {id === "FREE"
                      ? t("tasks.neonPlan.option.FREE", {
                          name: entry.name,
                          cuHours: entry.cuHoursPerMonth ?? 0,
                          storageMb: Math.round((entry.storageBytes ?? 0) / (1024 * 1024)),
                        })
                      : t("tasks.neonPlan.option.LAUNCH", {
                          name: entry.name,
                          rate: rate(entry.usdPerCuHour),
                          storageRate: rate(entry.usdPerGbMonth),
                        })}
                  </option>
                );
              })}
            </RecallField>
            <RecallField name="note" label={t("tasks.neonPlan.note")} defaultValue={plan.note} size="small" slotProps={{ htmlInput: { maxLength: 200 } }} />
            {/* The December review (§280) is one select on this screen, and the panel says so. */}
            <Typography variant="caption" color="text.secondary">
              {t("tasks.neonPlan.december")}
            </Typography>
            <Box>
              <GlyphSubmitButton label={t("tasks.neonPlan.save")} pendingLabel={t("tasks.neonPlan.saving")} icon="save" />
            </Box>
          </Stack>
        </ActionForm>
        </Box>
      )}
    </Panel>
  );
}
