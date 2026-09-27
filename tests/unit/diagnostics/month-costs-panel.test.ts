import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { type MonthCostFacts, monthCosts, monthTotals, utcMonth } from "@/modules/diagnostics/domain/month-costs";
import type { MonthCostReasons } from "@/modules/diagnostics/month-costs-read";
import { DOMAIN_PRICE_USD_PER_YEAR } from "@/modules/diagnostics/platform-plans";
import { VERCEL_HOBBY_BUILD_MINUTES_PER_MONTH } from "@/modules/diagnostics/vercel";

/**
 * BR-REQ-090-07 criterion 19 (§479) — «Luna aceasta», rendered to HTML on the server the way the
 * page sends it, through next-intl's own translator over the real catalogues, in both languages:
 * the total first, last month's beside it, one line per provider with its money, its last month
 * and its usage, a line nothing could read saying why instead of printing a zero, every free line
 * saying what would cost money, and the free providers named in one sentence.
 */
const state = { locale: "ro" as "ro" | "en" };
vi.mock("next-intl/server", async () => {
  const { createFormatter, createTranslator } = await import("next-intl");
  const catalogues = {
    ro: (await import("../../../messages/ro.json")).default,
    en: (await import("../../../messages/en.json")).default,
  };
  return {
    getTranslations: async (namespace: string) =>
      createTranslator({ locale: state.locale, messages: catalogues[state.locale], namespace: namespace as "Admin" }),
    getFormatter: async () => createFormatter({ locale: state.locale }),
    getLocale: async () => state.locale,
  };
});

const { default: MonthCostsPanel } = await import("@/modules/diagnostics/ui/MonthCostsPanel");

const NOW = new Date("2026-10-11T00:00:00.000Z");
const OCTOBER = utcMonth(NOW);
const GB = 1024 * 1024 * 1024;

function facts(patch: Partial<MonthCostFacts> = {}): MonthCostFacts {
  return {
    now: NOW,
    neon: { plan: "LAUNCH", meter: { usedCuHours: 10, periodStart: OCTOBER.start, periodEnd: OCTOBER.end, quotaCuHours: 30 }, databaseBytes: GB },
    mailgun: { planName: "Free", usdPerMonth: 0, sentThisMonth: 100, monthlyAllowance: null, dailyAllowance: 100 },
    vercel: null,
    vercelBuildMinutesPerMonth: VERCEL_HOBBY_BUILD_MINUTES_PER_MONTH,
    domain: { planName: ".com", usdPerYear: DOMAIN_PRICE_USD_PER_YEAR, expiresOn: "2026-10-20" },
    deepl: { charactersThisMonth: 1_234 },
    r2: { storedBytes: 2 * GB },
    lastMonth: { neonCuHours: 20, mailgunSent: 500 },
    ...patch,
  };
}

function reasons(patch: { current?: Partial<MonthCostReasons["current"]>; lastMonth?: Partial<MonthCostReasons["lastMonth"]> } = {}): MonthCostReasons {
  const none = { neon: null, mailgun: null, vercel: null, domain: null, deepl: null, r2: null };
  return { current: { ...none, vercel: "unconfigured", ...patch.current }, lastMonth: { ...none, ...patch.lastMonth } };
}

async function render(locale: "ro" | "en", input: MonthCostFacts, why: MonthCostReasons = reasons()) {
  state.locale = locale;
  const lines = monthCosts(input);
  const element = await MonthCostsPanel({ locale, lines, totals: monthTotals(lines), reasons: why, deeplConfigured: false });
  return renderToStaticMarkup(element as ReactElement);
}

/** The visible words, without the markup and the spacing MUI puts between them. */
function text(html: string): string {
  return html.replace(/<style[^>]*>[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");
}

describe("BR-REQ-090-07 «Luna aceasta» on Costuri", () => {
  it("says the month so far and by its end first, then one line per provider — in Romanian", async () => {
    const html = await render("ro", facts());
    const words = text(html);
    // Neon 1,18 so far, 3,65 at the end; the domain's renewal falls in October: 10,97 + TVA.
    // The total is first (§NNN): one large figure, the month's end, above every provider's line.
    expect(words).toContain("Totalul lunii ~14,62 USD + TVA estimat la sfârșitul lunii");
    expect(words).toContain("Până acum: 1,18 USD.");
    expect(html.indexOf('data-testid="costs-total"')).toBeGreaterThan(-1);
    expect(html.indexOf('data-testid="costs-total"')).toBeLessThan(html.indexOf('data-testid="month-costs"'));
    expect(html.indexOf('data-testid="month-costs-total"')).toBeLessThan(html.indexOf('data-testid="month-cost-domain"'));
    // One sentence on the page; why it is an estimate behind its «?».
    expect(words).toContain("Suma bazei de date e o estimare, nu o factură.");
    expect(html).toContain("Neon se plătește la consum");
    for (const id of ["domain", "mailgun", "vercel", "neon", "deepl", "r2"]) expect(html).toContain(`data-testid="month-cost-${id}"`);
    // Neon: the quota the club set is the ceiling, and ~31 hours by the end goes past it.
    expect(words).toContain("10 ore-CU până acum, ~31 la final.");
    expect(words).toContain("30, pusă de club la Neon");
    expect(words).toContain("Neon oprește baza de date până la perioada următoare");
    expect(words).toContain("Spațiul bazei 1 GB");
    expect(html).toMatch(/data-testid="month-cost-neon" data-severity="act"/);
    expect(words).toContain("Launch · la consum");
    expect(words).toContain("(estimare)");
    // Mailgun Free: the daily hundred, named per day.
    expect(words).toContain("100 pe zi, pe planul Free");
    // Vercel without a token: why, never a zero usage.
    expect(words).toContain("Nu se măsoară fără VERCEL_API_TOKEN și VERCEL_PROJECT_ID pe acest mediu.");
    // The domain's renewal, in the month that has it.
    // No «pe» before a date the helper wrote (§452).
    expect(words).toMatch(/Expiră luna aceasta, marți, 20 oct\. 2026: reînnoirea intră în suma lunii\./);
    expect(words).toContain("DeepL nu e pusă pe acest server");
    expect(words).toContain("Perioada de facturare Neon:");
    expect(words).toContain("Zitadel");
    // R2 is its own line now, measured against its free ten GB.
    expect(words).toContain("2 GB de poze stocate");
    expect(words).toContain("10 GB gratuit");
    // The lower bound's reason is behind the usage's «?».
    expect(html).toContain("Se numără o singură variantă a fiecărei poze");
  });

  it("says last month beside it: the total, and each line's amount with what was counted", async () => {
    const words = text(await render("ro", facts()));
    // Neon: 20 × 0,106 + 0,35 (a GB for the month) = 2,47, an estimate; the rest free.
    expect(words).toContain("Luna trecută: 2,47 USD (estimare).");
    expect(words).toContain("2,47 USD (estimare) · 20 ore-CU");
    expect(words).toContain("0,00 USD · 500 e-mailuri");
  });

  it("prints a dash for last month when a line that bills kept nothing, naming the line and why", async () => {
    const html = await render("ro", facts({ lastMonth: { neonCuHours: null, mailgunSent: 500 } }), reasons({ lastMonth: { neon: "HTTP 403" } }));
    const words = text(html);
    expect(words).toContain("Luna trecută: — (Baza de date — Neon fără cifră).");
    expect(words).toContain("— Neon păstrează istoricul doar pentru o cheie de organizație; cheia pe proiect e refuzată (HTTP 403).");
  });

  it("says, on every free line, what would start costing money — each figure from its catalogue", async () => {
    const html = await render("ro", facts({ vercel: { buildMinutes: 30, deployments: 7 } }), reasons({ current: { vercel: null } }));
    const words = text(html);
    for (const id of ["mailgun", "vercel", "deepl", "r2"]) expect(html).toContain(`data-testid="month-cost-${id}-trigger"`);
    // Launch bills, so the Neon line names no trigger; the domain is yearly.
    expect(html).not.toContain('data-testid="month-cost-neon-trigger"');
    expect(html).not.toContain('data-testid="month-cost-domain-trigger"');
    expect(words).toContain("Ar costa doar pe un plan plătit (Basic, 15,00 USD pe lună)");
    expect(words).toContain("după 500.000 de caractere");
    expect(words).toContain("Ar costa doar peste 10 GB stocați: 0,015 USD pe GB pe lună");
    // Vercel's deployments beside its build minutes.
    expect(words).toContain("Publicări 7 luna aceasta");
  });

  it("reads the same in English, with the same figures", async () => {
    const words = text(await render("en", facts()));
    expect(words).toContain("This month's total ~14.62 USD + VAT estimated by the end of the month");
    expect(words).toContain("So far: 1.18 USD.");
    expect(words).toContain("Last month: 2.47 USD (estimate).");
    expect(words).toContain("10 CU-hours so far, ~31 by the end.");
    expect(words).toContain("30, set by the club at Neon");
    expect(words).toContain("billing period:");
  });

  it("says when a provider that bills could not be read, and that the total is short by it", async () => {
    const html = await render("ro", facts({ neon: { plan: "LAUNCH", meter: null, databaseBytes: null } }), reasons({ current: { neon: "HTTP 401" } }));
    const words = text(html);
    expect(html).toContain('data-testid="month-costs-incomplete"');
    expect(words).toContain("Furnizorul nu a răspuns acum (HTTP 401).");
    expect(words).toContain("nemăsurat");
    expect(html).toMatch(/data-testid="month-cost-neon" data-severity="unknown"/);
  });

  it("says a typed Mailgun plan's month is unknown for that reason, not because nothing answered", async () => {
    const custom = facts({ mailgun: { planName: "Custom", usdPerMonth: null, sentThisMonth: 10, monthlyAllowance: null, dailyAllowance: null } });
    const html = await render("ro", custom, reasons({ current: { mailgun: "typed plan" }, lastMonth: { mailgun: "typed plan" } }));
    const words = text(html);
    expect(words).toContain("Totalul e mai mic decât cel real: suma unui furnizor nu e cunoscută.");
    expect(html).toContain("planul Mailgun e scris de mână, fără preț");
    expect(words).toContain("Planul e scris de mână, fără preț înregistrat");
    expect(words).toContain("— planul scris de mână nu are preț înregistrat.");
  });

  it("says a query that failed here as the site's own database, not the provider", async () => {
    const words = text(await render("ro", facts({ deepl: null, r2: null }), reasons({ current: { deepl: "error", r2: "error" }, lastMonth: { r2: "error" } })));
    expect(words).toContain("Nu s-a putut citi acum din baza de date a site-ului.");
    expect(words).toContain("— nu s-a putut citi (baza de date a site-ului).");
  });

  it("is a card of words only: no form, and nothing to press but its «?»", async () => {
    const html = await render("ro", facts());
    expect(html).not.toContain("<form");
    const buttons = html.match(/<button/g) ?? [];
    expect(buttons.length).toBeGreaterThan(0);
    expect(buttons).toHaveLength((html.match(/data-testid="quiet-help"/g) ?? []).length);
  });
});
