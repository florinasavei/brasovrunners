import { sql } from "drizzle-orm";
import { check, integer, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

/**
 * A small database-backed throttle (AGENTS.md §19.4: "no Redis for V1").
 *
 * Fixed-window counting: `scope` names the guarded action (e.g. `registration-submit`), `key`
 * is what is being limited (a canonical email — §19.4 forbids IP/device as participant
 * identity), and `window_starts_at` is the current window's start, truncated by
 * `modules/rate-limit/domain/window.ts`. One row per (scope, key, window); a check is one
 * `INSERT ... ON CONFLICT (scope, key, window_starts_at) DO UPDATE SET count = count + 1
 * RETURNING count`, so concurrent requests in the same window still count correctly.
 *
 * Old windows are never swept by a job — they are cheap, bounded by the number of distinct
 * keys times a handful of windows, and a bounded query (`window_starts_at = ?`) never touches
 * them. If retention ever matters, delete rows older than the widest window in use.
 */
export const rateLimitBuckets = pgTable(
  "rate_limit_buckets",
  {
    scope: text("scope").notNull(),
    key: text("key").notNull(),
    windowStartsAt: timestamp("window_starts_at", { withTimezone: true }).notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.scope, t.key, t.windowStartsAt] }),
    check("rate_limit_buckets_count_non_negative", sql`${t.count} >= 0`),
  ],
);

export type RateLimitBucket = typeof rateLimitBuckets.$inferSelect;
