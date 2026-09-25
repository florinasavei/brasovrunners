import { readScheduleItems } from "./schedule";
import { type Coordinates, isNightEvent, localDay, sunTimes, wallClockTime } from "./sun";

/**
 * Whether an occurrence is a night event (§NNN, replacing §382's "Necesită frontală" checkbox).
 *
 * `events.headlamp_required` is the organizer's override, `nightOverride` in the code: `true` is
 * "Da" (a night event whatever the sun does — a start in a forest at 18:30 in September), `false`
 * is "Nu" (never, whatever the sun does), and `null` — the default — is "Automat": **the start
 * and the end** are compared with civil dusk and civil dawn of its own date at the club's place
 * (`sun.ts`) — the owner, 2026-09-25: "Necesită frontală ar trebui să fie cumva eveniment de
 * noapte setat automat" said the start, but a run that starts in daylight and finishes after dusk
 * is a night run too. A weekly run is therefore a day run in June and a night run in November
 * without anybody touching it, and every date of a series answers for itself.
 *
 * The one function every surface asks — the pill (`route-pills.ts`), the featured hero, the
 * calendar entry, the `.ics`, the reminder, the editor's closed-card line — so none of them can
 * disagree about the same date.
 */
export type NightEventFacts = {
  /** It is a night event: the pill, the calendar line and the reminder's line are shown. */
  night: boolean;
  /** Where the answer came from: the organizer's "Da"/"Nu", or the sun. */
  source: "override" | "automatic";
  /** Sunset of the occurrence's own day on its wall clock, "16:36" — for the pill's tooltip and the lines. */
  sunset: string | null;
  /**
   * Where the span's own end came from, when the automatic answer used one (§NNN): the event's
   * own end, the latest timed programme row of the occurrence's own date, or the start alone —
   * for the editor's line and the pill's tooltip to name.
   */
  endSource: "event" | "programme" | "start" | null;
};

export type NightEventSource = {
  /** `events.headlamp_required`: true "Da", false "Nu", null "Automat". */
  nightOverride: boolean | null;
  /** The event's own zone, whose wall clock names the day and prints the time. */
  timezone: string;
  /**
   * `events.ends_at` (§NNN): the occurrence's own end, when the club named one — the automatic
   * answer's first place to look for the span's end. Absent from a caller that has not read it.
   */
  endsAt?: Date | null;
  /**
   * `events.schedule_items` (§NNN), raw: read for the latest timed row of the occurrence's own
   * date only when `endsAt` is unset — a schedule row on another date of a series is not this
   * occurrence's own. Absent from a caller that has not read it.
   */
  scheduleItems?: unknown;
};

/**
 * The occurrence's own end instant, and where it came from (§NNN): the event's own `endsAt` when
 * the club named one; else the latest timed programme row of the occurrence's own date (its
 * `endsAt`, or its `startsAt` when a row has none); else the start alone — a point, not a span,
 * which changes nothing about the start's own answer.
 */
function occurrenceSpanEnd(
  event: NightEventSource,
  occurrenceStartsAt: Date | null,
): { end: Date | null; source: "event" | "programme" | "start" | null } {
  if (!occurrenceStartsAt) return { end: null, source: null };
  if (event.endsAt) return { end: event.endsAt, source: "event" };
  const day = localDay(occurrenceStartsAt, event.timezone);
  const latest = readScheduleItems(event.scheduleItems)
    .filter((row) => localDay(new Date(row.startsAt), event.timezone) === day)
    .reduce<Date | null>((max, row) => {
      const end = new Date(row.endsAt ?? row.startsAt);
      return !max || end.getTime() > max.getTime() ? end : max;
    }, null);
  return latest ? { end: latest, source: "programme" } : { end: occurrenceStartsAt, source: "start" };
}

export function nightEvent(event: NightEventSource, occurrenceStartsAt: Date | null, place: Coordinates): NightEventFacts {
  const sunsetAt = occurrenceStartsAt ? sunTimes(localDay(occurrenceStartsAt, event.timezone), place)?.sunset ?? null : null;
  const sunset = sunsetAt ? wallClockTime(sunsetAt, event.timezone) : null;
  if (event.nightOverride !== null) return { night: event.nightOverride, source: "override", sunset, endSource: null };
  const nightAtStart = isNightEvent(occurrenceStartsAt, place, event.timezone);
  const { end, source: endSource } = occurrenceSpanEnd(event, occurrenceStartsAt);
  const nightAtEnd = isNightEvent(end, place, event.timezone);
  // The end is only named when it is the reason: a start already after dusk needs no mention of
  // when the run finishes (§NNN).
  return { night: nightAtStart || nightAtEnd, source: "automatic", sunset, endSource: !nightAtStart && nightAtEnd ? endSource : null };
}

/** The editor's three choices, as the radio posts them and the column stores them. */
export const NIGHT_CHOICES = ["auto", "yes", "no"] as const;
export type NightChoice = (typeof NIGHT_CHOICES)[number];

export function nightChoiceOf(nightOverride: boolean | null | undefined): NightChoice {
  return nightOverride === true ? "yes" : nightOverride === false ? "no" : "auto";
}

/** What the radio posted → the column: "yes" true, "no" false, anything else (and nothing) automatic. */
export function nightOverrideFromChoice(choice: string | null | undefined): boolean | null {
  return choice === "yes" ? true : choice === "no" ? false : null;
}
