import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import type { Locale } from "@/i18n/routing";
import { type CostTotal, perMonth, perYear, type PlanCost, type ServiceId, type ServiceRow } from "@/modules/diagnostics/platform-plans";
import QuietHelp from "@/shared/ui/QuietHelp";

/** The words the table prints, translated by the page: strings only, so nothing but text crosses into it. */
export type PlanCostTableLabels = {
  /** The table's accessible name. */
  caption: string;
  service: string;
  perMonth: string;
  perYear: string;
  total: string;
  free: string;
  notTaken: string;
  /** A usage plan whose pace nothing measures: «ritm nemăsurat». */
  unmeasured: string;
  /** «+ TVA» / "+ VAT", said per amount. */
  plusVat: string;
  /** The header's «?»: what the two columns are. */
  help: string;
  /** Each service's short name. */
  names: Record<ServiceId, string>;
};

type Props = {
  locale: Locale;
  /** The cost table's rows (`platformServices`), in their order. */
  rows: readonly ServiceRow[];
  /** `monthlyCostToday` and `annualCostToday` over the same rows. */
  monthly: readonly CostTotal[];
  yearly: readonly CostTotal[];
  labels: PlanCostTableLabels;
};

/** One cell's words, and whether they are the quiet kind (free, nothing, unmeasured). */
type Cell = { text: string; quiet: boolean };

/**
 * «Cât costă»'s breakdown (§610; the owner: «la costuri vreau să văd defalcat pe lună și per
 * serviciu»): one line per service in the cost table's order — «Serviciu» · «Pe lună» · «Pe an» —
 * then the «Total». Each amount is the vendor's own figure or the one derived from it
 * (`perMonth`, `perYear`), in the vendor's currency; an estimate is marked «≈», VAT is named per
 * amount, a free service says «gratuit» in both cells and a usage plan nothing measures says so
 * rather than a zero.
 *
 * A CSS grid of three columns — the name takes what is left, the amounts their own width, right
 * aligned in tabular figures — never a `<table>` that scrolls sideways on a 320-pixel phone: the
 * amounts are short and wrap before the VAT word if they must. A Server Component with no client
 * code but the «?», which takes a string.
 */
export default function PlanCostTable({ locale, rows, monthly, yearly, labels }: Props) {
  const number = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const amount = (value: number, currency: string, estimated: boolean, plusVat: boolean) =>
    `${estimated ? "≈ " : ""}${number.format(value)} ${currency}${plusVat ? ` ${labels.plusVat}` : ""}`;

  const cell = (cost: PlanCost, period: (cost: PlanCost) => number | null): Cell => {
    if (cost.kind === "free") return { text: labels.free, quiet: true };
    if (cost.kind === "notTaken") return { text: labels.notTaken, quiet: true };
    const value = period(cost);
    if (value === null) return { text: labels.unmeasured, quiet: true };
    return cost.kind === "usage"
      ? { text: amount(value, cost.currency, true, false), quiet: false }
      : { text: amount(value, cost.currency, false, cost.plusVat), quiet: false };
  };
  const total = (totals: readonly CostTotal[]): Cell =>
    totals.length === 0
      ? { text: labels.free, quiet: true }
      : { text: totals.map((t) => amount(t.amount, t.currency, t.estimated, t.plusVat)).join(", "), quiet: false };

  const figure = { textAlign: "right", fontVariantNumeric: "tabular-nums" } as const;
  // The total line opens with a rule across all three cells.
  const ruled = { borderTop: 1, borderColor: "divider", pt: 0.75 } as const;
  const amountCell = (value: Cell, testId: string, last = false) => (
    <Typography
      variant="body2"
      component="div"
      role="cell"
      data-testid={testId}
      color={value.quiet ? "text.secondary" : undefined}
      sx={{ ...figure, ...(last ? { ...ruled, fontWeight: 700 } : {}) }}
    >
      {value.text}
    </Typography>
  );
  const header = (text: string, align: "left" | "right", help?: string) => (
    <Typography variant="caption" color="text.secondary" component="div" role="columnheader" sx={{ textAlign: align }}>
      {text}
      {help && <QuietHelp text={help} size={14} />}
    </Typography>
  );

  return (
    <Box
      role="table"
      aria-label={labels.caption}
      data-testid="plan-cost-table"
      sx={{
        display: "grid",
        gridTemplateColumns: "minmax(min-content, 1fr) auto auto",
        columnGap: 2,
        rowGap: 0.75,
        alignItems: "baseline",
        border: 1,
        borderColor: "divider",
        borderRadius: 1,
        px: { xs: 1.5, sm: 2 },
        py: 1.5,
        mb: 2,
      }}
    >
      <Box role="row" sx={{ display: "contents" }}>
        {header(labels.service, "left", labels.help)}
        {header(labels.perMonth, "right")}
        {header(labels.perYear, "right")}
      </Box>
      {rows.map((row) => (
        <Box role="row" key={row.id} data-testid={`plan-cost-${row.id}`} sx={{ display: "contents" }}>
          <Typography variant="body2" component="div" role="rowheader" >
            {labels.names[row.id]}
            {row.planToday && (
              <Typography component="span" variant="caption" color="text.secondary">
                {` · ${row.planToday}`}
              </Typography>
            )}
          </Typography>
          {amountCell(cell(row.costToday, perMonth), `plan-cost-${row.id}-month`)}
          {amountCell(cell(row.costToday, perYear), `plan-cost-${row.id}-year`)}
        </Box>
      ))}
      <Box role="row" data-testid="plan-cost-total" sx={{ display: "contents" }}>
        <Typography
          variant="body2"
          component="div"
          role="rowheader"
          sx={{ ...ruled, fontWeight: 700 }}
        >
          {labels.total}
        </Typography>
        {amountCell(total(monthly), "plan-cost-total-month", true)}
        {amountCell(total(yearly), "plan-cost-total-year", true)}
      </Box>
    </Box>
  );
}
