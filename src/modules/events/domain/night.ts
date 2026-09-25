import { type Coordinates, isNightEvent, localDay, sunTimes, wallClockTime } from "./sun";

/**
 * Whether an occurrence is a night event (§NNN, replacing §382's "Necesită frontală" checkbox).
 *
 * `events.headlamp_required` is the organizer's override, `nightOverride` in the code: `true` is
 * "Da" (a night event whatever the sun does — a start in a forest at 18:30 in September), `false`
 * is "Nu" (never, whatever the sun does), and `null` — the default — is "Automat": the start is
 * compared with civil dusk and civil dawn of its own date at the club's place (`sun.ts`). A weekly
 * run is therefore a day run in June and a night run in November without anybody touching it, and
 * every date of a series answers for itself.
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
};

export type NightEventSource = {
  /** `events.headlamp_required`: true "Da", false "Nu", null "Automat". */
  nightOverride: boolean | null;
  /** The event's own zone, whose wall clock names the day and prints the time. */
  timezone: string;
};

export function nightEvent(event: NightEventSource, occurrenceStartsAt: Date | null, place: Coordinates): NightEventFacts {
  const sunsetAt = occurrenceStartsAt ? sunTimes(localDay(occurrenceStartsAt, event.timezone), place)?.sunset ?? null : null;
  const sunset = sunsetAt ? wallClockTime(sunsetAt, event.timezone) : null;
  if (event.nightOverride !== null) return { night: event.nightOverride, source: "override", sunset };
  return { night: isNightEvent(occurrenceStartsAt, place, event.timezone), source: "automatic", sunset };
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
