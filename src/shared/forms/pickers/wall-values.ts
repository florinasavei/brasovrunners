/**
 * What the backoffice's date and time boxes post, and what the date box shows (`DECISIONS.md`
 * §70, §303, §345, §400 and §439).
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
 *   box shows exactly what it posts, `19:00`, since §439: a typed 24-hour text box
 *   (`TimeField`), because the browser's own `<input type="time">` (§400) drew "07:00 PM" on an
 *   English-language browser, and no attribute can stop it.
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

/*
  The birth-date box (§561, applying §345's day-first order to the public registration form): a
  typed text box, not the picker — the picker is kept off every public page
  (`pickers-backoffice-only.test.ts`), and a birth date decades back is faster typed than paged
  to. It shows what the backoffice's picker shows, `DATE_DISPLAY_FORMAT`, and reads what it is
  given day first, whatever language the browser speaks: «05/11/1990» is 5 November.
*/

/** Day, month, year, with any one separator a keyboard offers: «11.05.1990», «11/5/1990», «11-05-1990», «11 05 1990». */
const TYPED_DAY_FIRST = /^(\d{1,2})\s*[./\-, ]\s*(\d{1,2})\s*[./\-, ]\s*(\d{4})$/;
/** Eight digits and nothing else — a phone's numeric keypad has no separator: «11051990». */
const TYPED_DIGITS = /^(\d{2})(\d{2})(\d{4})$/;

/**
 * The typed box's HTML `pattern`, for a browser without JavaScript: a day-first date, eight digits
 * or the posted `YYYY-MM-DD` (autofill, a pasted value). Browsers compile it with the `v` flag,
 * which wants `/` and `-` escaped inside a class; the unit test compiles it that way.
 */
export const TYPED_DATE_PATTERN = "\\s*(?:\\d{1,2}\\s*[.\\/\\-, ]\\s*\\d{1,2}\\s*[.\\/\\-, ]\\s*\\d{4}|\\d{8}|\\d{4}-\\d{2}-\\d{2})\\s*";

/**
 * What a typed date is: `YYYY-MM-DD`, or "" while the box holds no real day yet («11.05», «31.02.1990»,
 * «1990»). The posted shape is read as itself, so a value the server gave back, a browser's
 * autofill or a test's `fill("1990-05-17")` means what it says.
 */
export function readTypedDate(typed: string): string {
  const text = typed.trim();
  if (isDateValue(text)) return text;
  const parts = TYPED_DAY_FIRST.exec(text) ?? TYPED_DIGITS.exec(text);
  if (!parts) return "";
  const value = `${parts[3]}-${parts[2].padStart(2, "0")}-${parts[1].padStart(2, "0")}`;
  return isDateValue(value) ? value : "";
}

/** What the server reads from the typed box: the date as posted, or what was typed, trimmed, for the schema to refuse. */
export function normalizeTypedDate(typed: string): string {
  return readTypedDate(typed) || typed.trim();
}

/** What the typed box shows for a value: `11.05.1990` (`DATE_DISPLAY_FORMAT`), or the text as it was when it is no date. */
export function shownTypedDate(value: string): string {
  const date = readTypedDate(value);
  if (!date) return value;
  const [year, month, day] = date.split("-");
  return `${day}.${month}.${year}`;
}

export function isTimeValue(value: string): boolean {
  return TIME_VALUE.test(value);
}

/**
 * What the time box makes of what was typed into it, on the 24-hour clock and nothing else
 * (§439): "1900", "19.00", "19,00", "19h00" and "19 00" are "19:00"; "930" and "9:30" are
 * "09:30"; "7" and "19" are the hour on the dot. Anything that is no time of day — "25:00",
 * "7pm", "abc" — comes back as typed, trimmed, for the box's own pattern and the server to
 * refuse; "" stays "". No AM/PM is read, on purpose: a box that accepted "7 pm" would teach
 * the 12-hour clock the owner asked the platform never to show.
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
 * A time box as a live reader of the form sees it while it is still being typed (§439): what the
 * box will post («1900» → "19:00"), or "" while the box holds no time of day yet («19:», «7pm»).
 * Every island that follows the start box — the series sentence, the night line — asks this one,
 * so two readers of the same box never disagree before it is left.
 */
export function readTypedTime(typed: string): string {
  const time = normalizeTypedTime(typed);
  return isTimeValue(time) ? time : "";
}
