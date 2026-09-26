import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getFormatter, getTranslations } from "next-intl/server";
import { updateBudgetThresholdsAction } from "@/app/[locale]/admin/tasks/actions";
import { CLUB_TIME_ZONE, formatDay } from "@/i18n/dates";
import type { Locale } from "@/i18n/routing";
import { BUDGET_AHEAD_MARGIN, type NeonBudgetLevel } from "@/modules/diagnostics/domain/neon-budget";
import type { BudgetReading } from "@/modules/diagnostics/neon-budget";
import { confirmWords } from "@/shared/feedback/confirm-words";
import ActionForm from "@/shared/forms/ActionForm";
import RecallField from "@/shared/forms/recall";
import { refusalMessages } from "@/shared/forms/refusal-messages";
import GlyphSubmitButton from "@/shared/ui/GlyphSubmitButton";
import Panel from "@/shared/ui/Panel";

type Props = {
  locale: Locale;
  /** The governor's reading (`readNeonBudget`): the level, its arithmetic and the meter behind it. */
  reading: BudgetReading;
  /** The Administrator's, like the interval beside it; `updateBudgetThresholds` refuses anybody else. `/devs` shows it read-only. */
  mayEdit?: boolean;
};

/** The alert's colour per level. */
const SEVERITY: Record<NeonBudgetLevel, "success" | "info" | "warning" | "error"> = {
  unknown: "info",
  green: "success",
  amber: "warning",
  red: "error",
};

/**
 * "Bugetul lunii" — the month's Neon budget as the platform reads it, and what it is doing about
 * it (§NNN). On `/admin/tasks` → Costuri beside the brakes it is read against, with the two
 * thresholds the Administrator may move, and on `/devs` read-only, for the Tehnic role.
 *
 * In the order a reader asks: where the month stands (the level, the spend against the quota and
 * the pro-rated line, the pace), what the platform does about it now (the governor's effects, in
 * words), and where the figure came from (which of Neon's readings, the other two beside it).
 */
export default async function NeonBudgetPanel({ locale, reading, mayEdit = false }: Props) {
  const t = await getTranslations("Budget");
  const format = await getFormatter();
  const hours = (value: number) => format.number(value, { maximumFractionDigits: 1 });
  const day = (value: Date) => formatDay(value, { locale, timeZone: CLUB_TIME_ZONE, style: "long", position: "inline" });
  const { level, budget, meter, effects, thresholds } = reading;
  const words = mayEdit ? await confirmWords() : null;

  return (
    <Panel title={t("title")} intro={t("intro")} aside={t(`level.${level}`)} data-testid="neon-budget">
      <Alert severity={SEVERITY[level]} sx={{ mb: 1.5 }} data-testid="neon-budget-level" data-level={level}>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {t(`level.${level}`)}
        </Typography>
        <Typography variant="body2">
          {t(`meaning.${level}`, {
            amber: thresholds.amberPercent,
            red: thresholds.redPercent,
            margin: Math.round(BUDGET_AHEAD_MARGIN * 100),
          })}
        </Typography>
        {budget?.spent && <Typography variant="body2">{t("spentAll")}</Typography>}
      </Alert>

      {meter && budget && (
        <>
          <Typography variant="body2" sx={{ fontWeight: 500 }} data-testid="neon-budget-spent">
            {meter.quotaCuHours === null || budget.lineCuHours === null
              ? t("spentNoLimit", { used: hours(meter.usedCuHours), end: day(meter.periodEnd) })
              : t("spent", {
                  used: hours(meter.usedCuHours),
                  quota: hours(meter.quotaCuHours),
                  percent: Math.round((budget.ratio ?? 0) * 100),
                  line: hours(budget.lineCuHours),
                  end: day(meter.periodEnd),
                })}
          </Typography>
          <Typography variant="body2" sx={{ mt: 0.5 }} data-testid="neon-budget-pace">
            {budget.projectedCuHours === null
              ? t("paceNoLimit", { perDay: hours(budget.cuHoursPerDay) })
              : t("pace", { perDay: hours(budget.cuHoursPerDay), projected: hours(budget.projectedCuHours) })}
            {budget.runsOutAt && ` ${t("runsOut", { date: day(budget.runsOutAt) })}`}
          </Typography>
        </>
      )}

      <Typography variant="body2" sx={{ mt: 1.5 }} data-testid="neon-budget-effect">
        {t("effectLead")}{" "}
        {effects.jobFloorMinutes > 0 ? t("effect.floor", { minutes: effects.jobFloorMinutes }) : t("effect.none")}
        {effects.cacheCeilingFactor > 1 && ` ${t("effect.cache", { factor: effects.cacheCeilingFactor })}`}
        {effects.healthReuseMinutes > 0 && ` ${t("effect.healthReuse", { minutes: effects.healthReuseMinutes })}`}
        {` ${t("effect.monitor")}`}
      </Typography>

      {meter && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }} data-testid="neon-budget-source" data-source={meter.source}>
          {t(`source.${meter.source}`)}{" "}
          {t("readings", {
            metered: meter.meteredCuHours === null ? t("notRead") : hours(meter.meteredCuHours),
            operations: meter.operationsCuHours === null ? t("notRead") : hours(meter.operationsCuHours),
            legacy: hours(meter.legacyCuHours),
          })}
          {meter.meteredCuHours === null && ` ${t("meteredNeedsKey")}`}
        </Typography>
      )}

      {words && (
        <Box sx={{ mt: 1.5 }}>
          <ActionForm
            action={updateBudgetThresholdsAction}
            messages={await refusalMessages({ amberPercent: t("thresholds.amber"), redPercent: t("thresholds.red") })}
            confirm={{
              title: t("thresholds.confirmTitle"),
              body: t("thresholds.confirmBody"),
              confirmLabel: t("thresholds.save"),
              cancelLabel: words.cancel,
            }}
            scope="budget-thresholds"
            data-testid="neon-budget-thresholds"
          >
            <input type="hidden" name="uiLocale" value={locale} />
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              {t("thresholds.intro")}
            </Typography>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ maxWidth: 520 }}>
              <RecallField
                type="number"
                name="amberPercent"
                label={t("thresholds.amber")}
                defaultValue={String(thresholds.amberPercent)}
                size="small"
                slotProps={{ htmlInput: { min: 10, max: 95, step: 1 } }}
              />
              <RecallField
                type="number"
                name="redPercent"
                label={t("thresholds.red")}
                defaultValue={String(thresholds.redPercent)}
                size="small"
                slotProps={{ htmlInput: { min: 20, max: 99, step: 1 } }}
              />
            </Stack>
            <Box sx={{ mt: 1.5 }}>
              <GlyphSubmitButton label={t("thresholds.save")} pendingLabel={t("thresholds.saving")} icon="save" />
            </Box>
          </ActionForm>
        </Box>
      )}
    </Panel>
  );
}
