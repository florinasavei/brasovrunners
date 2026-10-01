import { and, eq, inArray, sql } from "drizzle-orm";
import { rateLimitBuckets } from "@/db/schema/rate-limit";
import type { Database } from "@/db/types";
import { retryAfterSeconds, windowStart } from "./domain/window";

/**
 * The small database-backed throttle of AGENTS.md §19.4: one table, one statement per check, no
 * Redis. The key is never an IP address (§19.4 forbids IP or device as identity); it is something
 * the application already knows — a canonical email, a registration id, a token hash, a job name.
 */

export type RateLimitScope =
  | "registration-submit"
  | "registration-link-submit"
  | "link-request"
  | "admin-resend"
  | "admin-bulk-resend"
  | "token-validate"
  | "job-invoke"
  | "admin-send-now"
  | "admin-retry-failed"
  | "contact-message"
  | "group-run-declaration"
  | "newsletter-subscribe"
  | "content-translate"
  | "bot-check-signal";

/**
 * Limits per scope, deliberately generous: they stop a script or a mailbox flood, not a person
 * retrying. `/devs` renders this map directly.
 */
export const RATE_LIMITS: Record<RateLimitScope, { limit: number; windowMs: number }> = {
  // A person mistyping and retrying uses two or three; a script uses hundreds.
  "registration-submit": { limit: 5, windowMs: 60 * 60_000 },
  /**
   * The family link (§389): its own bucket on the same hashed identity, so a family does not
   * spend the form's five. Ten is the highest per-address cap an event may set (`domain/address-cap.ts`).
   */
  "registration-link-submit": { limit: 10, windowMs: 60 * 60_000 },
  /**
   * §19.4, keyed on the canonical identity: the bucket belongs to the mailbox written to, since
   * anyone can type any address here (`+tag` variants share it, §10.4). One field, so three.
   */
  "link-request": { limit: 3, windowMs: 60 * 60_000 },
  // BR-REQ-037-02 criterion 5. Per registration, not per administrator: it protects one inbox.
  "admin-resend": { limit: 5, windowMs: 60 * 60_000 },
  /**
   * «Retrimite declarația tuturor care nu au semnat» (§606), keyed on the event: each press can put
   * an email in every pending inbox at once, so three presses an hour, whoever presses. Every row
   * it queues still spends that registration's own `admin-resend` above.
   */
  "admin-bulk-resend": { limit: 3, windowMs: 60 * 60_000 },
  /**
   * BR-REQ-036-02, §19.4. Keyed on the presented token's hash (`action-tokens/throttle.ts`): no new
   * secret at rest, no IP. Guards one token being hammered; 32 random bytes are not guessed.
   */
  "token-validate": { limit: 10, windowMs: 60 * 60_000 },
  /**
   * §19.4: `JOB_SECRET` says who, this says how often, so a leaked secret cannot drain the outbox.
   * Keyed on the job name. Counted only after the secret is verified, so an unauthenticated flood
   * cannot lock the real scheduler out.
   */
  "job-invoke": { limit: 30, windowMs: 60 * 60_000 },
  /** "Send now" (§80): per Administrator, so the button and the monitor never share a bucket. */
  "admin-send-now": { limit: 10, windowMs: 60 * 60_000 },
  /** «Reîncearcă emailurile eșuate» (§NNN): per Administrator, three an hour — a press that empties a week of failures. */
  "admin-retry-failed": { limit: 3, windowMs: 60 * 60_000 },
  /**
   * The contact form (§149), keyed on a hash of the canonical email (the form keeps no copy of the
   * address). Every message is an immediate SMTP send; a refused send is refunded (`refundRateLimit`).
   */
  "contact-message": { limit: 5, windowMs: 60 * 60_000 },
  /**
   * A group run's self-declaration (§393), hashed canonical email; each signature queues two
   * messages, so a script spends the Mailgun allowance twice per post.
   */
  "group-run-declaration": { limit: 5, windowMs: 60 * 60_000 },
  /**
   * The newsletter pop-up (§445), hashed canonical address: each post mails an unproven address.
   * «Vreau să mă dezabonez» under the same button (§550) spends the same bucket, so the two forms
   * together still put at most three messages an hour in one mailbox.
   */
  "newsletter-subscribe": { limit: 3, windowMs: 60 * 60_000 },
  /** «Tradu din română» (§464), per staff id; the daily character budget bounds the cost. */
  "content-translate": { limit: 60, windowMs: 60 * 60_000 },
  /**
   * Not a throttle but a counter (§518): the anti-bot failure signals, keyed on the signal's word,
   * summed by `/api/health` (`registrations/bot-check-signals.ts`). The verdict is never read.
   */
  "bot-check-signal": { limit: 10_000, windowMs: 60 * 60_000 },
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
 * Count this attempt and say whether it is allowed. One atomic `INSERT … ON CONFLICT DO UPDATE`,
 * because a read-then-write lets a concurrent pair through. A refused attempt is still counted,
 * so hammering keeps the window occupied.
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

/**
 * How many attempts each key has made in `now`'s window, without counting one — for a page that says
 * before a press which keys the press would find spent (§606), and for the press that skips them
 * rather than spending a refused attempt on each. A key with no row has made none. One read.
 */
export async function readRateLimitCounts<T extends Record<string, unknown>>(
  db: Database<T>,
  scope: RateLimitScope,
  keys: readonly string[],
  now: Date,
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (keys.length === 0) return counts;
  const rows = await db
    .select({ key: rateLimitBuckets.key, count: rateLimitBuckets.count })
    .from(rateLimitBuckets)
    .where(
      and(
        eq(rateLimitBuckets.scope, scope),
        inArray(rateLimitBuckets.key, [...keys]),
        eq(rateLimitBuckets.windowStartsAt, windowStart(now, RATE_LIMITS[scope].windowMs)),
      ),
    );
  for (const row of rows) counts.set(row.key, row.count);
  return counts;
}

/**
 * Give one attempt back in `now`'s window — for a contact message the SMTP server refused, which
 * reached nobody. Never below zero.
 */
export async function refundRateLimit<T extends Record<string, unknown>>(
  db: Database<T>,
  scope: RateLimitScope,
  key: string,
  now: Date,
): Promise<void> {
  const { windowMs } = RATE_LIMITS[scope];
  await db
    .update(rateLimitBuckets)
    .set({ count: sql`GREATEST(${rateLimitBuckets.count} - 1, 0)` })
    .where(
      and(
        eq(rateLimitBuckets.scope, scope),
        eq(rateLimitBuckets.key, key),
        eq(rateLimitBuckets.windowStartsAt, windowStart(now, windowMs)),
      ),
    );
}
