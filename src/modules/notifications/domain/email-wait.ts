import { CLUB_TIME_ZONE, formatDay, formatTime } from "@/i18n/dates";
import { dayKey } from "@/modules/events/domain/calendar";
import { minimumIntervalEnd, nextClubBoundary } from "@/modules/jobs/schedule";
import type { DeliveryTiming } from "./delivery-timing";

/**
 * How long a message queued now may wait, and when the outbox job is next expected to send it
 * (§513) — pure, so the pages that promise a wait, `/api/health` and «Următoarele emailuri
 * automate» (§383) all say the same number from one formula.
 *
 * Under `scheduled` the outbox job is the only sender, and three things hold it back, the longest
 * of which wins:
 *
 * - **the pinger's cadence** at this hour (`jobs/quiet-hours.ts#pingerCadenceMinutes`): fifteen
 *   minutes by day on production, an hour at night and all day on a deployment pinged hourly;
 * - **the Administrator's minimum interval** between two real runs (§334, `jobs/cadence.ts`);
 * - **the budget governor's floor** (§447): an hour at amber, two at red.
 *
 * Under `immediate` the request that queued the message sends it: no wait to promise (null).
 */
export function emailWaitMinutes(input: {
  timing: DeliveryTiming;
  pingerMinutes: number;
  intervalMinutes: number;
  governorFloorMinutes: number;
}): number | null {
  if (input.timing === "immediate") return null;
  return Math.max(input.pingerMinutes, input.intervalMinutes, input.governorFloorMinutes);
}

/**
 * The pinger call at which the outbox job is next expected to run for real: the next boundary of
 * the pinger's cadence on the club's clock (a quarter-hour by day, the top of the hour at night),
 * and — when a minimum interval holds the job back (§334, §447) — the first such call at or after
 * the interval's end measured from the last real run (`minimumIntervalEnd`, §355). An estimate for
 * a person to read, never a promise the scheduler is held to: a ping the pinger skips or a wake
 * that comes early moves it.
 */
export function nextOutboxTick(input: {
  now: Date;
  pingerMinutes: number;
  intervalMinutes: number;
  lastRunAt: Date | null;
}): Date {
  const { now, pingerMinutes, intervalMinutes, lastRunAt } = input;
  const onGrid = (at: Date) => nextClubBoundary(at, pingerMinutes) ?? new Date(at.getTime() + pingerMinutes * 60_000);
  // Strictly after now: a call landing on this very instant is the one already under way.
  const tick = onGrid(new Date(now.getTime() + 1));
  if (intervalMinutes <= 0 || !lastRunAt) return tick;
  const floor = minimumIntervalEnd(lastRunAt, intervalMinutes);
  return floor.getTime() > tick.getTime() ? onGrid(floor) : tick;
}

/**
 * When a message queued now leaves, as the screen after the registration form says it (§NNN; the
 * owner, 2026-09-28: «sa inteleg ca nu primesc mailu daca nu apas…?»): null under `immediate` — the
 * request sends it — else the pinger call the outbox job is next expected at (`nextOutboxTick`). A
 * public page never reads the job's history, so with a minimum interval in force (§334, §447) the
 * interval is counted from now: the latest the call can be, never a time that comes and goes first.
 */
export function emailLeavesAt(input: {
  timing: DeliveryTiming;
  now: Date;
  pingerMinutes: number;
  intervalMinutes: number;
  governorFloorMinutes: number;
}): Date | null {
  if (input.timing === "immediate") return null;
  const interval = Math.max(input.intervalMinutes, input.governorFloorMinutes);
  return nextOutboxTick({ now: input.now, pingerMinutes: input.pingerMinutes, intervalMinutes: interval, lastRunAt: interval > 0 ? input.now : null });
}

/**
 * When a message leaves, as a person reads it: now (the request sends it), today at an hour, or on
 * another day with its hour.
 */
export type EmailLeavesOn = { key: "leavesToday" | "leavesOn"; at: string };
export type EmailLeavesWords = { key: "leavesNow" } | EmailLeavesOn;

/**
 * When a message leaves, in words (§NNN, §529) — one function for the screen after the registration
 * form («Emailul către ana@… pleacă la 10:15.» / «… pleacă luni, 29 sept. 2026, la 10:00.» / «… pleacă
 * acum.») and every row of the queue panel on `/admin/settings/emails` («Pleacă: 10:15 (estimat).»),
 * so the two cannot say one message's time two ways. No instant is «now»; an instant on the club's
 * clock today is the bare «HH:MM» (`leavesToday`, the sentence brings its «la»), on another day the
 * inline day with its own «la» before the hour (`leavesOn`, §349, §439, §452) — a sentence never puts
 * a second «la» or a «la» before a weekday-led date.
 */
export function emailLeavesWords(leavesAt: Date, now: Date, locale: string): EmailLeavesOn;
export function emailLeavesWords(leavesAt: Date | null, now: Date, locale: string): EmailLeavesWords;
export function emailLeavesWords(leavesAt: Date | null, now: Date, locale: string): EmailLeavesWords {
  if (leavesAt === null) return { key: "leavesNow" };
  if (dayKey(leavesAt, CLUB_TIME_ZONE) === dayKey(now, CLUB_TIME_ZONE)) {
    return { key: "leavesToday", at: formatTime(leavesAt, { locale, timeZone: CLUB_TIME_ZONE }) };
  }
  return { key: "leavesOn", at: formatDay(leavesAt, { locale, timeZone: CLUB_TIME_ZONE, style: "short", withTime: true, position: "inline" }) };
}

/** More than a week of real runs a queued row could wait behind: the estimate stops there. */
const LEAVES_AT_MAX_STEPS = 500;

/**
 * When one message still in the queue is expected to leave (§529): the outbox job's first real run
 * at or after the row's own turn — its `next_attempt_at` after a retry or a deferral, its creation
 * otherwise. The next run is `nextTickAt` (above); the runs after it follow one another at the
 * pinger's cadence, or at the minimum interval when one holds the job back (§334, §447). Under
 * `immediate` too: a row the request did not send — a retry, a deferral, a batch longer than the
 * drain — is the outbox job's, like every row under `scheduled`.
 *
 * An estimate for a person to read, as `nextOutboxTick` is: a wake (§334) may send a row sooner,
 * and a skipped ping later. `pingerMinutesAt` is the cadence at a given instant, day or night
 * (`jobs/quiet-hours.ts#pingerCadenceMinutes`), passed in so this stays pure.
 */
export function outboxRowLeavesAt(input: {
  dueAt: Date;
  nextTickAt: Date;
  intervalMinutes: number;
  pingerMinutesAt: (at: Date) => number;
}): Date {
  const { dueAt, nextTickAt, intervalMinutes, pingerMinutesAt } = input;
  if (dueAt.getTime() <= nextTickAt.getTime()) return nextTickAt;
  // With no interval every pinger call is a real run: the first call at or after the row's turn.
  if (intervalMinutes <= 0) {
    return nextOutboxTick({ now: new Date(dueAt.getTime() - 1), pingerMinutes: pingerMinutesAt(dueAt), intervalMinutes: 0, lastRunAt: null });
  }
  // With one, each real run is the first call after the interval measured from the one before.
  let tick = nextTickAt;
  for (let step = 0; step < LEAVES_AT_MAX_STEPS && tick.getTime() < dueAt.getTime(); step++) {
    tick = nextOutboxTick({ now: tick, pingerMinutes: pingerMinutesAt(tick), intervalMinutes, lastRunAt: tick });
  }
  return tick;
}

/**
 * Whether a waiting row's turn passed so long ago that no schedule explains it (§529): the same
 * threshold `/api/health` calls `overdue` (§98) — ninety minutes past the row's turn, plus the
 * minimum interval in force — so the queue panel and the monitor never disagree about a stall.
 * The panel says it on the row, beside the estimate that would otherwise read as a promise.
 */
export function outboxRowOverdue(input: { now: Date; dueAt: Date; overdueAfterMs: number; intervalMinutes: number }): boolean {
  return input.now.getTime() - input.dueAt.getTime() > input.overdueAfterMs + input.intervalMinutes * 60_000;
}
