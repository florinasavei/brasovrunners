/**
 * A race time as the club types it and as the page says it (§NNN, race results part 1).
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
 */

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
