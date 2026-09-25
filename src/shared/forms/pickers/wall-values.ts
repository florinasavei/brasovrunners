/**
 * What the backoffice's date and time boxes post, and what the date box shows (`DECISIONS.md`
 * §70, §303, §345 and its 2026-09-25 amendment).
 *
 * Two different things, kept apart on purpose:
 *
 * - **What is posted** has not changed since `0011`: a date is `YYYY-MM-DD`, a time is `HH:mm`
 *   on the 24-hour clock, both wall-clock values with no zone. `admin/actions.ts` joins a pair
 *   into the `<field>WallTime` string the service reads in the event's own zone; a date alone
 *   (a series' end, an album's day) is read as it is. Nothing below the form moved.
 * - **What the date box shows** is the club's: `30.09.2026`, day first, whatever language the
 *   browser speaks — the owner, over "09/30/2026": "timepickerul ar trebui să fie tot element
 *   MUI". The token is Day.js's, the adapter the picker uses (`DD`, not date-fns' `dd`). The time
 *   box shows whatever the browser's own `<input type="time">` shows since §345's 2026-09-25
 *   amendment (`TimeField`): no format token controls it any more, only `step={60}` and what it
 *   *posts*, which is unchanged.
 *
 * The patterns are the scriptless box's (`DateField` before the island takes over, and
 * `TimeField` always): with JavaScript off the box is a plain input, and the browser refuses
 * anything the server would not read — the same shape, so the parse on the server is untouched.
 *
 * Imports nothing, like `registrations/domain/age.ts` (§188): the browser gets a few regular
 * expressions, not a date library, from this file.
 */

/** A date as posted: a real month and a day of at most 31 (the calendar is the service's). */
export const DATE_VALUE = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;

/** A time as posted: `00:00` to `23:59`, two digits each. */
export const TIME_VALUE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

/**
 * The same two rules as HTML `pattern` attributes: the browser anchors a pattern itself, so the
 * `^…$` is off. Written out rather than derived from the regular expressions above so a reader of
 * the rendered box sees exactly this; the unit test proves the two say the same thing.
 */
export const DATE_PATTERN = "\\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01])";
export const TIME_PATTERN = "(?:[01]\\d|2[0-3]):[0-5]\\d";

/** What the date picker shows, in Day.js tokens: `30.09.2026`, in Romanian and in English. */
export const DATE_DISPLAY_FORMAT = "DD.MM.YYYY";

export function isDateValue(value: string): boolean {
  if (!DATE_VALUE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  // 31 February passes the pattern; a UTC date built from it rolls into March.
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}

export function isTimeValue(value: string): boolean {
  return TIME_VALUE.test(value);
}
