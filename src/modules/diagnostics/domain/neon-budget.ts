import type { JobCadenceMinutes } from "@/modules/jobs/schedule";
import { NEON_QUOTA_WARNING_RATIO, neonQuotaRatio } from "./neon-limits";

/**
 * The month's budget, as one word, and what the platform does about each word (§NNN) — pure: no
 * request, no database, no clock of its own.
 *
 * The owner capped both Neon projects (§327: production 100 CU-hours a month, QA 30) knowing that
 * a project that reaches its quota is suspended until the next billing period. The re-measure of
 * 2026-09-26 projected an October at that week's pace reaching production's 100 around the 23rd
 * — four weeks before the race — and found the only warning (§335's 80%) reading a counter that
 * had stopped. So the platform now reads what Neon meters (`neon-meter.ts`), turns it into a
 * level here, and slows itself down as the month runs ahead of the calendar, instead of running
 * at full pace into a wall.
 *
 * ## The levels
 *
 * - `unknown` — nothing could be read (no key, Neon did not answer). Nothing changes: a platform
 *   that throttled itself because a third party had a bad minute would be the governor causing
 *   the outage it exists to prevent.
 * - `unlimited` — the project has no quota. Nothing to run into; the bill is §280's business.
 * - `normal` — the pace fits: this period's spend, carried on at its own average to the period's
 *   end, stays under the quota.
 * - `ahead` — the pace does not fit: at this rate the quota runs out before the period ends. Well
 *   before any share of it is "high"; that is the point of reading the pace.
 * - `tight` — 80% spent (`NEON_QUOTA_WARNING_RATIO`, the same line `/api/health` has degraded at
 *   since §335).
 * - `critical` — 95% spent: the last few hours of compute the period has.
 * - `exhausted` — 100%: Neon has suspended the project (or is about to), and nothing that needs
 *   the database will work until the period ends.
 *
 * The pace is the period's own average, measured over at least a day (`NEON_BUDGET_MIN_PACE_HOURS`)
 * so that the first busy hour of a period — a release, a morning of testing — does not project to
 * a month of that and throttle the platform for nothing.
 */

export const NEON_BUDGET_LEVELS = ["unknown", "unlimited", "normal", "ahead", "tight", "critical", "exhausted"] as const;
export type NeonBudgetLevel = (typeof NEON_BUDGET_LEVELS)[number];

/** The share of the quota past which only the last hours are left. */
export const NEON_BUDGET_CRITICAL_RATIO = 0.95;

/** The shortest stretch a pace is measured over, in hours, however early in the period it is. */
export const NEON_BUDGET_MIN_PACE_HOURS = 24;

export type NeonBudgetInput = {
  usedCuHours: number;
  quotaCuHours: number | null;
  periodStart: Date;
  periodEnd: Date;
  now: Date;
};

export type NeonBudget = {
  level: NeonBudgetLevel;
  /** Share of the quota spent, 0–1 and past it, or null with no quota. */
  ratio: number | null;
  /** Share of the period gone, 0–1. */
  elapsedRatio: number;
  /** CU-hours a day at this period's average pace. */
  cuHoursPerDay: number;
  /** This period's spend at the period's end if the pace holds, or null with no quota. */
  projectedCuHours: number | null;
  /** When the quota runs out at this pace, if that is before the period ends; otherwise null. */
  runsOutAt: Date | null;
};

const HOUR = 3_600_000;

export function neonBudget(input: NeonBudgetInput): NeonBudget {
  const start = input.periodStart.getTime();
  const end = input.periodEnd.getTime();
  const now = input.now.getTime();
  const totalHours = Math.max((end - start) / HOUR, 1);
  const elapsedHours = Math.min(Math.max((now - start) / HOUR, 0), totalHours);
  const leftHours = totalHours - elapsedHours;
  const perHour = input.usedCuHours / Math.max(elapsedHours, NEON_BUDGET_MIN_PACE_HOURS);
  const ratio = neonQuotaRatio(input.usedCuHours, input.quotaCuHours);
  const base = { elapsedRatio: elapsedHours / totalHours, cuHoursPerDay: perHour * 24 };

  if (ratio === null || input.quotaCuHours === null) {
    return { level: "unlimited", ratio: null, projectedCuHours: null, runsOutAt: null, ...base };
  }
  const projectedCuHours = input.usedCuHours + perHour * leftHours;
  const left = input.quotaCuHours - input.usedCuHours;
  const hoursToEmpty = perHour > 0 ? left / perHour : Number.POSITIVE_INFINITY;
  const runsOutAt = left > 0 && hoursToEmpty < leftHours ? new Date(now + hoursToEmpty * HOUR) : null;

  const level: NeonBudgetLevel =
    ratio >= 1
      ? "exhausted"
      : ratio >= NEON_BUDGET_CRITICAL_RATIO
        ? "critical"
        : ratio >= NEON_QUOTA_WARNING_RATIO
          ? "tight"
          : projectedCuHours > input.quotaCuHours
            ? "ahead"
            : "normal";
  return { level, ratio, projectedCuHours, runsOutAt, ...base };
}

/**
 * What the platform does at each level — the governor's whole rulebook, in one table.
 *
 * - `jobFloorMinutes` — a minimum interval between two real runs of each scheduled job, added to
 *   the Administrator's own (`jobs/cadence.ts`; the larger wins). It rides the same floor slots
 *   §334 built, so a ping inside it answers from the cache and wakes nothing. At `ahead` the jobs
 *   look at most once an hour, which is what an idle hour already costs (§355); from `tight` once
 *   every two hours. A later reminder or hand-over is the price, never a place: the allocator
 *   expires holds and offers on every read (AGENTS.md §10.6).
 * - `jobsPaused` — at `exhausted` a ping answers without trying the database at all: it is
 *   suspended, a connection would only fail, and a job endpoint that answers 500 all day is one
 *   cron-job.org disables (§98), which would leave the scheduler off when the period resets.
 * - `healthReuseMinutes` — from `tight`, `/api/health` answers its database half from an answer
 *   up to this old, so a stray caller (the re-measure of 2026-09-26 suspected "`/api/health`
 *   called by something other than the monitor") does not wake the compute for five billed minutes each time. Only an
 *   answer that reached the database is reused; a failure is asked again every time.
 * - `restingCopies` — at `exhausted` a public page serves its last good copy however old it is
 *   (up to a billing period, `SNAPSHOT_MAX_AGE_WHILE_RESTING_HOURS`), and says why.
 */
export type GovernorEffects = {
  jobFloorMinutes: JobCadenceMinutes;
  jobsPaused: boolean;
  healthReuseMinutes: number;
  restingCopies: boolean;
};

export const GOVERNOR_EFFECTS: Record<NeonBudgetLevel, GovernorEffects> = {
  unknown: { jobFloorMinutes: 0, jobsPaused: false, healthReuseMinutes: 0, restingCopies: false },
  unlimited: { jobFloorMinutes: 0, jobsPaused: false, healthReuseMinutes: 0, restingCopies: false },
  normal: { jobFloorMinutes: 0, jobsPaused: false, healthReuseMinutes: 0, restingCopies: false },
  ahead: { jobFloorMinutes: 60, jobsPaused: false, healthReuseMinutes: 0, restingCopies: false },
  tight: { jobFloorMinutes: 120, jobsPaused: false, healthReuseMinutes: 10, restingCopies: false },
  critical: { jobFloorMinutes: 120, jobsPaused: false, healthReuseMinutes: 10, restingCopies: false },
  exhausted: { jobFloorMinutes: 120, jobsPaused: true, healthReuseMinutes: 0, restingCopies: true },
};

export function governorEffects(level: NeonBudgetLevel): GovernorEffects {
  return GOVERNOR_EFFECTS[level];
}

/** The interval a real run plans under: the Administrator's, or the governor's floor when that is longer. */
export function governedCadence(stated: JobCadenceMinutes, floor: JobCadenceMinutes): JobCadenceMinutes {
  return (floor > stated ? floor : stated) as JobCadenceMinutes;
}
