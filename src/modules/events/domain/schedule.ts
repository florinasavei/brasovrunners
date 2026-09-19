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
