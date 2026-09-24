import type { Deadlines } from "@/modules/deadlines/domain/deadlines";
import { toWallTimeInput } from "./zoned-time";

/**
 * Whole calendar days from `now` to the event, counted on the event's own wall clock.
 *
 * "In 3 days" is a question about dates, not about 72-hour spans: a race on Saturday at 07:00
 * is "tomorrow" all of Friday, including Friday at 23:59, and never "in 0 days" at Friday
 * 08:00. And the dates are Brașov's, not the server's — Vercel's clock says UTC, where a
 * Saturday 07:00 race is still Friday at 04:00 UTC — so both instants are read as the wall
 * date in `timeZone` before they are subtracted (AGENTS.md §9.4: format in the event's zone).
 */
export function daysUntilOnWallClock(startsAt: Date, now: Date, timeZone: string): number {
  const dayNumber = (at: Date) => {
    const [year, month, day] = toWallTimeInput(at, timeZone).slice(0, 10).split("-").map(Number);
    return Date.UTC(year, month - 1, day) / 86_400_000;
  };
  return dayNumber(startsAt) - dayNumber(now);
}

/**
 * Whether the event is within race week — the last days before it, during which the homepage
 * counts down (`DECISIONS.md` §78): still ahead, and starting within the club's number of calendar
 * days (seven unless changed, §NNN). Null otherwise — an event that has started is the desk's
 * business, and one further out is an ordinary listing.
 */
export function raceWeek(
  event: { startsAt: Date; timezone: string },
  now: Date,
  deadlines: Pick<Deadlines, "raceWeekDays">,
): { days: number } | null {
  if (event.startsAt.getTime() <= now.getTime()) return null;
  const days = daysUntilOnWallClock(event.startsAt, now, event.timezone);
  return days <= deadlines.raceWeekDays ? { days } : null;
}
