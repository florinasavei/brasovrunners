import { describe, expect, it } from "vitest";
import {
  DEEPL_FREE_CHARACTERS_PER_MONTH,
  MONTH_COST_IDS,
  type MonthCostFacts,
  type MonthCostLine,
  monthCosts,
  monthTotals,
  projectToPeriodEnd,
  utcMonth,
} from "@/modules/diagnostics/domain/month-costs";
import { neonBudget } from "@/modules/diagnostics/domain/neon-budget";
import { NEON_PLANS } from "@/modules/diagnostics/domain/neon-plan";
import { DOMAIN_PRICE_USD_PER_YEAR } from "@/modules/diagnostics/platform-plans";
import { VERCEL_HOBBY_BUILD_MINUTES_PER_MONTH } from "@/modules/diagnostics/vercel";

/**
 * BR-REQ-090-07 criterion 19 (§NNN) — Costuri's «Luna aceasta»: each provider's month so far and
 * projected to its end, at the pace the budget card uses, every price from its catalogue, and a
 * provider nothing could read never counted as free.
 */
const OCTOBER = utcMonth(new Date("2026-10-11T00:00:00.000Z"));
/** Ten days (240 h) into a 744-hour October. */
const NOW = new Date("2026-10-11T00:00:00.000Z");
const GB = 1024 * 1024 * 1024;

function facts(patch: Partial<MonthCostFacts> = {}): MonthCostFacts {
  return {
    now: NOW,
    neon: { plan: "LAUNCH", meter: { usedCuHours: 10, periodStart: OCTOBER.start, periodEnd: OCTOBER.end, quotaCuHours: null }, databaseBytes: GB },
    mailgun: { planName: "Free", usdPerMonth: 0, sentThisMonth: 100, monthlyAllowance: null, dailyAllowance: 100 },
    vercel: { buildMinutes: 100 },
    vercelBuildMinutesPerMonth: VERCEL_HOBBY_BUILD_MINUTES_PER_MONTH,
    domain: { planName: ".com", usdPerYear: DOMAIN_PRICE_USD_PER_YEAR, expiresOn: "2027-09-16" },
    deepl: { charactersThisMonth: 50_000 },
    ...patch,
  };
}

function line(input: MonthCostFacts, id: MonthCostLine["id"]): MonthCostLine {
  const found = monthCosts(input).find((candidate) => candidate.id === id);
  if (!found) throw new Error(`no ${id} line`);
  return found;
}

describe("the pace a month is projected at", () => {
  it("is the UTC calendar month, first instant to the next month's first", () => {
    expect(OCTOBER.start.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(OCTOBER.end.toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(utcMonth(new Date("2026-12-31T23:59:59.000Z")).end.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("adds the hourly pace so far times the hours left", () => {
    // 10 in 240 hours, 504 hours left: 10 + 21.
    expect(projectToPeriodEnd(10, OCTOBER, NOW)).toBeCloseTo(31, 6);
    expect(projectToPeriodEnd(0, OCTOBER, NOW)).toBe(0);
    // At the period's end the projection is what was spent.
    expect(projectToPeriodEnd(40, OCTOBER, OCTOBER.end)).toBe(40);
  });

  it("measures the pace over at least a day, so a busy first hour is not a month of it", () => {
    const sixHoursIn = new Date("2026-10-01T06:00:00.000Z");
    // 2 over 24 hours (not 6), 738 hours left.
    expect(projectToPeriodEnd(2, OCTOBER, sixHoursIn)).toBeCloseTo(2 + (2 / 24) * 738, 6);
  });

  it("is the budget card's own projection for the same month (§447)", () => {
    for (const [used, now] of [
      [10, NOW],
      [2, new Date("2026-10-01T06:00:00.000Z")],
      [70, new Date("2026-10-29T12:00:00.000Z")],
    ] as const) {
      const budget = neonBudget({ usedCuHours: used, quotaCuHours: 100, periodStart: OCTOBER.start, periodEnd: OCTOBER.end, now });
      expect(projectToPeriodEnd(used, OCTOBER, now)).toBeCloseTo(budget.projectedCuHours ?? Number.NaN, 9);
    }
  });
});

describe("one line per provider that bills or meters something", () => {
  it("lists the five providers, in the cost table's order", () => {
    expect(monthCosts(facts()).map((row) => row.id)).toEqual(["domain", "mailgun", "vercel", "neon", "deepl"]);
    expect([...MONTH_COST_IDS].sort()).toEqual(monthCosts(facts()).map((row) => row.id).sort());
  });

  it("Neon on Launch: the hours and the storage so far and at the period's end, at the catalogue's rates, an estimate", () => {
    const neon = line(facts(), "neon");
    const rate = NEON_PLANS.LAUNCH.usdPerCuHour;
    const storagePerHour = NEON_PLANS.LAUNCH.usdPerGbMonth / 720;
    expect(neon).toMatchObject({ plan: "Launch", billing: "usage", estimated: true, plusVat: false, severity: "ok" });
    expect(neon.soFarUsd).toBe(Math.round((10 * rate + storagePerHour * 240) * 100) / 100);
    expect(neon.projectedUsd).toBe(Math.round((31 * rate + storagePerHour * 744) * 100) / 100);
    expect(neon.soFarUsd).toBe(1.18);
    expect(neon.projectedUsd).toBe(3.65);
    expect(neon.usage).toMatchObject({ unit: "cuHours", used: 10, ceiling: null, ceilingKind: null, state: "ok" });
  });

  it("Neon: the club's quota is the ceiling, and a projection past it is the row to act on", () => {
    const capped = line(facts({ neon: { plan: "LAUNCH", meter: { usedCuHours: 10, periodStart: OCTOBER.start, periodEnd: OCTOBER.end, quotaCuHours: 30 }, databaseBytes: GB } }), "neon");
    expect(capped.usage).toMatchObject({ ceiling: 30, ceilingKind: "quota", state: "over" });
    expect(capped.severity).toBe("act");
    const roomy = line(facts({ neon: { plan: "LAUNCH", meter: { usedCuHours: 10, periodStart: OCTOBER.start, periodEnd: OCTOBER.end, quotaCuHours: 100 }, databaseBytes: GB } }), "neon");
    expect(roomy.usage?.state).toBe("ok");
  });

  it("Neon on Free: nothing billed, the plan's hours the ceiling unless the club's quota is lower", () => {
    const meter = { usedCuHours: 10, periodStart: OCTOBER.start, periodEnd: OCTOBER.end, quotaCuHours: null };
    const free = line(facts({ neon: { plan: "FREE", meter, databaseBytes: GB } }), "neon");
    expect(free).toMatchObject({ billing: "free", soFarUsd: 0, projectedUsd: 0, estimated: false });
    expect(free.usage).toMatchObject({ ceiling: NEON_PLANS.FREE.cuHoursPerMonth, ceilingKind: "plan" });
    expect(line(facts({ neon: { plan: "FREE", meter: { ...meter, quotaCuHours: 50 }, databaseBytes: GB } }), "neon").usage).toMatchObject({ ceiling: 50, ceilingKind: "quota" });
    expect(line(facts({ neon: { plan: "FREE", meter: { ...meter, quotaCuHours: 150 }, databaseBytes: GB } }), "neon").usage).toMatchObject({ ceiling: 100, ceilingKind: "plan" });
  });

  it("Neon unread: Launch's money is unknown — never zero — and the row is grey on either plan", () => {
    const launch = line(facts({ neon: { plan: "LAUNCH", meter: null, databaseBytes: GB } }), "neon");
    expect(launch).toMatchObject({ soFarUsd: null, projectedUsd: null, usage: null, severity: "unknown" });
    const free = line(facts({ neon: { plan: "FREE", meter: null, databaseBytes: null } }), "neon");
    expect(free).toMatchObject({ soFarUsd: 0, projectedUsd: 0, usage: null, severity: "unknown" });
  });

  it("Mailgun: a subscription month is billed whole; Free names its daily hundred instead of a monthly ceiling", () => {
    const free = line(facts(), "mailgun");
    expect(free).toMatchObject({ billing: "free", soFarUsd: 0, projectedUsd: 0, plusVat: false });
    expect(free.usage).toMatchObject({ unit: "messages", used: 100, ceiling: null, dailyCeiling: 100, state: "ok" });
    expect(free.usage?.projected).toBeCloseTo(310, 6);

    const basic = line(facts({ mailgun: { planName: "Basic", usdPerMonth: 15, sentThisMonth: 4_000, monthlyAllowance: 10_000, dailyAllowance: null } }), "mailgun");
    expect(basic).toMatchObject({ billing: "monthly", soFarUsd: 15, projectedUsd: 15, plusVat: true, estimated: false, severity: "act" });
    expect(basic.usage).toMatchObject({ ceiling: 10_000, ceilingKind: "plan", state: "over" });
  });

  it("Mailgun on a typed plan: its price is not recorded, so the month is unknown rather than free", () => {
    const custom = line(facts({ mailgun: { planName: "Custom", usdPerMonth: null, sentThisMonth: 10, monthlyAllowance: null, dailyAllowance: null } }), "mailgun");
    expect(custom).toMatchObject({ billing: "monthly", soFarUsd: null, projectedUsd: null, severity: "unknown" });
  });

  it("Vercel: free, the build minutes against Hobby's month, grey without a token", () => {
    const busy = line(facts({ vercel: { buildMinutes: 1_600 } }), "vercel");
    // 1,600 in ten days is about 4,960 by the end: past 80% of 6,000.
    expect(busy).toMatchObject({ plan: "Hobby", soFarUsd: 0, projectedUsd: 0, severity: "watch" });
    expect(busy.usage).toMatchObject({ unit: "buildMinutes", ceiling: VERCEL_HOBBY_BUILD_MINUTES_PER_MONTH, state: "close" });
    expect(line(facts({ vercel: null }), "vercel")).toMatchObject({ usage: null, severity: "unknown" });
  });

  it("the domain: nothing in a month without its expiry; the renewal in the month that has it, paid once the day has passed", () => {
    expect(line(facts(), "domain")).toMatchObject({ soFarUsd: 0, projectedUsd: 0, renewsOn: "2027-09-16", renewsThisPeriod: false, severity: "ok" });
    const due = { planName: ".com", usdPerYear: DOMAIN_PRICE_USD_PER_YEAR, expiresOn: "2026-10-20" };
    expect(line(facts({ domain: due }), "domain")).toMatchObject({ soFarUsd: 0, projectedUsd: DOMAIN_PRICE_USD_PER_YEAR, plusVat: true, renewsThisPeriod: true, severity: "watch" });
    expect(line(facts({ domain: due, now: new Date("2026-10-25T00:00:00.000Z") }), "domain")).toMatchObject({ soFarUsd: DOMAIN_PRICE_USD_PER_YEAR });
    expect(line(facts({ domain: { ...due, expiresOn: null } }), "domain")).toMatchObject({ renewsOn: null, projectedUsd: 0 });
  });

  it("DeepL: free, the month's characters against the free plan's 500,000", () => {
    const deepl = line(facts(), "deepl");
    expect(deepl).toMatchObject({ billing: "free", soFarUsd: 0, projectedUsd: 0 });
    expect(deepl.usage).toMatchObject({ unit: "characters", ceiling: DEEPL_FREE_CHARACTERS_PER_MONTH, state: "ok" });
    expect(line(facts({ deepl: { charactersThisMonth: 170_000 } }), "deepl").usage?.state).toBe("over");
  });
});

describe("the month's total", () => {
  it("adds the lines, says when a projection is in it and when VAT comes on top", () => {
    const lines = monthCosts(
      facts({
        mailgun: { planName: "Basic", usdPerMonth: 15, sentThisMonth: 10, monthlyAllowance: 10_000, dailyAllowance: null },
        domain: { planName: ".com", usdPerYear: DOMAIN_PRICE_USD_PER_YEAR, expiresOn: "2026-10-20" },
      }),
    );
    // Mailgun's month is VAT-exclusive already; the domain's renewal is only in the projection.
    expect(monthTotals(lines)).toEqual({ soFarUsd: 16.18, projectedUsd: 29.62, estimated: true, soFarPlusVat: true, projectedPlusVat: true, incomplete: false });
    const renewalOnly = monthCosts(facts({ domain: { planName: ".com", usdPerYear: DOMAIN_PRICE_USD_PER_YEAR, expiresOn: "2026-10-20" } }));
    expect(monthTotals(renewalOnly)).toMatchObject({ soFarUsd: 1.18, soFarPlusVat: false, projectedUsd: 14.62, projectedPlusVat: true });
  });

  it("on the free plans is zero, with no estimate and no VAT", () => {
    const lines = monthCosts(facts({ neon: { plan: "FREE", meter: null, databaseBytes: null } }));
    expect(monthTotals(lines)).toEqual({ soFarUsd: 0, projectedUsd: 0, estimated: false, soFarPlusVat: false, projectedPlusVat: false, incomplete: false });
  });

  it("is marked incomplete when a provider that bills could not be read", () => {
    const lines = monthCosts(facts({ neon: { plan: "LAUNCH", meter: null, databaseBytes: GB } }));
    expect(monthTotals(lines)).toMatchObject({ incomplete: true, soFarUsd: 0, projectedUsd: 0 });
  });
});
