import { z } from "zod";
import type { Locale } from "@/i18n/routing";
import { addWallClockInterval } from "./zoned-time";

/**
 * The programme as data (`DECISIONS.md` §117): the timed rows of a race day — kit pickup, the
 * briefing, the start, the cut-offs, the awards — as the event row stores them
 * (`events.schedule_items`) and as the page, the reminder and the calendar read them.
 *
 * Instants are ISO strings in the JSON, the label carries both languages, the place is the
 * club's own words (§36). Everything that reads the column goes through `readScheduleItems`,
 * which drops what is not a row rather than rendering it.
 */

export const scheduleItemSchema = z
  .object({
    startsAt: z.iso.datetime(),
    endsAt: z.iso.datetime().nullable(),
    label: z.object({ ro: z.string().trim().min(1).max(200), en: z.string().trim().min(1).max(200) }),
    place: z.string().trim().min(1).max(200).nullable(),
  })
  .strict();

export type ScheduleItem = z.infer<typeof scheduleItemSchema>;

/** The stored rows, soonest first; an empty list for null, a wrong shape, or no rows. */
export function readScheduleItems(json: unknown): ScheduleItem[] {
  const parsed = z.array(scheduleItemSchema).safeParse(json);
  if (!parsed.success) return [];
  return [...parsed.data].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

/**
 * The same rows, none with a place (`DECISIONS.md` §328): what the public reads while the event's
 * place is to be announced, for the staff preview. The public queries do the same in SQL
 * (`events/repository.ts#publicScheduleItems`).
 */
export function withoutPlaces(json: unknown): ScheduleItem[] {
  return readScheduleItems(json).map((item) => ({ ...item, place: null }));
}

/** A row in one language, with real instants — what a page, a mail or a calendar renders. */
export type ProgrammeRow = { startsAt: Date; endsAt: Date | null; label: string; place: string | null };

export function localizedSchedule(items: readonly ScheduleItem[], locale: Locale): ProgrammeRow[] {
  return items.map((item) => ({
    startsAt: new Date(item.startsAt),
    endsAt: item.endsAt ? new Date(item.endsAt) : null,
    label: item.label[locale],
    place: item.place,
  }));
}

/**
 * The same rows some days or months later on the wall clock, for a repeated event (§64): a
 * briefing at 08:30 stays at 08:30 across a clock change, like the start it precedes.
 */
export function shiftScheduleItems(
  items: readonly ScheduleItem[],
  timeZone: string,
  interval: { days?: number; months?: number },
): ScheduleItem[] {
  return items.map((item) => ({
    ...item,
    startsAt: addWallClockInterval(new Date(item.startsAt), timeZone, interval).toISOString(),
    endsAt: item.endsAt ? addWallClockInterval(new Date(item.endsAt), timeZone, interval).toISOString() : null,
  }));
}

/**
 * The editor's rows moved with the event's date: the programme is usually on the day of the
 * event, so when the organizer moves the start from `fromDate` to `toDate`, every row that has
 * a date moves by the same number of calendar days — a row on the old start lands on the new
 * one, the day before it (kit pickup) stays the day before. A row with no date, or one the
 * browser would refuse, is left as it is; so is every row when either anchor is not a date, or
 * the two are the same day.
 *
 * Calendar days on `YYYY-MM-DD` boxes, not instants: these are the form's inputs, and the
 * clock change is the service's business when the boxes are read at save time. Pure — it takes
 * the two dates and never reads the wall clock.
 */
export function shiftProgrammeDates<Row extends { date: string }>(rows: readonly Row[], fromDate: string, toDate: string): Row[] {
  const from = calendarDay(fromDate);
  const to = calendarDay(toDate);
  if (from === null || to === null || from === to) return [...rows];
  const delta = to - from;
  return rows.map((row) => {
    const day = calendarDay(row.date);
    return day === null ? row : { ...row, date: isoDate(day + delta) };
  });
}

const ISO_DATE = /^(\d{4,})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

/** A `YYYY-MM-DD` box as whole days since 1970-01-01, or null for anything else — an empty box included. */
function calendarDay(value: string): number | null {
  const match = ISO_DATE.exec(value);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  // `Date.UTC` reads a year under 100 as 19xx — and a date box reads "0002-11-21" while the
  // organizer is typing a year; `setUTCFullYear` reads the year as written.
  const at = new Date(0);
  at.setUTCFullYear(year, month - 1, day);
  // "2026-02-30" would roll over into March; a browser never posts it, and a row carrying it
  // is not a date to move.
  if (at.getUTCFullYear() !== year || at.getUTCMonth() !== month - 1 || at.getUTCDate() !== day) return null;
  return Math.round(at.getTime() / DAY_MS);
}

/** Whole days since 1970-01-01 back as a `YYYY-MM-DD` box. */
function isoDate(day: number): string {
  const at = new Date(day * DAY_MS);
  const pad = (n: number, width: number) => String(n).padStart(width, "0");
  return `${pad(at.getUTCFullYear(), 4)}-${pad(at.getUTCMonth() + 1, 2)}-${pad(at.getUTCDate(), 2)}`;
}

/**
 * "08:30 — Briefing (Cortul de start)", one line per row, for the plain places: the calendar's
 * description and the reminder. The date is written only when the programme spans days.
 */
export function programmeLines(rows: readonly ProgrammeRow[], timeZone: string, locale: Locale): string[] {
  if (rows.length === 0) return [];
  const days = new Set(rows.map((row) => dayOf(row.startsAt, timeZone)));
  const time = new Intl.DateTimeFormat(locale === "ro" ? "ro-RO" : "en-GB", { hour: "2-digit", minute: "2-digit", timeZone });
  const day = new Intl.DateTimeFormat(locale === "ro" ? "ro-RO" : "en-GB", { weekday: "short", day: "numeric", month: "short", timeZone });
  return rows.map((row) => {
    const when = [days.size > 1 ? day.format(row.startsAt) : "", time.format(row.startsAt) + (row.endsAt ? `–${time.format(row.endsAt)}` : "")]
      .filter(Boolean)
      .join(" ");
    return `${when} — ${row.label}${row.place ? ` (${row.place})` : ""}`;
  });
}

function dayOf(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone }).format(at);
}
