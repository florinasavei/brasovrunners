import { CLUB_TIME_ZONE } from "@/i18n/dates";

/**
 * Sample dates drawn from today (§162), at the club's wall-clock hours, so a seeded event never
 * slides into the past: a Sunday run last weekend, the Tâmpa run next Saturday, the intervals
 * next Wednesday, the race on a Sunday three weeks out.
 *
 * The club's zone is `CLUB_TIME_ZONE` (`club/club.json`, §NNN), never a name written here: a club
 * west of Greenwich has a negative offset, which the signed arithmetic below keeps.
 */
export const ZONE = CLUB_TIME_ZONE;

/** Today's date on the club's clock, as a UTC-midnight anchor to count days from. */
export function todayInBrasov(): Date {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return new Date(`${parts}T00:00:00Z`);
}

/** The club's offset from UTC at an instant, in milliseconds, signed: +3 h in a Romanian summer, −1 h in an Azores winter. */
function offsetAt(instant: Date): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
      .formatToParts(instant)
      .map((part) => [part.type, Number(part.value)]),
  );
  const wall = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return wall - Math.floor(instant.getTime() / 1000) * 1000;
}

/** `daysAhead` days from today, at `hour:minute` on the club's clock. */
export function atClubTime(daysAhead: number, hour: number, minute = 0): Date {
  const day = new Date(todayInBrasov().getTime() + daysAhead * 86_400_000);
  const ymd = day.toISOString().slice(0, 10);
  // The wall time read as if it were UTC, then moved by the zone's signed offset — asked twice, the
  // second time at the first answer, so a day the clock changes on lands on the offset in force then.
  const guess = new Date(`${ymd}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00Z`);
  const first = new Date(guess.getTime() - offsetAt(guess));
  return new Date(guess.getTime() - offsetAt(first));
}

/** The name the seeds have always used: `atClubTime`. */
export const atBrasov = atClubTime;

/** The next given weekday (0 = Sunday … 6 = Saturday) at least `minDaysAhead` days from today. */
export function nextWeekday(weekday: number, minDaysAhead: number): number {
  const today = todayInBrasov().getUTCDay();
  let days = minDaysAhead;
  while ((today + days) % 7 !== weekday) days += 1;
  return days;
}
