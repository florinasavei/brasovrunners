/**
 * Mailgun's hourly pace (§NNN, amending §100): how many messages Mailgun's road may still carry in
 * the trailing sixty minutes.
 *
 * Mailgun put the club's account on "probation": its notice said domains are limited to 100 messages
 * an hour, and that sending faster temporarily disables the account. The day the club opened
 * registrations, nothing here knew: the outbox sent as fast as the queue
 * filled, and every refusal past the hundredth was retried six times in an hour and then FAILED.
 * So the outbox paces itself to `hourlyAllowance` (the email plan setting, 100 by default), and a
 * rate refusal is a pause (`mailgun-adapter.ts`), never a loss.
 *
 * Pure: the numbers. The count is `hourly-pace.ts`.
 */

/**
 * The pace when the stored setting says nothing: Mailgun's probation, a hundred an hour. A pace
 * that is too low costs minutes; one that is too high costs the account, which is why the default
 * errs low and an Administrator raises or clears it once Mailgun lifts the probation.
 */
export const DEFAULT_HOURLY_ALLOWANCE = 100;

/** The most the box takes: far beyond any plan the club could be on, and a bound on a typo. */
export const MAX_HOURLY_ALLOWANCE = 100_000;

/** The trailing window the pace is counted over: Mailgun's own hour. */
export const PACE_WINDOW_MS = 60 * 60_000;

/**
 * How recently Mailgun must have carried a message for a backlog to read as the pace working
 * rather than a stall (`health.ts`): `/api/health`'s own ninety minutes (`OVERDUE_AFTER_MS`, §98),
 * pinned to it by a test. A queue held for the hour still sends every outbox run — twenty a run,
 * four runs an hour by day — so ninety minutes with nothing carried is a stall whatever the pace.
 */
export const PACE_EVIDENCE_MS = 90 * 60_000;

/**
 * What a provider's rate refusal leaves on the row's `last_error` (§NNN): the mark health reads to
 * tell a pause from a backoff retry, followed by the provider's sanitized reason.
 */
export const RATE_PAUSE_ERROR_PREFIX = "paused by the provider: ";

/** Whether a row's `last_error` is a provider's rate pause (§NNN), as the outbox wrote it. */
export function isRatePaused(lastError: string | null): boolean {
  return lastError !== null && lastError.startsWith(RATE_PAUSE_ERROR_PREFIX);
}

/**
 * How many more messages Mailgun's road may take now: the allowance less what left (or is leaving)
 * in the last hour, never below zero; null when no pace is set.
 */
export function hourlyRoom(hourlyAllowance: number | null, usedLastHour: number): number | null {
  if (hourlyAllowance === null) return null;
  return Math.max(0, hourlyAllowance - usedLastHour);
}

/**
 * Whether a backlog is the pace working (§NNN): a pace is set and Mailgun carried at least one
 * message in the last `PACE_EVIDENCE_MS`. Then rows whose turn passed are waiting for the hour, not
 * overdue; without a recent send they are overdue as before — the outbox is not moving.
 */
export function paceHolds(input: { hourlyAllowance: number | null; carriedRecently: number }): boolean {
  return input.hourlyAllowance !== null && input.carriedRecently > 0;
}
