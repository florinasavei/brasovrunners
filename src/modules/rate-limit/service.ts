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
 * the actor: a canonical email, a registration id, a token hash, a job name. That choice also makes the limit mean
 * something — throttling an address stops one person flooding one mailbox, which is the abuse
 * this actually has.
 */

export type RateLimitScope =
  | "registration-submit"
  | "admin-resend"
  | "token-validate"
  | "job-invoke";

/**
 * What each guarded action allows, as data.
 *
 * Deliberately generous. These exist to stop a script and a mailbox flood, not to police a
 * person who mistyped their address and tried again — and a limit a real user can hit is a
 * support request that costs more than the abuse it prevented.
 *
 * `/devs` renders this map directly rather than restating it, so a scope added here is a
 * scope a maintainer can see in the deployment. Add one and there is nothing else to update.
 */
export const RATE_LIMITS: Record<RateLimitScope, { limit: number; windowMs: number }> = {
  // Five submissions per hour for one email identity. A participant registering, mistyping and
  // retrying uses two or three; a script filling a mailbox uses hundreds.
  "registration-submit": { limit: 5, windowMs: 60 * 60_000 },
  // BR-REQ-037-02 criterion 5. Per registration, not per administrator: the thing being
  // protected is one participant's inbox, and two organizers clicking resend at the same
  // moment is the case that should be caught.
  "admin-resend": { limit: 5, windowMs: 60 * 60_000 },
  /**
   * BR-REQ-036-02, §19.4's third surface. Keyed on the **presented token's hash**, which is
   * what `modules/action-tokens/throttle.ts` computes and what the tokens table already
   * stores — so this adds no new secret at rest and no IP.
   *
   * The threat is one token being hammered, not enumeration: 32 random bytes is not guessed,
   * and a per-IP limit would key on something §19.4 forbids to defend against nothing. Ten
   * per hour is well above the handful a real participant produces — a link scanner's
   * prefetch, the page load, a reload or two, then the POST — and well below useful.
   */
  "token-validate": { limit: 10, windowMs: 60 * 60_000 },
  /**
   * §19.4's fifth surface, read as auth-adjacent: `JOB_SECRET` says *who*, and nothing until
   * now said *how often*. A leaked secret was an unlimited outbox drain — every message the
   * club will ever send, into somebody else's hands and out of Mailgun's daily allowance in
   * one afternoon.
   *
   * Keyed on the job name, so the bucket is the endpoint itself rather than a caller: there
   * is exactly one legitimate caller and no identity to key on beyond the secret already
   * checked. Thirty an hour against a scheduler asking for twelve (a five-minute cron) and actually
   * delivering roughly one every two hours (`docs/PLATFORM.md` limit 4) leaves room for a
   * manual run and a catch-up burst, and still bounds the damage.
   *
   * Counted only after the secret has been verified, so an unauthenticated flood cannot fill
   * the bucket and lock the real scheduler out — a guard that can be used to disable the
   * thing it guards is worse than none.
   */
  "job-invoke": { limit: 30, windowMs: 60 * 60_000 },
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
