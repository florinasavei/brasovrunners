import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { type MonthCostFacts, monthCosts, monthTotals, utcMonth } from "@/modules/diagnostics/domain/month-costs";
import type { MonthCostReasons } from "@/modules/diagnostics/month-costs-read";
import { DOMAIN_PRICE_USD_PER_YEAR } from "@/modules/diagnostics/platform-plans";
import { translationCredit } from "@/modules/translate/domain/credit";
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
    vercelPlan: { plan: "HOBBY", seats: 1, usdPerSeatPerMonth: 0 },
    domain: { planName: ".com", usdPerYear: DOMAIN_PRICE_USD_PER_YEAR, expiresOn: "2026-10-20" },
    deepl: { charactersThisMonth: 1_234 },
    deeplCredit: { expected: false, credit: null },
    r2: { storedBytes: 2 * GB },
    lastMonth: { neonCuHours: 20, mailgunSent: 500 },
    ...patch,
  };
}

function reasons(
  patch: { current?: Partial<MonthCostReasons["current"]>; lastMonth?: Partial<MonthCostReasons["lastMonth"]>; deeplCredit?: string | null } = {},
): MonthCostReasons {
  const none = { neon: null, mailgun: null, vercel: null, domain: null, deepl: null, r2: null };
  return { current: { ...none, vercel: "unconfigured", ...patch.current }, lastMonth: { ...none, ...patch.lastMonth }, deeplCredit: patch.deeplCredit ?? "unconfigured" };
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
    // Neon 1,18 USD so far, 3,65 at the end; the domain's renewal falls in October: 10,97 + TVA —
    // 14,62 USD in all. The total is first (§511): ONE line in the owner's words, in euro at the
    // dated ECB rate (1 € = 1,1403 USD): 1,18 → 1,03 €, 14,62 → 12,82 €.
    expect(words).toContain("Luna aceasta: 1,03 € până acum · estimare la sfârșitul lunii: 12,82 € + TVA");
    expect(html).toMatch(/<h2[^>]*id="costs-total-title"[^>]*>Luna aceasta: 1,03 €/);
    expect(html).toContain("1 € = 1,1403 USD");
    // The domain's year beside it, and the one line that is true here: Neon is the only monthly cost.
    expect(words).toContain("Domeniul .com: 9,62 € + TVA pe an.");
    expect(words).toContain("Neon este singurul cost lunar; restul sunt pe planurile gratuite.");
    // The provider rows fold under the total, closed (§336).
    expect(html).toMatch(/<details[^>]*data-testid="month-costs"/);
    expect(html).not.toMatch(/<details[^>]*data-testid="month-costs"[^>]*open/);
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

  it("says Neon is the only monthly cost only when it is true", async () => {
    const paidMail = facts({ mailgun: { planName: "Basic", usdPerMonth: 15, sentThisMonth: 100, monthlyAllowance: 10_000, dailyAllowance: null } });
    const words = text(await render("ro", paidMail));
    expect(words).not.toContain("Neon este singurul cost lunar");
    const neonFree = text(await render("ro", facts({ neon: { plan: "FREE", meter: { usedCuHours: 10, periodStart: OCTOBER.start, periodEnd: OCTOBER.end, quotaCuHours: null }, databaseBytes: GB } })));
    expect(neonFree).not.toContain("Neon este singurul cost lunar");
  });

  it("says last month beside it: the total, and each line's amount with what was counted", async () => {
    const words = text(await render("ro", facts()));
    // Neon: 20 × 0,106 + 0,35 (a GB for the month) = 2,47 USD, an estimate; the rest free.
    // The total's last month in euro (2,17 €), each line's in the vendor's USD.
    expect(words).toContain("Luna trecută: 2,17 € (estimare).");
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
    expect(words).toContain("creditul DeepL al cheii se dă o singură dată și nu se reînnoiește lunar");
    expect(words).not.toContain("500.000");
    // DeepL's limit is the key's credit, never «fără plafon».
    expect(html).not.toContain('data-testid="month-cost-deepl-ceiling"');
    expect(words).toContain("Ar costa doar peste 10 GB stocați: 0,015 USD pe GB pe lună");
    // Vercel's deployments beside its build minutes.
    expect(words).toContain("Publicări 7 luna aceasta");
  });

  it("§610 prints Vercel Pro's line as a monthly subscription: its price so far and at the end, + TVA, and no «what would cost money»", async () => {
    const html = await render("ro", facts({ vercelPlan: { plan: "PRO", seats: 1, usdPerSeatPerMonth: 20 }, vercel: { buildMinutes: 30, deployments: 7 } }), reasons({ current: { vercel: null } }));
    const words = text(html);
    expect(words).toContain("Pro · abonament lunar");
    expect(words).toContain("20,00 USD + TVA");
    expect(html).not.toContain('data-testid="month-cost-vercel-trigger"');
    // Neon is no longer the only monthly cost.
    expect(words).not.toContain("Neon este singurul cost lunar");
  });

  it("reads the same in English, with the same figures", async () => {
    const words = text(await render("en", facts()));
    expect(words).toContain("This month: 1.03 € so far · month-end estimate: 12.82 € + VAT");
    expect(words).toContain("The .com domain: 9.62 € + VAT a year.");
    expect(words).toContain("Neon is the only monthly cost; everything else is on a free plan.");
    expect(words).toContain("Last month: 2.17 € (estimate).");
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

  it("§497: says the DeepL credit as DeepL counts it — used, left, given once — and its level, in both languages", async () => {
    const withCredit = (used: number) => facts({ deeplCredit: { expected: true, credit: translationCredit({ used, limit: 1_000_000 }) } });
    const ro = text(await render("ro", withCredit(250_000), reasons({ deeplCredit: null })));
    expect(ro).toContain("Creditul DeepL: 250.000 din 1.000.000 caractere folosite (25 %), rămân 750.000 — citit de la DeepL, se dă o singură dată.");
    expect(ro).not.toContain("Peste 80 %");
    const spent = await render("ro", withCredit(1_000_000), reasons({ deeplCredit: null }));
    expect(text(spent)).toContain("Creditul s-a terminat: butoanele de traducere refuză orice traducere");
    expect(spent).toMatch(/data-testid="month-cost-deepl" data-severity="act"/);
    expect(text(await render("ro", withCredit(850_000), reasons({ deeplCredit: null })))).toContain("Peste 80 % din credit e folosit.");
    const en = text(await render("en", withCredit(960_000), reasons({ deeplCredit: null })));
    expect(en).toContain("The DeepL credit: 960,000 of 1,000,000 characters used (96%), 40,000 left");
    expect(en).toContain("The credit is nearly spent");
  });

  it("§497: says why the credit could not be read, and nothing about it without a key", async () => {
    const unread = facts({ deeplCredit: { expected: true, credit: null } });
    expect(text(await render("ro", unread, reasons({ deeplCredit: "refused" })))).toContain("Creditul DeepL nu s-a putut citi: DeepL refuză cheia.");
    expect(text(await render("en", unread, reasons({ deeplCredit: "unavailable" })))).toContain("The DeepL credit could not be read just now");
    expect(text(await render("ro", facts()))).not.toContain("Creditul DeepL");
  });

  it("is a card of words only: no form, and nothing to press but its «?»", async () => {
    const html = await render("ro", facts());
    expect(html).not.toContain("<form");
    const buttons = html.match(/<button/g) ?? [];
    expect(buttons.length).toBeGreaterThan(0);
    expect(buttons).toHaveLength((html.match(/data-testid="quiet-help"/g) ?? []).length);
  });
});
