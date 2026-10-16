import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { DatabaseSizes } from "@/modules/diagnostics/domain/db-sizes";
import type { VercelUsage } from "@/modules/diagnostics/vercel-usage";

/**
 * §NNN — the two cards on `/devs`, rendered to HTML on the server through next-intl's own
 * translator over the real catalogues, in both languages: «Baza de date» with the size, the tables,
 * the growth and the registrations by age, and its sentence when the database could not be asked;
 * «Vercel: consumul lunii» with the lines, the builds by project and the CPU against Hobby's
 * allowance, and the one sentence that says Vercel would not tell, with a link to its Usage page.
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
      createTranslator({ locale: state.locale, messages: catalogues[state.locale], namespace: namespace as "Devs" }),
    getFormatter: async () => createFormatter({ locale: state.locale }),
    getLocale: async () => state.locale,
  };
});
vi.mock("@/i18n/navigation", async () => {
  const { createElement } = await import("react");
  return {
    Link: ({ children, href, ...rest }: { children?: unknown; href: unknown } & Record<string, unknown>) =>
      createElement("a", { href: JSON.stringify(href), ...rest }, children as never),
  };
});

const { default: DatabaseSizesPanel } = await import("@/modules/diagnostics/ui/DatabaseSizesPanel");
const { default: VercelBuildsLine } = await import("@/modules/diagnostics/ui/VercelBuildsLine");
const { default: VercelUsagePanel } = await import("@/modules/diagnostics/ui/VercelUsagePanel");

const MB = 1024 * 1024;

const SIZES: DatabaseSizes = {
  databaseBytes: 12.3 * MB,
  tables: [
    { name: "audit_logs", totalBytes: 3 * MB, tableBytes: 1 * MB, indexBytes: 2 * MB, estimatedRows: 40_000, rows: null },
    { name: "email_outbox", totalBytes: 1 * MB, tableBytes: 0.5 * MB, indexBytes: 0.5 * MB, estimatedRows: 100, rows: 98 },
    { name: "events", totalBytes: 0.1 * MB, tableBytes: 0.05 * MB, indexBytes: 0.05 * MB, estimatedRows: null, rows: null },
  ],
  growth: [
    { table: "audit_logs", total: 40_000, last30Days: 1_234, settled: null },
    { table: "email_action_tokens", total: 500, last30Days: 60, settled: 450 },
  ],
  registrations: [
    { status: "CANCELLED", total: 5, pastSixMonths: 2, pastTwelveMonths: 1 },
    { status: "CONFIRMED", total: 100, pastSixMonths: 40, pastTwelveMonths: 10 },
  ],
  measuredAt: new Date("2026-10-16T12:00:00.000Z"),
};

const USAGE: VercelUsage = {
  lines: [
    { service: "Build CPU Minutes", unit: "minute", quantity: 3156, usd: 10.99 },
    { service: "Fluid Active CPU", unit: "hour", quantity: 3.66, usd: 0.62 },
  ],
  usageUsd: 11.61,
  subscriptionUsd: 10.67,
  buildsByProject: [
    { project: "site-production", minutes: 1584, usd: 5.52 },
    { project: "site-qa", minutes: 1572, usd: 5.47 },
  ],
  activeCpuHours: 3.66,
  activeCpuUnit: null,
  periodStart: new Date("2026-10-01T00:00:00.000Z"),
  periodEnd: new Date("2026-10-17T00:00:00.000Z"),
};

async function html(node: Promise<ReactElement>): Promise<string> {
  return renderToStaticMarkup(await node).replace(/&#x27;/g, "'");
}

describe("§NNN «Baza de date» on /devs", () => {
  it("draws the size, the tables with their split and rows, the growth and the registrations by age, in Română", async () => {
    state.locale = "ro";
    const out = await html(DatabaseSizesPanel({ sizes: SIZES }));

    expect(out).toContain('data-testid="db-size"');
    expect(out).toContain('id="db-size"');
    expect(out).toContain("Baza de date: mărime și creștere");
    expect(out).toMatch(/Toată baza de date: 12,3 MB/);
    expect(out).toContain("audit_logs");
    expect(out).toMatch(/3,0 MB, din care 1,0 MB date și 2,0 MB indecși/);
    // An estimate says so; an exact count does not; a table nobody could count says so.
    expect(out).toMatch(/Rânduri: circa 40\.000/);
    expect(out).toMatch(/Rânduri: 98/);
    expect(out).toContain("Rânduri: necunoscut");
    expect(out).toMatch(/1\.234 noi în ultimele 30 de zile/);
    expect(out).toContain("Linkurile din emailuri");
    expect(out).toMatch(/Nefolosibile: 450/);
    expect(out).toMatch(/100 în total · 40 la evenimente de peste 6 luni · 10 la evenimente de peste 12 luni/);
    // The states come in the order a registration goes through them, in the club's words.
    expect(out.indexOf("Confirmate")).toBeLessThan(out.indexOf("Anulate"));
  });

  it("says the same in English", async () => {
    state.locale = "en";
    const out = await html(DatabaseSizesPanel({ sizes: SIZES }));

    expect(out).toContain("The database: size and growth");
    expect(out).toMatch(/The whole database: 12\.3 MB/);
    expect(out).toMatch(/3\.0 MB, of which 1\.0 MB data and 2\.0 MB indexes/);
    expect(out).toMatch(/Rows: about 40,000/);
    expect(out).toContain("Rows: unknown");
    expect(out).toMatch(/1,234 new in the last 30 days/);
    expect(out).toMatch(/450 can no longer be used/);
    expect(out).toMatch(/100 in all · 40 at events more than 6 months ago · 10 at events more than 12 months ago/);
  });

  it("says in a sentence that the database could not be asked, in both languages, and draws no figure", async () => {
    for (const [locale, sentence] of [
      ["ro", "Nu am putut citi mărimea bazei de date"],
      ["en", "The database's size could not be read"],
    ] as const) {
      state.locale = locale;
      const out = await html(DatabaseSizesPanel({ sizes: null }));
      expect(out).toContain('data-testid="db-size-unread"');
      expect(out).toContain(sentence);
      expect(out).not.toContain("db-size-tables");
    }
  });

  it("links the plan document from the card", async () => {
    state.locale = "ro";
    const out = await html(DatabaseSizesPanel({ sizes: SIZES }));
    expect(out).toContain('data-testid="db-size-plan-link"');
    expect(out).toContain("PLATFORM");
  });
});

describe("§NNN «Vercel: consumul lunii» on /devs", () => {
  it("draws the lines, the builds by project and the CPU against Hobby's four hours, amber near it", async () => {
    state.locale = "ro";
    const out = await html(VercelUsagePanel({ reading: { ok: true, usage: USAGE }, creditUsd: 20 }));

    expect(out).toContain('id="vercel-usage"');
    expect(out).toContain("Vercel: consumul lunii");
    expect(out).toMatch(/Consum până acum: 11,61 \$ din creditul inclus de 20,00 \$/);
    expect(out).toContain("Abonamentul în sine: 10,67 $");
    expect(out).toContain("Build CPU Minutes");
    expect(out).toMatch(/3\.156 minute · 10,99 \$/);
    expect(out).toContain("site-production");
    expect(out).toMatch(/1\.584 minute de CPU de build · 5,52 \$/);
    expect(out).toMatch(/Aproape de limită: 3,7 din cele 4 ore de CPU incluse pe lună în planul Hobby \(92%\)/);
    // 3.66 of 4 is past eighty percent: the one figure that decides whether the club fits on Hobby is amber.
    expect(out).toContain('data-near="true"');
  });

  it("says the same in English, and reads «Hobby» when the club states no credit", async () => {
    state.locale = "en";
    const out = await html(VercelUsagePanel({ reading: { ok: true, usage: { ...USAGE, activeCpuHours: 1, subscriptionUsd: 0 } }, creditUsd: 0 }));

    expect(out).toContain("Vercel: this month's usage");
    expect(out).toMatch(/Used so far: \$11\.61 at list price/);
    expect(out).toMatch(/1,584 build CPU minutes · \$5\.52/);
    expect(out).toMatch(/Function CPU time: 1 of the 4 CPU-hours the Hobby plan includes a month \(25%\)/);
    expect(out).toContain('data-near="false"');
    expect(out).not.toContain("vercel-usage-subscription");
  });

  it("says Vercel would not tell — with its reason and a link to the Usage page — in both languages, and draws no line", async () => {
    for (const [locale, sentence] of [
      ["ro", "Vercel nu dă consumul cu această cheie (HTTP 403)"],
      ["en", "Vercel does not give usage to this key (HTTP 403)"],
    ] as const) {
      state.locale = locale;
      const out = await html(VercelUsagePanel({ reading: { ok: false, reason: "HTTP 403" }, creditUsd: 20 }));
      expect(out).toContain('data-testid="vercel-usage-cannot"');
      expect(out).toContain(sentence);
      expect(out).toContain("https://vercel.com/dashboard/usage");
      expect(out).not.toContain("vercel-usage-lines");
    }
  });

  it("says a missing token in both languages", async () => {
    for (const [locale, sentence] of [
      ["ro", "Fără VERCEL_API_TOKEN nu se poate citi consumul"],
      ["en", "Without VERCEL_API_TOKEN the usage cannot be read"],
    ] as const) {
      state.locale = locale;
      const out = await html(VercelUsagePanel({ reading: { ok: false, reason: "unconfigured" }, creditUsd: 0 }));
      expect(out).toContain(sentence);
    }
  });
});

describe("§NNN the CPU line says how near the allowance is, and does not compare what it cannot", () => {
  it("is calm under eighty percent, says the share near it, and names a unit that is not hours instead of guessing", async () => {
    state.locale = "en";
    const calm = await html(VercelUsagePanel({ reading: { ok: true, usage: { ...USAGE, activeCpuHours: 2 } }, creditUsd: 0 }));
    expect(calm).toMatch(/Function CPU time: 2 of the 4 CPU-hours the Hobby plan includes a month \(50%\)/);
    expect(calm).toContain('data-near="false"');

    const near = await html(VercelUsagePanel({ reading: { ok: true, usage: { ...USAGE, activeCpuHours: 3.4 } }, creditUsd: 0 }));
    expect(near).toMatch(/Close to the allowance: 3\.4 of the 4 CPU-hours/);
    expect(near).toContain('data-near="true"');

    const unknown = await html(VercelUsagePanel({ reading: { ok: true, usage: { ...USAGE, activeCpuHours: null, activeCpuUnit: "GB-Hrs" } }, creditUsd: 0 }));
    expect(unknown).toContain("«GB-Hrs», not in hours");
    expect(unknown).toContain('data-near="false"');

    state.locale = "ro";
    const ro = await html(VercelUsagePanel({ reading: { ok: true, usage: { ...USAGE, activeCpuHours: 1 } }, creditUsd: 0 }));
    expect(ro).toMatch(/Timp de CPU al funcțiilor: 1 din cele 4 ore de CPU incluse pe lună în planul Hobby \(25%\)/);
  });
});

describe("§NNN the builds line under the deployments", () => {
  it("names the count and the branches in both languages, and a dash when no branch built", async () => {
    const byBranch = [
      { branch: "qa", count: 7 },
      { branch: "main", count: 2 },
    ];
    state.locale = "ro";
    expect(await html(VercelBuildsLine({ builds: 9, byBranch }))).toContain("Build-uri luna aceasta, pe acest proiect: 9 (qa 7, main 2).");
    state.locale = "en";
    const en = await html(VercelBuildsLine({ builds: 9, byBranch }));
    expect(en).toContain("Builds this month, on this project: 9 (qa 7, main 2).");
    expect(en).not.toContain("cost money");
    expect(await html(VercelBuildsLine({ builds: 0, byBranch: [] }))).toContain("0 (—).");
  });
});
