import { and, count, desc, eq, gt, inArray, isNotNull, lt, not, or, type SQL, sql } from "drizzle-orm";
import { emailOutbox } from "@/db/schema/email-outbox";
import { BULK_MESSAGE_TYPES } from "./domain/bulk";
import { GMAIL_CAP_DEFERRED_ERROR } from "./domain/email-transport";
import { PACE_EVIDENCE_MS, paceHolds, RATE_PAUSE_ERROR_PREFIX } from "./domain/hourly-pace";
import { readMailgunHour } from "./hourly-pace";
import { gmailRoadCondition } from "./outbox";
import { readOutboxRoads } from "./outbox-roads";
import type { Database } from "@/db/types";
import { readJobCadence } from "@/modules/jobs/cadence";
import { checkGmailHealth, type GmailHealth, readEmailTransport } from "./email-transport";
import {
  ALLOWANCE_DEFERRED_ERROR_PREFIX,
  FALLBACK_WAITING_ERROR_PREFIX,
  fallbackSwitchOn,
  type MailgunStopKind,
  routeWhileStopped,
  type StopWaitReason,
} from "./domain/mailgun-stop";
import { MAX_SEND_ATTEMPTS } from "./domain/retry";
import { heldByMailgunCondition, readMailgunStop } from "./mailgun-stop";
import { type OutboxDelivery, outboxOverdueCadenceMinutes, readOutboxDelivery } from "./outbox-delivery";

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
 *              the scheduler is not draining them — unless Mailgun's hourly pace binds and
 *              they ride Mailgun's road (§605, `hourPaced`); rows Mailgun paused recently
 *              for the rate, past the same allowance since they were queued; and since §622 rows
 *              a transient refusal keeps retrying hourly past six attempts or that allowance.
 *   failed     rows the provider refused for the message or the account, in the last seven
 *              days, or that could not be rendered. Since §622 a transient refusal never lands
 *              here: it is retried hourly and shows as overdue instead; «Reîncearcă emailurile
 *              eșuate» puts these back in the queue.
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
  /**
   * `stalled` — something needs a person: a deferral, an overdue row, a failure (§98); `/api/health`
   * answers `degraded` and a 503 for it, and the monitor emails the owner. `degraded` (§622) — Mailgun
   * said stop and Gmail is carrying every group for it: reported here and on «Sarcini», and not a 503 —
   * a monitor that emailed the owner every time Mailgun paused for a quarter of an hour would be
   * emailing about the platform doing what it was built to do. Nothing overdue, deferred or failed
   * stands behind it, or it would be `stalled`.
   */
  status: "ok" | "degraded" | "stalled";
  /** Rows not yet delivered — pending or claimed — whatever the reason. */
  waiting: number;
  deferred: number;
  overdue: number;
  /**
   * Mailgun-road rows whose turn passed while Mailgun's hour binds (§605, `paceHolds`): waiting for
   * the hour, the pace working — counted here, never in `overdue`, and never a status of their own.
   */
  hourPaced: number;
  failed: number;
  /** The earliest a deferred row will be tried again, when any is deferred. */
  resumesAt: string | null;
  /** The provider's last sanitized reason on a deferred or failed row; never a body or a token. */
  lastError: string | null;
  /**
   * The club's Gmail road (§443): recipients it reached in the last day against the club's cap,
   * and its last failure. Reported beside the counts, never a status of its own: a Gmail failure
   * falls back to Mailgun or is retried by the outbox, whose own counts above turn a real stall
   * into the 503 (§98), unchanged.
   *
   * `deferred` and `resumesAt` are the rows waiting out Gmail's cap because the club chose to wait
   * (§493): counted here, and not in `deferred` above — the club's own choice working, like the
   * newsletter's reserve, not the plan's limit the monitor exists to report.
   */
  gmail: GmailHealth & { deferred: number; resumesAt: string | null };
  /**
   * When the queue next leaves (§513): the delivery timing, the rows waiting to be claimed, the
   * most a message queued now may wait and the outbox job's next expected real run. Reported
   * beside the counts, never a status of its own — under the scheduled default a queue that waits
   * for the tick is the setting working, and `overdue` above already says when it is not.
   */
  delivery: OutboxDelivery;
  /**
   * Mailgun said stop (§622): a pause or its allowance spent, until when, and who carries for it —
   * Gmail, or nobody and why (the switch off, Gmail not configured, its cap spent). Null while
   * Mailgun's road is open.
   */
  mailgunStop: { kind: MailgunStopKind; until: string; carriedBy: "gmail" | null; waitReason: StopWaitReason | null } | null;
  /**
   * Waiting rows Mailgun stopped — paused, deferred to its reset, or waiting because Gmail could not
   * carry them — that were queued longer ago than the overdue allowance, while nothing carries them
   * (§622): what «Sarcini» turns red for, with the remedies named.
   */
  stoppedLong: number;
  /**
   * Waiting rows a transient refusal keeps retrying (§622): a plain provider error (a 5xx, a timeout,
   * a 404), six attempts spent or queued past the overdue allowance, the turn scheduled — counted in
   * `overdue` as well, and what «Sarcini» turns red for with the remedy for a refusal that does not pass.
   */
  retryingLate: number;
};

/**
 * `governorFloorMinutes` is the budget governor's minimum interval in force now (§447): time the
 * outbox job may leave a retry waiting, added exactly like the Administrator's own interval — the
 * longer of the two, and of the interval the outbox's last run planned under, which its cached
 * slot remembers after the governor's level has dropped.
 */
export async function checkEmailHealth<T extends Record<string, unknown>>(
  db: Database<T>,
  now: Date,
  governorFloorMinutes = 0,
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
  const { minutes: stated } = await readJobCadence(db);
  // The same number the queue panel marks a row late with (§529, `outbox-delivery.ts`).
  const cadenceMinutes = await outboxOverdueCadenceMinutes(stated, governorFloorMinutes, now);
  const overdueAfterMs = OVERDUE_AFTER_MS + cadenceMinutes * 60_000;
  const overdueBefore = new Date(now.getTime() - overdueAfterMs);
  const failedSince = new Date(now.getTime() - FAILED_WINDOW_MS);

  /*
    A newsletter or a new-event alert waiting for the allowance to come back is the reserve doing
    its job (§445, `domain/bulk.ts`), not a stalled outbox: it is neither deferred nor overdue here.
    It still counts as waiting, and a transactional message that stalls still says so.
  */
  const pending = and(eq(emailOutbox.status, "PENDING"), not(inArray(emailOutbox.messageType, [...BULK_MESSAGE_TYPES])));
  /*
    A row waiting out Gmail's rolling day because the club chose "wait at the cap" (§443) is not a
    stall either (§493): the club set the cap and the choice on `/admin/emails`, the row goes when the
    oldest send leaves the day, and a monitor that alarmed on it would alarm every busy day for a
    choice nobody has to undo. It is counted in the Gmail block instead, with when it resumes. Only
    while it waits: once its turn is overdue, the overdue count below says so as for any row.
  */
  const gmailCapWait = sql`${emailOutbox.lastError} = ${GMAIL_CAP_DEFERRED_ERROR}`;
  const gmailDeferredWhere = and(pending, gt(emailOutbox.nextAttemptAt, deferredFrom), gmailCapWait);
  const deferredWhere = and(pending, gt(emailOutbox.nextAttemptAt, deferredFrom), sql`${emailOutbox.lastError} IS DISTINCT FROM ${GMAIL_CAP_DEFERRED_ERROR}`);
  // A row the worker never touched has no `next_attempt_at`; its turn was its creation.
  const overdueWhere = and(
    pending,
    or(
      lt(emailOutbox.nextAttemptAt, overdueBefore),
      and(sql`${emailOutbox.nextAttemptAt} IS NULL`, lt(emailOutbox.createdAt, overdueBefore)),
    ),
  );
  const failedWhere = and(eq(emailOutbox.status, "FAILED"), gt(emailOutbox.createdAt, failedSince));

  /*
    Mailgun's hourly pace (§605). A queue held back for the hour is the pace working: while the hour
    binds — Mailgun's road carried a full allowance in the last ninety minutes or is carrying the rest
    of it now (`paceHolds`) — a Mailgun row whose turn passed is waiting for the hour, `hourPaced`,
    not `overdue`, exactly as a row held for Gmail's cap or the newsletter's reserve is not. A row on
    Gmail's road is not held by Mailgun's hour, and an hour with room holds nothing: those are overdue
    as before.

    A row Mailgun itself paused for the rate (`RATE_PAUSE_ERROR_PREFIX`: a 429, the probation's
    "temporarily disabled") gives its attempt back on every pause, so it is never FAILED and its turn
    is always minutes ahead — it would never be counted anywhere. So while its own pause is recent
    (`pauseIsRecent`: it ended, or ends, less than ninety minutes from now) and it has waited longer
    than the overdue allowance since it was queued, it is overdue, pace or no pace: a provider that
    keeps refusing needs a person, and `lastError` says which refusal. A row whose pause mark is older
    is waiting its turn like any other, and judged like any other.
  */
  // The roads as the claim reads them, the fallback's notice included (§622, `readOutboxRoads`).
  const [roads, transport] = await Promise.all([readOutboxRoads(db, now), readEmailTransport(db)]);
  const gmailRoad = roads ? gmailRoadCondition(roads) : sql`false`;
  /*
    Mailgun's stop and who carries for it (§622), as the claim reads them: while Gmail carries every
    group, the rows Mailgun held back are Gmail's to send at once — not deferred to Mailgun's reset and
    not paused — so they count in neither; a row Gmail could not carry, queued longer ago than the
    overdue allowance, is overdue while the stop it waits on is in force and nothing carries it.
  */
  const gmailHealth = await checkGmailHealth(db, now);
  const stop = await readMailgunStop(db, now, roads ? not(gmailRoadCondition(roads)) : undefined);
  const whileStopped = routeWhileStopped({
    stop,
    fallbackToGmail: fallbackSwitchOn(transport),
    /*
      The roads carry the fallback only under a notice that names it; where they do not, a configured
      deployment with the switch on was refused by the notice — the two earlier reasons come first.
    */
    noticeNamesFallback: roads?.fallbackToGmail === true,
    gmailConfigured: gmailHealth.configured,
    gmailRoom: Math.max(0, gmailHealth.cap - gmailHealth.sentLastDay),
  });
  const carried = whileStopped.road === "gmail";
  const held = heldByMailgunCondition();
  const fallbackWaiting = sql`${emailOutbox.lastError} LIKE ${`${FALLBACK_WAITING_ERROR_PREFIX}%`}`;
  const notCarried = (where: SQL | undefined) => (carried ? and(where, sql`NOT coalesce(${held}, false)`) : where);
  const evidenceSince = new Date(now.getTime() - PACE_EVIDENCE_MS);
  const recentPause = sql`(${emailOutbox.lastError} LIKE ${`${RATE_PAUSE_ERROR_PREFIX}%`} AND ${emailOutbox.nextAttemptAt} > ${evidenceSince.toISOString()}::timestamptz)`;
  const turnWithinDeferral = sql`${emailOutbox.nextAttemptAt} <= ${deferredFrom.toISOString()}::timestamptz`;
  // Not one already counted as deferred: a `Retry-After` over an hour away is that, and says when.
  const pausedLateWhere = notCarried(and(pending, recentPause, lt(emailOutbox.createdAt, overdueBefore), turnWithinDeferral));
  /*
    Gmail could not carry it while Mailgun was stopped (§622), and it was queued past the allowance:
    nothing is carrying it — but only while a stop is in force that nothing carries. Once the stop has
    ended the mark is the last thing said, not what holds the row: it is back on Mailgun's road waiting
    its paced turn, and judged as any waiting row (`late`, `hourPaced`), never twice.
  */
  const stopUncarried = stop !== null && !carried;
  const stoppedLateWhere = stopUncarried
    ? and(pending, fallbackWaiting, lt(emailOutbox.createdAt, overdueBefore), turnWithinDeferral)
    : sql`false`;
  /*
    A transient refusal retried for ever (§622): past `MAX_SEND_ATTEMPTS` a 5xx, a timeout or a 404 keeps
    the row PENDING and hourly, its turn always minutes ahead — so it is neither overdue (its turn never
    passes by ninety minutes while the scheduler runs) nor deferred (never more than an hour ahead) nor
    FAILED, and would be counted nowhere: the blind spot `pausedLate` closed for the pause (§605). So a
    row carrying a plain provider error — no stop mark, no Gmail-cap wait — that has spent the backoff's
    six attempts (its own two hours of trying) is overdue, pace or no pace: a provider that keeps
    refusing needs a person, and `lastError` says which refusal (a 404 is usually the API base or the
    domain). Not its age (the review of round three): an old row met by one transient refusal is in
    its backoff, not stuck, and counting it here would ring for ninety minutes and then go quiet in
    `late`, which the pace exempts. A row whose turn has already passed by the allowance is in `late`
    as before, not here.
  */
  const plainError = sql`(${emailOutbox.lastError} IS NOT NULL
    AND ${emailOutbox.lastError} NOT LIKE ${`${RATE_PAUSE_ERROR_PREFIX}%`}
    AND ${emailOutbox.lastError} NOT LIKE ${`${ALLOWANCE_DEFERRED_ERROR_PREFIX}%`}
    AND ${emailOutbox.lastError} NOT LIKE ${`${FALLBACK_WAITING_ERROR_PREFIX}%`}
    AND ${emailOutbox.lastError} <> ${GMAIL_CAP_DEFERRED_ERROR})`;
  const retryingLateWhere = and(
    pending,
    plainError,
    sql`${emailOutbox.attemptCount} >= ${MAX_SEND_ATTEMPTS}`,
    turnWithinDeferral,
    sql`${emailOutbox.nextAttemptAt} >= ${overdueBefore.toISOString()}::timestamptz`,
  );
  // Each late row counted once: a recent pause and a stop nothing carries have counts of their own.
  const lateWhere = and(overdueWhere, sql`NOT coalesce(${recentPause}, false)`, stopUncarried ? sql`NOT coalesce(${fallbackWaiting}, false)` : undefined);
  const deferredCounted = notCarried(deferredWhere);
  // «Sarcini»'s red row (§622): stopped rows queued past the allowance that nothing carries now.
  // A mark counts only while a stop is in force and nothing carries it; an old mark past its stop is a row waiting its turn.
  const stoppedLongWhere = stopUncarried
    ? and(pending, lt(emailOutbox.createdAt, overdueBefore), sql`(coalesce(${held}, false) OR coalesce(${fallbackWaiting}, false))`)
    : sql`false`;

  const [[row], hour] = await Promise.all([
    db
      .select({
        waiting: count(sql`case when ${emailOutbox.status} in ('PENDING', 'PROCESSING') then 1 end`),
        deferred: count(sql`case when ${deferredCounted} then 1 end`),
        stoppedLate: count(sql`case when ${stoppedLateWhere} then 1 end`),
        stoppedLong: count(sql`case when ${stoppedLongWhere} then 1 end`),
        late: count(sql`case when ${lateWhere} then 1 end`),
        lateOnGmail: count(sql`case when ${and(lateWhere, gmailRoad)} then 1 end`),
        pausedLate: count(sql`case when ${pausedLateWhere} then 1 end`),
        retryingLate: count(sql`case when ${retryingLateWhere} then 1 end`),
        failed: count(sql`case when ${failedWhere} then 1 end`),
        resumesAt: sql<Date | null>`min(case when ${deferredCounted} then ${emailOutbox.nextAttemptAt} end)`,
        gmailDeferred: count(sql`case when ${gmailDeferredWhere} then 1 end`),
        gmailResumesAt: sql<Date | null>`min(case when ${gmailDeferredWhere} then ${emailOutbox.nextAttemptAt} end)`,
      })
      .from(emailOutbox),
    // Mailgun's hour as the claim counts it, on Mailgun's road (`hourly-pace.ts`); no count without a pace.
    readMailgunHour(db, now, roads ? { mailgunRoad: not(gmailRoadCondition(roads)) } : {}),
  ]);

  const holds = paceHolds({ hourlyAllowance: hour.allowance, carriedRecently: hour.carriedRecently, inFlight: hour.inFlight });
  const hourPaced = holds ? row.late - row.lateOnGmail : 0;
  const overdue = row.late - hourPaced + row.pausedLate + row.stoppedLate + row.retryingLate;
  const stalled = row.deferred > 0 || overdue > 0 || row.failed > 0;

  // The reason, from the most recent row that has one among those that count. One more query
  // only when there is something to explain.
  let lastError: string | null = null;
  if (stalled) {
    const [latest] = await db
      .select({ lastError: emailOutbox.lastError })
      .from(emailOutbox)
      .where(and(or(deferredCounted, holds ? and(lateWhere, gmailRoad) : lateWhere, pausedLateWhere, stoppedLateWhere, retryingLateWhere, failedWhere), isNotNull(emailOutbox.lastError)))
      .orderBy(desc(emailOutbox.createdAt))
      .limit(1);
    lastError = latest?.lastError ?? null;
  }

  const resumesAt = row.resumesAt ? new Date(row.resumesAt) : null;
  const gmailResumesAt = row.gmailResumesAt ? new Date(row.gmailResumesAt) : null;
  const delivery = await readOutboxDelivery(db, now, governorFloorMinutes);
  return {
    status: stalled ? "stalled" : carried ? "degraded" : "ok",
    waiting: row.waiting,
    deferred: row.deferred,
    overdue,
    hourPaced,
    failed: row.failed,
    resumesAt: resumesAt ? resumesAt.toISOString() : null,
    lastError,
    gmail: {
      ...gmailHealth,
      deferred: row.gmailDeferred,
      resumesAt: gmailResumesAt ? gmailResumesAt.toISOString() : null,
    },
    delivery,
    mailgunStop: stop
      ? {
          kind: stop.kind,
          until: stop.until.toISOString(),
          carriedBy: carried ? "gmail" : null,
          waitReason: whileStopped.road === "wait" ? whileStopped.reason : null,
        }
      : null,
    stoppedLong: row.stoppedLong,
    retryingLate: row.retryingLate,
  };
}

/** Kept exported for the test that pins the thresholds to the backoff they are derived from. */
export const EMAIL_HEALTH_THRESHOLDS = { OVERDUE_AFTER_MS, DEFERRED_BEYOND_MS, FAILED_WINDOW_MS };
