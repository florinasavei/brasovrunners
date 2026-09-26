import { env } from "@/shared/config/env";
import { cachedBudgetThresholds } from "./budget-thresholds";
import {
  type BudgetThresholds,
  DEFAULT_BUDGET_THRESHOLDS,
  type GovernorEffects,
  governorEffects,
  type NeonBudget,
  type NeonBudgetLevel,
  neonBudget,
} from "./domain/neon-budget";
import { type NeonDeps, type NeonMeter, readNeonMeter } from "./neon";

/**
 * The governor's one question — "how is this month's budget doing, and what do I do about it?" —
 * answered without the database (§NNN).
 *
 * Every caller that changes its behaviour on the budget asks here: a job ping deciding how long a
 * quiet to plan (`jobs/ping.ts`), `/api/health` deciding whether a stray caller may be answered
 * from a recent answer, the health checks widening their thresholds by the governor's floor, the
 * public cache stretching its safety-net lifetime, and a public page that found the database away
 * deciding whether it is resting for the month. None of them may wake the compute to find out, so
 * the answer comes from Neon's API (a different host, which answers whether or not the compute is
 * up), through the shared fifteen-minute reading (`readNeonMeter`), with a minute of this
 * instance's memory on top so a burst of pings or page views asks once.
 *
 * It never throws: no key, a refusal or a slow Neon is the level `unknown`, whose effects are none.
 */

export type BudgetReading = {
  level: NeonBudgetLevel;
  effects: GovernorEffects;
  /** The arithmetic behind the level, or null when nothing could be read. */
  budget: NeonBudget | null;
  meter: NeonMeter | null;
  thresholds: BudgetThresholds;
};

type BudgetDeps = Pick<NeonDeps, "fetchImpl"> & { thresholds?: () => Promise<BudgetThresholds> };

/** How long this instance keeps an answer before asking the shared reading again. */
const MEMO_MS = 60_000;

let memo: { at: number; reading: BudgetReading } | null = null;
let refreshing: Promise<BudgetReading> | null = null;

const unknownReading = (thresholds: BudgetThresholds = DEFAULT_BUDGET_THRESHOLDS): BudgetReading => ({
  level: "unknown",
  effects: governorEffects("unknown"),
  budget: null,
  meter: null,
  thresholds,
});

export async function readNeonBudget(now: Date = new Date(), deps: BudgetDeps = {}): Promise<BudgetReading> {
  if (!env.NEON_API_KEY || !env.NEON_PROJECT_ID) return unknownReading();
  if (memo && now.getTime() - memo.at >= 0 && now.getTime() - memo.at < MEMO_MS) return memo.reading;
  let reading = unknownReading();
  try {
    const [read, thresholds] = await Promise.all([
      readNeonMeter(env, { ...deps, shared: true }, now),
      (deps.thresholds ?? cachedBudgetThresholds)(),
    ]);
    reading = read.ok ? budgetOf(read.meter, now, thresholds) : unknownReading(thresholds);
  } catch (error) {
    // `readNeonMeter` answers failures as values; anything thrown past it is a bug, and a bug in
    // the governor must not become a failure of the page or the job that asked.
    console.error("[budget] could not read Neon", error);
  }
  memo = { at: now.getTime(), reading };
  return reading;
}

/**
 * The level this instance last read, without waiting — for the public cache, which asks on every
 * read and must never make a visitor wait on Neon's API. A stale or missing memo starts one
 * refresh in the background and answers what it has (`unknown` on a cold instance: no effect).
 */
export function peekNeonBudgetLevel(now: Date = new Date()): NeonBudgetLevel {
  const fresh = memo && now.getTime() - memo.at >= 0 && now.getTime() - memo.at < MEMO_MS;
  if (!fresh && !refreshing) {
    refreshing = readNeonBudget(now).finally(() => {
      refreshing = null;
    });
  }
  return memo?.reading.level ?? "unknown";
}

/** The level and its effects for a meter already in hand. */
export function budgetOf(meter: NeonMeter, now: Date, thresholds: BudgetThresholds = DEFAULT_BUDGET_THRESHOLDS): BudgetReading {
  const budget = neonBudget({
    usedCuHours: meter.usedCuHours,
    quotaCuHours: meter.quotaCuHours,
    periodStart: meter.periodStart,
    periodEnd: meter.periodEnd,
    now,
    thresholds,
  });
  return { level: budget.level, effects: governorEffects(budget.level), budget, meter, thresholds };
}

/** For the tests, which must not see one case's answer in the next. */
export function forgetNeonBudget(): void {
  memo = null;
}
