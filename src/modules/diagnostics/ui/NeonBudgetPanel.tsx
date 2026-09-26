import Alert from "@mui/material/Alert";
import Typography from "@mui/material/Typography";
import { getFormatter, getTranslations } from "next-intl/server";
import { CLUB_TIME_ZONE, formatDay } from "@/i18n/dates";
import type { Locale } from "@/i18n/routing";
import { NEON_BUDGET_CRITICAL_RATIO, type NeonBudgetLevel } from "@/modules/diagnostics/domain/neon-budget";
import { NEON_QUOTA_WARNING_RATIO } from "@/modules/diagnostics/domain/neon-limits";
import type { BudgetReading } from "@/modules/diagnostics/neon-budget";
import Panel from "@/shared/ui/Panel";

type Props = {
  locale: Locale;
  /** The governor's reading (`readNeonBudget`): the level, its arithmetic and the meter behind it. */
  reading: BudgetReading;
};

/** The alert's colour per level: calm while the pace fits, amber as it runs ahead, red near and at the wall. */
const SEVERITY: Record<NeonBudgetLevel, "success" | "info" | "warning" | "error"> = {
  unknown: "info",
  unlimited: "info",
  normal: "success",
  ahead: "warning",
  tight: "warning",
  critical: "error",
  exhausted: "error",
};

/**
 * "Bugetul lunii" — the month's Neon budget as the platform reads it, and what it is doing about
 * it (§NNN). On `/admin/tasks` → Costuri beside the brakes it is read against, and on `/devs`,
 * for the Tehnic role, which reads `/devs` and not the task board.
 *
 * Three things, in the order a reader asks them: where the month stands (the level in words, the
 * share of the limit, the pace and where it leads), what the platform does about it now (the
 * governor's effect, in words — never a setting to hunt for), and where the figure came from
 * (which of Neon's three readings, and the other two beside it, because the distance between them
 * is how the frozen counter was caught on 2026-09-26). Read-only: the brakes themselves are the
 * limits card's, and the owner's own throttle is the cadence card's.
 */
export default async function NeonBudgetPanel({ locale, reading }: Props) {
  const t = await getTranslations("Budget");
  const format = await getFormatter();
  const hours = (value: number) => format.number(value, { maximumFractionDigits: 1 });
  const day = (value: Date) => formatDay(value, { locale, timeZone: CLUB_TIME_ZONE, style: "long", position: "inline" });
  const { level, budget, meter, effects } = reading;

  return (
    <Panel title={t("title")} intro={t("intro")} aside={t(`level.${level}`)} data-testid="neon-budget">
      <Alert severity={SEVERITY[level]} sx={{ mb: 1.5 }} data-testid="neon-budget-level" data-level={level}>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {t(`level.${level}`)}
        </Typography>
        {/* The lines from the one table that decides them, never a number written into the words. */}
        <Typography variant="body2">
          {t(`meaning.${level}`, { warn: Math.round(NEON_QUOTA_WARNING_RATIO * 100), critical: Math.round(NEON_BUDGET_CRITICAL_RATIO * 100) })}
        </Typography>
      </Alert>

      {meter && budget && (
        <>
          <Typography variant="body2" sx={{ fontWeight: 500 }} data-testid="neon-budget-spent">
            {meter.quotaCuHours === null
              ? t("spentNoLimit", { used: hours(meter.usedCuHours), end: day(meter.periodEnd) })
              : t("spent", {
                  used: hours(meter.usedCuHours),
                  quota: hours(meter.quotaCuHours),
                  percent: Math.round((budget.ratio ?? 0) * 100),
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
        {effects.jobsPaused
          ? t("effect.paused")
          : effects.jobFloorMinutes > 0
            ? t("effect.floor", { minutes: effects.jobFloorMinutes })
            : t("effect.none")}
        {effects.healthReuseMinutes > 0 && ` ${t("effect.healthReuse", { minutes: effects.healthReuseMinutes })}`}
        {effects.restingCopies && ` ${t("effect.resting")}`}
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
    </Panel>
  );
}
