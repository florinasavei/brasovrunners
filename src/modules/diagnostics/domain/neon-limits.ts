import { z } from "zod";
import type { AppEnvironment } from "@/shared/config/env-enums";
import type { NeonMeterSource } from "./neon-meter";
import { NEON_PLANS, type NeonPlanId, roundUsd } from "./neon-plan";

/**
 * The two brakes the club can put on its own Neon bill from `/admin/tasks` → Costuri (§335):
 * how large the database's compute may grow, and how many CU-hours a billing period may spend
 * before Neon stops it. Pure rules — no request, no database — so the page, the service and the
 * tests agree on them.
 *
 * The owner, 2026-09-23, after $1.09 in two days of Launch: "I want toggles in my admin area, so
 * I can throttle myself when needed". What was measured that evening decides what each brake is
 * for. Both computes average about 0.26 CU while awake, so the **size ceiling** does not change
 * the steady bill — the bill is the time awake, which Launch's fixed five-minute idle timeout and
 * the monitors' cadence decide (§280) — it bounds a spike: a runaway query at 8 CU costs 32 times
 * what it costs at 0.25. The **monthly limit** is the only hard cap Neon offers, and it is a cap
 * by switching the site off: when the project's compute time reaches it, Neon suspends every
 * compute until the next billing period, and a suspended project does not wake on the next
 * connection (neon.com/docs/guides/consumption-limits). On production that is registrations, the
 * race-day desk and the emails gone until the first of the month — and the owner capped
 * production anyway, the same night ("I want QA to be cheaper and also Prod to be capped, not ok
 * to leave to unlimited"; `SETUP.md` §40, 100 CU-hours there and 30 on QA). So the page
 * recommends a limit with room plus Neon's own spending alert on every environment, and on
 * production a new or changed limit asks for a ticked confirmation: a guard on the click, not
 * advice against the limit.
 */

/** The floor stays where it is: the site idles at the smallest compute Neon has. */
export const NEON_MIN_CU = 0.25;

/**
 * The ceilings on offer. Neon moves in quarter-CU steps and allows at most 8 CU between the
 * floor and the ceiling; these six are the ones a person can tell apart, and 8 is 7.75 above the
 * floor, inside that rule.
 */
export const NEON_MAX_CU_STEPS = [0.25, 0.5, 1, 2, 4, 8] as const;
export type NeonMaxCu = (typeof NEON_MAX_CU_STEPS)[number];

/** One CU is about 4 GB of memory, with the CPU to match (neon.com/docs, checked 2026-09-23). */
export const NEON_GB_RAM_PER_CU = 4;

/**
 * How far each plan lets a compute autoscale (neon.com/pricing, checked 2026-09-23): Free up to
 * 2 CU, Launch up to 16. A ceiling above the plan's is not offered, because Neon would refuse it.
 */
export const NEON_AUTOSCALING_CEILING_CU: Record<NeonPlanId, number> = { FREE: 2, LAUNCH: 16 };

/**
 * A new or changed limit must clear what this period has already spent by this much, or it
 * suspends the database the moment it is saved — or a few minutes later, which is the same
 * mistake found after the page has been closed. Five CU-hours is about a day of the club's awake
 * time.
 */
export const NEON_QUOTA_MARGIN_CU_HOURS = 5;

/** A limit larger than this is a typo: 8 CU awake every hour of a month is under 6,000. */
export const NEON_QUOTA_MAX_CU_HOURS = 10_000;

/**
 * The limit the card recommends, per environment — what the owner set on Neon on 2026-09-23
 * (`SETUP.md` §40): 100 CU-hours on production, which lets it average 3.3 CU-hours a day for a
 * whole month, close to the 4 a day measured on days of two people testing all day and well
 * above an ordinary day; 30 on QA, which nobody registers on. Advice printed on the card, never
 * a value the form sends by itself.
 */
export function recommendedNeonQuotaCuHours(appEnv: AppEnvironment): number {
  return appEnv === "production" ? 100 : 30;
}

/**
 * 80%: the one share of a quota that both `/api/health`'s early warning and the derived
 * `neonLimits` row on `/admin/tasks` read the period's spend against (§335). Neon suspends the
 * whole database at 100% — every page down until the next billing period — so there has to be
 * one formula that decides "close to it", or the two could disagree the day it matters.
 */
export const NEON_QUOTA_WARNING_RATIO = 0.8;

/** How much of a quota this period has spent, 0–1, or null when there is no quota to spend against. */
export function neonQuotaRatio(usedCuHours: number, quotaCuHours: number | null): number | null {
  return quotaCuHours === null || quotaCuHours <= 0 ? null : usedCuHours / quotaCuHours;
}

/** Whether the spend has reached the warning share of the quota — the one test both readers make. */
export function isNeonQuotaNearLimit(usedCuHours: number, quotaCuHours: number | null): boolean {
  const ratio = neonQuotaRatio(usedCuHours, quotaCuHours);
  return ratio !== null && ratio >= NEON_QUOTA_WARNING_RATIO;
}

/** The month the worst cases are priced over — the same thirty days the cost row projects to. */
export const NEON_MONTH_HOURS = 30 * 24;

/** What Neon says about the project's brakes, read by `readNeonLimits` (`neon.ts`). */
export type NeonLimitsReading = {
  /** The read-write computes, one per branch — the club has one. Read replicas are not brakes. */
  computes: ReadonlyArray<{ id: string; minCu: number; maxCu: number }>;
  /** What a compute created again would get (`default_endpoint_settings`), or null when unset. */
  defaults: { minCu: number | null; maxCu: number | null };
  /** The period's compute-time limit in CU-hours, or null when there is none (absent or zero). */
  quotaCuHours: number | null;
  usedCuHours: number;
  activeHours: number;
  periodEnd: Date;
  reportedPlan: NeonPlanId | null;
  /** Which of Neon's readings `usedCuHours` is (§447, `neon-meter.ts`); absent is the project row's own counter. */
  usedSource?: NeonMeterSource;
};

/** What one ceiling costs at worst, at Launch's rate from the one catalogue. */
export type NeonCeilingPrice = {
  cu: number;
  ramGb: number;
  /** The most an hour awake can cost at this size, in USD — unrounded, the page picks the digits. */
  usdPerHour: number;
  /** The same hour, every hour of a thirty-day month: the bill if the compute never slept at the ceiling. */
  usdPerMonth: number;
};

export function priceCeiling(cu: number): NeonCeilingPrice {
  const rate = NEON_PLANS.LAUNCH.usdPerCuHour;
  return {
    cu,
    ramGb: cu * NEON_GB_RAM_PER_CU,
    usdPerHour: cu * rate,
    usdPerMonth: roundUsd(cu * rate * NEON_MONTH_HOURS),
  };
}

/** The ceilings the form offers under a plan: every step up to the plan's own autoscaling limit. */
export function offeredCeilings(plan: NeonPlanId | null): NeonCeilingPrice[] {
  const limit = plan ? NEON_AUTOSCALING_CEILING_CU[plan] : Number.POSITIVE_INFINITY;
  return NEON_MAX_CU_STEPS.filter((cu) => cu <= limit).map(priceCeiling);
}

/**
 * The card's readout, as numbers: the ceiling in force and what it costs at worst, the limit and
 * how much of it is spent, and the smallest limit the form would accept.
 *
 * The ceiling in force is the largest among the read-write computes — the worst case is what a
 * brake is for — and `mixed` says when they (or the project default) disagree, so the page can
 * name the default instead of letting a recreated compute surprise anybody.
 */
export type NeonLimitsModel = {
  maxCu: number | null;
  price: NeonCeilingPrice | null;
  computeCount: number;
  defaults: { minCu: number | null; maxCu: number | null };
  /** Whether the computes and the project default do not all share one ceiling. */
  mixed: boolean;
  quotaCuHours: number | null;
  usedCuHours: number;
  activeHours: number;
  periodEnd: Date;
  /** The smallest limit the form accepts, to one decimal: above what is spent plus the margin. */
  smallestQuotaCuHours: number;
};

export function describeNeonLimits(reading: NeonLimitsReading): NeonLimitsModel {
  const maxes = reading.computes.map((compute) => compute.maxCu);
  const maxCu = maxes.length > 0 ? Math.max(...maxes) : null;
  const ceilings = new Set([...maxes, ...(reading.defaults.maxCu === null ? [] : [reading.defaults.maxCu])]);
  return {
    maxCu,
    price: maxCu === null ? null : priceCeiling(maxCu),
    computeCount: reading.computes.length,
    defaults: reading.defaults,
    mixed: ceilings.size > 1,
    quotaCuHours: reading.quotaCuHours,
    usedCuHours: reading.usedCuHours,
    activeHours: reading.activeHours,
    periodEnd: reading.periodEnd,
    smallestQuotaCuHours: smallestQuota(reading.usedCuHours),
  };
}

/**
 * The first tenth of a CU-hour strictly above what is spent plus the margin, so "at least this"
 * on the page is a figure the form accepts and the tenth below it is one it refuses.
 */
function smallestQuota(usedCuHours: number): number {
  const threshold = usedCuHours + NEON_QUOTA_MARGIN_CU_HOURS;
  const tenths = Math.ceil(threshold * 10);
  return (tenths / 10 > threshold ? tenths : tenths + 1) / 10;
}

/**
 * What the form posts, as the service receives it. Strings, because a form posts strings; the
 * number accepts a decimal comma, because a Romanian keyboard types one.
 */
export const neonLimitsFormSchema = z
  .object({
    maxCu: z.union([z.string(), z.number()]),
    quotaMode: z.enum(["none", "limit"]),
    quotaCuHours: z.union([z.string(), z.number()]).nullish(),
    confirmSuspension: z.boolean().default(false),
  })
  .strict();

export type NeonLimitsRequest = {
  maxCu: NeonMaxCu;
  /** CU-hours for the period, or null for no limit. */
  quotaCuHours: number | null;
  confirmSuspension: boolean;
};

function decimal(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim().replace(",", ".");
  if (text === "" || !/^\d+(\.\d+)?$/.test(text)) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

/**
 * The shape check: a ceiling that is one of the six, and a limit that is a positive number of
 * CU-hours when a limit is asked for. The names in `fields` are the form's own boxes.
 */
export function parseNeonLimitsRequest(raw: unknown): { ok: true; request: NeonLimitsRequest } | { ok: false; fields: string[] } {
  const parsed = neonLimitsFormSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, fields: [...new Set(parsed.error.issues.map((issue) => String(issue.path[0] ?? "")))].filter(Boolean) };
  }
  const fields: string[] = [];
  const maxCu = decimal(parsed.data.maxCu);
  if (maxCu === null || !(NEON_MAX_CU_STEPS as readonly number[]).includes(maxCu)) fields.push("maxCu");
  let quotaCuHours: number | null = null;
  if (parsed.data.quotaMode === "limit") {
    quotaCuHours = decimal(parsed.data.quotaCuHours);
    if (quotaCuHours === null || quotaCuHours <= 0 || quotaCuHours > NEON_QUOTA_MAX_CU_HOURS) fields.push("quotaCuHours");
  }
  if (fields.length > 0) return { ok: false, fields };
  return { ok: true, request: { maxCu: maxCu as NeonMaxCu, quotaCuHours, confirmSuspension: parsed.data.confirmSuspension } };
}

/** Why a well-formed request is still refused, as the code the backoffice translates (`Admin.errors`). */
export type NeonLimitsRuleRefusal =
  | { code: "VALIDATION_ERROR"; field: "maxCu" }
  | { code: "NEON_QUOTA_BELOW_USAGE"; field: "quotaCuHours" }
  | { code: "NEON_QUOTA_UNCONFIRMED"; field: "confirmSuspension" }
  | { code: "NEON_QUOTA_REMOVAL_UNCONFIRMED"; field: "confirmSuspension" };

/**
 * The rules a request meets against what Neon says right now, in the order they are told:
 *
 * 1. A ceiling above the plan's own autoscaling limit — Neon would refuse it.
 * 2. A new or changed limit at or below what is spent plus the margin — it would stop the
 *    database on saving.
 * 3. A new or changed limit on production without the ticked confirmation — the site stops when
 *    it is reached.
 * 4. Removing the limit production holds ("Fără limită") without the same ticked confirmation —
 *    production then has no cap at all, which the owner refused ("not ok to leave to unlimited",
 *    §327). The same box as 3, because it is the same act: changing production's cap.
 *
 * A limit Neon already holds, posted back to the second (`quotaBoxValue`), is neither new nor
 * changed: 2, 3 and 4 are about what this save does, and keeping the limit in force does nothing.
 * So throttling the size alone on production, with the quota box untouched, needs no
 * confirmation — and it is not refused when the period is already close to the limit, which is
 * exactly when somebody reaches for the size. "No limit" posted where there was none is no change
 * either, and asks nothing.
 */
export function checkNeonLimits(
  request: NeonLimitsRequest,
  context: { usedCuHours: number; quotaCuHours: number | null; plan: NeonPlanId | null; appEnv: AppEnvironment },
): NeonLimitsRuleRefusal | null {
  if (context.plan && request.maxCu > NEON_AUTOSCALING_CEILING_CU[context.plan]) return { code: "VALIDATION_ERROR", field: "maxCu" };
  const quotaChanges = cuHoursToSeconds(request.quotaCuHours) !== cuHoursToSeconds(context.quotaCuHours);
  if (request.quotaCuHours !== null && quotaChanges) {
    if (request.quotaCuHours <= context.usedCuHours + NEON_QUOTA_MARGIN_CU_HOURS) {
      return { code: "NEON_QUOTA_BELOW_USAGE", field: "quotaCuHours" };
    }
    if (context.appEnv === "production" && !request.confirmSuspension) {
      return { code: "NEON_QUOTA_UNCONFIRMED", field: "confirmSuspension" };
    }
  }
  if (request.quotaCuHours === null && quotaChanges && context.appEnv === "production" && !request.confirmSuspension) {
    return { code: "NEON_QUOTA_REMOVAL_UNCONFIRMED", field: "confirmSuspension" };
  }
  return null;
}

/** CU-hours to the seconds Neon's quota counts, and back; zero is Neon's word for "no limit". */
export function cuHoursToSeconds(cuHours: number | null): number {
  return cuHours === null ? 0 : Math.round(cuHours * 3600);
}

export function secondsToCuHours(seconds: unknown): number | null {
  return typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0 ? seconds / 3600 : null;
}

/**
 * What the quota box shows for a limit Neon holds: the CU-hours to four decimals at most, which
 * `cuHoursToSeconds` turns back into exactly the seconds Neon holds (four decimals are within
 * 0.18 of a second). A box rounded to a tenth would rewrite a quota set in odd seconds — 100000,
 * say, shown as 27.8 and sent back as 100080 — on a save that only meant to change the size.
 * A whole number of CU-hours, which is what the card and `SETUP.md` §40 set, shows as itself.
 */
export function quotaBoxValue(quotaCuHours: number | null): string {
  return quotaCuHours === null ? "" : String(Number(quotaCuHours.toFixed(4)));
}
