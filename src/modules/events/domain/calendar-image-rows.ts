import { dayKey, type YearMonth } from "./calendar";
import { calendarTone } from "./calendar-kind";
import type { CalendarImageEntry } from "./calendar-image";
import { groupSeries } from "./series";
import type { PublicEvent } from "../repository";

/**
 * The month's dates in the picture's terms, soonest first. `time` and `sentence` are formatted by the
 * caller (the page's language and the club's zone); everything decided here is pure.
 */
export function calendarImageRows(
  month: YearMonth,
  events: readonly PublicEvent[],
  time: (event: PublicEvent) => string | null,
): { entries: CalendarImageEntry[]; series: PublicEvent[][]; singles: PublicEvent[] } {
  const prefix = `${month.year}-${String(month.month).padStart(2, "0")}-`;
  const inMonth = [...events]
    .filter((event) => dayKey(event.startsAt, event.timezone).startsWith(prefix))
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  const entries = inMonth.map((event) => ({
    day: Number(dayKey(event.startsAt, event.timezone).slice(8, 10)),
    time: event.timeToBeAnnounced ? null : time(event),
    title: event.title ?? "",
    tone: calendarTone(event),
    type: event.type,
    surface: event.surface ?? null,
    special: event.isSpecial,
    cancelled: event.eventStatus === "CANCELLED",
  }));
  const groups = groupSeries(inMonth).map((series) => series.members);
  return {
    entries,
    series: groups.filter((members) => members.length > 1),
    singles: groups.filter((members) => members.length === 1).map((members) => members[0]),
  };
}
