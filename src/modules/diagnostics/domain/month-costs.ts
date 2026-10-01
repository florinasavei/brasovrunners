import type { TranslationCredit } from "@/modules/translate/domain/credit";
import { R2_FREE_STORAGE_GB, R2_USD_PER_GB_MONTH } from "../platform-plans";
import { NEON_BUDGET_MIN_PACE_HOURS } from "./neon-budget";
import { NEON_PLANS, type NeonPlanId, roundUsd } from "./neon-plan";
import type { VercelPlanId } from "./vercel-plan";

/**
 * «Luna aceasta» — what each provider has cost the club so far this month, and what it will
 * have cost by the month's end at the pace so far (§479; the owner: «Costuri» becomes the club's
 * money page).
 *
 * The cost table below it on Costuri answers "what does today's setup cost a year"; this answers
 * the treasurer's other question, the one asked in the middle of a month: **how much this month,
 * and how much by the end of it**. One line per provider that bills or meters something —
 * Neon, Mailgun, Vercel, the domain, DeepL, R2 — each with its money (so far, projected, and last
 * month's where anything kept it) and its usage (so far, projected, and the ceiling that usage
 * meets).
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
 * **Every price comes from its catalogue** (`neon-plan.ts`, `email-plan.ts`, `vercel-plan.ts`, the domain and R2
 * constants in `platform-plans.ts`; DeepL's credit is DeepL's own answer, §497), never from
 * here: this file multiplies and adds, and says "estimate" wherever it projects — `AGENTS.md`
 * §1.2's rule that a vendor's price is quoted, never invented. Every amount is in USD, the
 * currency every one of those vendors bills in and the cost table below already prints.
 *
 * **Last month** (`lastMonth` on each line) is what the previous period cost where something kept
 * it: the outbox's rows for Mailgun, Neon's consumption history (an organisation's key only), the
 * domain's anniversary; the free lines are zero. A line nothing kept is null, and the total is
 * then null too — the card prints «—» and says which line is missing, never a smaller sum.
 */

/** Share of a ceiling past which a projected usage is worth watching (the eighty percent every other card warns at). */
export const MONTH_USAGE_WATCH_SHARE = 0.8;

export const MONTH_COST_IDS = ["neon", "mailgun", "vercel", "domain", "deepl", "r2"] as const;
export type MonthCostId = (typeof MONTH_COST_IDS)[number];

export type MonthPeriod = { start: Date; end: Date };

export type MonthUsageUnit = "cuHours" | "messages" | "buildMinutes" | "characters" | "gigabytes";

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
  /** A usage fact beside the money that is not the metered one: Vercel's deployments, Neon's stored gigabytes. */
  detail:
    | { kind: "deployments"; count: number }
    | { kind: "storageGb"; gb: number }
    | ({ kind: "credit" } & TranslationCredit)
    | null;
  /** The period before this one: its money (null when nothing kept it) and its usage where one was counted. */
  lastMonth: { period: MonthPeriod; usd: number | null; usage: number | null; estimated: boolean; plusVat: boolean };
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
  /** This month's build minutes and deployments from Vercel, or null without a token or an answer. */
  vercel: { buildMinutes: number; deployments: number } | null;
  /** Hobby's build minutes a month — the ceiling the usage meets on Hobby only. */
  vercelBuildMinutesPerMonth: number;
  /**
   * The Vercel plan the club states (§NNN): Hobby, or Pro with its seats and the catalogue's seat
   * price (`domain/vercel-plan.ts`), which this file multiplies and never quotes.
   */
  vercelPlan: { plan: VercelPlanId; seats: number; usdPerSeatPerMonth: number };
  domain: { planName: string; usdPerYear: number; expiresOn: string | null };
  /** The month's translated characters (§464), or null when the audit trail could not be read. */
  deepl: { charactersThisMonth: number } | null;
  /**
   * DeepL's credit from its own meter (§497), or null — not configured here (`expected: false`),
   * or configured and not read just now (`expected: true`, the line is then «nu știm», §1.2).
   */
  deeplCredit: { expected: boolean; credit: TranslationCredit | null };
  /** The pictures' recorded bytes (`media_assets.byte_size`), or null when they could not be read. */
  r2: { storedBytes: number } | null;
  lastMonth: {
    /** Neon's previous period in CU-hours (its consumption history), or null when it could not be read. */
    neonCuHours: number | null;
    /** The messages Mailgun carried in the previous UTC month (the outbox), or null when unread. */
    mailgunSent: number | null;
  };
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

/** The UTC calendar month before the one `period` starts in. */
export function previousMonth(period: MonthPeriod): MonthPeriod {
  return utcMonth(new Date(period.start.getTime() - 1));
}

function nothingLastMonth(period: MonthPeriod): MonthCostLine["lastMonth"] {
  return { period: previousMonth(period), usd: 0, usage: null, estimated: false, plusVat: false };
}

/** Hours in the period, and hours of it gone by `now` (clamped to the period). */
function periodHours(period: MonthPeriod, now: Date): { total: number; elapsed: number } {
  const total = Math.max((period.end.getTime() - period.start.getTime()) / HOUR, 0);
  const elapsed = Math.min(Math.max((now.getTime() - period.start.getTime()) / HOUR, 0), total);
  return { total, elapsed };
}

/**
 * Where `now` stands in a provider's period: which day of it (1-based, counted from the period's
 * own start, never from the club's midnight), how many days it has, and the hours left.
 *
 * The period is the provider's, in its own clock — Neon's billing period, the UTC calendar month
 * the outbox and Vercel count — so at 01:30 on 1 October in Brașov (22:30 UTC on 30 September)
 * the month being projected is still September, on its last day with an hour and a half left.
 * Counting days in the club's zone instead would move three hours of every month's edge into the
 * wrong month and disagree with the provider's own meter; the test at the month's edge holds this.
 */
export function periodProgress(period: MonthPeriod, now: Date): { day: number; days: number; hoursLeft: number } {
  const { total, elapsed } = periodHours(period, now);
  const days = Math.round(total / 24);
  return { day: Math.min(Math.floor(elapsed / 24) + 1, Math.max(days, 1)), days, hoursLeft: total - elapsed };
}

/**
 * The usage at the period's end if the pace so far holds: `used` plus the hourly pace times the
 * hours left, the pace measured over at least a day — `neonBudget`'s own formula (§447), so the
 * two cards never print two projections for one month. Never below `used`.
 *
 * Kept as §447's hourly pace rather than a count of days elapsed in the club's zone: the two agree
 * to the day in mid-month, but a day count jumps at the club's midnight and at the month's edge
 * would divide a UTC period's usage by the club's calendar (`periodProgress`), while the hourly
 * pace with its one-day floor is smooth, provider-aligned, and the number «Bugetul lunii» prints.
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
  const storageUsdPerHour = databaseBytes === null ? 0 : ((databaseBytes / GB) * entry.usdPerGbMonth) / MONTH_HOURS;
  if (plan !== "FREE" && use) {
    const { total, elapsed } = periodHours(period, facts.now);
    soFarUsd = roundUsd(use.used * entry.usdPerCuHour + storageUsdPerHour * elapsed);
    projectedUsd = roundUsd(use.projected * entry.usdPerCuHour + storageUsdPerHour * total);
  }
  // The period before, at today's catalogue rate and today's database size — Neon keeps the hours
  // (its consumption history), not what the storage was, so the figure is an estimate.
  const before = previousMonth(period);
  const lastCuHours = facts.lastMonth.neonCuHours;
  const lastMonth: MonthCostLine["lastMonth"] =
    plan === "FREE"
      ? { period: before, usd: 0, usage: lastCuHours, estimated: false, plusVat: false }
      : {
          period: before,
          usd: lastCuHours === null ? null : roundUsd(lastCuHours * entry.usdPerCuHour + storageUsdPerHour * periodHours(before, before.end).total),
          usage: lastCuHours,
          estimated: true,
          plusVat: false,
        };
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
    detail: databaseBytes === null ? null : { kind: "storageGb" as const, gb: databaseBytes / GB },
    lastMonth,
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
    detail: null,
    // A subscription month is billed whole whatever was sent: the plan's price, the count beside it.
    // The plan is today's — a month switched back from Basic reads at Free's price (§100).
    lastMonth: { period: previousMonth(period), usd: m.usdPerMonth, usage: facts.lastMonth.mailgunSent, estimated: false, plusVat: paid },
  };
  return { ...line, severity: severityOf(line, true) };
}

/**
 * Vercel. On Hobby: free; the build minutes are the ceiling a busy month of pushes meets (§101).
 * On Pro (§NNN): the seats' price, billed whole for the month like Mailgun's, so so far and at the
 * end are the same figure, with VAT on top as the invoice decides; last month is the same plan's
 * price, as Mailgun's is — the plan is today's. The build minutes are still counted, with no
 * ceiling: Pro's is not recorded here, and none is invented.
 */
function vercelLine(facts: MonthCostFacts): MonthCostLine {
  const period = utcMonth(facts.now);
  const pro = facts.vercelPlan.plan === "PRO";
  const use = facts.vercel
    ? usage("buildMinutes", facts.vercel.buildMinutes, period, facts.now, pro ? null : facts.vercelBuildMinutesPerMonth, "plan")
    : null;
  const detail = facts.vercel ? { kind: "deployments" as const, count: facts.vercel.deployments } : null;
  const price = pro ? roundUsd(facts.vercelPlan.usdPerSeatPerMonth * facts.vercelPlan.seats) : 0;
  const line = {
    id: "vercel" as const,
    plan: pro ? "Pro" : "Hobby",
    billing: pro ? ("monthly" as const) : ("free" as const),
    period,
    soFarUsd: price,
    projectedUsd: price,
    estimated: false,
    plusVat: pro,
    usage: use,
    renewsOn: null,
    renewsThisPeriod: false,
    detail,
    lastMonth: pro
      ? { period: previousMonth(period), usd: price, usage: null, estimated: false, plusVat: true }
      : nothingLastMonth(period),
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
  // Last month paid a renewal if the expiry's anniversary fell in it: the same calendar month, a
  // year (or more) before the expiry now in force.
  const before = previousMonth(period);
  const renewedLastMonth =
    !Number.isNaN(expiry) &&
    new Date(expiry).getUTCMonth() === before.start.getUTCMonth() &&
    new Date(expiry).getUTCFullYear() > before.start.getUTCFullYear();
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
    detail: null,
    lastMonth: { period: before, usd: renewedLastMonth ? price : 0, usage: null, estimated: false, plusVat: renewedLastMonth },
  };
  return { ...line, severity: inPeriod ? "watch" : "ok" };
}

/**
 * DeepL: nothing billed; the month's characters as the club counted them (§464), with no monthly
 * ceiling — the key's allowance is a credit given once (§497), so it is the credit, from DeepL's
 * own meter, that the line measures against: used, left, and its level. The level is the line's
 * severity — `low` and `spent` are `act`, `watch` is `watch` — and a configured key whose
 * credit could not be read is «nu știm», never green.
 */
function deeplLine(facts: MonthCostFacts): MonthCostLine {
  const period = utcMonth(facts.now);
  const use = facts.deepl ? usage("characters", facts.deepl.charactersThisMonth, period, facts.now, null, null) : null;
  const { expected, credit } = facts.deeplCredit;
  const line = {
    id: "deepl" as const,
    plan: "API",
    billing: "free" as const,
    period,
    soFarUsd: 0,
    projectedUsd: 0,
    estimated: false,
    plusVat: false,
    usage: use,
    renewsOn: null,
    renewsThisPeriod: false,
    detail: credit ? { kind: "credit" as const, ...credit } : null,
    lastMonth: nothingLastMonth(period),
  };
  const severity: MonthCostLine["severity"] = credit
    ? credit.level === "spent" || credit.level === "low"
      ? "act"
      : credit.level === "watch"
        ? "watch"
        : severityOf(line, facts.deepl !== null)
    : expected
      ? "unknown"
      : severityOf(line, facts.deepl !== null);
  return { ...line, severity };
}

/**
 * Cloudflare R2: free up to its ten GB-month, then priced per GB-month over it. The stored size is
 * a level, not a pace — the month's end is today's size — and the recorded bytes are one variant
 * per picture, so the figure is a lower bound (`storedMediaBytes`). Over the allowance, the month
 * is the excess at the catalogue's rate, spread over the month like Neon's storage; an estimate.
 */
function r2Line(facts: MonthCostFacts): MonthCostLine {
  const period = utcMonth(facts.now);
  const before = previousMonth(period);
  if (!facts.r2) {
    const unread = {
      id: "r2" as const,
      plan: "Free",
      billing: "free" as const,
      period,
      soFarUsd: null,
      projectedUsd: null,
      estimated: false,
      plusVat: false,
      usage: null,
      renewsOn: null,
      renewsThisPeriod: false,
      detail: null,
      lastMonth: { period: before, usd: null, usage: null, estimated: false, plusVat: false },
    };
    return { ...unread, severity: severityOf(unread, false) };
  }
  const gb = facts.r2.storedBytes / GB;
  const monthUsd = Math.max(gb - R2_FREE_STORAGE_GB, 0) * R2_USD_PER_GB_MONTH;
  const { total, elapsed } = periodHours(period, facts.now);
  const billed = monthUsd > 0;
  const use: MonthUsage = {
    unit: "gigabytes",
    used: gb,
    projected: gb,
    ceiling: R2_FREE_STORAGE_GB,
    ceilingKind: "plan",
    dailyCeiling: null,
    state: usageState(gb, R2_FREE_STORAGE_GB),
  };
  const line = {
    id: "r2" as const,
    plan: "Free",
    billing: billed ? ("usage" as const) : ("free" as const),
    period,
    soFarUsd: roundUsd(total > 0 ? (monthUsd * elapsed) / total : 0),
    projectedUsd: roundUsd(monthUsd),
    estimated: billed,
    plusVat: false,
    usage: use,
    renewsOn: null,
    renewsThisPeriod: false,
    detail: null,
    // Nothing keeps last month's size: today's, which only grows, bounds it from above.
    lastMonth: { period: before, usd: roundUsd(monthUsd), usage: null, estimated: billed, plusVat: false },
  };
  return { ...line, severity: severityOf(line, true) };
}

/** One line per provider that bills or meters something, in the cost table's order. */
export function monthCosts(facts: MonthCostFacts): MonthCostLine[] {
  return [domainLine(facts), mailgunLine(facts), vercelLine(facts), neonLine(facts), deeplLine(facts), r2Line(facts)];
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
  /**
   * Some line's amount is unknown — its provider could not be read, or a typed Mailgun plan has no
   * recorded price (§100) — so the total is short by it.
   */
  incomplete: boolean;
  /** The previous period, summed, or null when any line's is unknown (the card prints «—»). */
  lastMonthUsd: number | null;
  /** The lines whose last month nothing kept, in order — what the «—» names. */
  lastMonthMissing: MonthCostId[];
  lastMonthEstimated: boolean;
  lastMonthPlusVat: boolean;
};

export function monthTotals(lines: readonly MonthCostLine[]): MonthTotals {
  let soFar = 0;
  let projected = 0;
  let estimated = false;
  let soFarPlusVat = false;
  let projectedPlusVat = false;
  let incomplete = false;
  let lastMonth = 0;
  let lastMonthEstimated = false;
  let lastMonthPlusVat = false;
  const lastMonthMissing: MonthCostId[] = [];
  for (const line of lines) {
    if (line.lastMonth.usd === null) lastMonthMissing.push(line.id);
    else {
      lastMonth += line.lastMonth.usd;
      if (line.lastMonth.estimated && line.lastMonth.usd > 0) lastMonthEstimated = true;
      if (line.lastMonth.plusVat && line.lastMonth.usd > 0) lastMonthPlusVat = true;
    }
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
  return {
    soFarUsd: roundUsd(soFar),
    projectedUsd: roundUsd(projected),
    estimated,
    soFarPlusVat,
    projectedPlusVat,
    incomplete,
    lastMonthUsd: lastMonthMissing.length > 0 ? null : roundUsd(lastMonth),
    lastMonthMissing,
    lastMonthEstimated,
    lastMonthPlusVat,
  };
}
