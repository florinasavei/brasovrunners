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
