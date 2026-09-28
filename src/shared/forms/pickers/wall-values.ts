/**
 * What the backoffice's date and time boxes post and show (`DECISIONS.md` §70, §303, §345, §400,
 * §439).
 *
 * Posted: `YYYY-MM-DD` and 24-hour `HH:mm`, wall-clock values with no zone (`admin/actions.ts`
 * reads a pair in the event's own zone). Shown: the date day first, `30.09.2026` (Day.js tokens);
 * the time as posted, typed, since a native time input may draw "07:00 PM" (§439).
 *
 * The patterns are the scriptless boxes', so the browser refuses what the server would not read.
 * Imports nothing, like `registrations/domain/age.ts` (§188), to keep the browser bundle small.
 */

/** A date as posted: a real month and a day of at most 31 (the calendar is the service's). */
export const DATE_VALUE = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;

/** A time as posted: `00:00` to `23:59`, two digits each. */
export const TIME_VALUE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

/**
 * The same two rules as HTML `pattern`s (unanchored: the browser anchors them), written out so the
 * rendered box reads plainly; a unit test proves they match the regular expressions above.
 */
export const DATE_PATTERN = "\\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01])";
export const TIME_PATTERN = "(?:[01]\\d|2[0-3]):[0-5]\\d";

/** Day.js tokens (`DD`, not date-fns' `dd`): `30.09.2026` in both languages. */
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

/**
 * A typed time on the 24-hour clock (§439): "1900", "19.00", "19h00" → "19:00"; "930" → "09:30";
 * "7" → "07:00". Anything else comes back trimmed for the pattern and server to refuse. AM/PM is
 * never read, on purpose: the platform shows only the 24-hour clock.
 */
export function normalizeTypedTime(typed: string): string {
  const text = typed.trim();
  if (text === "") return "";
  const separated = /^(\d{1,2})\s*[:.,hH ]\s*(\d{2})$/.exec(text);
  const digits = /^\d{1,4}$/.test(text) ? text : null;
  let hour: number;
  let minute: number;
  if (separated) {
    hour = Number(separated[1]);
    minute = Number(separated[2]);
  } else if (digits && digits.length <= 2) {
    hour = Number(digits);
    minute = 0;
  } else if (digits) {
    hour = Number(digits.slice(0, digits.length - 2));
    minute = Number(digits.slice(-2));
  } else {
    return text;
  }
  if (hour > 23 || minute > 59) return text;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/**
 * A time box as live readers see it while typing (§439): what it will post, or "" while it holds
 * no time yet. Every island following the start box asks this, so they never disagree.
 */
export function readTypedTime(typed: string): string {
  const time = normalizeTypedTime(typed);
  return isTimeValue(time) ? time : "";
}
