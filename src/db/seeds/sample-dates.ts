/**
 * The sample dates are drawn from today (`DECISIONS.md` §162): a Sunday run last weekend (a
 * past event, for the "latest past" fallback), the Tâmpa run next Saturday, the intervals next
 * Wednesday, the race on a Sunday three weeks out — at Brașov wall-clock hours. The dates
 * used to be written out for September 2026, and on the morning of 2026-09-20 the Tâmpa run
 * slid into the past on CI and took an e2e assertion with it.
 */
export const ZONE = "Europe/Bucharest";

/** Today's date in Brașov, as a UTC-midnight anchor to count days from. */
export function todayInBrasov(): Date {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return new Date(`${parts}T00:00:00Z`);
}

/** `daysAhead` days from today, at `hour:minute` on the Brașov clock. */
export function atBrasov(daysAhead: number, hour: number, minute = 0): Date {
  const day = new Date(todayInBrasov().getTime() + daysAhead * 86_400_000);
  const ymd = day.toISOString().slice(0, 10);
  // Bucharest is UTC+2 or UTC+3; ask Intl which, for that day, then build the instant.
  const guess = new Date(`${ymd}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00Z`);
  const local = new Intl.DateTimeFormat("en-GB", { timeZone: ZONE, hour: "2-digit", hourCycle: "h23" }).format(guess);
  const offsetHours = ((Number(local) - hour) % 24 + 24) % 24; // 2 or 3
  return new Date(guess.getTime() - offsetHours * 3_600_000);
}

/** The next given weekday (0 = Sunday … 6 = Saturday) at least `minDaysAhead` days from today. */
export function nextWeekday(weekday: number, minDaysAhead: number): number {
  const today = todayInBrasov().getUTCDay();
  let days = minDaysAhead;
  while ((today + days) % 7 !== weekday) days += 1;
  return days;
}

