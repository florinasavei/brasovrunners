import { daysUntilOnWallClock } from "./race-week";

/**
 * How far away the calendar's next event is, in the steps the card says it in (§834):
 * «Acum», «Azi», «Mâine», «Peste 5 zile», «Peste 3 săptămâni», «Peste 2 luni».
 *
 * - `now` — it has started (the listing's read keeps an event until it ends, so the card can
 *   still show one that is running);
 * - `today` / `tomorrow` — the same calendar day, or the next one;
 * - `days` — from two to thirteen days;
 * - `weeks` — from fourteen days, whole weeks rounded down, up to eight (59 days);
 * - `months` — from sixty days, thirty-day months rounded down: 60 days is two months.
 *
 * Days are **calendar days** on `timeZone`'s wall clock — `daysUntilOnWallClock`, the one day
 * count the race-week countdown uses (§78) — never 24-hour blocks, so the last Sunday of October,
 * a 25-hour day, moves nothing: a race on Saturday is «Mâine» all of Friday, in either time of
 * year. Pure: `now` arrives as an argument, so a test pins it and the page's clock is the
 * page's own (`page-clock.ts`: the page that says it is held to the next wall midnight).
 */
export type AwayFrom = { kind: "now" | "today" | "tomorrow" } | { kind: "days" | "weeks" | "months"; count: number };

/** Where the days stop and the weeks begin, and the weeks stop and the months begin. */
const WEEKS_FROM_DAYS = 14;
const MONTHS_FROM_DAYS = 60;

export function awayFrom(startsAt: Date, now: Date, timeZone: string): AwayFrom {
  if (startsAt.getTime() <= now.getTime()) return { kind: "now" };
  const days = daysUntilOnWallClock(startsAt, now, timeZone);
  // Not started but zero days (or fewer, were the zone ever to disagree with the clock): it is today.
  if (days <= 0) return { kind: "today" };
  if (days === 1) return { kind: "tomorrow" };
  if (days < WEEKS_FROM_DAYS) return { kind: "days", count: days };
  if (days < MONTHS_FROM_DAYS) return { kind: "weeks", count: Math.floor(days / 7) };
  return { kind: "months", count: Math.floor(days / 30) };
}

/**
 * The same distance to the hour (§843; the owner, 2026-10-21, of «Peste 4 zile» on the calendar's card: «Here I want you to
 * tell me also the hours until the event, not just the day»), for the line the browser refines (`AwayLine`) — the page is
 * cached until the club's midnight, so only the visitor's own clock can say the hours (§834's reason for refusing them).
 *
 * - `now` — it has started;
 * - `minutes` — less than an hour to go, with the calendar day it falls on («Azi, peste 40 de minute»);
 * - `hours` — less than a day to go, with its calendar day («Mâine, peste 14 ore»);
 * - `daysHours` — from a day to under fourteen: whole 24-hour days and the hours left («Peste 4 zile și 3 ore»), elapsed time,
 *   never calendar days, so «4 zile și 3 ore» is exactly that long; no hours left is «Peste 4 zile»;
 * - from fourteen days on, `awayFrom`'s weeks and months: an hour means nothing at that distance.
 *
 * The calendar day of `minutes` and `hours` is `daysUntilOnWallClock` on `timeZone`, as `awayFrom` counts it: 0 «Azi», 1 «Mâine».
 */
export type AwayPrecise =
  | { kind: "now" }
  | { kind: "minutes" | "hours"; count: number; day: "today" | "tomorrow" }
  | { kind: "daysHours"; days: number; hours: number }
  | { kind: "weeks" | "months"; count: number };

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export function awayPrecise(startsAt: Date, now: Date, timeZone: string): AwayPrecise {
  const left = startsAt.getTime() - now.getTime();
  if (left <= 0) return { kind: "now" };
  const coarse = awayFrom(startsAt, now, timeZone);
  if (coarse.kind === "weeks" || coarse.kind === "months") return { kind: coarse.kind, count: coarse.count };
  if (left < DAY_MS) {
    const day = daysUntilOnWallClock(startsAt, now, timeZone) <= 0 ? "today" : "tomorrow";
    // Rounded up: «peste 1 minut» until it starts, never «peste 0 minute»; an hour and a half is still «peste 1 oră».
    if (left < HOUR_MS) return { kind: "minutes", count: Math.max(1, Math.ceil(left / MINUTE_MS)), day };
    return { kind: "hours", count: Math.floor(left / HOUR_MS), day };
  }
  return { kind: "daysHours", days: Math.floor(left / DAY_MS), hours: Math.floor((left % DAY_MS) / HOUR_MS) };
}
