import { and, count, desc, eq, gt, isNotNull, lt, or, sql } from "drizzle-orm";
import { emailOutbox } from "@/db/schema/email-outbox";
import type { Database } from "@/db/types";
import { readJobCadence } from "@/modules/jobs/cadence";
import { checkGmailHealth, type GmailHealth } from "./email-transport";

/**
 * "Can the club still send email?" — the answer `/api/health` and `/admin/tasks` give
 * (BR-REQ-080-02 criterion 6; `DECISIONS.md` §98).
 *
 * The outbox is built so that nothing is lost when Mailgun refuses: a spent allowance defers
 * the message to the reset, a socket error retries with backoff, an exhausted message is
 * `FAILED` and kept. What it could not do until now is *tell anybody*. A message the provider
 * holds back looks, from the club's side, exactly like a message that went — nobody on the
 * team opens the outbox on a normal day — and the platform cannot email the owner about it,
 * because the one thing that is broken is email. So this reads as three counts the monitors
 * can act on through a channel of their own (cron-job.org's failure notification, sent from
 * its own mail, on a non-2xx `/api/health`):
 *
 *   deferred   PENDING rows the provider refused for the day; they go at the allowance reset.
 *   overdue    PENDING rows whose turn came and passed, by more than the backoff can explain:
 *              the scheduler is not draining them.
 *   failed     rows that spent every attempt, in the last seven days: the provider said no
 *              six times, or the message could not be rendered.
 *
 * Any of the three above zero is `stalled`, and `stalled` is a `degraded` health answer with
 * a 503, which is what turns a monitor into a notification. Bounces are not here: a bounce is
 * one address that does not exist, and BR-REQ-080-04 already shows it on the registration.
 */

/**
 * Longer than the longest backoff (`domain/retry.ts`: six attempts, one to thirty-two
 * minutes) plus the night cadence's hour (`jobs/quiet-hours.ts`), so a row this late is not a
 * retry the schedule will get to; it is a schedule that is not running.
 */
const OVERDUE_AFTER_MS = 90 * 60_000;

/**
 * A deferral schedules the row for the allowance reset, hours away; a backoff schedules it
 * minutes away. A `PENDING` row more than an hour in the future can only be the former.
 */
const DEFERRED_BEYOND_MS = 60 * 60_000;

const FAILED_WINDOW_MS = 7 * 24 * 3_600_000;

export type EmailHealth = {
  status: "ok" | "stalled";
  /** Rows not yet delivered — pending or claimed — whatever the reason. */
  waiting: number;
  deferred: number;
  overdue: number;
  failed: number;
  /** The earliest a deferred row will be tried again, when any is deferred. */
  resumesAt: string | null;
  /** The provider's last sanitized reason on a deferred or failed row; never a body or a token. */
  lastError: string | null;
  /**
   * The club's Gmail road (§NNN): recipients it reached in the last day against the club's cap,
   * and its last failure. Reported beside the counts, never a status of its own: a Gmail failure
   * falls back to Mailgun or is retried by the outbox, whose own counts above turn a real stall
   * into the 503 (§98), unchanged.
   */
  gmail: GmailHealth;
};

export async function checkEmailHealth<T extends Record<string, unknown>>(
  db: Database<T>,
  now: Date,
): Promise<EmailHealth> {
  const deferredFrom = new Date(now.getTime() + DEFERRED_BEYOND_MS);
  /*
    The Administrator's minimum interval between two real runs (§334) is time the outbox job may
    legitimately leave a retry waiting, and it is added in full whenever one is set. Not "past
    the hour": the ninety minutes above already spend their hour on the night pinger, and the
    interval comes on top of it. At night with sixty minutes, a retry due just after a run at T
    waits out the interval to T+60, and when the run that started the interval was off the
    pinger's hour (the GitHub backstop, a run woken between two calls) the hourly call at T+60
    still falls inside it and the claim is at T+120 — about 110 minutes overdue against ninety.
    So the worst case is the interval plus one night pinger period, and ninety plus the interval
    covers it with the backoff's half hour to spare; a club that chose a throttle is never told
    its email has stalled by it. Since §355 the interval ends on a boundary of its own length and
    may run up to a quarter of an hour past it on the way there, landing on a quarter-hour the
    hourly night pinger reaches at most 45 minutes later: the interval plus about an hour, as
    before, still inside ninety plus the interval (`tests/unit/jobs/schedule-alignment.test.ts`).
  */
  const { minutes: cadenceMinutes } = await readJobCadence(db);
  const overdueAfterMs = OVERDUE_AFTER_MS + cadenceMinutes * 60_000;
  const overdueBefore = new Date(now.getTime() - overdueAfterMs);
  const failedSince = new Date(now.getTime() - FAILED_WINDOW_MS);

  const pending = eq(emailOutbox.status, "PENDING");
  const deferredWhere = and(pending, gt(emailOutbox.nextAttemptAt, deferredFrom));
  // A row the worker never touched has no `next_attempt_at`; its turn was its creation.
  const overdueWhere = and(
    pending,
    or(
      lt(emailOutbox.nextAttemptAt, overdueBefore),
      and(sql`${emailOutbox.nextAttemptAt} IS NULL`, lt(emailOutbox.createdAt, overdueBefore)),
    ),
  );
  const failedWhere = and(eq(emailOutbox.status, "FAILED"), gt(emailOutbox.createdAt, failedSince));

  const [row] = await db
    .select({
      waiting: count(sql`case when ${emailOutbox.status} in ('PENDING', 'PROCESSING') then 1 end`),
      deferred: count(sql`case when ${deferredWhere} then 1 end`),
      overdue: count(sql`case when ${overdueWhere} then 1 end`),
      failed: count(sql`case when ${failedWhere} then 1 end`),
      resumesAt: sql<Date | null>`min(case when ${deferredWhere} then ${emailOutbox.nextAttemptAt} end)`,
    })
    .from(emailOutbox);

  const stalled = row.deferred > 0 || row.overdue > 0 || row.failed > 0;

  // The reason, from the most recent row that has one among those that count. One more query
  // only when there is something to explain.
  let lastError: string | null = null;
  if (stalled) {
    const [latest] = await db
      .select({ lastError: emailOutbox.lastError })
      .from(emailOutbox)
      .where(and(or(deferredWhere, overdueWhere, failedWhere), isNotNull(emailOutbox.lastError)))
      .orderBy(desc(emailOutbox.createdAt))
      .limit(1);
    lastError = latest?.lastError ?? null;
  }

  const resumesAt = row.resumesAt ? new Date(row.resumesAt) : null;
  return {
    status: stalled ? "stalled" : "ok",
    waiting: row.waiting,
    deferred: row.deferred,
    overdue: row.overdue,
    failed: row.failed,
    resumesAt: resumesAt ? resumesAt.toISOString() : null,
    lastError,
    gmail: await checkGmailHealth(db, now),
  };
}

/** Kept exported for the test that pins the thresholds to the backoff they are derived from. */
export const EMAIL_HEALTH_THRESHOLDS = { OVERDUE_AFTER_MS, DEFERRED_BEYOND_MS, FAILED_WINDOW_MS };
