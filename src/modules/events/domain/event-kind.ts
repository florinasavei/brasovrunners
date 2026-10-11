import type { EventType } from "./event-type";
import type { RepeatCadence } from "./repeat";

/**
 * What kind of date this is for the new look (the facelift's phase 2, §NNN; `docs/REDESIGN.md`,
 * decision 9): a **weekly** run — a date of a standing series that repeats every week — or a
 * **special** event, which is everything else: a race, a hike, a coffee, a one-off run, a series
 * that repeats every two weeks or every month. The home page splits its cards by it (phase 3), the
 * calendar colours by it (phase 4) and the listing's photo tag says it (phase 5).
 *
 * **Derived, never typed.** The kind is read from the series the date belongs to — the source's
 * `repeat_rule` (§122), which the source carries and every date made from it reaches through
 * `repeat_of` — and from nothing the club sets by hand: a second flag beside the series would be a
 * second answer to the same question, and the two would disagree the first time somebody stopped a
 * series and forgot the flag. A series stopped with «Oprește recurența» is a one-off again (§275),
 * so its dates read as special, the way its source already reads as a one-off in the listing.
 *
 * **Not «Ediție specială».** The special edition (§168) keeps its meaning: one date of a weekly run
 * the club marks as different — the Wednesday it joins another club's race — is still a weekly date
 * here, and wears the chip beside the kind. The decision says so in as many words.
 *
 * Pure, so the listing, the calendar, the home page and a test read one rule.
 */
export const EVENT_KINDS = ["weekly", "special"] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

/**
 * The fact the kind is read from, as the public read carries it (`events/repository.ts`,
 * `seriesCadence`): the cadence of the standing series the date belongs to, or null for a date of
 * none. A string, because a row is a row — anything that is not a cadence reads as no series.
 */
export type EventKindFacts = { seriesCadence: string | null };

/** The one cadence that makes a weekly run; every other answer, null included, is special. */
const WEEKLY_CADENCE: RepeatCadence = "WEEKLY";

export function eventKind(event: EventKindFacts): EventKind {
  return event.seriesCadence === WEEKLY_CADENCE ? "weekly" : "special";
}

/**
 * The photo tag (the plan's «tag pill» on a card's photo, drawn from phase 5): the kind's word,
 * `Event.kind.<kind>` in the catalogues, and a glyph named in the public registry
 * (`events/ui/glyphs.ts`) — the public repeat arrows (§486) for a weekly run, the event type's glyph for a
 * special one (a race's flag, a hike's boot), so a special tag still says what the event is. Data
 * only: the pill, its colours (`kindSpecial`, the accent tint) and its place over the picture are
 * phase 5's, under «Aspectul nou».
 */
export type CoverTag = {
  kind: EventKind;
  /** The catalogue key under `Event`: «Săptămânal» / "Weekly", «Eveniment special» / "Special event". */
  labelKey: `kind.${EventKind}`;
  /** A name of `events/ui/glyphs.ts`, so the pill crosses the server/client boundary as a string (§370). */
  glyph: "repeat" | `type:${EventType}`;
};

export function coverTag(event: EventKindFacts & { type: EventType }): CoverTag {
  const kind = eventKind(event);
  return { kind, labelKey: `kind.${kind}`, glyph: kind === "weekly" ? "repeat" : `type:${event.type}` };
}
