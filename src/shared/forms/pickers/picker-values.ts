import dayjs, { type Dayjs } from "dayjs";
import { isDateValue, isTimeValue } from "./wall-values";

/**
 * The posted wall-clock strings and the pickers' own values, both ways (`DECISIONS.md` §NNN).
 *
 * A picker holds a Day.js object, which is an instant in the *browser's* zone. Nothing here lets
 * that zone reach what is posted: a date goes in as the browser's noon of that day and comes out
 * as the year, month and day it was built from; a time goes in on 1 January 2000 and comes out as
 * the hours and minutes it was built from. Noon and January are there because neither has a
 * daylight-saving gap anywhere — "03:30" on the last Sunday of March does not exist in Bucharest,
 * and a Date built on that day would quietly read "04:30". The event's own zone is not a
 * browser's business at all: the service turns the posted pair into an instant with the zone the
 * form also posts, exactly as before the pickers (`events/domain/zoned-time.ts`).
 *
 * What cannot be posted is posted as "": an empty box, or one half typed. The box itself says so
 * before the press (`DateField`, `TimeField`), the way a half-typed native date box did.
 */

/** A posted date (`2026-09-30`) as the date picker's value; null for "" or anything malformed. */
export function pickerDate(value: string | null | undefined): Dayjs | null {
  if (!value || !isDateValue(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  return dayjs(new Date(year, month - 1, day, 12, 0, 0, 0));
}

/** The date picker's value as posted: `YYYY-MM-DD`, or "" for nothing or a half-typed box. */
export function postedDate(value: Dayjs | null | undefined): string {
  if (!value || !value.isValid()) return "";
  const year = value.year();
  if (year < 1000 || year > 9999) return "";
  return `${year}-${pad(value.month() + 1)}-${pad(value.date())}`;
}

/** A posted time (`19:00`) as the time picker's value; null for "" or anything malformed. */
export function pickerClock(value: string | null | undefined): Dayjs | null {
  if (!value || !isTimeValue(value)) return null;
  const [hours, minutes] = value.split(":").map(Number);
  return dayjs(new Date(2000, 0, 1, hours, minutes, 0, 0));
}

/** The time picker's value as posted: `HH:mm` on the 24-hour clock, or "". */
export function postedClock(value: Dayjs | null | undefined): string {
  if (!value || !value.isValid()) return "";
  return `${pad(value.hour())}:${pad(value.minute())}`;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}
