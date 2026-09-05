import { sql } from "drizzle-orm";
import { rateLimitBuckets } from "@/db/schema/rate-limit";
import type { Database } from "@/db/types";
import { retryAfterSeconds, windowStart } from "./domain/window";

/**
 * The database-backed throttle of AGENTS.md §19.4.
 *
 * "Use platform-native or a small database-backed throttle. Do not add Redis solely for V1."
 * This is that: one table, one statement per check, no new dependency and no new process. It
 * is not a general-purpose rate limiter and should not become one — §1.3.
 *
 * **The key is never an IP address.** §19.4 forbids IP or device as participant identity, and
 * the key is persisted here, so what goes in is something the application already knows about
 * the actor: a canonical email, a registration id. That choice also makes the limit mean
 * something — throttling an address stops one person flooding one mailbox, which is the abuse
 * this actually has.
 */

export type RateLimitScope = "registration-submit" | "admin-resend";

/**
 * What each guarded action allows, as data.
 *
 * Deliberately generous. These exist to stop a script and a mailbox flood, not to police a
 * person who mistyped their address and tried again — and a limit a real user can hit is a
 * support request that costs more than the abuse it prevented.
 */
export const RATE_LIMITS: Record<RateLimitScope, { limit: number; windowMs: number }> = {
  // Five submissions per hour for one email identity. A participant registering, mistyping and
  // retrying uses two or three; a script filling a mailbox uses hundreds.
  "registration-submit": { limit: 5, windowMs: 60 * 60_000 },
  // BR-REQ-037-02 criterion 5. Per registration, not per administrator: the thing being
  // protected is one participant's inbox, and two organizers clicking resend at the same
  // moment is the case that should be caught.
  "admin-resend": { limit: 5, windowMs: 60 * 60_000 },
};

export type RateLimitVerdict = {
  allowed: boolean;
  /** How many attempts this key has made in the current window, including this one. */
  count: number;
  limit: number;
  /** Whole seconds until the window resets. */
  retryAfter: number;
};

/**
 * Count this attempt and say whether it is allowed.
 *
 * One statement, and it has to be: two requests arriving in the same window would each read
 * the same count and each write the same increment, so a read followed by a write lets a
 * concurrent pair through together. `INSERT … ON CONFLICT DO UPDATE … RETURNING` is atomic —
 * the same reasoning `registrations/repository.ts` gives for making every transition one
 * guarded statement.
 *
 * It counts the attempt even when it refuses it. That is intentional: an actor who keeps
 * hammering while throttled keeps their window occupied rather than getting a fresh allowance
 * the moment they stop being counted.
 */
export async function consumeRateLimit<T extends Record<string, unknown>>(
  db: Database<T>,
  scope: RateLimitScope,
  key: string,
  now: Date,
): Promise<RateLimitVerdict> {
  const { limit, windowMs } = RATE_LIMITS[scope];
  const windowStartsAt = windowStart(now, windowMs);

  const [row] = await db
    .insert(rateLimitBuckets)
    .values({ scope, key, windowStartsAt, count: 1 })
    .onConflictDoUpdate({
      target: [rateLimitBuckets.scope, rateLimitBuckets.key, rateLimitBuckets.windowStartsAt],
      set: { count: sql`${rateLimitBuckets.count} + 1` },
    })
    .returning({ count: rateLimitBuckets.count });

  const count = row?.count ?? 1;

  return {
    allowed: count <= limit,
    count,
    limit,
    retryAfter: retryAfterSeconds(now, windowMs),
  };
}
