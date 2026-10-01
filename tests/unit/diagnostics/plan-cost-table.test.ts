import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { annualCostToday, monthlyCostToday, type PlatformFacts, platformServices, type ServiceId } from "@/modules/diagnostics/platform-plans";
import PlanCostTable, { type PlanCostTableLabels } from "@/modules/diagnostics/ui/PlanCostTable";
import { MESSAGES_PER_COMPLETED_REGISTRATION } from "@/modules/notifications/volume";

/**
 * BR-REQ-090-05, §NNN — «Cât costă»'s breakdown, rendered to HTML on the server the way the page
 * sends it, over the real catalogues: one line per service with its month and its year, a free
 * service saying «gratuit» in both cells, an estimate marked «≈», VAT named per amount, a usage
 * plan nothing measures saying so, and the total line — a grid, never a table that scrolls.
 */
const BASE: PlatformFacts = {
  emailAllowance: 10_000,
  emailSentToday: 0,
  emailPlanName: "Basic",
  emailPlanUsdPerMonth: 15,
  messagesPerRegistration: MESSAGES_PER_COMPLETED_REGISTRATION,
  hasPaidEvent: false,
  clubDomainBound: true,
  jobsHealthy: true,
  vercelPlan: "PRO",
  vercelSeats: 1,
  neonPlan: "LAUNCH",
  databaseBytes: 1024 ** 2,
  neonCuHoursThisMonth: 1.8,
  neonHoursElapsed: 24,
};

function labels(messages: typeof ro | typeof en): PlanCostTableLabels {
  const tasks = messages.Admin.tasks;
  return {
    caption: tasks.costTable.caption,
    service: tasks.costTable.service,
    perMonth: tasks.costTable.perMonth,
    perYear: tasks.costTable.perYear,
    total: tasks.costTable.total,
    free: tasks.costToday.free,
    notTaken: tasks.costToday.notTaken,
    unmeasured: tasks.costTable.unmeasured,
    plusVat: tasks.costTable.plusVat,
    help: tasks.costTable.help,
    names: tasks.costTable.name as Record<ServiceId, string>,
  };
}

function render(locale: "ro" | "en", facts: PlatformFacts = BASE) {
  const rows = platformServices(facts);
  const html = renderToStaticMarkup(
    PlanCostTable({ locale, rows, monthly: monthlyCostToday(rows), yearly: annualCostToday(rows), labels: labels(locale === "ro" ? ro : en) }),
  );
  return { rows, html };
}

/** The words of one element found by its test id: its markup, tags stripped. */
function cell(html: string, testId: string): string {
  const match = new RegExp(`data-testid="${testId}"[^>]*>([\\s\\S]*?)</div>`).exec(html);
  if (!match) throw new Error(`no ${testId}`);
  return match[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

describe("§NNN «Cât costă» per service, per month and per year", () => {
  it("draws one line per service, in the cost table's order, under the three column headers", () => {
    const { rows, html } = render("ro");
    expect(html).toContain('role="table"');
    expect(html).toContain('aria-label="Costul fiecărui serviciu, pe lună și pe an"');
    expect(html.match(/role="columnheader"/g)).toHaveLength(3);
    for (const header of ["Serviciu", "Pe lună", "Pe an"]) expect(html).toContain(header);
    const order = rows.map((row) => html.indexOf(`data-testid="plan-cost-${row.id}"`));
    expect(order.every((index) => index > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // The service's short name, with its plan beside it.
    expect(html).toContain("Vercel");
    expect(html).toContain(" · Pro");
    // A CSS grid of three columns, never a `<table>` that scrolls sideways on a phone.
    expect(html).not.toContain("<table");
    expect(html).toContain("grid-template-columns:minmax(0, 1fr) auto auto");
  });

  it("says each amount in both periods, VAT named per amount and the estimate marked", () => {
    const { html } = render("ro");
    // The domain: billed yearly — its twelfth a month.
    expect(cell(html, "plan-cost-domain-month")).toBe("0,91 USD + TVA");
    expect(cell(html, "plan-cost-domain-year")).toBe("10,97 USD + TVA");
    // Mailgun Basic and Vercel Pro: billed monthly — twelve of them a year.
    expect(cell(html, "plan-cost-mailgun-month")).toBe("15,00 USD + TVA");
    expect(cell(html, "plan-cost-mailgun-year")).toBe("180,00 USD + TVA");
    expect(cell(html, "plan-cost-vercel-month")).toBe("20,00 USD + TVA");
    expect(cell(html, "plan-cost-vercel-year")).toBe("240,00 USD + TVA");
    // Neon Launch: an estimate at this month's pace, with no VAT of ours on top.
    expect(cell(html, "plan-cost-neon-month")).toBe("≈ 5,72 USD");
    expect(cell(html, "plan-cost-neon-year")).toBe("≈ 68,64 USD");
  });

  it("says «gratuit» in both cells of a free service, quietly", () => {
    const { html } = render("ro");
    for (const id of ["zitadel", "scheduler"]) {
      expect(cell(html, `plan-cost-${id}-month`)).toBe("gratuit");
      expect(cell(html, `plan-cost-${id}-year`)).toBe("gratuit");
    }
  });

  it("ends with the bold total, estimated when an estimate is in it", () => {
    const { html } = render("ro");
    expect(html).toContain('data-testid="plan-cost-total"');
    expect(cell(html, "plan-cost-total-month")).toBe("≈ 41,63 USD + TVA");
    expect(cell(html, "plan-cost-total-year")).toBe("≈ 499,61 USD + TVA");
    expect(html.indexOf('data-testid="plan-cost-scheduler"')).toBeLessThan(html.indexOf('data-testid="plan-cost-total"'));
  });

  it("says «ritm nemăsurat» for a usage plan nothing measures, and the total is then an estimate", () => {
    const { html } = render("ro", { ...BASE, neonCuHoursThisMonth: null });
    expect(cell(html, "plan-cost-neon-month")).toBe("ritm nemăsurat");
    expect(cell(html, "plan-cost-neon-year")).toBe("ritm nemăsurat");
    expect(cell(html, "plan-cost-total-month")).toBe("≈ 35,91 USD + TVA");
  });

  it("on the free plans totals the domain alone, with no estimate", () => {
    const { html } = render("ro", { ...BASE, emailPlanName: "Free", emailPlanUsdPerMonth: 0, emailAllowance: 100, vercelPlan: "HOBBY", neonPlan: "FREE" });
    expect(cell(html, "plan-cost-vercel-month")).toBe("gratuit");
    expect(cell(html, "plan-cost-total-month")).toBe("0,91 USD + TVA");
    expect(cell(html, "plan-cost-total-year")).toBe("10,97 USD + TVA");
  });

  it("reads the same in English, with its «?» saying what the columns are", () => {
    const { html } = render("en");
    for (const header of ["Service", "Per month", "Per year", "Total"]) expect(html).toContain(header);
    expect(cell(html, "plan-cost-vercel-year")).toBe("240.00 USD + VAT");
    expect(cell(html, "plan-cost-zitadel-year")).toBe("free");
    expect(cell(html, "plan-cost-scheduler-month")).toBe("free");
    expect(html).toContain('data-testid="quiet-help"');
    expect(html).toContain("twelve times the monthly price");
  });
});
