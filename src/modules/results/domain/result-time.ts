/**
 * A race time as the club types it and as the page says it (§808, race results part 1).
 *
 * Stored as whole milliseconds from the gun (`event_results.gun_time_ms`), typed in the shapes a stopwatch
 * and a timing sheet use:
 *
 * - `h:mm:ss` — `1:23:45`;
 * - `m:ss` or `mm:ss` — `45:12`, `9:05`; here the minutes may pass sixty (`125:30` is two hours, five minutes);
 * - either with a fraction of a second after a dot or a comma, up to three digits — `45:12.3`, `1:23:45,25`.
 *
 * Pure: no database, no React, no catalogue. A time that is not one of these, or is zero, or runs past two days,
 * is `null` — the caller says which box and why.
 *
 * The browser's half lives here too (§NNN): what the «Timp» and «Timp cip» boxes make of a time typed in another
 * shape — digits alone, dots, commas, spaces — on leaving the box (`normalizeTypedResultTime`), and what the clock
 * picker beside them opens at and writes (`clockOfResultTime`, `resultTimeOfClock`). Both answer in the shapes
 * `parseResultTime` reads, so the server's parser and its refusals stay as they were.
 */
import type { ClockTime } from "@/shared/forms/pickers/clock-values";

/** The longest time taken at face value: two days. A typo (`999:99:99`) is refused, never stored. */
export const RESULT_TIME_MAX_MS = 48 * 60 * 60 * 1000;

const TIME_PATTERN = /^(?:(\d{1,2}):)?(\d{1,3}):(\d{2})(?:[.,](\d{1,3}))?$/;

/**
 * The milliseconds a typed time stands for, or null for anything else (an empty box, a word, a zero,
 * a minute or second past fifty-nine where it has an hour or a minute before it).
 */
export function parseResultTime(text: string | null | undefined): number | null {
  if (typeof text !== "string") return null;
  const match = TIME_PATTERN.exec(text.trim());
  if (!match) return null;
  const hoursText = match[1];
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const fraction = match[4] === undefined ? 0 : Number(match[4].padEnd(3, "0"));
  if (seconds > 59) return null;
  // `h:mm:ss`: the minutes are one hour's, so under sixty and written with two digits; `m:ss` may pass sixty.
  if (hoursText !== undefined && (minutes > 59 || match[2].length !== 2)) return null;
  const hours = hoursText === undefined ? 0 : Number(hoursText);
  const total = ((hours * 60 + minutes) * 60 + seconds) * 1000 + fraction;
  if (total <= 0 || total > RESULT_TIME_MAX_MS) return null;
  return total;
}

/**
 * A time as the box shows it: `h:mm:ss`, with the fraction of a second only when there is one, trimmed
 * (`1:23:45`, `0:45:12.3`). The same shapes `parseResultTime` reads back, so a save of what the page drew
 * changes nothing.
 */
export function formatResultTime(ms: number | null | undefined): string {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return "";
  const whole = Math.floor(ms / 1000);
  const fraction = ms - whole * 1000;
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const seconds = whole % 60;
  const base = `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  if (fraction === 0) return base;
  return `${base}.${String(fraction).padStart(3, "0").replace(/0+$/, "")}`;
}

/** Digits alone, three to six of them, with a fraction of a second after a dot or a comma: «2345», «12345», «2345,6». */
const TYPED_DIGITS = /^(\d{3,6})(?:[.,](\d{1,3}))?$/;

/** The separators a keyboard offers between hours, minutes and seconds: a dot, a comma, a colon — spaces around them — or a space. */
const TYPED_SEPARATOR = /\s*[.,:]\s*|\s+/;

/**
 * The shapes a typed time may stand for, the likelier first; `normalizeTypedResultTime` keeps the first the server reads.
 *
 * - **Digits alone** are read from the right: the last two are the seconds, the two before them the minutes, the rest
 *   the hours, its leading zero dropped — «945» is 9:45, «2345» is 23:45, «12345» and «012345» are 1:23:45 — and a
 *   fraction after them stays one: «2345,6» is 23:45.6.
 * - **Groups** of one to three digits between separators: two are minutes and seconds («23.45» → 23:45); three are
 *   hours, minutes and seconds («1.23.45», «1 23 45», «1,23,45» → 1:23:45) or, when that is no time, minutes,
 *   seconds and a fraction («23.45.6» → 23:45.6); four are hours, minutes, seconds and a fraction.
 */
function typedShapes(text: string): string[] {
  const digits = TYPED_DIGITS.exec(text);
  if (digits) {
    const run = digits[1];
    const seconds = run.slice(-2);
    const minutes = run.slice(-4, -2);
    const hours = run.slice(0, -4);
    const fraction = digits[2] === undefined ? "" : `.${digits[2]}`;
    return [hours === "" ? `${Number(minutes)}:${seconds}${fraction}` : `${Number(hours)}:${minutes}:${seconds}${fraction}`];
  }
  const groups = text.split(TYPED_SEPARATOR);
  if (!groups.every((group) => /^\d{1,3}$/.test(group))) return [];
  const [first, second, third, fourth] = groups;
  const lead = String(Number(first));
  switch (groups.length) {
    case 2:
      return [`${lead}:${second}`];
    case 3:
      return [`${lead}:${second}:${third}`, `${lead}:${second}.${third}`];
    case 4:
      return [`${lead}:${second}:${third}.${fourth}`];
    default:
      return [];
  }
}

/**
 * What the «Timp» and «Timp cip» boxes make of what was typed, on leaving the box or pressing Enter in it (§NNN): a
 * phone's decimal keypad has digits and one separator, and no colon. A text the server already reads is left exactly
 * as typed (trimmed) — `h:mm:ss`, `mm:ss`, `mm:ss.t` and their commas; digits alone and the usual separators become the
 * shape they stand for (`typedShapes`): «2345» → «23:45», «12345» → «1:23:45», «2345,6» → «23:45.6», «1.23.45» →
 * «1:23:45». Whatever it writes, `parseResultTime` reads; anything else — «45», «1.5.30», «25:61», a word — comes back
 * as typed, trimmed, for the server to refuse with its own sentence, as `normalizeTypedTime` does for the event's hour.
 */
export function normalizeTypedResultTime(typed: string): string {
  const text = typed.trim();
  if (text === "" || parseResultTime(text) !== null) return text;
  return typedShapes(text).find((shape) => parseResultTime(shape) !== null) ?? text;
}

/** A day's seconds: the clock's hours stop at 23, so a time of a day or more is typed, never picked. */
const DAY_SECONDS = 24 * 60 * 60;

/**
 * Where the clock picker opens for what a box holds (§NNN): the time as `normalizeTypedResultTime` reads it, in whole
 * seconds — a box with tenths («45:12.3») opens at 0:45:12. Null — the picker opens at 0:00:00 — for an empty box, a
 * text that is no time, or a time of 24 hours or more, which the clock's hours cannot show.
 */
export function clockOfResultTime(text: string): ClockTime | null {
  const ms = parseResultTime(normalizeTypedResultTime(text));
  if (ms === null) return null;
  const whole = Math.floor(ms / 1000);
  if (whole >= DAY_SECONDS) return null;
  return { hours: Math.floor(whole / 3600), minutes: Math.floor((whole % 3600) / 60), seconds: whole % 60 };
}

/** What «OK» writes into the box for a picked time: `h:mm:ss`, the hour without a leading zero («1:23:45», «0:45:12») — `formatResultTime`'s own. */
export function resultTimeOfClock(time: ClockTime): string {
  return formatResultTime(((time.hours * 60 + time.minutes) * 60 + time.seconds) * 1000);
}
