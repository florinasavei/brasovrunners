import { DURATION_MAX_MINUTES } from "@/modules/content/events/duration";
import { blankStartParts } from "@/modules/events/domain/provisional-start";
import { toWallTimeInput } from "@/modules/events/domain/zoned-time";
import { clockMinutes } from "./checkpoint";

/**
 * Where a checkpoint's cut-off is counted from, where the finish stands and how long a race's time
 * limit is (§757) — pure, so the writer (`checkpoints.ts`), the event page and the bib read one answer.
 */

/**
 * The start the cut-offs are counted from: the race's gun when it has one (§71), else the event's
 * start — and nothing while the start's date or hour was left blank (§545), when there is nothing to
 * count from and the rules that need it are not applied.
 */
export function checkpointStart(event: { startsAt: Date; raceStartsAt: Date | null; timezone: string }): Date | null {
  if (event.raceStartsAt) return event.raceStartsAt;
  const blank = blankStartParts(event.startsAt, event.timezone);
  return blank.date || blank.time ? null : event.startsAt;
}

/**
 * A race's «Timp limită» in whole minutes (§757; the owner, 2026-10-13: «trebuie să pot pune timp
 * limită»): from the gun — else the event's start — to the event's end, the instant the editor's box
 * stores (`content/events/duration.ts#durationBase`). Null for any other type, whose «Durata» is how
 * long it lasts and no limit, and for a race with no end. The length is said even while the start's
 * hour is to be announced: the box's minutes are the club's whatever the hour turns out to be.
 */
export function raceTimeLimitMinutes(event: { type: string; startsAt: Date; raceStartsAt: Date | null; endsAt: Date | null }): number | null {
  if (event.type !== "RACE" || !event.endsAt) return null;
  const from = event.raceStartsAt ?? event.startsAt;
  const minutes = Math.round((event.endsAt.getTime() - from.getTime()) / 60_000);
  return minutes > 0 ? minutes : null;
}

/**
 * The finish row of the page's table: the route's length when the club typed one, and — **for a race
 * with a time limit** — the time the finish closes, the event's end as `HH:MM` on the event's own clock,
 * and the limit itself in minutes from the start (`minutes`, the race's «Timp limită», §770), when the
 * start has an hour and the end is after it. Every other event's end is when it finishes, not a limit
 * anyone is held to, so its table has no finish row (`limit` and `minutes` null).
 */
export function checkpointFinish(event: {
  type: string;
  startsAt: Date;
  raceStartsAt: Date | null;
  endsAt: Date | null;
  timezone: string;
  distanceMeters: number | null;
}): { km: number | null; limit: string | null; minutes: number | null } {
  const start = checkpointStart(event);
  const end = event.type === "RACE" && start && event.endsAt && event.endsAt.getTime() > start.getTime() ? event.endsAt : null;
  return {
    km: event.distanceMeters && event.distanceMeters > 0 ? Math.round(event.distanceMeters / 10) / 100 : null,
    limit: end ? toWallTimeInput(end, event.timezone).slice(11, 16) : null,
    minutes: end && start ? Math.round((end.getTime() - start.getTime()) / 60_000) : null,
  };
}

// ---------------------------------------------------------------------------------------------
// The one converter between a clock and a time limit (§770)
// ---------------------------------------------------------------------------------------------

/**
 * The clock a time limit closes at: the start plus `minutes` elapsed, read on the event's own clock as
 * `HH:MM`. Elapsed, as the race's «Timp limită» is, so the night the clocks change reads the hour the
 * wall really shows. The event page, the bib's strip and the editor all say a limit's clock through this.
 */
export function cutoffClockOf(start: Date, minutes: number, timezone: string): string {
  return toWallTimeInput(new Date(start.getTime() + minutes * 60_000), timezone).slice(11, 16);
}

/**
 * The clock of each limit of an event, for a reader that has the event it draws: a function from a
 * point's minutes to its `HH:MM`, or to null while the event's start has no date or hour (nothing to
 * count from) or the point has no limit. One place for the page, its staff preview and the bib.
 */
export function checkpointClock(event: { startsAt: Date; raceStartsAt: Date | null; timezone: string }): (minutes: number | null) => string | null {
  const start = checkpointStart(event);
  return (minutes) => (start && minutes !== null ? cutoffClockOf(start, minutes, event.timezone) : null);
}

/** The checkpoints with the clock each limit closes at, for the event a reader draws (`checkpointClock`). */
export function withCutoffClocks<T extends { cutoffMinutes: number | null }>(
  checkpoints: readonly T[],
  event: { startsAt: Date; raceStartsAt: Date | null; timezone: string } | null,
): (T & { cutoffClock: string | null })[] {
  const clockOf = event ? checkpointClock(event) : () => null;
  return checkpoints.map((row) => ({ ...row, cutoffClock: clockOf(row.cutoffMinutes) }));
}

/**
 * A clock reading as the minutes after the start it falls — the reverse of `cutoffClockOf`, for what
 * was typed or exported as a time of day (§757): an old file's cut-off, an old row. `startMinutes` is
 * the start's minute of the day on the event's clock; `limitMinutes` the minutes from the start to the
 * event's end, when it has one. **A clock earlier than the start's is the next day's only for an event
 * that runs past midnight** (its end, counted from the start, is on the next day); any other event's is
 * before the start. Null for a clock at or before the start — a limit nobody could meet. Migration 0157
 * computes the same in SQL, and a test holds the two to the same answers.
 */
export function minutesFromClock(clock: string, startMinutes: number, limitMinutes: number | null = null): number | null {
  const crossesMidnight = limitMinutes !== null && startMinutes + limitMinutes >= 1440;
  const raw = clockMinutes(clock) - startMinutes;
  const minutes = crossesMidnight ? ((raw % 1440) + 1440) % 1440 : raw;
  return minutes >= 1 && minutes <= DURATION_MAX_MINUTES ? minutes : null;
}
