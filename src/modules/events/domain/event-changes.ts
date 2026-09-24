import { z } from "zod";
import { readScheduleItems } from "./schedule";

/**
 * What a save changed that a registered runner needs to hear about (`DECISIONS.md` §331; the
 * owner: "I want to know exactly when and if participants get email alerts (e.g. event location
 * gets updated)").
 *
 * The organizer decides *whether* the participants are told — a box on the editor's save, unticked
 * by default, so a typo fixed on a Tuesday emails nobody (§9's line: notification is a deliberate
 * act, never automatic on save). This decides *what* there is to tell, by comparing the event as
 * it was loaded with the event as it was written, inside the save's own transaction:
 *
 * - `place` — where to meet: the meeting point as the page shows it in any language (the event's
 *   own words, or a language's own name for the place, migration `0059`), or the map link. While
 *   the place is *to be announced* (`events.location_to_be_announced`) no page shows any of it,
 *   so nothing typed behind the switch is a change; switching it off is one, and the only one a
 *   hidden place ever makes.
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
  /**
   * The place is not announced yet: every public reader is handed no name (in either language),
   * no address, no map link and no programme place (the place-to-be-announced switch, which
   * masks them in SQL). Optional so a row read without the column counts as announced, which is
   * what every row written before it was.
   */
  locationToBeAnnounced?: boolean;
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

const hidden = (event: EventChangeFacts) => event.locationToBeAnnounced === true;

/**
 * Whether the place a runner can *read* moved. Compared on what the pages show, not on what the
 * columns hold, because the message says "the meeting point is now: …" and reads the place at
 * send time (§331):
 *
 * - still hidden after the save, or hidden by it — never. Words typed behind the switch reach no
 *   page, and a message would say "the meeting point is now: to be announced soon" about a place
 *   nobody was told. Withdrawing an announced place is not counted either: the organizer who
 *   wants to say why writes the note, which goes on its own.
 * - announced by the save (hidden before, shown after) — always, whether or not the words behind
 *   the switch changed at the same press: to the runner the place is new.
 * - shown before and after — when the place, the map link or a language's own name differs.
 */
function placeChanged(
  before: EventChangeFacts,
  after: EventChangeFacts,
  languagesBefore: readonly PlaceInLanguage[],
  languagesAfter: readonly PlaceInLanguage[],
): boolean {
  if (hidden(after)) return false;
  if (hidden(before)) return true;
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

/**
 * The programme's timing and places, in order — the rows a runner plans the morning by. A row's
 * place is read as the page shows it: none while the event's place is to be announced (§331),
 * so a programme place edited behind the switch is no change, and the places appearing when the
 * switch goes off are one.
 */
function programmeTiming(event: EventChangeFacts): string {
  const placeShown = !hidden(event);
  return JSON.stringify(
    readScheduleItems(event.scheduleItems).map((item) => [item.startsAt, item.endsAt, placeShown ? words(item.place) : ""]),
  );
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
  if (programmeTiming(before) !== programmeTiming(after)) changes.push("programme");
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
 * character is dropped, and the template escapes the rest. Each language's box is read by this
 * rule on its own (§354, bilingual everywhere): five hundred characters in Romanian and five
 * hundred in English.
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

/**
 * The note or the reason as a message is written from it (§354, bilingual everywhere): what the
 * half in `language` says, and what the other half says.
 *
 * - **Both languages** — the shape every row queued since the organizer types the text twice:
 *   `{ ro, en }`. Each half of the bilingual message reads its own language, so the Romanian
 *   registrant's English half carries the English text and never the Romanian one.
 * - **One string** — a row queued before, with the one text the organizer typed. Rendered as it
 *   always was, the same words in both halves: the row is already in the outbox and rewriting what
 *   it says is not this release's to do.
 * - **Half a pair**, or nothing readable — nothing at all. The save refuses one language only, so
 *   a half can only come from a hand-made row, and showing it would put one language's text in
 *   front of a reader of the other; the rest of the message still goes.
 */
export function readEventNoticeWords(value: unknown, language: "ro" | "en"): { text?: string; other?: string } {
  const legacy = readEventNoticeText(value);
  if (legacy) return { text: legacy };
  if (!value || typeof value !== "object") return {};
  const pair = value as { ro?: unknown; en?: unknown };
  const ro = readEventNoticeText(pair.ro);
  const en = readEventNoticeText(pair.en);
  if (!ro || !en) return {};
  return language === "ro" ? { text: ro, other: en } : { text: en, other: ro };
}
