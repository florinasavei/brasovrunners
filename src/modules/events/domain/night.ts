import { readScheduleItems } from "./schedule";
import { type Coordinates, isNightEvent, localDay, sunTimes, wallClockTime } from "./sun";

/**
 * Whether an occurrence is a night event (§394, replacing §382's "Necesită frontală" checkbox).
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
  /**
   * The occurrence's own start on its wall clock, "19:00" (§404) — every sentence names it before
   * the sunset, so "Apusul la 19:00" on a 19:00 run cannot be read as the start: the owner,
   * 2026-09-25, "evenimentul începe atunci, nu apusul începe atunci!". Null without a start.
   */
  start: string | null;
  /** Sunset of the occurrence's own day on its wall clock, "16:36" — for the pill's tooltip and the lines. */
  sunset: string | null;
  /**
   * Sunrise of the occurrence's own day on its wall clock, "07:14" (§404) — so a start before it
   * (an automatic night event with no named end, chosen by the start alone rather than the span
   * running into the dark) can be told from one after sunset: the pill then says the run starts
   * before that sunrise, never "after the sunset", which an early-morning date is not.
   */
  sunrise: string | null;
  /**
   * Where the span's own end came from, when the automatic answer used one (§394): the event's
   * own end, the latest timed programme row of the occurrence's own date, or the start alone —
   * for the editor's line and the pill's tooltip to name.
   */
  endSource: "event" | "programme" | "start" | null;
  /** That end on the occurrence's wall clock, "18:15", whenever `endSource` names one — the words' `{end}`. */
  end: string | null;
};

export type NightEventSource = {
  /** `events.headlamp_required`: true "Da", false "Nu", null "Automat". */
  nightOverride: boolean | null;
  /** The event's own zone, whose wall clock names the day and prints the time. */
  timezone: string;
  /**
   * `events.ends_at` (§394): the occurrence's own end, when the club named one — the automatic
   * answer's first place to look for the span's end. Absent from a caller that has not read it.
   */
  endsAt?: Date | null;
  /**
   * `events.schedule_items` (§394), raw: read for the latest timed row of the occurrence's own
   * date only when `endsAt` is unset — a schedule row on another date of a series is not this
   * occurrence's own. Absent from a caller that has not read it.
   */
  scheduleItems?: unknown;
  /**
   * The same rows already read as instants — the calendar's `programme` (§117) — for a caller that
   * holds them rather than the raw column; read in place of `scheduleItems` when given.
   */
  programme?: readonly { startsAt: Date; endsAt: Date | null }[];
};

/**
 * The occurrence's own end instant, and where it came from (§394): the event's own `endsAt` when
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
  const rows =
    event.programme ??
    readScheduleItems(event.scheduleItems).map((row) => ({ startsAt: new Date(row.startsAt), endsAt: row.endsAt ? new Date(row.endsAt) : null }));
  const latest = rows
    .filter((row) => localDay(row.startsAt, event.timezone) === day)
    .reduce<Date | null>((max, row) => {
      const end = row.endsAt ?? row.startsAt;
      return !max || end.getTime() > max.getTime() ? end : max;
    }, null);
  return latest ? { end: latest, source: "programme" } : { end: occurrenceStartsAt, source: "start" };
}

/**
 * Whether any part of the span from `start` to `end` is in the dark (§394) — the one rule the
 * server and the editor's island both ask: the start after dusk or before dawn; the end likewise;
 * or the span running through the dark between them — it contains the start day's civil dusk, or
 * it ends on a later day of the wall clock than it starts (an overnight ultra that starts at 16:00
 * and finishes after the next morning's dawn has both ends in the light and a whole night inside).
 * `nightAtStart` tells the callers whether the end had to be named at all.
 */
export function nightSpan(
  start: Date | null,
  end: Date | null,
  place: Coordinates,
  timeZone: string,
): { night: boolean; nightAtStart: boolean } {
  const nightAtStart = isNightEvent(start, place, timeZone);
  if (nightAtStart) return { night: true, nightAtStart };
  if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end.getTime() <= start.getTime()) {
    return { night: false, nightAtStart };
  }
  if (isNightEvent(end, place, timeZone)) return { night: true, nightAtStart };
  if (localDay(end, timeZone) > localDay(start, timeZone)) return { night: true, nightAtStart };
  const dusk = sunTimes(localDay(start, timeZone), place)?.civilDusk ?? null;
  return { night: dusk !== null && start.getTime() < dusk.getTime() && dusk.getTime() <= end.getTime(), nightAtStart };
}

export function nightEvent(event: NightEventSource, occurrenceStartsAt: Date | null, place: Coordinates): NightEventFacts {
  const dayTimes = occurrenceStartsAt ? sunTimes(localDay(occurrenceStartsAt, event.timezone), place) : null;
  const sunset = dayTimes?.sunset ? wallClockTime(dayTimes.sunset, event.timezone) : null;
  const sunrise = dayTimes?.sunrise ? wallClockTime(dayTimes.sunrise, event.timezone) : null;
  const start = occurrenceStartsAt && !Number.isNaN(occurrenceStartsAt.getTime()) ? wallClockTime(occurrenceStartsAt, event.timezone) : null;
  if (event.nightOverride !== null) return { night: event.nightOverride, source: "override", start, sunset, sunrise, endSource: null, end: null };
  const { end, source } = occurrenceSpanEnd(event, occurrenceStartsAt);
  const { night, nightAtStart } = nightSpan(occurrenceStartsAt, end, place, event.timezone);
  // The end is only named when it is the reason: a start already after dusk needs no mention of
  // when the run finishes (§394).
  const named = night && !nightAtStart && end ? source : null;
  return { night, source: "automatic", start, sunset, sunrise, endSource: named, end: named && end ? wallClockTime(end, event.timezone) : null };
}

/**
 * Which of the five shapes a night event's sentence takes (§404): the start and the sunset
 * always, and the end only when it is why the date is dark — «Durata»'s end (`End`) or the day's
 * last programme row (`EndProgramme`). The start is named first so the sunset is never read as it
 * — the owner, 2026-09-25, "evenimentul începe atunci, nu apusul începe atunci!". When the sun
 * alone made the call and no end was ever named (`nightEvent`'s `named`), the plain shape would
 * read as if the sunset were the reason without saying so: `After` says the start came after that
 * sunset instead — unless the start is actually before that day's sunrise (`isNightEvent` calls a
 * start before civil dawn a night event too), in which case naming the sunset as "after" would be
 * backwards for an early-morning run; `Dawn` names the sunrise instead. One rule for every
 * sentence: the calendar entry, the `.ics` and the reminder all ask it — the pill's tooltip names
 * only the sunset (§NNN) and does not.
 */
export function nightShape(
  facts: NightEventFacts,
): { suffix: "" | "End" | "EndProgramme" | "After" | "Dawn"; values: Record<string, string> } | null {
  if (!facts.sunset || !facts.start) return null;
  const values = { start: facts.start, sunset: facts.sunset };
  if (!facts.night) return { suffix: "", values };
  if (!facts.end) {
    if (facts.source === "automatic" && facts.sunrise && facts.start < facts.sunrise) {
      return { suffix: "Dawn", values: { start: facts.start, sunrise: facts.sunrise } };
    }
    return { suffix: facts.source === "automatic" ? "After" : "", values };
  }
  return { suffix: facts.endSource === "programme" ? "EndProgramme" : "End", values: { ...values, end: facts.end } };
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
