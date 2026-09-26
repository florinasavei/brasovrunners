import type { JobCadenceMinutes } from "@/modules/jobs/schedule";
import { neonQuotaRatio } from "./neon-limits";

/**
 * The month's budget as one of three colours, and what the platform does at each (§447) — pure:
 * no request, no database, no clock of its own.
 *
 * The owner capped both Neon projects (§327: production 100 CU-hours a month, QA 30) knowing that
 * a project that reaches its quota is suspended until the next billing period. The re-measure of
 * 2026-09-26 projected an October at that week's pace reaching production's 100 around the 23rd
 * — four weeks before the race — and found the only warning (§335's 80%) reading a counter that
 * had stopped. The owner: "keep the site running even if hitting Neon limits, but start
 * throttling earlier". So the platform reads what Neon meters (`neon-meter.ts`), compares it with
 * the month's pro-rated line here, and slows itself down well before the wall.
 *
 * ## The levels
 *
 * - `green` — on or under the line, and under the amber share of the quota. Nothing changes. A
 *   project with no quota is green too: there is nothing to run into.
 * - `amber` — ahead of the line by more than `BUDGET_AHEAD_MARGIN` (a quarter), or past the amber
 *   share of the quota (60% by default). The platform looks less often.
 * - `red` — past the red share of the quota (85% by default). The platform looks as rarely as it
 *   safely can, and `/api/health` degrades so the monitor rings (§98).
 * - `unknown` — nothing could be read (no key, Neon did not answer). Nothing changes: a platform
 *   that throttled itself because a third party had a bad minute would be the governor causing
 *   the outage it exists to prevent.
 *
 * **The line** is the quota times the share of the period gone: at noon on the 16th of a
 * thirty-day month it is half the quota. Early in the period the share is measured over at least
 * `NEON_BUDGET_MIN_PACE_HOURS`, so the first busy hour of a month (a release, a morning of
 * testing) is not read as a month of that.
 *
 * The two shares are the Administrator's to move on `/admin/tasks` → Costuri
 * (`diagnostics/budget-thresholds.ts`, audited, like §334's interval); the margin is not — it is
 * what "ahead of the line" means, not a dial.
 */

export const NEON_BUDGET_LEVELS = ["unknown", "green", "amber", "red"] as const;
export type NeonBudgetLevel = (typeof NEON_BUDGET_LEVELS)[number];

/** How far past the pro-rated line the spend may run before the month is "ahead" — a quarter. */
export const BUDGET_AHEAD_MARGIN = 0.25;

/**
 * The shares of the quota that turn the level amber and red, as whole percents. 60 leaves about
 * twelve days of this week's 4.4 CU-hours a day before production's 100; 85 leaves three and a
 * half — enough for the owner to raise the quota after the monitor rings.
 */
export type BudgetThresholds = { amberPercent: number; redPercent: number };
export const DEFAULT_BUDGET_THRESHOLDS: BudgetThresholds = { amberPercent: 60, redPercent: 85 };

/** The shortest stretch the line and the pace are measured over, in hours, however early in the period it is. */
export const NEON_BUDGET_MIN_PACE_HOURS = 24;

const HOUR = 3_600_000;

/** The share of the period gone, 0–1, never less than `NEON_BUDGET_MIN_PACE_HOURS` of it. */
function elapsedShare(periodStart: Date, periodEnd: Date, now: Date): { share: number; paceShare: number; totalHours: number; elapsedHours: number } {
  const totalHours = Math.max((periodEnd.getTime() - periodStart.getTime()) / HOUR, 1);
  const elapsedHours = Math.min(Math.max((now.getTime() - periodStart.getTime()) / HOUR, 0), totalHours);
  return {
    share: elapsedHours / totalHours,
    paceShare: Math.min(Math.max(elapsedHours, NEON_BUDGET_MIN_PACE_HOURS), totalHours) / totalHours,
    totalHours,
    elapsedHours,
  };
}

/**
 * GREEN, AMBER or RED for this spend at this instant — the brief's function, the whole rule.
 * `quota` null or zero is no limit: green.
 */
export function budgetLevel(
  metered: number,
  quota: number | null,
  periodStart: Date,
  periodEnd: Date,
  now: Date,
  thresholds: BudgetThresholds = DEFAULT_BUDGET_THRESHOLDS,
): Exclude<NeonBudgetLevel, "unknown"> {
  const ratio = neonQuotaRatio(metered, quota);
  if (ratio === null) return "green";
  if (ratio * 100 >= thresholds.redPercent) return "red";
  if (ratio * 100 >= thresholds.amberPercent) return "amber";
  const { paceShare } = elapsedShare(periodStart, periodEnd, now);
  return ratio > paceShare * (1 + BUDGET_AHEAD_MARGIN) ? "amber" : "green";
}

export type NeonBudgetInput = {
  usedCuHours: number;
  quotaCuHours: number | null;
  periodStart: Date;
  periodEnd: Date;
  now: Date;
  thresholds?: BudgetThresholds;
};

export type NeonBudget = {
  level: Exclude<NeonBudgetLevel, "unknown">;
  /** Share of the quota spent, 0–1 and past it, or null with no quota. */
  ratio: number | null;
  /** The pro-rated line now, in CU-hours: the quota times the share of the period gone; null with no quota. */
  lineCuHours: number | null;
  /** Share of the period gone, 0–1. */
  elapsedRatio: number;
  /** CU-hours a day at this period's average pace. */
  cuHoursPerDay: number;
  /** This period's spend at the period's end if the pace holds, or null with no quota. */
  projectedCuHours: number | null;
  /** When the quota runs out at this pace, if that is before the period ends; otherwise null. */
  runsOutAt: Date | null;
  /** The quota is spent: Neon has suspended the project, or is about to. */
  spent: boolean;
};

export function neonBudget(input: NeonBudgetInput): NeonBudget {
  const { share, totalHours, elapsedHours } = elapsedShare(input.periodStart, input.periodEnd, input.now);
  const perHour = input.usedCuHours / Math.max(elapsedHours, NEON_BUDGET_MIN_PACE_HOURS);
  const ratio = neonQuotaRatio(input.usedCuHours, input.quotaCuHours);
  const level = budgetLevel(input.usedCuHours, input.quotaCuHours, input.periodStart, input.periodEnd, input.now, input.thresholds);
  const base = { level, elapsedRatio: share, cuHoursPerDay: perHour * 24 };

  if (ratio === null || input.quotaCuHours === null) {
    return { ...base, ratio: null, lineCuHours: null, projectedCuHours: null, runsOutAt: null, spent: false };
  }
  const leftHours = totalHours - elapsedHours;
  const left = input.quotaCuHours - input.usedCuHours;
  const hoursToEmpty = perHour > 0 ? left / perHour : Number.POSITIVE_INFINITY;
  return {
    ...base,
    ratio,
    lineCuHours: input.quotaCuHours * share,
    projectedCuHours: input.usedCuHours + perHour * leftHours,
    runsOutAt: left > 0 && hoursToEmpty < leftHours ? new Date(input.now.getTime() + hoursToEmpty * HOUR) : null,
    spent: ratio >= 1,
  };
}

/**
 * What the platform does at each level — the governor's whole rulebook, in one table. Every effect
 * is applied without the database: it is read with the metered figure, from Neon's API.
 *
 * - `jobFloorMinutes` — a minimum interval between two real runs of each scheduled job, added to
 *   the Administrator's own (`jobs/cadence.ts`; the longer wins). It rides the floor slots §334
 *   built, so a ping inside it answers from the cache and wakes nothing. Amber: once an hour,
 *   which is what an idle hour already costs (§355). Red: once every two hours. A later reminder
 *   or hand-over is the price, never a place: the allocator expires holds and offers on every
 *   read (AGENTS.md §10.6).
 * - `healthReuseMinutes` — at red, `/api/health` answers its database half from an answer up to
 *   this old, so a stray caller (the re-measure suspected "`/api/health` called by something other
 *   than the monitor") does not wake the compute for five billed minutes each time. Only an answer
 *   that reached the database is reused.
 * - `cacheCeilingFactor` — the public data cache's safety-net lifetime (§333, a day) is multiplied
 *   by this: two at amber, four at red. A write still expires what it changed at once (§28: a
 *   cancelled event never reads as scheduled); only the refetch nobody asked for waits longer.
 * - `publicMissRefreshMinutes` — at red, anonymous traffic is served from the cache only: a public
 *   read that misses the data cache never asks the database in the request. It is answered from
 *   the read's last good copy, or — with none — the page sends the reader to the short resting
 *   page (200, `Retry-After`), and the read is refreshed in the background at the next allowed
 *   moment: at most one wave of refreshes per this many minutes per instance, or at once after a
 *   write this instance made (that write already woke the compute). Zero: a miss reads as always.
 *
 * The outbox is not in the table: its drain after a request runs inside the wake that request
 * already paid for (§68), so holding it for the scheduler would delay the club's mail and save
 * nothing.
 */
export type GovernorEffects = {
  jobFloorMinutes: JobCadenceMinutes;
  healthReuseMinutes: number;
  cacheCeilingFactor: number;
  publicMissRefreshMinutes: number;
};

export const GOVERNOR_EFFECTS: Record<NeonBudgetLevel, GovernorEffects> = {
  unknown: { jobFloorMinutes: 0, healthReuseMinutes: 0, cacheCeilingFactor: 1, publicMissRefreshMinutes: 0 },
  green: { jobFloorMinutes: 0, healthReuseMinutes: 0, cacheCeilingFactor: 1, publicMissRefreshMinutes: 0 },
  amber: { jobFloorMinutes: 60, healthReuseMinutes: 0, cacheCeilingFactor: 2, publicMissRefreshMinutes: 0 },
  red: { jobFloorMinutes: 120, healthReuseMinutes: 10, cacheCeilingFactor: 4, publicMissRefreshMinutes: 10 },
};

export function governorEffects(level: NeonBudgetLevel): GovernorEffects {
  return GOVERNOR_EFFECTS[level];
}

/** The interval a real run plans under: the Administrator's, or the governor's floor when that is longer. */
export function governedCadence(stated: JobCadenceMinutes, floor: JobCadenceMinutes): JobCadenceMinutes {
  return (floor > stated ? floor : stated) as JobCadenceMinutes;
}
