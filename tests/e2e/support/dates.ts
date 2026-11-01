/**
 * Dates for the e2e specs that the calendar never reaches (§883).
 *
 * A spec used to write the day of its event as a literal (`"2027-04-14"`), and every such literal
 * started failing as the day passed: the event was in the past, so it left the listing, the
 * registration closed and the signing window shut. This module keeps the literal as a *pattern*
 * and returns the same day of the week on a calendar that is always ahead:
 *
 *     fillDateField(page, "Începutul evenimentului", ahead("2027-05-04"));
 *
 * One shift serves the whole suite — a whole number of weeks, the smallest that puts `ANCHOR`
 * at least `LEAD_DAYS` ahead of today in Brașov — so what a spec relied on stays true:
 *
 *  - the weekday of every date (a shift of whole weeks never changes it);
 *  - the gap between two dates of one spec (a series' `until` before its start, a second date a
 *    week later, a Wednesday after a Monday), and two dates written alike stay equal;
 *  - the lead: the earliest pattern is always about as far ahead as it was when the specs were
 *    written, so no registration window a spec opens has started already.
 *
 * The shift is read once per process, when this module is first imported, so a spec that crosses
 * the club's midnight fills a box with `ahead(...)` and asserts `ahead(...)` on the same day.
 *
 * What a whole-week shift does NOT keep is the month, the year and the season. A spec that reads
 * one of those (a month named in a header, `?month=`, the line under a typed date, an age, the
 * sunset) derives it from the date it typed — `monthOf`, `written`, `dayLine`, `dmy`, `birthOn`,
 * `yearsBefore` — or asks for its season with `nextMonthDay`, never from a second literal. A time of day
 * typed into the editor is local and is not affected; an instant written into the database is
 * written as a local time (`AT TIME ZONE 'Europe/Bucharest'`), because the offset changes with
 * the season and a shifted summer instant would read an hour early in winter.
 */

/** The earliest date any spec wrote when the helper was made: the pattern the shift is measured on. */
const ANCHOR = "2027-04-14";
/** 24 weeks: about how far ahead the earliest written date was (1 November 2026 to 14 April 2027). */
const LEAD_DAYS = 24 * 7;
const DAY_MS = 24 * 3_600_000;
const TIME_ZONE = "Europe/Bucharest";

/** Today's date in Brașov as `YYYY-MM-DD` — the club's calendar, whatever the machine's zone. */
export function todayInBrasov(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

function dayNumber(iso: string): number {
  const [year, month, day] = iso.split("-").map(Number);
  return Math.round(Date.UTC(year, month - 1, day) / DAY_MS);
}

function isoOf(days: number): string {
  return new Date(days * DAY_MS).toISOString().slice(0, 10);
}

/** The whole weeks the suite's dates are moved by: 0 while the written dates are still far enough ahead. */
export function weeksShift(now: Date = new Date()): number {
  const short = dayNumber(todayInBrasov(now)) + LEAD_DAYS - dayNumber(ANCHOR);
  return Math.max(0, Math.ceil(short / 7));
}

/** The suite's shift, read once per process: every `ahead` of one run moves by the same weeks, even across midnight. */
const SHIFT = weeksShift();

/**
 * The written date, moved a whole number of weeks forward so it is ahead of today: same weekday,
 * same gaps. `now` is for the unit test alone; a spec leaves it out and gets the process's one shift.
 */
export function ahead(written: string, now?: Date): string {
  return isoOf(dayNumber(written) + 7 * (now ? weeksShift(now) : SHIFT));
}

/** The `YYYY-MM` of a date — the calendar's `?month=`. */
export function monthOf(iso: string): string {
  return iso.slice(0, 7);
}

/** The first `month`/`day` (1-based) on or after today plus `weeksAway` weeks: a date whose season is fixed (the sunset of a November evening). */
export function nextMonthDay(month: number, day: number, weeksAway = 12, now: Date = new Date()): string {
  const from = dayNumber(todayInBrasov(now)) + weeksAway * 7;
  let year = new Date(from * DAY_MS).getUTCFullYear();
  for (;;) {
    const candidate = Date.UTC(year, month - 1, day);
    if (Math.round(candidate / DAY_MS) >= from) return new Date(candidate).toISOString().slice(0, 10);
    year += 1;
  }
}

/** A date as the site writes it, from the language's own formatter: `{ weekday: "short", day: "numeric", month: "short", year: "numeric" }` and so on. */
export function written(iso: string, locale: "ro" | "en", options: Intl.DateTimeFormatOptions): string {
  const [year, month, day] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat(locale, { timeZone: "UTC", ...options }).format(new Date(Date.UTC(year, month - 1, day)));
}

/** `iso` moved by whole days. */
export function addDays(iso: string, days: number): string {
  return isoOf(dayNumber(iso) + days);
}

/**
 * A birth date that makes someone exactly `age` years old on `runDay`, with the next birthday
 * `daysUntilBirthday` days after it (1 = one day short of the next year). A spec that types a
 * birth date against the run's age limits (§561) derives it from the run's day, because that day
 * moves with `ahead` and a written 1990 would be a year older each time it did. A 29 February
 * birthday is read as 1 March, so the year is always one the calendar has.
 */
export function birthOn(runDay: string, age: number, daysUntilBirthday: number): string {
  let birthday = addDays(runDay, daysUntilBirthday);
  if (birthday.slice(5) === "02-29") birthday = addDays(birthday, 1);
  const [year, month, day] = birthday.split("-");
  return `${Number(year) - age - 1}-${month}-${day}`;
}

/** The same day `years` earlier: the last birth date that is `years` old on `iso` (a 29 February is not asked for before 2044: its one caller types a Monday, and the next Monday 29 February is in 2044). */
export function yearsBefore(iso: string, years: number): string {
  return `${Number(iso.slice(0, 4)) - years}${iso.slice(4)}`;
}

/** `DD.MM.YYYY`, how the typed birth-date box shows a date once it is left. */
export function dmy(iso: string): string {
  const [year, month, day] = iso.split("-");
  return `${day}.${month}.${year}`;
}

/** `DDMMYYYY`, what a phone's numeric keypad types (it has no dot). */
export function digits(iso: string): string {
  return dmy(iso).replaceAll(".", "");
}

const RO_DAYS = ["Duminică", "Luni", "Marți", "Miercuri", "Joi", "Vineri", "Sâmbătă"];
const RO_MONTHS = ["ianuarie", "februarie", "martie", "aprilie", "mai", "iunie", "iulie", "august", "septembrie", "octombrie", "noiembrie", "decembrie"];
const EN_DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const EN_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** The line a typed date box says under itself: «Vineri, 11 mai 1990» / «Friday, 11 May 1990». */
export function dayLine(iso: string, locale: "ro" | "en"): string {
  const [year, month, day] = iso.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return locale === "ro"
    ? `${RO_DAYS[weekday]}, ${day} ${RO_MONTHS[month - 1]} ${year}`
    : `${EN_DAYS[weekday]}, ${day} ${EN_MONTHS[month - 1]} ${year}`;
}
