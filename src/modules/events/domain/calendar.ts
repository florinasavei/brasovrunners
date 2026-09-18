import { fromWallTimeInput, toWallTimeInput } from "./zoned-time";

/**
 * The month view of the listing (`DECISIONS.md` §89): a club that runs every Monday and
 * Wednesday and some weekends is a calendar, not a list, and the owner asked for one "similar
 * to Google Calendar".
 *
 * Everything here is wall-clock arithmetic in the club's zone: the month begins at midnight
 * in Brașov, not in UTC, and an event at 23:30 on the 31st belongs to that month wherever the
 * server runs. Days are `YYYY-MM-DD` strings, which sort, compare and key a map without a
 * `Date` in sight.
 */

export type YearMonth = { year: number; month: number };

const MONTH_PARAM = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** The month the URL asked for, or the current one; anything else is the current one too. */
export function parseMonth(value: string | string[] | undefined, now: Date, timeZone: string): YearMonth {
  const raw = Array.isArray(value) ? value[0] : value;
  const match = raw ? MONTH_PARAM.exec(raw) : null;
  if (match) {
    const year = Number(match[1]);
    // Two years either way is as far as the listing goes: further is not a schedule.
    const current = currentMonth(now, timeZone);
    if (Math.abs(year - current.year) <= 2) return { year, month: Number(match[2]) };
  }
  return currentMonth(now, timeZone);
}

export function currentMonth(now: Date, timeZone: string): YearMonth {
  const wall = toWallTimeInput(now, timeZone);
  return { year: Number(wall.slice(0, 4)), month: Number(wall.slice(5, 7)) };
}

export function shiftMonth({ year, month }: YearMonth, by: number): YearMonth {
  const index = year * 12 + (month - 1) + by;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

export function monthParam({ year, month }: YearMonth): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** The instants the month spans in the club's zone: `[from, to)`. */
export function monthRange(ym: YearMonth, timeZone: string): { from: Date; to: Date } {
  const next = shiftMonth(ym, 1);
  const from = fromWallTimeInput(`${monthParam(ym)}-01T00:00`, timeZone);
  const to = fromWallTimeInput(`${monthParam(next)}-01T00:00`, timeZone);
  if (!from || !to) throw new Error(`cannot place ${monthParam(ym)} in ${timeZone}`);
  return { from, to };
}

export type CalendarDay = { key: string; day: number; inMonth: boolean };

/**
 * The weeks of the grid, Monday first, each seven days, padded with the neighbouring months'
 * days so every row is full. Pure date arithmetic on UTC midnights — no zone is involved,
 * because a day of the month is the same day in every zone.
 */
export function monthGrid({ year, month }: YearMonth): CalendarDay[][] {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const lead = (first.getUTCDay() + 6) % 7; // Monday = 0
  const start = new Date(Date.UTC(year, month - 1, 1 - lead));
  const weeks: CalendarDay[][] = [];
  const cursor = new Date(start);
  do {
    const week: CalendarDay[] = [];
    for (let i = 0; i < 7; i += 1) {
      week.push({
        key: cursor.toISOString().slice(0, 10),
        day: cursor.getUTCDate(),
        inMonth: cursor.getUTCMonth() === month - 1,
      });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    weeks.push(week);
  } while (cursor.getUTCMonth() === month - 1);
  return weeks;
}

/** The day an instant falls on in a zone, as a grid key. */
export function dayKey(at: Date, timeZone: string): string {
  return toWallTimeInput(at, timeZone).slice(0, 10);
}

/** Events grouped by the day they start, each group in start order (the input's order). */
export function groupByDay<T extends { startsAt: Date; timezone: string }>(items: T[]): Map<string, T[]> {
  const byDay = new Map<string, T[]>();
  for (const item of items) {
    const key = dayKey(item.startsAt, item.timezone);
    const group = byDay.get(key);
    if (group) group.push(item);
    else byDay.set(key, [item]);
  }
  return byDay;
}
