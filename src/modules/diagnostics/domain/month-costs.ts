import { NEON_BUDGET_MIN_PACE_HOURS } from "./neon-budget";
import { NEON_PLANS, type NeonPlanId, roundUsd } from "./neon-plan";

/**
 * «Luna aceasta» — what each provider has cost the club so far this month, and what it will
 * have cost by the month's end at the pace so far (§NNN; the owner: «Costuri» becomes the club's
 * money page).
 *
 * The cost table below it on Costuri answers "what does today's setup cost a year"; this answers
 * the treasurer's other question, the one asked in the middle of a month: **how much this month,
 * and how much by the end of it**. One line per provider that bills or meters something —
 * Neon, Mailgun, Vercel, the domain, DeepL — each with its money (so far, and projected) and its
 * usage (so far, projected, and the ceiling that usage meets).
 *
 * Pure, over the facts the page already reads (Neon's meter §447, the outbox's month §100,
 * Vercel's deployments §101, the audit trail's translated characters §464, the domain's expiry
 * §435) and the clock, so every figure is pinned by a unit test rather than read off a page.
 *
 * **The same pace as «Bugetul lunii».** A projection is the spend so far, plus the average hourly
 * pace times the hours left, the pace measured over at least a day (`NEON_BUDGET_MIN_PACE_HOURS`,
 * §447) so a busy first hour is not a month of that pace. The Neon line's projected CU-hours are
 * therefore exactly the ones the budget card prints, and a test holds the two together.
 *
 * **The period is the provider's own where it is known.** Neon bills its own billing period (the
 * project row's `consumption_period_start`/`_end`); the outbox, Vercel's list and the translated
 * characters are counted per UTC calendar month, the month `notifications/volume.ts` and
 * `diagnostics/vercel.ts` already count, so each line names its period.
 *
 * **Every price comes from its catalogue** (`neon-plan.ts`, `email-plan.ts`, the domain constant
 * in `platform-plans.ts`), never from here: this file multiplies and adds, and says "estimate"
 * wherever it projects — `AGENTS.md` §1.2's rule that a vendor's price is quoted, never invented.
 */

/** DeepL API Free's monthly allowance, from deepl.com/pro-api on 2026-09-26 (§464): 500,000 characters a month. */
export const DEEPL_FREE_CHARACTERS_PER_MONTH = 500_000;
export const DEEPL_FREE_CHECKED_ON = "2026-09-26";

/** Share of a ceiling past which a projected usage is worth watching (the eighty percent every other card warns at). */
export const MONTH_USAGE_WATCH_SHARE = 0.8;

export const MONTH_COST_IDS = ["neon", "mailgun", "vercel", "domain", "deepl"] as const;
export type MonthCostId = (typeof MONTH_COST_IDS)[number];

export type MonthPeriod = { start: Date; end: Date };

export type MonthUsageUnit = "cuHours" | "messages" | "buildMinutes" | "characters";

export type MonthUsage = {
  unit: MonthUsageUnit;
  used: number;
  /** At the period's end, at the pace so far. */
  projected: number;
  /** The ceiling this usage meets inside the month, or null when none binds per month. */
  ceiling: number | null;
  /** `plan` — the vendor's plan caps it; `quota` — the club's own limit at Neon (§335). */
  ceilingKind: "plan" | "quota" | null;
  /** Free Mailgun only: the daily ceiling, counted per day rather than per month (§100). */
  dailyCeiling: number | null;
  /** Where the projection lands against the ceiling: `over` reaches it before the period ends. */
  state: "ok" | "close" | "over";
};

export type MonthCostLine = {
  id: MonthCostId;
  /** The vendor's own plan name ("Launch", "Free", "Hobby", ".com"), never translated. */
  plan: string;
  /** How the vendor bills it: by usage, a monthly subscription, once a year, or not at all. */
  billing: "usage" | "monthly" | "yearly" | "free";
  period: MonthPeriod;
  /** USD billed in this period so far, or null when nothing measures it (no key, no answer, a typed plan's unknown price). */
  soFarUsd: number | null;
  /** USD by the period's end at the pace so far, or null when nothing measures it. */
  projectedUsd: number | null;
  /** Whether the money figures are a projection at a catalogue rate rather than a fixed price. */
  estimated: boolean;
  /** Whether Romania's VAT comes on top of the amount (the domain and a paid Mailgun month, as the cost table says). */
  plusVat: boolean;
  /** The usage behind the money, or null when this deployment cannot read it. */
  usage: MonthUsage | null;
  /** The domain only: the expiry day (`YYYY-MM-DD`), or null while `DOMAIN_REGISTERED_ON` is unset. */
  renewsOn: string | null;
  /** The domain only: whether the renewal falls inside this period and is in the projection. */
  renewsThisPeriod: boolean;
  /** How the row should read at a glance — `ServiceSeverity`'s four words (§1.2: unmeasured is not green). */
  severity: "ok" | "unknown" | "watch" | "act";
};

export type MonthCostFacts = {
  now: Date;
  neon: {
    /** The plan in force (§326): Neon's answer, else the stated setting. */
    plan: NeonPlanId;
    /** The meter (§447), or null when Neon could not be read. */
    meter: { usedCuHours: number; periodStart: Date; periodEnd: Date; quotaCuHours: number | null } | null;
    /** `pg_database_size`, or null when it could not be read. */
    databaseBytes: number | null;
  };
  mailgun: {
    planName: string;
    /** The plan's monthly price, or null for a typed plan whose price is not recorded (§100's `CUSTOM`). */
    usdPerMonth: number | null;
    sentThisMonth: number;
    monthlyAllowance: number | null;
    dailyAllowance: number | null;
  };
  /** This month's build minutes from Vercel, or null without a token or an answer. */
  vercel: { buildMinutes: number } | null;
  vercelBuildMinutesPerMonth: number;
  domain: { planName: string; usdPerYear: number; expiresOn: string | null };
  deepl: { charactersThisMonth: number };
};

const HOUR = 3_600_000;
/** A GB-month is priced per month; a period's storage is its hours against a thirty-day month, the way `projectedNeonLaunchUsdPerMonth` counts one. */
const MONTH_HOURS = 30 * 24;
const GB = 1024 * 1024 * 1024;

/** The UTC calendar month `now` falls in — the month the outbox and Vercel's list are counted over. */
export function utcMonth(now: Date): MonthPeriod {
  return {
    start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
    end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
  };
}

/** Hours in the period, and hours of it gone by `now` (clamped to the period). */
function periodHours(period: MonthPeriod, now: Date): { total: number; elapsed: number } {
  const total = Math.max((period.end.getTime() - period.start.getTime()) / HOUR, 0);
  const elapsed = Math.min(Math.max((now.getTime() - period.start.getTime()) / HOUR, 0), total);
  return { total, elapsed };
}

/**
 * The usage at the period's end if the pace so far holds: `used` plus the hourly pace times the
 * hours left, the pace measured over at least a day — `neonBudget`'s own formula (§447), so the
 * two cards never print two projections for one month. Never below `used`.
 */
export function projectToPeriodEnd(used: number, period: MonthPeriod, now: Date): number {
  const { total, elapsed } = periodHours(period, now);
  if (total <= 0 || used <= 0) return Math.max(used, 0);
  const perHour = used / Math.max(elapsed, NEON_BUDGET_MIN_PACE_HOURS);
  return used + perHour * (total - elapsed);
}

function usageState(projected: number, ceiling: number | null): MonthUsage["state"] {
  if (ceiling === null || ceiling <= 0) return "ok";
  if (projected >= ceiling) return "over";
  if (projected >= ceiling * MONTH_USAGE_WATCH_SHARE) return "close";
  return "ok";
}

function usage(
  unit: MonthUsageUnit,
  used: number,
  period: MonthPeriod,
  now: Date,
  ceiling: number | null,
  ceilingKind: MonthUsage["ceilingKind"],
  dailyCeiling: number | null = null,
): MonthUsage {
  const projected = projectToPeriodEnd(used, period, now);
  return { unit, used, projected, ceiling, ceilingKind: ceiling === null ? null : ceilingKind, dailyCeiling, state: usageState(projected, ceiling) };
}

function severityOf(line: Pick<MonthCostLine, "usage" | "soFarUsd" | "billing">, measurable: boolean): MonthCostLine["severity"] {
  if (line.usage?.state === "over") return "act";
  if (line.usage?.state === "close") return "watch";
  if (!measurable || (line.billing !== "free" && line.billing !== "yearly" && line.soFarUsd === null)) return "unknown";
  return "ok";
}

/**
 * Neon: Launch bills the CU-hours and the storage, so both money figures are estimates at the
 * catalogue's rates over Neon's own billing period; Free bills nothing and caps the hours, so
 * the money is zero and the usage meets the plan's hundred hours. On either plan the club's own
 * quota (§335) is the ceiling when it is lower — reaching it suspends the site.
 */
function neonLine(facts: MonthCostFacts): MonthCostLine {
  const { plan, meter, databaseBytes } = facts.neon;
  const entry = NEON_PLANS[plan];
  const period = meter ? { start: meter.periodStart, end: meter.periodEnd } : utcMonth(facts.now);
  const planCap = entry.cuHoursPerMonth;
  const quota = meter?.quotaCuHours ?? null;
  const [ceiling, ceilingKind] =
    quota !== null && (planCap === null || quota < planCap) ? [quota, "quota" as const] : planCap !== null ? [planCap, "plan" as const] : [null, null];
  const use = meter ? usage("cuHours", meter.usedCuHours, period, facts.now, ceiling, ceilingKind) : null;

  let soFarUsd: number | null = plan === "FREE" ? 0 : null;
  let projectedUsd: number | null = plan === "FREE" ? 0 : null;
  if (plan !== "FREE" && use) {
    const { total, elapsed } = periodHours(period, facts.now);
    const storageUsdPerHour = databaseBytes === null ? 0 : ((databaseBytes / GB) * entry.usdPerGbMonth) / MONTH_HOURS;
    soFarUsd = roundUsd(use.used * entry.usdPerCuHour + storageUsdPerHour * elapsed);
    projectedUsd = roundUsd(use.projected * entry.usdPerCuHour + storageUsdPerHour * total);
  }
  const line = {
    id: "neon" as const,
    plan: entry.name,
    billing: plan === "FREE" ? ("free" as const) : ("usage" as const),
    period,
    soFarUsd,
    projectedUsd,
    estimated: plan !== "FREE",
    plusVat: false,
    usage: use,
    renewsOn: null,
    renewsThisPeriod: false,
  };
  return { ...line, severity: severityOf(line, meter !== null) };
}

/**
 * Mailgun: a subscription month is billed whole, so the month's money is the plan's price both
 * so far and at the end; the usage is the messages Mailgun carried this month, projected, against
 * a paid plan's monthly allowance. On Free the daily hundred binds per day and is named beside
 * it rather than multiplied into a monthly figure no plan states.
 */
function mailgunLine(facts: MonthCostFacts): MonthCostLine {
  const m = facts.mailgun;
  const period = utcMonth(facts.now);
  const paid = m.usdPerMonth === null || m.usdPerMonth > 0;
  const use = usage("messages", m.sentThisMonth, period, facts.now, m.monthlyAllowance, "plan", m.dailyAllowance);
  const line = {
    id: "mailgun" as const,
    plan: m.planName,
    billing: paid ? ("monthly" as const) : ("free" as const),
    period,
    soFarUsd: m.usdPerMonth,
    projectedUsd: m.usdPerMonth,
    estimated: false,
    plusVat: paid,
    usage: use,
    renewsOn: null,
    renewsThisPeriod: false,
  };
  return { ...line, severity: severityOf(line, true) };
}

/** Vercel Hobby: free; the build minutes are the ceiling a busy month of pushes meets (§101). */
function vercelLine(facts: MonthCostFacts): MonthCostLine {
  const period = utcMonth(facts.now);
  const use = facts.vercel
    ? usage("buildMinutes", facts.vercel.buildMinutes, period, facts.now, facts.vercelBuildMinutesPerMonth, "plan")
    : null;
  const line = {
    id: "vercel" as const,
    plan: "Hobby",
    billing: "free" as const,
    period,
    soFarUsd: 0,
    projectedUsd: 0,
    estimated: false,
    plusVat: false,
    usage: use,
    renewsOn: null,
    renewsThisPeriod: false,
  };
  return { ...line, severity: severityOf(line, facts.vercel !== null) };
}

/**
 * The domain: billed a year at a time, so a month costs nothing unless its expiry day falls in
 * it — then the renewal is the month's (so far once the day has passed, projected either way).
 * The registry price, as the cost table quotes it (§55): the registrar adds its margin and VAT.
 */
function domainLine(facts: MonthCostFacts): MonthCostLine {
  const period = utcMonth(facts.now);
  const { expiresOn } = facts.domain;
  const expiry = expiresOn ? Date.parse(`${expiresOn}T00:00:00Z`) : Number.NaN;
  const inPeriod = !Number.isNaN(expiry) && expiry >= period.start.getTime() && expiry < period.end.getTime();
  const passed = inPeriod && expiry <= facts.now.getTime();
  const price = facts.domain.usdPerYear;
  const line = {
    id: "domain" as const,
    plan: facts.domain.planName,
    billing: "yearly" as const,
    period,
    soFarUsd: passed ? price : 0,
    projectedUsd: inPeriod ? price : 0,
    estimated: false,
    plusVat: true,
    usage: null,
    renewsOn: expiresOn,
    renewsThisPeriod: inPeriod,
  };
  return { ...line, severity: inPeriod ? "watch" : "ok" };
}

/** DeepL API Free: free; the characters this month against its 500,000 (§464). */
function deeplLine(facts: MonthCostFacts): MonthCostLine {
  const period = utcMonth(facts.now);
  const use = usage("characters", facts.deepl.charactersThisMonth, period, facts.now, DEEPL_FREE_CHARACTERS_PER_MONTH, "plan");
  const line = {
    id: "deepl" as const,
    plan: "API Free",
    billing: "free" as const,
    period,
    soFarUsd: 0,
    projectedUsd: 0,
    estimated: false,
    plusVat: false,
    usage: use,
    renewsOn: null,
    renewsThisPeriod: false,
  };
  return { ...line, severity: severityOf(line, true) };
}

/** One line per provider that bills or meters something, in the cost table's order. */
export function monthCosts(facts: MonthCostFacts): MonthCostLine[] {
  return [domainLine(facts), mailgunLine(facts), vercelLine(facts), neonLine(facts), deeplLine(facts)];
}

export type MonthTotals = {
  /** Every provider in USD, so one currency; the sum of the lines that could be read. */
  soFarUsd: number;
  projectedUsd: number;
  /** Some line is a projection at a catalogue rate. */
  estimated: boolean;
  /**
   * Some amount in that figure has VAT on top — per figure, because the domain's renewal can be in
   * the projection and not yet in what has been spent. One VAT-exclusive amount makes the whole
   * figure VAT-exclusive, as the year's total already says (`annualCostToday`).
   */
  soFarPlusVat: boolean;
  projectedPlusVat: boolean;
  /** Some line that bills could not be read, so the total is short by it. */
  incomplete: boolean;
};

export function monthTotals(lines: readonly MonthCostLine[]): MonthTotals {
  let soFar = 0;
  let projected = 0;
  let estimated = false;
  let soFarPlusVat = false;
  let projectedPlusVat = false;
  let incomplete = false;
  for (const line of lines) {
    if (line.soFarUsd === null || line.projectedUsd === null) {
      incomplete = true;
      continue;
    }
    soFar += line.soFarUsd;
    projected += line.projectedUsd;
    if (line.estimated && line.projectedUsd > 0) estimated = true;
    if (line.plusVat && line.soFarUsd > 0) soFarPlusVat = true;
    if (line.plusVat && line.projectedUsd > 0) projectedPlusVat = true;
  }
  return { soFarUsd: roundUsd(soFar), projectedUsd: roundUsd(projected), estimated, soFarPlusVat, projectedPlusVat, incomplete };
}
