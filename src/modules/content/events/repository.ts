import { and, asc, count, desc, eq, inArray, or, sql } from "drizzle-orm";
import { eventTranslations, events } from "@/db/schema/events";
import { registrations } from "@/db/schema/registrations";
import type { Database } from "@/db/types";
import { type Locale, routing } from "@/i18n/routing";

/**
 * Backoffice reads (BR-REQ-050-01, BR-REQ-051-01, BR-REQ-051-02).
 *
 * Separate from `modules/events/repository.ts` on purpose. That file returns only PUBLISHED
 * rows and only the columns a public page may show; these return every editorial status,
 * including drafts, which is precisely what must never reach a public query. Keeping the two
 * apart means a change here cannot widen what the public site renders.
 *
 * Every function is a read. Writes go through `service.ts`, which is where the authorization
 * and the version check live.
 */

export type EditableTranslation = typeof eventTranslations.$inferSelect;
export type EditableEvent = typeof events.$inferSelect;

/** One row per event per locale, drafts included, newest event first. */
export async function listEventsForBackoffice<T extends Record<string, unknown>>(
  db: Database<T>,
): Promise<Array<{ event: EditableEvent; translations: EditableTranslation[] }>> {
  const rows = await db
    .select({ event: events, translation: eventTranslations })
    .from(events)
    .leftJoin(eventTranslations, eq(eventTranslations.eventId, events.id))
    .orderBy(desc(events.featured), asc(events.startsAt), asc(eventTranslations.locale));

  const byEvent = new Map<string, { event: EditableEvent; translations: EditableTranslation[] }>();
  for (const row of rows) {
    const entry = byEvent.get(row.event.id) ?? { event: row.event, translations: [] };
    if (row.translation) entry.translations.push(row.translation);
    byEvent.set(row.event.id, entry);
  }
  return [...byEvent.values()];
}

/**
 * How many registrations each event carries, for the list screen.
 *
 * `deleteEvent` refuses an event that has any, and the list had no way to say so: the button was
 * simply offered and the refusal arrived afterwards as an error code. A count turns that into a
 * sentence an organizer accepts before pressing anything — "eleven people have registered" is a
 * reason; a button that fails is not (BR-REQ-060-01: the guard is still on the server either
 * way, and this only changes what the screen is able to explain).
 *
 * `TEST` rows are counted too, deliberately. They block a delete exactly as real ones do, because
 * the foreign key does not care what kind they are, so a count that omitted them would explain
 * the refusal with a number that disagreed with it.
 *
 * One grouped query for the whole list rather than one per row.
 */
export async function countRegistrationsByEvent<T extends Record<string, unknown>>(
  db: Database<T>,
): Promise<Map<string, { total: number; test: number }>> {
  const rows = await db
    .select({
      eventId: registrations.eventId,
      total: count(),
      // Split out since §176: an event blocked only by test rows is deleted with them, and the
      // row must say that rather than "archive it instead" to somebody who already has.
      test: sql<number>`count(*) FILTER (WHERE ${registrations.kind} = 'TEST')`.mapWith(Number),
    })
    .from(registrations)
    .groupBy(registrations.eventId);

  return new Map(rows.map((row) => [row.eventId, { total: row.total, test: row.test }]));
}

/**
 * Confirmed and checked-in per event — the two numbers the desk shows (`countDesk`), for the
 * events list on race day (`DECISIONS.md` §83): an organizer watching from the office sees
 * how many are here without opening the desk.
 */
export async function countConfirmedAndCheckedInByEvent<T extends Record<string, unknown>>(
  db: Database<T>,
): Promise<Map<string, { confirmed: number; checkedIn: number }>> {
  const rows = await db
    .select({
      eventId: registrations.eventId,
      confirmed: sql<number>`count(*) FILTER (WHERE ${registrations.status} = 'CONFIRMED')`.mapWith(Number),
      checkedIn: sql<number>`count(*) FILTER (WHERE ${registrations.checkedInAt} IS NOT NULL)`.mapWith(Number),
    })
    .from(registrations)
    // Real rows only, as `countDesk` (§30, AGENTS.md §12.6; §420).
    .where(eq(registrations.kind, "REAL"))
    .groupBy(registrations.eventId);
  return new Map(rows.map((row) => [row.eventId, { confirmed: row.confirmed, checkedIn: row.checkedIn }]));
}

export async function findEventForEditing<T extends Record<string, unknown>>(
  db: Database<T>,
  eventId: string,
): Promise<{ event: EditableEvent; translations: EditableTranslation[] } | undefined> {
  const [event] = await db.select().from(events).where(eq(events.id, eventId)).limit(1);
  if (!event) return undefined;

  return { event, translations: await listTranslationsForEvent(db, eventId) };
}

export async function findTranslationById<T extends Record<string, unknown>>(
  db: Database<T>,
  translationId: string,
): Promise<EditableTranslation | undefined> {
  const [row] = await db
    .select()
    .from(eventTranslations)
    .where(eq(eventTranslations.id, translationId))
    .limit(1);
  return row;
}

/**
 * One translation and the event it belongs to, in one query.
 *
 * Editing a translation needs both now: the author is on the translation, but the editorial
 * status and the first-publication date — what decides whether this is live content and whether
 * the slug is still editable — moved to the event (`DECISIONS.md` §28).
 */
export async function findTranslationWithEventById<T extends Record<string, unknown>>(
  db: Database<T>,
  translationId: string,
): Promise<{ event: EditableEvent; translation: EditableTranslation } | undefined> {
  const [row] = await db
    .select({ event: events, translation: eventTranslations })
    .from(eventTranslations)
    .innerJoin(events, eq(events.id, eventTranslations.eventId))
    .where(eq(eventTranslations.id, translationId))
    .limit(1);
  return row;
}

/** Every locale's translation for one event, keyed by locale — what publication checks. */
export async function listTranslationsForEvent<T extends Record<string, unknown>>(
  db: Database<T>,
  eventId: string,
): Promise<EditableTranslation[]> {
  return db
    .select()
    .from(eventTranslations)
    .where(eq(eventTranslations.eventId, eventId))
    .orderBy(asc(eventTranslations.locale));
}

/**
 * The slugs already taken in one locale, among a candidate set.
 *
 * Duplicating an event has to invent slugs nobody is using, and `UNIQUE(locale, slug)` is what
 * would otherwise reject the copy — asking first turns a constraint violation into a suffix.
 */
export async function findTakenSlugs<T extends Record<string, unknown>>(
  db: Database<T>,
  locale: "ro" | "en",
  candidates: readonly string[],
): Promise<Set<string>> {
  if (candidates.length === 0) return new Set();
  const rows = await db
    .select({ slug: eventTranslations.slug })
    .from(eventTranslations)
    .where(and(eq(eventTranslations.locale, locale), inArray(eventTranslations.slug, [...candidates])));
  return new Set(rows.map((row) => row.slug));
}

/**
 * One event and one locale, whatever its editorial status — the preview query
 * (BR-REQ-051-02).
 *
 * This is the one read in the codebase that deliberately returns unpublished content, which
 * is why it lives here rather than beside the public queries, and why every caller of it is
 * behind `requireStaff()`.
 */
export async function findTranslationForPreview<T extends Record<string, unknown>>(
  db: Database<T>,
  eventId: string,
  locale: "ro" | "en",
): Promise<{ event: EditableEvent; translation: EditableTranslation } | undefined> {
  const [row] = await db
    .select({ event: events, translation: eventTranslations })
    .from(events)
    .innerJoin(eventTranslations, eq(eventTranslations.eventId, events.id))
    .where(and(eq(events.id, eventId), eq(eventTranslations.locale, locale)))
    .limit(1);
  return row;
}

/**
 * Every date of a series — the source and each date made from it — soonest first, with what
 * the editor's header needs to say which one is open and mark the ones unlike the others
 * (§131). Two indexed reads' worth for a series of any length; archived dates included, so
 * the count is the series' own.
 */
export async function listSeriesDates<T extends Record<string, unknown>>(db: Database<T>, sourceId: string) {
  return db
    .select({
      id: events.id,
      startsAt: events.startsAt,
      timezone: events.timezone,
      locationName: events.locationName,
      // The pin beside the name: two dates with the same map link are at the same place (§367).
      mapUrl: events.mapUrl,
      eventStatus: events.eventStatus,
      editorialStatus: events.editorialStatus,
      // A special edition is one of the four marks a date of a series can wear (§169).
      isSpecial: events.isSpecial,
    })
    .from(events)
    .where(or(eq(events.id, sourceId), eq(events.repeatOf, sourceId)))
    .orderBy(asc(events.startsAt));
}

/**
 * Exactly what a hard delete would destroy, read before anything is pressed (BR-REQ-037-06).
 *
 * The screen that asks for a typed confirmation has to be able to state the consequence, and
 * the consequence is four numbers and a fact: how many registrations there are, how many of
 * them are confirmed people who expect to run, how many are `TEST` rows, and — the one that
 * decides whether this is a mistake being tidied up or a season being destroyed — whether any
 * of them is a real participant at all (`DECISIONS.md` §30). A count of "2" means nothing on
 * its own; "2, both of them real people, one confirmed" is a sentence somebody can act on.
 *
 * `titles` is every language's title *with its locale*, because that is what the confirmation
 * field compares against: the organizer types the title they can see, the event has two, and
 * which one they can see depends on the language the backoffice is in.
 */
export type EventErasurePlan = {
  eventId: string;
  titles: Array<{ locale: Locale; title: string }>;
  startsAt: Date;
  /** The zone the date above is read in — the event's own. */
  timezone: string;
  editorialStatus: EditableEvent["editorialStatus"];
  total: number;
  confirmed: number;
  real: number;
  test: number;
};

export async function readEventErasurePlan<T extends Record<string, unknown>>(
  db: Database<T>,
  eventId: string,
): Promise<EventErasurePlan | undefined> {
  const [event] = await db.select().from(events).where(eq(events.id, eventId)).limit(1);
  if (!event) return undefined;

  const titles = await db
    .select({ locale: eventTranslations.locale, title: eventTranslations.title })
    .from(eventTranslations)
    .where(eq(eventTranslations.eventId, eventId))
    .orderBy(asc(eventTranslations.locale));

  const [counts] = await db
    .select({
      total: count(),
      confirmed: sql<number>`count(*) FILTER (WHERE ${registrations.status} = 'CONFIRMED')`.mapWith(Number),
      real: sql<number>`count(*) FILTER (WHERE ${registrations.kind} = 'REAL')`.mapWith(Number),
      test: sql<number>`count(*) FILTER (WHERE ${registrations.kind} = 'TEST')`.mapWith(Number),
    })
    .from(registrations)
    .where(eq(registrations.eventId, eventId));

  return {
    eventId: event.id,
    titles: titles
      .filter((row) => row.title.trim() !== "")
      // The default locale first, so a plan read without a reader — a test, an audit row — gets
      // the club's own language rather than whichever locale sorts first.
      .sort((a, b) => routing.locales.indexOf(a.locale) - routing.locales.indexOf(b.locale)),
    startsAt: event.startsAt,
    timezone: event.timezone,
    editorialStatus: event.editorialStatus,
    total: counts?.total ?? 0,
    confirmed: counts?.confirmed ?? 0,
    real: counts?.real ?? 0,
    test: counts?.test ?? 0,
  };
}

/** The title of an event in one language — for the note on a series' date (§122); the other language if that one is missing. */
export async function findEventTitle<T extends Record<string, unknown>>(
  db: Database<T>,
  eventId: string,
  locale: Locale,
): Promise<string | null> {
  const rows = await db
    .select({ locale: eventTranslations.locale, title: eventTranslations.title })
    .from(eventTranslations)
    .where(eq(eventTranslations.eventId, eventId));
  return rows.find((row) => row.locale === locale)?.title ?? rows[0]?.title ?? null;
}
