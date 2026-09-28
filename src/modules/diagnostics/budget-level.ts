import type { NeonBudgetLevel } from "./domain/neon-budget";

/**
 * The month's budget level this instance last read — what a public page's render is told, never
 * asked for (§447; since §NNN, a review finding, without a request of its own).
 *
 * ## Why a page never asks
 *
 * The public cache stretches its ceiling by the level and, at red, answers a miss from the cache
 * alone (`public-cache/cache.ts`); the resting page names the period's end from it
 * (`resilience/last-good.ts`). Both run inside a static page's render (ISR, §NNN), and a request to
 * Neon's API made there is the render's own: the shared reading's `next: { revalidate: 900 }`
 * lowered the page's lifetime to fifteen minutes, and a no-store one would have turned the page
 * dynamic («Page changed from static to dynamic at runtime»). So this module holds the answer and
 * makes no request; nothing a static route imports reaches `neon.ts`
 * (`tests/unit/public-cache/static-public-routes.test.ts` walks it).
 *
 * ## Who tells it
 *
 * Every reading of the governor (`readNeonBudget`, `neon-budget.ts`) notes its answer here — above
 * all the job pinger's, which reads it on every ping (every fifteen minutes by day, hourly at
 * night, `SETUP.md` §40), and the backoffice pages that show the budget. On Vercel the public pages
 * and the job routes are served by the same functions, so the instance that renders a page has
 * usually heard the level from the last ping.
 *
 * ## When it is not believed
 *
 * An answer older than `KNOWN_LEVEL_MAX_AGE_MS`, or from a billing period that has ended, is no
 * answer: `unknown`, whose effects are none — the platform behaves as in a green month, which costs
 * at most a wake, never a page. A cold instance that has heard nothing reads `unknown` too, as
 * before.
 */

export type KnownBudget = {
  level: NeonBudgetLevel;
  /** The quota is spent: Neon has suspended the project, or is about to. */
  spent: boolean;
  /** The billing period's end, when the reading had a meter; after it the reading is void. */
  periodEnd: Date | null;
  /** When it was read, in epoch milliseconds. */
  at: number;
};

/**
 * How long a noted level is believed: three hours — the pinger's night cadence (hourly) three times
 * over, so a missed ping or two does not drop the governor, and short enough that a level from
 * before an Administrator's own change of plan does not linger for the day.
 */
export const KNOWN_LEVEL_MAX_AGE_MS = 3 * 60 * 60 * 1000;

let known: KnownBudget | null = null;

/** What a governor reading tells this module: its level, and when it had one, the budget and the meter. */
export type NotedReading = {
  level: NeonBudgetLevel;
  budget: { spent: boolean } | null;
  meter: { periodEnd: Date } | null;
};

/** Note a governor reading as the instance's last known level. */
export function noteBudgetReading(reading: NotedReading, now: Date = new Date()): void {
  known = { level: reading.level, spent: reading.budget?.spent ?? false, periodEnd: reading.meter?.periodEnd ?? null, at: now.getTime() };
}

/** The last known reading, or null when there is none worth believing (above). Never a request. */
export function lastKnownBudget(now: Date = new Date()): KnownBudget | null {
  if (!known) return null;
  const age = now.getTime() - known.at;
  if (age < 0 || age >= KNOWN_LEVEL_MAX_AGE_MS) return null;
  if (known.periodEnd && now.getTime() >= known.periodEnd.getTime()) return null;
  return known;
}

/** The level for the public cache, without waiting and without a request: `unknown` when nothing is believed. */
export function peekNeonBudgetLevel(now: Date = new Date()): NeonBudgetLevel {
  return lastKnownBudget(now)?.level ?? "unknown";
}

/** For the tests, and for a saved threshold (`budget-thresholds.ts`): the next reading starts afresh. */
export function forgetKnownBudget(): void {
  known = null;
}
