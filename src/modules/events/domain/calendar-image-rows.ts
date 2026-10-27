import { dayKey, type YearMonth } from "./calendar";
import { calendarTone } from "./calendar-kind";
import type { CalendarImageEntry } from "./calendar-image";
import { groupSeries } from "./series";
import type { PublicEvent } from "../repository";

/**
 * The words the caller formats for a date, in the page's language: the hour (null when it is to be
 * announced), and the distance's and the climb's short forms (null when the event has none) — the site's
 * own words (`distance.ts`, `elevation.ts`), which need a translator this module does not have.
 */
export type CalendarImageFormat = {
  time: (event: PublicEvent) => string | null;
  distance: (event: PublicEvent) => string | null;
  elevation: (event: PublicEvent) => string | null;
};

/**
 * The month's dates in the picture's terms, soonest first. `time`, `distance` and `elevation` are formatted
 * by the caller (the page's language and the club's zone); the short place is copied from the event as the
 * public read gives it (`locationShort`, null while the place is to be announced); everything decided here
 * is pure.
 */
export function calendarImageRows(
  month: YearMonth,
  events: readonly PublicEvent[],
  format: CalendarImageFormat,
): { entries: CalendarImageEntry[]; series: PublicEvent[][]; singles: PublicEvent[] } {
  const prefix = `${month.year}-${String(month.month).padStart(2, "0")}-`;
  const inMonth = [...events]
    .filter((event) => dayKey(event.startsAt, event.timezone).startsWith(prefix))
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  const entries = inMonth.map((event) => ({
    day: Number(dayKey(event.startsAt, event.timezone).slice(8, 10)),
    time: event.timeToBeAnnounced ? null : format.time(event),
    title: event.title ?? "",
    tone: calendarTone(event),
    type: event.type,
    surface: event.surface ?? null,
    special: event.isSpecial,
    cancelled: event.eventStatus === "CANCELLED",
    ...calendarImageDetails(event, format),
  }));
  const groups = groupSeries(inMonth).map((series) => series.members);
  return {
    entries,
    series: groups.filter((members) => members.length > 1),
    singles: groups.filter((members) => members.length === 1).map((members) => members[0]),
  };
}

/** A date's details (`CalendarImageDetails`): the short place as read, the two words as the caller formats them. */
export function calendarImageDetails(event: PublicEvent, format: Pick<CalendarImageFormat, "distance" | "elevation">) {
  return { place: event.locationShort ?? null, distance: format.distance(event), elevation: format.elevation(event) };
}
