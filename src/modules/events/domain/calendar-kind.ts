import { EVENT_KINDS, eventKind, type EventKind, type EventKindFacts } from "./event-kind";
import type { EventType } from "./event-type";
import { SPECIAL_TYPE, withoutValue, type FilterOffer, type ListingFilter } from "./listing-filter";

/**
 * The calendar's kind, as a filter and as a colour (the facelift's phase 4, `docs/REDESIGN.md`;
 * the kind itself is §709's `eventKind`, derived from the series, never typed).
 *
 * **The filter.** One more question of the address, beside §413's groups: `?kind=weekly` or
 * `?kind=special`, at most one — the chips «Toate evenimentele», «Alergări săptămânale» and
 * «Evenimente speciale» are one choice, not boxes. It lives in the query on the period's path
 * like every filter (§574), so a link, the GET chips and a script-less visit read the same state;
 * a value that names no kind is ignored, as `?type=NOPE` always was. The listing does not read it
 * (its look is phase 5's), so it is not one of `FILTER_GROUPS`. The panel's own question for the
 * same kind is «Eveniment special» in «Tipul» (`?type=SPECIAL`, §NNN), on the listing and on the
 * calendar with the look off; both read one rule (`eventKind`). Under the look the chips carry the
 * kind, so the box is not offered there (`LOOK_HIDDEN_VALUES`), a kind link replaces a ticked
 * SPECIAL (`kindFilter`) and a lone `type=SPECIAL` reads as the «special» chip (`chipKind`):
 * the two never contradict.
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

/** The panel values the calendar's chips carry under the look: not drawn there (box and active chip). */
export const LOOK_HIDDEN_VALUES: readonly { group: "type"; value: string }[] = [{ group: "type", value: SPECIAL_TYPE }];

/** What the panel still offers under the look: the hidden values taken out, and a group left with nothing to narrow, unticked, gone. */
export function offerUnderLook(offer: FilterOffer, filter: ListingFilter): FilterOffer {
  const groups = offer.groups
    .map((entry) => ({
      ...entry,
      values: entry.group === "type" ? entry.values.filter((value) => !LOOK_HIDDEN_VALUES.some((hidden) => hidden.group === "type" && hidden.value === value)) : entry.values,
    }))
    .filter((entry) => entry.group !== "type" || entry.values.length >= 2 || entry.values.some((value) => (filter.type as string[]).includes(value)));
  return { ...offer, groups };
}

/** The filter a kind link carries: a kind choice replaces a ticked «Eveniment special», so the two cannot meet. */
export function kindFilter(filter: ListingFilter): ListingFilter {
  return withoutValue(filter, "type", SPECIAL_TYPE);
}

/** The chip shown active: the address's kind, or «special» when only the box asks for it. */
export function chipKind(kind: EventKind | null, filter: ListingFilter): EventKind | null {
  return kind ?? ((filter.type as string[]).includes(SPECIAL_TYPE) ? "special" : null);
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
