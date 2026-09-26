import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getFormatter, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { formatCalendarDay, formatDayRange } from "@/i18n/dates";
import type { Locale } from "@/i18n/routing";
import type { MonthCostLine, MonthTotals, MonthUsage } from "@/modules/diagnostics/domain/month-costs";
import { NEON_PLANS } from "@/modules/diagnostics/domain/neon-plan";
import type { MonthCostReasons } from "@/modules/diagnostics/month-costs-read";
import { R2_FREE_STORAGE_GB, R2_USD_PER_GB_MONTH } from "@/modules/diagnostics/platform-plans";
import { EMAIL_PLANS } from "@/modules/notifications/domain/email-plan";
import { DEEPL_FREE_CHARACTERS_PER_MONTH } from "@/modules/translate/domain/budget";
import Panel from "@/shared/ui/Panel";

type Props = {
  locale: Locale;
  lines: MonthCostLine[];
  totals: MonthTotals;
  /**
   * Why a line has no reading, or no last month, in the provider's own words ("HTTP 401",
   * "unconfigured"), or "error" for a query that failed here; null where it read.
   */
  reasons: MonthCostReasons;
  /** Whether DeepL is set up here: a line of zeros means something else when the buttons are not there. */
  deeplConfigured: boolean;
};

/** The chip's colour per severity — `ServiceSeverity`'s own: grey for "nothing measures it", never green. */
const SEVERITY_COLOR: Record<MonthCostLine["severity"], "success" | "default" | "warning" | "error"> = {
  ok: "success",
  unknown: "default",
  watch: "warning",
  act: "error",
};

/**
 * One labelled fact inside a line: two columns on a phone, four from `md` — the cost table's own
 * grid. `wide` takes the whole row on a phone, for the usage sentence that would otherwise wrap a
 * word to a line; a variable's long name breaks anywhere rather than pushing the page sideways.
 */
function Fact({ label, wide = false, testId, children }: { label: string; wide?: boolean; testId?: string; children: ReactNode }) {
  return (
    <Box sx={wide ? { gridColumn: { xs: "1 / -1", md: "auto" } } : undefined} data-testid={testId}>
      <Typography variant="caption" color="text.secondary" component="div">
        {label}
      </Typography>
      <Typography variant="body2" component="div" sx={{ overflowWrap: "anywhere" }}>
        {children}
      </Typography>
    </Box>
  );
}

/**
 * «Luna aceasta» — the first card on Costuri (§NNN): what each provider has cost this month so
 * far, what it will have cost by the end of it and what last month cost where anything kept it,
 * with the usage behind each figure and the ceiling that usage meets. The totals first, as
 * sentences, because that is the question; one line per provider under it; every free line says
 * what would start costing money; the providers that bill nothing and meter nothing named in one
 * sentence at the end, so the list is complete without rows of zeros.
 *
 * Every amount is in USD, the currency each of these vendors bills in and the cost table below
 * prints — a converted figure would be a second estimate on top of the first.
 *
 * Read-only, and a Server Component: every figure comes from `monthCosts` (pure), and a line
 * whose reading failed says why rather than printing a zero (§1.2).
 */
export default async function MonthCostsPanel({ locale, lines, totals, reasons, deeplConfigured }: Props) {
  const t = await getTranslations("Admin");
  const format = await getFormatter();
  const usd = (value: number) => format.number(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const money = (value: number | null, plusVat: boolean) =>
    value === null
      ? t("tasks.month.notMeasured")
      : t(plusVat && value > 0 ? "tasks.costToday.amountPlusVat" : "tasks.costToday.amount", { amount: usd(value), currency: "USD" });
  const quantity = (unit: MonthUsage["unit"], value: number) =>
    format.number(value, { maximumFractionDigits: unit === "cuHours" ? 1 : unit === "gigabytes" ? 2 : 0 });
  // A period as the provider counts it, first day to last: the end is exclusive, so the last day is one instant before it.
  const span = (line: MonthCostLine) =>
    formatDayRange(line.period.start, new Date(line.period.end.getTime() - 1), { locale, timeZone: "UTC", style: "short", position: "inline" });
  // Its own short names, never the cost table's: one heading per provider per card, so a reader
  // (and a locator) looking for the table's row finds one and not two.
  const name = (line: MonthCostLine) => t(`tasks.month.name.${line.id}`);
  // A reason as the reader reads it: a query that failed here is not "the provider did not answer".
  const why = (reason: string) => (reason === "error" ? t("tasks.month.unreadHere") : t("tasks.month.unread", { reason }));

  const usageText = (line: MonthCostLine) => {
    if (line.id === "domain") {
      if (line.renewsOn === null) return t("tasks.month.domain.unknown");
      const day = formatCalendarDay(line.renewsOn, { locale, style: "long", position: "inline" });
      return t(line.renewsThisPeriod ? "tasks.month.domain.thisMonth" : "tasks.month.domain.renews", { date: day });
    }
    if (!line.usage) {
      const reason = reasons.current[line.id];
      if ((line.id === "neon" || line.id === "vercel") && (reason === "unconfigured" || reason === null)) {
        return t(`tasks.month.unmeasured.${line.id}`);
      }
      return why(reason ?? "error");
    }
    const u = line.usage;
    const parts = [t(`tasks.month.usage.${u.unit}`, { used: quantity(u.unit, u.used), projected: quantity(u.unit, u.projected) })];
    if (u.ceiling !== null && u.ceilingKind !== null) {
      parts.push(t(u.unit === "gigabytes" ? "tasks.month.ceiling.freeGb" : `tasks.month.ceiling.${u.ceilingKind}`, { ceiling: quantity(u.unit, u.ceiling) }));
    } else if (u.dailyCeiling !== null) {
      parts.push(t("tasks.month.ceiling.daily", { daily: quantity(u.unit, u.dailyCeiling) }));
    }
    if (u.state === "over") parts.push(t(`tasks.month.over.${line.id}`));
    if (line.detail?.kind === "deployments") parts.push(t("tasks.month.detail.deployments", { count: format.number(line.detail.count) }));
    if (line.detail?.kind === "storageGb") parts.push(t("tasks.month.detail.storageGb", { gb: format.number(line.detail.gb, { maximumFractionDigits: 2 }) }));
    if (line.id === "mailgun" && reasons.current.mailgun === "typed plan") parts.push(t("tasks.month.typedPlan"));
    return parts.join(" ");
  };

  // «Luna trecută»: the amount, or «—» with why — never a zero for a month nothing kept.
  const lastMonthText = (line: MonthCostLine) => {
    const last = line.lastMonth;
    if (last.usd === null) {
      const reason = reasons.lastMonth[line.id];
      if (line.id === "neon" && reason !== null && /^HTTP 40[34]/.test(reason)) return t("tasks.month.lastMonth.neonKey", { reason });
      if (reason === "typed plan") return t("tasks.month.lastMonth.typedPlan");
      return t("tasks.month.lastMonth.unknown", { reason: reason === null || reason === "error" ? t("tasks.month.lastMonth.here") : reason });
    }
    const amount = money(last.usd, last.plusVat);
    const count =
      last.usage === null
        ? null
        : line.id === "mailgun"
          ? t("tasks.month.lastMonth.messages", { count: format.number(last.usage) })
          : line.id === "neon"
            ? t("tasks.month.lastMonth.cuHours", { hours: quantity("cuHours", last.usage) })
            : null;
    return [amount, last.estimated && last.usd > 0 ? t("tasks.month.estimateWord") : null, count].filter(Boolean).join(" ");
  };

  // What would start costing money, each figure from its catalogue — never typed into the words.
  const triggerValues = {
    plan: EMAIL_PLANS.BASIC.name,
    price: usd(EMAIL_PLANS.BASIC.usdPerMonth),
    hours: format.number(NEON_PLANS.FREE.cuHoursPerMonth ?? 0),
    free: format.number(DEEPL_FREE_CHARACTERS_PER_MONTH),
  };
  const r2Values = { free: format.number(R2_FREE_STORAGE_GB), price: format.number(R2_USD_PER_GB_MONTH, { maximumFractionDigits: 3 }) };

  const missingNames =totals.lastMonthMissing.map((id) => t(`tasks.month.name.${id}`)).join(", ");

  return (
    <Panel
      title={t("tasks.month.title")}
      intro={t("tasks.month.intro")}
      aside={t("tasks.month.aside", { amount: usd(totals.projectedUsd) })}
      data-testid="month-costs"
    >
      {/* The answer before the rows that justify it: so far, and by the end of the month. */}
      <Typography variant="body1" sx={{ fontWeight: 600 }} data-testid="month-costs-total">
        {t("tasks.month.total", {
          soFar: money(totals.soFarUsd, totals.soFarPlusVat),
          projected: money(totals.projectedUsd, totals.projectedPlusVat),
        })}
      </Typography>
      <Typography variant="body2" sx={{ mt: 0.5 }} data-testid="month-costs-last">
        {totals.lastMonthUsd === null
          ? t("tasks.month.lastTotalUnknown", { lines: missingNames })
          : t("tasks.month.lastTotal", {
              amount: money(totals.lastMonthUsd, totals.lastMonthPlusVat),
              estimate: totals.lastMonthEstimated ? ` ${t("tasks.month.estimateWord")}` : "",
            })}
      </Typography>
      {totals.estimated && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {t("tasks.month.estimated")}
        </Typography>
      )}
      {totals.incomplete && (
        <Typography variant="body2" color="warning.main" sx={{ mt: 0.5 }} data-testid="month-costs-incomplete">
          {t("tasks.month.incomplete")}
        </Typography>
      )}

      <Stack spacing={1.5} component="ul" aria-label={t("tasks.month.listLabel")} sx={{ listStyle: "none", m: 0, mt: 2, p: 0 }}>
        {lines.map((line) => (
          <Box
            component="li"
            key={line.id}
            data-testid={`month-cost-${line.id}`}
            data-severity={line.severity}
            sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: { xs: 1.5, sm: 2 } }}
          >
            <Stack direction="row" sx={{ mb: 1, flexWrap: "wrap", gap: 1, alignItems: "center" }}>
              <Typography variant="h3" sx={{ fontSize: "1rem" }}>
                {name(line)}
              </Typography>
              <Chip
                size="small"
                color={SEVERITY_COLOR[line.severity]}
                variant={line.severity === "unknown" ? "outlined" : "filled"}
                label={t(`tasks.severity.${line.severity}`)}
              />
            </Stack>
            {/* Two columns at 320 px, four from `md`: a table would scroll sideways on a phone (§18.5). */}
            <Box sx={{ display: "grid", gridTemplateColumns: { xs: "repeat(2, minmax(0, 1fr))", md: "repeat(4, minmax(0, 1fr))" }, gap: 1.5 }}>
              <Fact label={t("tasks.month.field.plan")} wide>
                {t("tasks.month.planLine", { plan: line.plan, billing: t(`tasks.month.billing.${line.billing}`) })}
              </Fact>
              <Fact label={t("tasks.month.field.soFar")}>
                <strong>{money(line.soFarUsd, line.plusVat)}</strong>
              </Fact>
              <Fact label={t("tasks.month.field.projected")}>
                <strong>{money(line.projectedUsd, line.plusVat)}</strong>
                {line.estimated && line.projectedUsd !== null && ` ${t("tasks.month.estimateWord")}`}
              </Fact>
              <Fact label={t("tasks.month.field.lastMonth")} testId={`month-cost-${line.id}-last`}>
                {lastMonthText(line)}
              </Fact>
              <Box sx={{ gridColumn: "1 / -1" }}>
                <Fact label={t("tasks.month.field.usage")}>{usageText(line)}</Fact>
              </Box>
            </Box>
            {/* What would start costing money, on every line that is free today (the owner: free tiers only). */}
            {line.billing === "free" && (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }} data-testid={`month-cost-${line.id}-trigger`}>
                {t(`tasks.month.trigger.${line.id}`, line.id === "r2" ? r2Values : triggerValues)}
              </Typography>
            )}
            {line.id === "deepl" && !deeplConfigured && (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                {t("tasks.month.deeplOff")}
              </Typography>
            )}
            <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 1 }}>
              {t(line.id === "neon" ? "tasks.month.periodNeon" : "tasks.month.period", { span: span(line) })}
            </Typography>
          </Box>
        ))}
      </Stack>

      <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
        {t("tasks.month.others")}
      </Typography>
    </Panel>
  );
}
