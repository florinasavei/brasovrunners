import { and, eq, gt, sql } from "drizzle-orm";
import { rateLimitBuckets } from "@/db/schema/rate-limit";
import type { Database } from "@/db/types";
import { consumeRateLimit } from "@/modules/rate-limit/service";
import type { BotCheckSignal } from "./domain/turnstile-widget";

/**
 * How often the anti-bot check let people down in the last day (§NNN), for `/api/health`: the held
 * presses the eight-second valve sent because the check never answered, and the widgets that failed
 * or never loaded — as the registration form carried them (`BOT_CHECK_SIGNAL_FIELD`), counted by
 * the register action once the registration went through; no endpoint of its own.
 *
 * No table of its own and no migration: the throttle's hourly buckets (`rate_limit_buckets`,
 * AGENTS.md §19.4) already are a counter per word per hour, written in one atomic statement, and
 * the retention sweep already deletes them a day after they start — exactly the window reported.
 * The key is the signal's own word, never an address, an IP or a page: level-only, nothing about
 * who. Counting goes through `consumeRateLimit` under the scope `bot-check-signal`, whose limit is
 * never enforced — the verdict is ignored; the bucket is the figure.
 */
export const BOT_CHECK_SIGNAL_SCOPE = "bot-check-signal" as const;

/** Count one signal in the current hour. */
export async function recordBotCheckSignal<T extends Record<string, unknown>>(
  db: Database<T>,
  signal: BotCheckSignal,
  now: Date,
): Promise<void> {
  await consumeRateLimit(db, BOT_CHECK_SIGNAL_SCOPE, signal, now);
}

export type BotCheckSignalCounts = { heldPressValve: number; widgetFailed: number };

/**
 * What `/api/health` publishes in place of a count (§NNN): the body is readable by anyone, and a
 * raw daily count of held presses is a lower bound on the club's registrations that day. A level
 * says whether the owner should look — `none`, `some` (1–4), `many` (5 or more) — and nothing more.
 */
export type BotCheckSignalLevel = "none" | "some" | "many";
export type BotCheckSignalLevels = { heldPressValve: BotCheckSignalLevel; widgetFailed: BotCheckSignalLevel };

export const BOT_CHECK_SIGNAL_MANY = 5;

export function botCheckSignalLevel(count: number): BotCheckSignalLevel {
  if (count >= BOT_CHECK_SIGNAL_MANY) return "many";
  return count > 0 ? "some" : "none";
}

export function botCheckSignalLevels(counts: BotCheckSignalCounts): BotCheckSignalLevels {
  return { heldPressValve: botCheckSignalLevel(counts.heldPressValve), widgetFailed: botCheckSignalLevel(counts.widgetFailed) };
}

const DAY_MS = 24 * 60 * 60_000;

/**
 * Each signal's count over the hourly windows that started in the last 24 hours. One query; a
 * signal with no row is 0.
 */
export async function countBotCheckSignals<T extends Record<string, unknown>>(
  db: Database<T>,
  now: Date,
): Promise<BotCheckSignalCounts> {
  const rows = await db
    .select({ key: rateLimitBuckets.key, count: sql<number>`coalesce(sum(${rateLimitBuckets.count}), 0)::int` })
    .from(rateLimitBuckets)
    .where(and(eq(rateLimitBuckets.scope, BOT_CHECK_SIGNAL_SCOPE), gt(rateLimitBuckets.windowStartsAt, new Date(now.getTime() - DAY_MS))))
    .groupBy(rateLimitBuckets.key);
  const of = (signal: BotCheckSignal) => Number(rows.find((row) => row.key === signal)?.count ?? 0);
  return { heldPressValve: of("held-press-valve"), widgetFailed: of("widget-failed") };
}
