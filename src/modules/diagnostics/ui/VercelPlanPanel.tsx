import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getFormatter, getTranslations } from "next-intl/server";
import { updateVercelPlanAction } from "@/app/[locale]/admin/settings/costs/actions";
import { countForm } from "@/i18n/count-form";
import { CLUB_TIME_ZONE, formatCalendarDay, formatDay } from "@/i18n/dates";
import type { Locale } from "@/i18n/routing";
import { VERCEL_MAX_SEATS, VERCEL_PLAN_IDS, VERCEL_PLANS, VERCEL_PLANS_CHECKED_ON, vercelUsdPerMonth } from "@/modules/diagnostics/domain/vercel-plan";
import type { VercelPlanState } from "@/modules/diagnostics/vercel-plan";
import { confirmWords } from "@/shared/feedback/confirm-words";
import ActionForm from "@/shared/forms/ActionForm";
import RecallField from "@/shared/forms/recall";
import { refusalMessages } from "@/shared/forms/refusal-messages";
import GlyphSubmitButton from "@/shared/ui/GlyphSubmitButton";
import Panel from "@/shared/ui/Panel";

type Props = {
  locale: Locale;
  plan: VercelPlanState;
  /**
   * Whether the reader may change the plan — the Neon plan's door (`canManageClubSettings`). The
   * plan in force is for everyone who may open the page; the form is the Administrator's, and
   * `updateVercelPlan` refuses anybody else.
   */
  mayEdit: boolean;
};

/**
 * Which Vercel plan the club is on — Hobby, or Pro with its developer seats — said in one sentence,
 * then the form that sets it (§610; the club took Pro on 2026-09-30, for the function quota before
 * the race, while «Costuri» went on printing Hobby).
 *
 * The Neon plan's panel (`NeonPlanPanel`, §306), copied: a Server Component with one form, the
 * select, the seats and the note posted as ordinary fields, the service validating and the audit
 * row saying who said what; a refusal comes back as the form's state with what was chosen (§315).
 * Unlike Neon's, nothing reads Vercel's own answer first: the plan is told here, and the «?» says
 * so. The price lives in `domain/vercel-plan.ts` and reaches every sentence through a placeholder.
 */
export default async function VercelPlanPanel({ locale, plan, mayEdit }: Props) {
  const t = await getTranslations("Admin");
  const words = await confirmWords();
  const format = await getFormatter();
  const usd = (value: number) => format.number(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const seats = t(`tasks.vercelPlan.seats.${countForm(plan.seats, locale)}`, { count: plan.seats });

  return (
    <Panel
      glyph="plan"
      level={2}
      id="vercel-plan"
      title={t("tasks.vercelPlan.title")}
      intro={t("tasks.vercelPlan.intro")}
      introMore={t("tasks.vercelPlan.introMore")}
      data-testid="vercel-plan"
    >
      <Typography variant="body2" sx={{ fontWeight: 500 }} data-testid="vercel-plan-in-force">
        {plan.plan === "PRO" ? t("tasks.vercelPlan.inForce.PRO", { seats, price: usd(vercelUsdPerMonth(plan)) }) : t("tasks.vercelPlan.inForce.HOBBY")}
      </Typography>
      {plan.updatedAt && (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }} data-testid="vercel-plan-updated">
          {(() => {
            const when = formatDay(plan.updatedAt, { locale, timeZone: CLUB_TIME_ZONE, style: "short", withTime: true, position: "inline" });
            const note = plan.note || "—";
            return plan.updatedBy ? t("tasks.vercelPlan.updated", { who: plan.updatedBy, when, note }) : t("tasks.vercelPlan.updatedNoWho", { when, note });
          })()}
        </Typography>
      )}

      {!mayEdit ? (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
          {t("tasks.vercelPlan.readOnly")}
        </Typography>
      ) : (
        <Box sx={{ mt: 1.5 }}>
          <ActionForm
            action={updateVercelPlanAction}
            confirm={{ title: t("confirm.vercelPlanTitle"), body: t("confirm.vercelPlanBody"), confirmLabel: t("tasks.vercelPlan.save"), cancelLabel: words.cancel }}
            messages={await refusalMessages({ plan: t("tasks.vercelPlan.field"), seats: t("tasks.vercelPlan.seatsField"), note: t("tasks.vercelPlan.note") })}
            scope="vercel"
            data-testid="vercel-plan-form"
          >
            <input type="hidden" name="uiLocale" value={locale} />
            <Stack spacing={1.5} sx={{ maxWidth: 520 }}>
              <RecallField
                select
                name="plan"
                label={t("tasks.vercelPlan.field")}
                defaultValue={plan.plan}
                size="small"
                slotProps={{ select: { native: true } }}
                helperText={t("tasks.vercelPlan.fieldHelp", { checkedOn: formatCalendarDay(VERCEL_PLANS_CHECKED_ON, { locale, style: "long", position: "inline" }) })}
                helpMore={t("tasks.vercelPlan.fieldHelpMore")}
              >
                {VERCEL_PLAN_IDS.map((id) => (
                  <option key={id} value={id}>
                    {t(`tasks.vercelPlan.option.${id}`, { name: VERCEL_PLANS[id].name, price: usd(VERCEL_PLANS[id].usdPerSeatPerMonth) })}
                  </option>
                ))}
              </RecallField>
              <RecallField
                name="seats"
                label={t("tasks.vercelPlan.seatsField")}
                defaultValue={String(plan.seats)}
                size="small"
                helperText={t("tasks.vercelPlan.seatsHelp", { max: VERCEL_MAX_SEATS })}
                slotProps={{ htmlInput: { inputMode: "numeric", pattern: "[0-9]*", min: 1, max: VERCEL_MAX_SEATS, required: true } }}
              />
              <RecallField name="note" label={t("tasks.vercelPlan.note")} defaultValue={plan.note} size="small" slotProps={{ htmlInput: { maxLength: 200 } }} />
              {/* The way back down is one select on this card, and the card says so. */}
              <Typography variant="caption" color="text.secondary">
                {t("tasks.vercelPlan.back")}
              </Typography>
              <Box>
                <GlyphSubmitButton label={t("tasks.vercelPlan.save")} pendingLabel={t("tasks.vercelPlan.saving")} icon="save" />
              </Box>
            </Stack>
          </ActionForm>
        </Box>
      )}
    </Panel>
  );
}
