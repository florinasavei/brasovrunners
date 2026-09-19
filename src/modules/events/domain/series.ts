import { toWallTimeInput, wallClockWeekday } from "./zoned-time";


/**
 * A repeated event as one line (`DECISIONS.md` §113). The owner, looking at fifty-two Mondays
 * as fifty-two cards: "I hate that editions are duplicated — I want to see a single line for
 * 'Running up that hill', like in Google Calendar."
 *
 * Occurrences stay rows — capacity, holds and the waiting list are per event — and the
 * *display* groups them. The series is recognised, not recorded: events of the same type with
 * the same title, in the language shown, are the same event again. That is what "Repeat" makes
 * (`copiedTranslationValues` carries the title), and it is also what a hand-made second edition
 * is; renaming one occurrence ("… — Christmas edition") takes it out of the line on purpose.
 * Pure functions, so the listing and the backoffice group the same way and a test can say so.
 */

export type SeriesMember = { type: string; title: string; startsAt: Date };

/** Case and spacing do not make a different event: "Running up that hill " is the same run. */
export function seriesKey(event: Pick<SeriesMember, "type" | "title">): string {
  return `${event.type}\n${event.title.trim().toLowerCase().replace(/\s+/g, " ")}`;
}

export type Series<T> = {
  key: string;
  /** Soonest first, whatever order the rows came in. */
  members: T[];
};

/**
 * Groups in order of first appearance, so a list sorted featured-first, races-first, soonest
 * (`listUpcomingEvents`) keeps that order for the lines: a series sits where its soonest
 * occurrence would have.
 */
export function groupSeries<T extends SeriesMember>(events: readonly T[]): Series<T>[] {
  const byKey = new Map<string, T[]>();
  for (const event of events) {
    const key = seriesKey(event);
    const members = byKey.get(key);
    if (members) members.push(event);
    else byKey.set(key, [event]);
  }
  return [...byKey].map(([key, members]) => ({
    key,
    members: [...members].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime()),
  }));
}

/**
 * How a series recurs, read off its dates on the wall clock of `timeZone`:
 *
 *   - `weekly` / `fortnightly` — every occurrence on one of `weekdays` (ISO, 1 = Monday), and
 *     consecutive occurrences on the same weekday always 7 (14) days apart; `time` is the
 *     shared `HH:MM`, or null when the occurrences start at different hours.
 *   - `dates` — anything else: a monthly run (the day of the month drifts on the weekday), a
 *     hand-made pair, one occurrence per weekday. The caller then says "N dates until …".
 */
export type Recurrence =
  | { kind: "weekly" | "fortnightly"; weekdays: number[]; time: string | null }
  | { kind: "dates" };

export function recurrenceOf(members: readonly { startsAt: Date }[], timeZone: string): Recurrence {
  if (members.length < 2) return { kind: "dates" };

  const walls = members.map((member) => toWallTimeInput(member.startsAt, timeZone));
  const times = new Set(walls.map((wall) => wall.slice(11, 16)));
  const weekdays = [...new Set(members.map((member) => wallClockWeekday(member.startsAt, timeZone)))].sort((a, b) => a - b);

  // Days between consecutive occurrences on the same weekday, on the calendar rather than in
  // hours — a clock change in between must not turn 7 days into 6.96.
  const datesByWeekday = new Map<number, number[]>();
  members.forEach((member, index) => {
    const weekday = wallClockWeekday(member.startsAt, timeZone);
    const day = Date.UTC(Number(walls[index].slice(0, 4)), Number(walls[index].slice(5, 7)) - 1, Number(walls[index].slice(8, 10)));
    datesByWeekday.set(weekday, [...(datesByWeekday.get(weekday) ?? []), day]);
  });
  const gaps = new Set<number>();
  for (const days of datesByWeekday.values()) {
    const sorted = [...days].sort((a, b) => a - b);
    for (let index = 1; index < sorted.length; index += 1) {
      gaps.add(Math.round((sorted[index] - sorted[index - 1]) / 86_400_000));
    }
  }
  if (gaps.size !== 1) return { kind: "dates" };
  const [gap] = gaps;
  if (gap !== 7 && gap !== 14) return { kind: "dates" };

  return { kind: gap === 7 ? "weekly" : "fortnightly", weekdays, time: times.size === 1 ? [...times][0] : null };
}

/**
 * What a series usually is — the place and the wall-clock time most of its dates share — so a
 * date that differs can say so (§122): cancelled, at another place, at another time. The
 * organizer edits one date like any event; nothing is recorded as "moved", it is read.
 */
export type Usual = { place: string | null; time: string | null };

const mode = <T,>(values: T[]): T | null => {
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best: T | null = null;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
};

export function usualOf(members: readonly { startsAt: Date; timezone: string; locationName: string | null }[]): Usual {
  return {
    place: mode(members.map((member) => member.locationName)),
    time: mode(members.map((member) => toWallTimeInput(member.startsAt, member.timezone).slice(11, 16))),
  };
}

export type EditionDifference =
  | { kind: "cancelled" }
  | { kind: "moved"; place: string }
  | { kind: "retimed"; time: string }
  | null;

/** Why this date is not like the series' others, or null when it is. Cancelled outranks the rest. */
export function editionDifference(
  member: { startsAt: Date; timezone: string; locationName: string | null; eventStatus: string },
  usual: Usual,
): EditionDifference {
  if (member.eventStatus === "CANCELLED") return { kind: "cancelled" };
  if (member.locationName && usual.place && member.locationName !== usual.place) return { kind: "moved", place: member.locationName };
  const time = toWallTimeInput(member.startsAt, member.timezone).slice(11, 16);
  if (usual.time && time !== usual.time) return { kind: "retimed", time };
  return null;
}
