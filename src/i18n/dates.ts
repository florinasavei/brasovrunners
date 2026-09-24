/**
 * Every date a person reads, written one way, with its day of the week (§NNN; the owner,
 * 2026-09-24: "I want all dates to show the day of the week as well, like 'Sâmbătă, 17 Jan,
 * 2027'").
 *
 * Two styles and nothing else:
 *
 *   - **long** — event pages, emails, the declaration, headings, facts:
 *     "Sâmbătă, 16 ian. 2027" / "Saturday, 16 Jan 2027", and with a time
 *     "Sâmbătă, 16 ian. 2027, 09:30" — always 24-hour, never AM/PM;
 *   - **short** — tables, list rows, chips, calendar cells, the desk, the timeline:
 *     "Sâm., 16 ian. 2027" / "Sat, 16 Jan 2027".
 *
 * The month is abbreviated in both; the weekday is what the style changes.
 *
 * **Composed, not left to one `Intl` pattern.** The weekday, the day-month-year and the time are
 * formatted apart and joined with ", ". One pattern with every field in it is ICU's to lay out,
 * and ICU versions differ on the comma after an English weekday ("Saturday 16 Jan" in some,
 * "Saturday, 16 Jan" in others) — so the same date could read two ways on two machines. Each
 * piece on its own is stable, and the join is ours.
 *
 * **Capitalisation is the position's.** Romanian writes a weekday in lower case inside a
 * sentence ("are loc sâmbătă, 16 ian.") and with a capital where the date starts a label, a
 * line, a cell or a heading ("Sâmbătă, 16 ian. 2027"). `position` says which: "start" (the
 * default) capitalises the first letter, "inline" leaves the language's own case. English
 * weekday names are capitalised either way.
 *
 * **The zone is the caller's to name.** An event's date is formatted in the event's own zone
 * (`event.timezone`), never the server's or the browser's; a platform timestamp (a submission,
 * an audit row) in the club's, `CLUB_TIME_ZONE`. A date with no time at all — a `date` column,
 * "2027-01-16" — goes through `formatCalendarDay`, which has no zone to get wrong.
 *
 * **The language is the reader's**: a page's own locale, an email's registration language
 * (each half of a bilingual one in its own), the declaration's language on its PDF.
 *
 * Import-free beyond `Intl`, so a client island may use it too (§188) — but a client island
 * must not format a date the server already rendered (§324): pass it the server's string.
 *
 * Kept as they are, on purpose: birth dates (a weekday on a birth date means nothing), the
 * date and time inputs (the pickers' 30.09.2026 / 19:00, §303), and every machine format —
 * CSV and xlsx exports, JSON, the calendar file's DTSTART/DTEND, the sitemap, URLs and the
 * ISO text of a `<time dateTime>` attribute.
 */

/** The club's own zone, for a timestamp that belongs to no event (AGENTS.md §3.1). */
export const CLUB_TIME_ZONE = "Europe/Bucharest";

export type DayStyle = "long" | "short";

/** The `Intl` locale for a page, message or document language: Romanian, or British English. */
export function intlLocale(locale: string): "ro-RO" | "en-GB" {
  return locale === "ro" || locale === "ro-RO" ? "ro-RO" : "en-GB";
}

/**
 * The same formats, by name, for next-intl's `formats.dateTime` (`src/i18n/request.ts`), so a
 * Server Component may write `format.dateTime(date, "dayLong")` and a message may carry
 * `{when, date, dayLong}`. Those are ICU's own layout and its own case — lower case in
 * Romanian, which is right inside a sentence; a date that starts a line goes through
 * `formatDay`, which capitalises and fixes the comma.
 */
export const DATE_FORMATS = {
  dayLong: { weekday: "long", day: "numeric", month: "short", year: "numeric" },
  dayShort: { weekday: "short", day: "numeric", month: "short", year: "numeric" },
  dayLongTime: { weekday: "long", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" },
  dayShortTime: { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" },
  time: { hour: "2-digit", minute: "2-digit", hourCycle: "h23" },
} satisfies Record<string, Intl.DateTimeFormatOptions>;

type Position = "start" | "inline";

export type DayOptions = {
  /** The reader's language: "ro" or "en" (anything else reads as English). */
  locale: string;
  /** The event's own zone for an event date; `CLUB_TIME_ZONE` for a platform timestamp. */
  timeZone: string;
  style?: DayStyle;
  /** ", 09:30" after the date, in the same zone, always 24-hour. */
  withTime?: boolean;
  /**
   * False only where a header around the date already names the year — a month's calendar
   * grid. Everywhere else a date carries its year.
   */
  year?: boolean;
  /** "start" capitalises the first letter (the default); "inline" keeps Romanian's lower case. */
  position?: Position;
};

// One formatter per locale, zone and pattern: a table of two hundred rows would otherwise
// build six hundred of them, and `Intl.DateTimeFormat` is not cheap to construct.
const cache = new Map<string, Intl.DateTimeFormat>();
function formatter(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let found = cache.get(key);
  if (!found) {
    found = new Intl.DateTimeFormat(locale, options);
    cache.set(key, found);
  }
  return found;
}

/** The first letter in capitals, in the language's own rules ("ș" → "Ș"); the rest untouched. */
export function capitalizeFirst(text: string, locale: string): string {
  if (text === "") return text;
  const first = text.codePointAt(0) as number;
  const width = first > 0xffff ? 2 : 1;
  return text.slice(0, width).toLocaleUpperCase(intlLocale(locale)) + text.slice(width);
}

function compose(instant: Date, timeZone: string, options: Omit<DayOptions, "timeZone">, withTime: boolean): string {
  const intl = intlLocale(options.locale);
  const weekday = formatter(intl, { weekday: options.style ?? "long", timeZone }).format(instant);
  const day = formatter(intl, {
    day: "numeric",
    month: "short",
    ...(options.year === false ? {} : { year: "numeric" }),
    timeZone,
  }).format(instant);
  const text = withTime ? `${weekday}, ${day}, ${formatTime(instant, { locale: options.locale, timeZone })}` : `${weekday}, ${day}`;
  return (options.position ?? "start") === "start" ? capitalizeFirst(text, options.locale) : text;
}

/**
 * An instant as a day a person reads: "Sâmbătă, 16 ian. 2027" / "Sat, 16 Jan 2027", with
 * ", 09:30" when `withTime` — in the zone the caller names.
 */
export function formatDay(date: Date, options: DayOptions): string {
  return compose(date, options.timeZone, options, options.withTime === true);
}

/**
 * A day with no time and no zone — a `date` column, "2027-01-16", or a `Date` made from one at
 * midnight UTC — read as the calendar day it names. Formatted at noon UTC, so no zone can move
 * it to the day before.
 */
export function formatCalendarDay(date: string | Date, options: Omit<DayOptions, "timeZone" | "withTime">): string {
  const iso = typeof date === "string" ? date.slice(0, 10) : date.toISOString().slice(0, 10);
  return compose(new Date(`${iso}T12:00:00Z`), "UTC", options, false);
}

/** "09:30", always 24-hour, in the zone the caller names. */
export function formatTime(date: Date, options: { locale: string; timeZone: string }): string {
  return formatter(intlLocale(options.locale), { ...DATE_FORMATS.time, timeZone: options.timeZone }).format(date);
}

/**
 * Two days as one span: "Sâm., 16 ian. 2027 – dum., 17 ian. 2027". The second day continues the
 * first, so it keeps the language's own case; the first follows `position`.
 */
export function formatDayRange(from: Date, until: Date, options: DayOptions): string {
  return `${formatDay(from, options)} – ${formatDay(until, { ...options, position: "inline" })}`;
}
