import { describe, expect, it } from "vitest";
import {
  MONTH_COST_IDS,
  type MonthCostFacts,
  type MonthCostLine,
  monthCosts,
  monthTotals,
  periodProgress,
  previousMonth,
  projectToPeriodEnd,
  utcMonth,
} from "@/modules/diagnostics/domain/month-costs";
import { CLUB_TIME_ZONE } from "@/i18n/dates";
import { translationCredit } from "@/modules/translate/domain/credit";
import { R2_FREE_STORAGE_GB, R2_USD_PER_GB_MONTH } from "@/modules/diagnostics/platform-plans";
import { neonBudget } from "@/modules/diagnostics/domain/neon-budget";
import { NEON_PLANS } from "@/modules/diagnostics/domain/neon-plan";
import { DOMAIN_PRICE_USD_PER_YEAR } from "@/modules/diagnostics/platform-plans";
import { VERCEL_HOBBY_BUILD_MINUTES_PER_MONTH } from "@/modules/diagnostics/vercel";

/**
 * BR-REQ-090-07 criterion 19 (§479) — Costuri's «Luna aceasta»: each provider's month so far and
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
    vercel: { buildMinutes: 100, deployments: 12 },
    vercelBuildMinutesPerMonth: VERCEL_HOBBY_BUILD_MINUTES_PER_MONTH,
    domain: { planName: ".com", usdPerYear: DOMAIN_PRICE_USD_PER_YEAR, expiresOn: "2027-09-16" },
    deepl: { charactersThisMonth: 50_000 },
    deeplCredit: { expected: false, credit: null },
    r2: { storedBytes: 2 * GB },
    lastMonth: { neonCuHours: 20, mailgunSent: 500 },
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

  it("counts the period's day and hours left in the provider's clock at the club's month edge", () => {
    const inClubZone = (at: Date) =>
      new Intl.DateTimeFormat("en-CA", { timeZone: CLUB_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at);
    // 01:30 on 1 October in Brașov is 22:30 UTC on 30 September: the provider's month is still September.
    const clubMidnightPast = new Date("2026-09-30T22:30:00.000Z");
    expect(inClubZone(clubMidnightPast)).toBe("2026-10-01, 01:30");
    const september = utcMonth(clubMidnightPast);
    expect(september.start.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(periodProgress(september, clubMidnightPast)).toEqual({ day: 30, days: 30, hoursLeft: 1.5 });
    // 30 CU-hours over 718.5 hours, 1.5 left: the projection barely moves, and stays September's.
    expect(projectToPeriodEnd(30, september, clubMidnightPast)).toBeCloseTo(30 + (30 / 718.5) * 1.5, 9);

    // 02:59 on 1 October in Brașov (23:59 UTC): still September, one minute left.
    const lastMinute = new Date("2026-09-30T23:59:00.000Z");
    expect(inClubZone(lastMinute)).toBe("2026-10-01, 02:59");
    expect(periodProgress(september, lastMinute).day).toBe(30);
    expect(periodProgress(september, lastMinute).hoursLeft).toBeCloseTo(1 / 60, 9);

    // 03:00 in Brașov is the UTC month's first instant: day 1 of October's 31, every hour left.
    expect(inClubZone(OCTOBER.start)).toBe("2026-10-01, 03:00");
    expect(periodProgress(OCTOBER, OCTOBER.start)).toEqual({ day: 1, days: 31, hoursLeft: 744 });
    // The pace's one-day floor keeps the first hours from projecting a month of them.
    expect(projectToPeriodEnd(1, OCTOBER, new Date("2026-10-01T01:00:00.000Z"))).toBeCloseTo(1 + (1 / 24) * 743, 9);
    // At the period's end: the last day, nothing left.
    expect(periodProgress(OCTOBER, OCTOBER.end)).toEqual({ day: 31, days: 31, hoursLeft: 0 });
  });
});

describe("one line per provider that bills or meters something", () => {
  it("lists the five providers, in the cost table's order", () => {
    expect(monthCosts(facts()).map((row) => row.id)).toEqual(["domain", "mailgun", "vercel", "neon", "deepl", "r2"]);
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
    const busy = line(facts({ vercel: { buildMinutes: 1_600, deployments: 40 } }), "vercel");
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

  it("DeepL (§497): free, the month's characters with no monthly ceiling — the key's allowance is a one-time credit", () => {
    const deepl = line(facts(), "deepl");
    expect(deepl).toMatchObject({ billing: "free", soFarUsd: 0, projectedUsd: 0, detail: null, severity: "ok" });
    expect(deepl.usage).toMatchObject({ unit: "characters", ceiling: null, ceilingKind: null, state: "ok" });
    // A busy month is never "over" by itself any more: only the credit's own figure can say so.
    expect(line(facts({ deepl: { charactersThisMonth: 900_000 } }), "deepl").usage?.state).toBe("ok");
  });

  it("DeepL's credit (§497): used and left from DeepL's meter, the level is the line's severity", () => {
    const at = (used: number) => line(facts({ deeplCredit: { expected: true, credit: translationCredit({ used, limit: 1_000_000 }) } }), "deepl");
    expect(at(0)).toMatchObject({ severity: "ok", detail: { kind: "credit", used: 0, limit: 1_000_000, remaining: 1_000_000, level: "ok" } });
    expect(at(799_999).severity).toBe("ok");
    expect(at(800_000)).toMatchObject({ severity: "watch", detail: { level: "watch" } });
    expect(at(950_000)).toMatchObject({ severity: "act", detail: { level: "low", remaining: 50_000 } });
    expect(at(1_000_000)).toMatchObject({ severity: "act", detail: { level: "spent", remaining: 0 } });
    // Still free: a credit already given bills nothing.
    expect(at(1_000_000)).toMatchObject({ soFarUsd: 0, projectedUsd: 0, billing: "free" });
  });

  it("DeepL's credit unread on a configured key is «nu știm», never green; no key reads as before", () => {
    expect(line(facts({ deeplCredit: { expected: true, credit: null } }), "deepl")).toMatchObject({ severity: "unknown", detail: null });
    expect(line(facts({ deeplCredit: { expected: false, credit: null } }), "deepl").severity).toBe("ok");
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
    expect(monthTotals(lines)).toMatchObject({ soFarUsd: 16.18, projectedUsd: 29.62, estimated: true, soFarPlusVat: true, projectedPlusVat: true, incomplete: false });
    const renewalOnly = monthCosts(facts({ domain: { planName: ".com", usdPerYear: DOMAIN_PRICE_USD_PER_YEAR, expiresOn: "2026-10-20" } }));
    expect(monthTotals(renewalOnly)).toMatchObject({ soFarUsd: 1.18, soFarPlusVat: false, projectedUsd: 14.62, projectedPlusVat: true });
  });

  it("on the free plans is zero, with no estimate and no VAT", () => {
    const lines = monthCosts(facts({ neon: { plan: "FREE", meter: null, databaseBytes: null } }));
    expect(monthTotals(lines)).toMatchObject({ soFarUsd: 0, projectedUsd: 0, estimated: false, soFarPlusVat: false, projectedPlusVat: false, incomplete: false });
  });

  it("is marked incomplete when a provider that bills could not be read", () => {
    const lines = monthCosts(facts({ neon: { plan: "LAUNCH", meter: null, databaseBytes: GB } }));
    expect(monthTotals(lines)).toMatchObject({ incomplete: true, soFarUsd: 0, projectedUsd: 0 });
  });
});

describe("the usage facts beside the money (§479)", () => {
  it("Vercel: the month's deployments beside its build minutes", () => {
    expect(line(facts(), "vercel").detail).toEqual({ kind: "deployments", count: 12 });
    expect(line(facts({ vercel: null }), "vercel").detail).toBeNull();
  });

  it("Neon: the database's stored gigabytes as a usage fact, not only inside the money", () => {
    expect(line(facts(), "neon").detail).toEqual({ kind: "storageGb", gb: 1 });
    expect(line(facts({ neon: { plan: "LAUNCH", meter: null, databaseBytes: null } }), "neon").detail).toBeNull();
  });

  it("R2: the pictures' bytes against the free ten GB — free under it, the excess priced over it, grey when unread", () => {
    const under = line(facts(), "r2");
    expect(under).toMatchObject({ plan: "Free", billing: "free", soFarUsd: 0, projectedUsd: 0, severity: "ok" });
    expect(under.usage).toMatchObject({ unit: "gigabytes", used: 2, projected: 2, ceiling: R2_FREE_STORAGE_GB, state: "ok" });

    const close = line(facts({ r2: { storedBytes: 9 * GB } }), "r2");
    expect(close).toMatchObject({ billing: "free", severity: "watch" });

    const over = line(facts({ r2: { storedBytes: 14 * GB } }), "r2");
    // 4 GB over at the catalogue's rate, a month; 240 of 744 hours of it so far.
    expect(over).toMatchObject({ billing: "usage", estimated: true, severity: "act", projectedUsd: Math.round(4 * R2_USD_PER_GB_MONTH * 100) / 100 });
    expect(over.soFarUsd).toBe(Math.round(((4 * R2_USD_PER_GB_MONTH * 240) / 744) * 100) / 100);

    const unread = line(facts({ r2: null }), "r2");
    expect(unread).toMatchObject({ soFarUsd: null, projectedUsd: null, usage: null, severity: "unknown" });
  });

  it("DeepL unread: no usage, grey — never a month of zero characters", () => {
    expect(line(facts({ deepl: null }), "deepl")).toMatchObject({ usage: null, severity: "unknown", soFarUsd: 0 });
  });
});

describe("last month (§479)", () => {
  const SEPTEMBER = previousMonth(OCTOBER);

  it("is the calendar month before, in the provider's own count", () => {
    expect(SEPTEMBER.start.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(SEPTEMBER.end.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(previousMonth(utcMonth(new Date("2027-01-15T00:00:00.000Z"))).start.toISOString()).toBe("2026-12-01T00:00:00.000Z");
  });

  it("Neon on Launch: the history's CU-hours at the catalogue's rate plus today's storage over the month, an estimate", () => {
    const neon = line(facts(), "neon");
    const expected = Math.round((20 * NEON_PLANS.LAUNCH.usdPerCuHour + NEON_PLANS.LAUNCH.usdPerGbMonth) * 100) / 100;
    expect(neon.lastMonth).toEqual({ period: SEPTEMBER, usd: expected, usage: 20, estimated: true, plusVat: false });
    // Nothing kept it: unknown, never zero.
    expect(line(facts({ lastMonth: { neonCuHours: null, mailgunSent: 500 } }), "neon").lastMonth.usd).toBeNull();
    // Free bills nothing, kept or not.
    expect(line(facts({ neon: { plan: "FREE", meter: null, databaseBytes: null }, lastMonth: { neonCuHours: null, mailgunSent: null } }), "neon").lastMonth.usd).toBe(0);
  });

  it("Mailgun: the plan's price with the outbox's count; unknown on a typed plan", () => {
    expect(line(facts(), "mailgun").lastMonth).toMatchObject({ usd: 0, usage: 500 });
    const basic = facts({ mailgun: { planName: "Basic", usdPerMonth: 15, sentThisMonth: 10, monthlyAllowance: 10_000, dailyAllowance: null } });
    expect(line(basic, "mailgun").lastMonth).toMatchObject({ usd: 15, usage: 500, plusVat: true });
    const custom = facts({ mailgun: { planName: "Custom", usdPerMonth: null, sentThisMonth: 10, monthlyAllowance: null, dailyAllowance: null } });
    expect(line(custom, "mailgun").lastMonth.usd).toBeNull();
  });

  it("the domain: the renewal when the expiry's anniversary fell last month", () => {
    expect(line(facts({ domain: { planName: ".com", usdPerYear: DOMAIN_PRICE_USD_PER_YEAR, expiresOn: "2027-09-16" } }), "domain").lastMonth).toMatchObject({
      usd: DOMAIN_PRICE_USD_PER_YEAR,
      plusVat: true,
    });
    expect(line(facts({ domain: { planName: ".com", usdPerYear: DOMAIN_PRICE_USD_PER_YEAR, expiresOn: "2027-03-16" } }), "domain").lastMonth.usd).toBe(0);
    // An expiry in September of this very year is this year's, not last month's renewal.
    expect(line(facts({ domain: { planName: ".com", usdPerYear: DOMAIN_PRICE_USD_PER_YEAR, expiresOn: "2026-09-30" } }), "domain").lastMonth.usd).toBe(0);
  });

  it("totals: summed when every line kept it, a dash naming the lines when one did not", () => {
    const kept = monthTotals(monthCosts(facts({ domain: { planName: ".com", usdPerYear: DOMAIN_PRICE_USD_PER_YEAR, expiresOn: "2027-09-16" } })));
    const neonLast = Math.round((20 * NEON_PLANS.LAUNCH.usdPerCuHour + NEON_PLANS.LAUNCH.usdPerGbMonth) * 100) / 100;
    expect(kept).toMatchObject({
      lastMonthUsd: Math.round((neonLast + DOMAIN_PRICE_USD_PER_YEAR) * 100) / 100,
      lastMonthMissing: [],
      lastMonthEstimated: true,
      lastMonthPlusVat: true,
    });
    const missing = monthTotals(monthCosts(facts({ lastMonth: { neonCuHours: null, mailgunSent: null } })));
    expect(missing).toMatchObject({ lastMonthUsd: null, lastMonthMissing: ["neon"] });
  });
});
