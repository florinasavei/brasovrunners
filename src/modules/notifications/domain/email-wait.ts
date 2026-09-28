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
