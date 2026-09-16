import { and, eq, isNotNull, lt, or } from "drizzle-orm";
import { emailActionTokens } from "@/db/schema/email-action-tokens";
import { emailOutbox } from "@/db/schema/email-outbox";
import { jobRuns } from "@/db/schema/job-runs";
import { rateLimitBuckets } from "@/db/schema/rate-limit";
import type { Database } from "@/db/types";

/**
 * Deleting the rows nobody will ever read again.
 *
 * Four tables grow on their own — not with the club's races, but with the clock. `job_runs`
 * gains a row every five minutes whether or not anybody registers: 288 a day, 105,000 a year,
 * to answer a question ("did the scheduler run recently?") that only ever looks at the newest
 * one. The others grow with traffic and then never shrink.
 *
 * This is a retention sweep, not a feature. It removes only rows whose *purpose is spent*, and
 * two of the four windows are privacy improvements rather than housekeeping: a sent message
 * keeps a participant's address, and an action token keeps the link between a participant and a
 * registration. Holding either for years because nothing deleted them is not a decision anybody
 * made.
 *
 * What it deliberately does **not** touch: `registrations`, `participants`,
 * `declaration_acceptances`, `audit_logs`, `events`. How long the club keeps a runner's entry
 * after a race is a policy question with legal weight, and it belongs to the club rather than
 * to a sweep that runs every five minutes (`BUSINESS.md` §9). Erasing one person is
 * BR-REQ-037-06 and is deliberate, per-row, and audited.
 */

/**
 * The windows, as data, and each one is an argument rather than a round number.
 *
 * They are generous on purpose: the cost of keeping a row a week longer is a few kilobytes,
 * and the cost of deleting one somebody still needed is a support question nobody can answer.
 */
export const RETENTION = {
  /**
   * `/api/health` reads the newest run per job and nothing else, and `/devs` shows the same.
   * Thirty days is far more history than either uses, and enough to see a pattern by hand after
   * a bad week.
   */
  jobRunsDays: 30,
  /**
   * A throttle bucket is meaningless once its window has passed — `consumeRateLimit` keys on the
   * window start, so an old row can never be read again. One day rather than one hour so that a
   * clock skew or a long window added later cannot delete a bucket still in use.
   */
  rateLimitBucketsDays: 1,
  /**
   * A token that is spent or expired can never be accepted again (§13.2), so the row only holds
   * a hash and a link. Thirty days leaves the trail intact long enough to answer "did this link
   * work?" about a recent race.
   */
  spentTokensDays: 30,
  /**
   * A delivered message's row holds the recipient's address. Ninety days covers a season's
   * worth of "did they ever get it?", after which keeping the address is storage rather than
   * evidence. Rows that failed permanently are kept: those are the ones somebody investigates.
   */
  sentOutboxDays: 90,
} as const;

export type PruneCounts = {
  jobRuns: number;
  rateLimitBuckets: number;
  actionTokens: number;
  outboxMessages: number;
};

const daysBefore = (now: Date, days: number) => new Date(now.getTime() - days * 24 * 60 * 60_000);

/**
 * One statement per table, each with its own cutoff, and all of them safe to run again: a sweep
 * that deletes nothing is the ordinary case, since it runs every five minutes and these windows
 * are measured in days.
 */
export async function pruneExpiredRows<T extends Record<string, unknown>>(
  db: Database<T>,
  now: Date,
): Promise<PruneCounts> {
  const deletedJobRuns = await db
    .delete(jobRuns)
    .where(lt(jobRuns.startedAt, daysBefore(now, RETENTION.jobRunsDays)))
    .returning({ id: jobRuns.id });

  const deletedBuckets = await db
    .delete(rateLimitBuckets)
    .where(lt(rateLimitBuckets.windowStartsAt, daysBefore(now, RETENTION.rateLimitBucketsDays)))
    .returning({ key: rateLimitBuckets.key });

  /**
   * Spent or long expired, never merely old: a token issued yesterday with a fourteen-day life
   * is still the link in somebody's inbox, and deleting it would break a message already sent.
   */
  const tokenCutoff = daysBefore(now, RETENTION.spentTokensDays);
  const deletedTokens = await db
    .delete(emailActionTokens)
    .where(
      and(
        lt(emailActionTokens.expiresAt, now),
        or(
          // Used or invalidated — either way it can never be accepted again (§13.2).
          isNotNull(emailActionTokens.usedAt),
          isNotNull(emailActionTokens.invalidatedAt),
          lt(emailActionTokens.expiresAt, tokenCutoff),
        ),
      ),
    )
    .returning({ id: emailActionTokens.id });

  // SENT only. A BOUNCED or COMPLAINED row is the one an organizer goes looking for.
  const deletedOutbox = await db
    .delete(emailOutbox)
    .where(
      and(
        eq(emailOutbox.status, "SENT"),
        isNotNull(emailOutbox.sentAt),
        lt(emailOutbox.sentAt, daysBefore(now, RETENTION.sentOutboxDays)),
      ),
    )
    .returning({ id: emailOutbox.id });

  return {
    jobRuns: deletedJobRuns.length,
    rateLimitBuckets: deletedBuckets.length,
    actionTokens: deletedTokens.length,
    outboxMessages: deletedOutbox.length,
  };
}

/** Total rows removed, for the one line the job logs. */
export function totalPruned(counts: PruneCounts): number {
  return Object.values(counts).reduce((sum, count) => sum + count, 0);
}
