import { z } from "zod";
import { readScheduleItems } from "./schedule";

/**
 * What a save changed that a registered runner needs to hear about (`DECISIONS.md` §NNN; the
 * owner: "I want to know exactly when and if participants get email alerts (e.g. event location
 * gets updated)").
 *
 * The organizer decides *whether* the participants are told — a box on the editor's save, unticked
 * by default, so a typo fixed on a Tuesday emails nobody (§9's line: notification is a deliberate
 * act, never automatic on save). This decides *what* there is to tell, by comparing the event as
 * it was loaded with the event as it was written, inside the save's own transaction:
 *
 * - `place` — where to meet: the meeting point as the page shows it in any language (the event's
 *   own words, or a language's own name for the place, migration `0059`), or the map link.
 * - `time` — when: the start, or a race's gun time. Not the end: nobody changes their plans for
 *   the finish of a group run, and a duration nudged by ten minutes is not worth an email.
 * - `programme` — the programme's timed rows: a time, a place, a row added or taken away. Not a
 *   label reworded on a row that kept its time, for the same reason as the end.
 * - `reinstated` — a cancelled event that is on again.
 *
 * Only the *kinds* are returned, and only the kinds travel in the outbox row. The new values are
 * read when the message is rendered (`render.ts`), the way every other message reads its event,
 * so a place corrected twice before the batch runs is sent once, right — and nothing the event
 * held *before* the save is ever put in front of a participant.
 *
 * Pure: two rows in, a list out.
 */
export const EVENT_CHANGE_KINDS = ["place", "time", "programme", "reinstated"] as const;
export type EventChangeKind = (typeof EVENT_CHANGE_KINDS)[number];

/** The columns of `events` the comparison reads. */
export type EventChangeFacts = {
  eventStatus: "SCHEDULED" | "CANCELLED" | "COMPLETED";
  startsAt: Date;
  raceStartsAt: Date | null;
  locationName: string | null;
  locationAddress: string | null;
  mapUrl: string | null;
  scheduleItems: unknown;
};

/** One language's own name for the place (migration `0059`); blank means "the event's". */
export type PlaceInLanguage = { locale: string; locationName: string | null };

const words = (value: string | null | undefined) => (value ?? "").replace(/\s+/g, " ").trim();

/**
 * The meeting point as the event states it. The street address was folded into the one field in
 * §36's follow-up (`EventFieldsForm` shows `name, address` and the save writes the address as
 * null), so the two are read together: the first save of an older event moves the address into
 * the name, says the same thing, and must not read as a new place.
 */
function eventPlace(event: Pick<EventChangeFacts, "locationName" | "locationAddress">): string {
  return [words(event.locationName), words(event.locationAddress)].filter((part) => part !== "").join(", ");
}

/** The place as each language's page shows it: its own name when it has one, else the event's. */
function placesByLanguage(event: EventChangeFacts, languages: readonly PlaceInLanguage[]): Map<string, string> {
  const fallback = eventPlace(event);
  return new Map(languages.map((language) => [language.locale, words(language.locationName) || fallback]));
}

function placeChanged(
  before: EventChangeFacts,
  after: EventChangeFacts,
  languagesBefore: readonly PlaceInLanguage[],
  languagesAfter: readonly PlaceInLanguage[],
): boolean {
  if (eventPlace(before) !== eventPlace(after)) return true;
  if (words(before.mapUrl) !== words(after.mapUrl)) return true;
  const was = placesByLanguage(before, languagesBefore);
  const now = placesByLanguage(after, languagesAfter);
  for (const [locale, place] of now) {
    if (was.has(locale) && was.get(locale) !== place) return true;
  }
  return false;
}

const instant = (value: Date | null) => (value ? value.getTime() : null);

/** The programme's timing and places, in order — the rows a runner plans the morning by. */
function programmeTiming(json: unknown): string {
  return JSON.stringify(readScheduleItems(json).map((item) => [item.startsAt, item.endsAt, words(item.place)]));
}

export function eventChangesToAnnounce(
  before: EventChangeFacts,
  after: EventChangeFacts,
  languagesBefore: readonly PlaceInLanguage[] = [],
  languagesAfter: readonly PlaceInLanguage[] = [],
): EventChangeKind[] {
  const changes: EventChangeKind[] = [];
  if (before.eventStatus === "CANCELLED" && after.eventStatus === "SCHEDULED") changes.push("reinstated");
  if (placeChanged(before, after, languagesBefore, languagesAfter)) changes.push("place");
  if (instant(before.startsAt) !== instant(after.startsAt) || instant(before.raceStartsAt) !== instant(after.raceStartsAt)) {
    changes.push("time");
  }
  if (programmeTiming(before.scheduleItems) !== programmeTiming(after.scheduleItems)) changes.push("programme");
  return changes;
}

/** The kinds as an outbox payload carries them; anything else in the list is dropped, never rendered. */
export function readEventChanges(value: unknown): EventChangeKind[] {
  if (!Array.isArray(value)) return [];
  return EVENT_CHANGE_KINDS.filter((kind) => value.includes(kind));
}

/**
 * The organizer's own words on the two messages — the note on "details updated", the reason on
 * "cancelled" — as plain text, at most five hundred characters, which is a paragraph and not a
 * newsletter. Line breaks are kept (a two-line note is written as two lines); every other control
 * character is dropped, and the template escapes the rest.
 */
export const EVENT_NOTICE_TEXT_MAX = 500;

/** A line break, or a character that is not a control character. */
const printable = (character: string) => {
  const code = character.charCodeAt(0);
  return code === 10 || (code >= 32 && code !== 127);
};

export const eventNoticeTextSchema = z
  .string()
  .transform((value) => [...value.replace(/\r\n?/g, "\n")].filter(printable).join("").trim())
  .pipe(z.string().max(EVENT_NOTICE_TEXT_MAX));

/** A stored note or reason, read back for the template: the same rule, or nothing. */
export function readEventNoticeText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const parsed = eventNoticeTextSchema.safeParse(value);
  return parsed.success && parsed.data !== "" ? parsed.data : undefined;
}
