import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { monthCosts, monthTotals, utcMonth, type MonthCostFacts } from "@/modules/diagnostics/domain/month-costs";
import { DOMAIN_PRICE_USD_PER_YEAR } from "@/modules/diagnostics/platform-plans";
import { VERCEL_HOBBY_BUILD_MINUTES_PER_MONTH } from "@/modules/diagnostics/vercel";

/**
 * BR-REQ-090-07 criterion 19 (§NNN) — «Luna aceasta», rendered to HTML on the server the way the
 * page sends it, through next-intl's own translator over the real catalogues, in both languages:
 * the total first, one line per provider with its money and its usage, a line nothing could read
 * saying why instead of printing a zero, and the free providers named in one sentence.
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

function facts(patch: Partial<MonthCostFacts> = {}): MonthCostFacts {
  return {
    now: NOW,
    neon: { plan: "LAUNCH", meter: { usedCuHours: 10, periodStart: OCTOBER.start, periodEnd: OCTOBER.end, quotaCuHours: 30 }, databaseBytes: 1024 * 1024 * 1024 },
    mailgun: { planName: "Free", usdPerMonth: 0, sentThisMonth: 100, monthlyAllowance: null, dailyAllowance: 100 },
    vercel: null,
    vercelBuildMinutesPerMonth: VERCEL_HOBBY_BUILD_MINUTES_PER_MONTH,
    domain: { planName: ".com", usdPerYear: DOMAIN_PRICE_USD_PER_YEAR, expiresOn: "2026-10-20" },
    deepl: { charactersThisMonth: 1_234 },
    ...patch,
  };
}

async function render(locale: "ro" | "en", input: MonthCostFacts, unread = { neon: null as string | null, vercel: "unconfigured" as string | null }) {
  state.locale = locale;
  const lines = monthCosts(input);
  const element = await MonthCostsPanel({ locale, lines, totals: monthTotals(lines), unread, deeplConfigured: false });
  return renderToStaticMarkup(element as ReactElement);
}

/** The visible words, without the markup and the spacing MUI puts between them. */
function text(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
}

describe("BR-REQ-090-07 «Luna aceasta» on Costuri", () => {
  it("says the month so far and by its end first, then one line per provider — in Romanian", async () => {
    const html = await render("ro", facts());
    const words = text(html);
    // Neon 1,18 so far, 3,65 at the end; the domain's renewal falls in October: 10,97 + TVA.
    expect(words).toContain("Până acum, luna aceasta: 1,18 USD. Estimat până la sfârșitul lunii: 14,62 USD + TVA.");
    expect(words).toContain("Baza de date se plătește la consum");
    for (const id of ["domain", "mailgun", "vercel", "neon", "deepl"]) expect(html).toContain(`data-testid="month-cost-${id}"`);
    // Neon: the quota the club set is the ceiling, and ~31 hours by the end goes past it.
    expect(words).toContain("10 ore-CU până acum, ~31 la final.");
    expect(words).toContain("Limita pusă de club la Neon: 30.");
    expect(words).toContain("Neon oprește baza de date până la perioada următoare");
    expect(html).toMatch(/data-testid="month-cost-neon" data-severity="act"/);
    expect(words).toContain("Launch · la consum");
    expect(words).toContain("(estimare)");
    // Mailgun Free: the daily hundred, named per day.
    expect(words).toContain("Planul Free: cel mult 100 pe zi, numărate pe zi.");
    // Vercel without a token: why, never a zero usage.
    expect(words).toContain("Nu se măsoară fără VERCEL_API_TOKEN și VERCEL_PROJECT_ID pe acest mediu.");
    // The domain's renewal, in the month that has it.
    // No «pe» before a date the helper wrote (§452).
    expect(words).toMatch(/Expiră luna aceasta, marți, 20 oct\. 2026: reînnoirea intră în suma lunii\./);
    expect(words).toContain("DeepL nu e pusă pe acest server");
    expect(words).toContain("Perioada de facturare Neon:");
    expect(words).toContain("Zitadel");
  });

  it("reads the same in English, with the same figures", async () => {
    const words = text(await render("en", facts()));
    expect(words).toContain("So far this month: 1.18 USD. Estimated by the end of the month: 14.62 USD + VAT.");
    expect(words).toContain("10 CU-hours so far, ~31 by the end.");
    expect(words).toContain("The limit the club set at Neon: 30.");
    // The apostrophe is an entity in the markup; the words around it are what the reader sees.
    expect(words).toContain("billing period:");
  });

  it("says when a provider that bills could not be read, and that the total is short by it", async () => {
    const html = await render("ro", facts({ neon: { plan: "LAUNCH", meter: null, databaseBytes: null } }), { neon: "HTTP 401", vercel: "unconfigured" });
    const words = text(html);
    expect(html).toContain('data-testid="month-costs-incomplete"');
    expect(words).toContain("Furnizorul nu a răspuns acum (HTTP 401).");
    expect(words).toContain("nemăsurat");
    expect(html).toMatch(/data-testid="month-cost-neon" data-severity="unknown"/);
  });

  it("is a card of words only: no form, nothing to press", async () => {
    const html = await render("ro", facts());
    expect(html).not.toContain("<form");
    expect(html).not.toContain("<button");
  });
});
