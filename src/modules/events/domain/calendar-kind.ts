import { EVENT_KINDS, eventKind, type EventKind, type EventKindFacts } from "./event-kind";
import type { EventType } from "./event-type";

/**
 * The calendar's kind, as a filter and as a colour (the facelift's phase 4, `docs/REDESIGN.md`;
 * the kind itself is §709's `eventKind`, derived from the series, never typed).
 *
 * **The filter.** One more question of the address, beside §413's groups: `?kind=weekly` or
 * `?kind=special`, at most one — the chips «Toate evenimentele», «Alergări săptămânale» and
 * «Evenimente speciale» are one choice, not boxes. It lives in the query on the period's path
 * like every filter (§574), so a link, the GET chips and a script-less visit read the same state;
 * a value that names no kind is ignored, as `?type=NOPE` always was. The listing does not read it
 * (its look is phase 5's), so it is not one of `FILTER_GROUPS`, and the listing's panel never
 * offers it.
 *
 * **The tone.** Three colours by kind, with a legend: a weekly run, a special event — a race, a
 * hike, a run held once, another club's race the club goes to, a «Eveniment special» evening —
 * and **other**: the social dates of a special kind, a coffee or a shoe-testing evening (§121),
 * where no one runs. The filter keeps §709's two kinds, so «Evenimente speciale» shows the green
 * and the grey together: the grey is a special date that is not a sport, said in the legend's own
 * word, «Alte evenimente».
 *
 * Pure, so the page, the chips and a test read one rule.
 */

/** The address's parameter. */
export const KIND_PARAM = "kind";

/** The kind the address asks for, or null for every kind. The first value that names one wins. */
export function parseKindChoice(address: Record<string, string | string[] | undefined>): EventKind | null {
  const asked = address[KIND_PARAM];
  const values = asked === undefined ? [] : Array.isArray(asked) ? asked : [asked];
  for (const value of values) {
    const kind = value.trim().toLowerCase();
    if ((EVENT_KINDS as readonly string[]).includes(kind)) return kind as EventKind;
  }
  return null;
}

/** The kind as query parameters, in the shape the chips' links carry; nothing for every kind. */
export function kindQuery(kind: EventKind | null): Record<string, string> {
  return kind ? { [KIND_PARAM]: kind } : {};
}

/** Whether a date passes the kind asked for; every date passes when none is. */
export function matchesKind(event: EventKindFacts, kind: EventKind | null): boolean {
  return kind === null || eventKind(event) === kind;
}

export const CALENDAR_TONES = ["weekly", "special", "other"] as const;
export type CalendarTone = (typeof CALENDAR_TONES)[number];

/** The special types where no one runs: a coffee, a shoe-testing evening — the calendar's grey. */
const SOCIAL_TYPES: ReadonlySet<EventType> = new Set<EventType>(["COFFEE", "GEAR_TEST"]);

/** The colour a date is drawn in under the new look. */
export function calendarTone(event: EventKindFacts & { type: EventType }): CalendarTone {
  if (eventKind(event) === "weekly") return "weekly";
  return SOCIAL_TYPES.has(event.type) ? "other" : "special";
}
