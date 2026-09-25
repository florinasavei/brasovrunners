import dayjs, { type Dayjs } from "dayjs";
import { isDateValue } from "./wall-values";

/**
 * The posted date string and the date picker's own value, both ways (`DECISIONS.md` §345).
 *
 * The date picker holds a Day.js object, which is an instant in the *browser's* zone. Nothing
 * here lets that zone reach what is posted: a date goes in as the browser's noon of that day and
 * comes out as the year, month and day it was built from — noon because it has no daylight-saving
 * gap anywhere, unlike midnight on the last Sunday of March in Bucharest. The event's own zone is
 * not a browser's business at all: the service turns the posted pair into an instant with the
 * zone the form also posts, exactly as before the pickers (`events/domain/zoned-time.ts`).
 *
 * The time half no longer goes through here: `TimeField` is the platform's own `<input
 * type="time">` since §400 (amending §345), which reads and posts `HH:mm` directly with no
 * picker value to convert.
 *
 * What cannot be posted is posted as "": an empty box, or one half typed. The box itself says so
 * before the press (`DateField`), the way a half-typed native date box did.
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

function pad(value: number): string {
  return String(value).padStart(2, "0");
}
