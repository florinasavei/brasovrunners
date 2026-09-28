import dayjs, { type Dayjs } from "dayjs";
import { isDateValue } from "./wall-values";

/**
 * The posted date string and the date picker's Day.js value, both ways (`DECISIONS.md` §345).
 *
 * A Day.js value is an instant in the browser's zone, so a date goes in as local noon (no DST gap
 * anywhere, unlike midnight) and comes out as the year, month and day it was built from; the
 * event's zone is the service's (`events/domain/zoned-time.ts`). Unpostable values post "".
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
