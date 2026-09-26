import { env } from "@/shared/config/env";
import { type GovernorEffects, governorEffects, type NeonBudget, type NeonBudgetLevel, neonBudget } from "./domain/neon-budget";
import { type NeonDeps, type NeonMeter, readNeonMeter } from "./neon";

/**
 * The governor's one question — "how is this month's budget doing, and what do I do about it?" —
 * answered without the database (§NNN).
 *
 * Every caller that changes its behaviour on the budget asks here: a job ping deciding whether to
 * try at all and how long a quiet to plan (`jobs/ping.ts`), `/api/health` deciding whether a
 * stray caller may be answered from a recent answer, the health checks widening their thresholds
 * by the governor's floor, and a public page that found the database away deciding whether it is
 * resting for the month. None of them may wake the compute to find out, and none of them may be
 * the reason a suspended project gets hammered — so the answer comes from Neon's API (a different
 * host, which answers whether or not the compute is up), through the shared fifteen-minute
 * reading (`readNeonMeter`), with a minute of this instance's memory on top so a burst of pings or
 * a page that failed a dozen reads at once asks once.
 *
 * It never throws and never waits long: no key, a refusal or a slow Neon is the level `unknown`,
 * whose effects are none. A governor that throttled the platform because a third party had a bad
 * minute would be causing the outage it exists to prevent.
 */

export type BudgetReading = {
  level: NeonBudgetLevel;
  effects: GovernorEffects;
  /** The arithmetic behind the level, or null when nothing could be read. */
  budget: NeonBudget | null;
  meter: NeonMeter | null;
};

/** How long this instance keeps an answer before asking the shared reading again. */
const MEMO_MS = 60_000;

let memo: { at: number; reading: BudgetReading } | null = null;

const UNKNOWN: BudgetReading = { level: "unknown", effects: governorEffects("unknown"), budget: null, meter: null };

export async function readNeonBudget(now: Date = new Date(), deps: Pick<NeonDeps, "fetchImpl"> = {}): Promise<BudgetReading> {
  if (!env.NEON_API_KEY || !env.NEON_PROJECT_ID) return UNKNOWN;
  if (memo && now.getTime() - memo.at >= 0 && now.getTime() - memo.at < MEMO_MS) return memo.reading;
  let reading = UNKNOWN;
  try {
    const read = await readNeonMeter(env, { ...deps, shared: true }, now);
    if (read.ok) reading = budgetOf(read.meter, now);
  } catch (error) {
    // `readNeonMeter` answers failures as values; anything thrown past it is a bug, and a bug in
    // the governor must not become a failure of the page or the job that asked.
    console.error("[budget] could not read Neon", error);
  }
  memo = { at: now.getTime(), reading };
  return reading;
}

/** The level and its effects for a meter already in hand. */
export function budgetOf(meter: NeonMeter, now: Date): BudgetReading {
  const budget = neonBudget({
    usedCuHours: meter.usedCuHours,
    quotaCuHours: meter.quotaCuHours,
    periodStart: meter.periodStart,
    periodEnd: meter.periodEnd,
    now,
  });
  return { level: budget.level, effects: governorEffects(budget.level), budget, meter };
}

/** For the tests, which must not see one case's answer in the next. */
export function forgetNeonBudget(): void {
  memo = null;
}
