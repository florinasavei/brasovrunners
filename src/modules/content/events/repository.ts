import { and, asc, count, desc, eq, inArray, or, sql } from "drizzle-orm";
import { eventTranslations, events } from "@/db/schema/events";
import { registrations } from "@/db/schema/registrations";
import type { Database } from "@/db/types";
import { type Locale, routing } from "@/i18n/routing";

/**
 * Backoffice reads (BR-REQ-050-01, BR-REQ-051-01, BR-REQ-051-02). Kept apart from
 * `modules/events/repository.ts`, which returns only PUBLISHED rows and public columns: these
 * include drafts, so a change here cannot widen what the public site renders. Reads only; writes
 * go through `service.ts`, where authorization and the version check live.
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
 * Registrations per event for the list, so the screen can say why a delete would be refused
 * (the guard stays on the server, BR-REQ-060-01). `TEST` rows count too: the foreign key blocks a
 * delete regardless of kind. One grouped query for the whole list.
 */
export async function countRegistrationsByEvent<T extends Record<string, unknown>>(
  db: Database<T>,
): Promise<Map<string, { total: number; test: number }>> {
  const rows = await db
    .select({
      eventId: registrations.eventId,
      total: count(),
      // An event blocked only by test rows is deleted with them (§176); the row says so.
      test: sql<number>`count(*) FILTER (WHERE ${registrations.kind} = 'TEST')`.mapWith(Number),
    })
    .from(registrations)
    .groupBy(registrations.eventId);

  return new Map(rows.map((row) => [row.eventId, { total: row.total, test: row.test }]));
}

/** Confirmed and checked-in per event, the desk's two numbers (`countDesk`), for the list on race day (§83). */
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
 * One translation and its event in one query: the editorial status and first-publication date,
 * which decide liveness and whether the slug is editable, are on the event (§28).
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
 * The slugs already taken in one locale among candidates, so a duplicate gets a suffix instead of
 * hitting `UNIQUE(locale, slug)`.
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
 * One event and locale whatever its editorial status — the preview (BR-REQ-051-02). The one read
 * that deliberately returns unpublished content; every caller is behind `requireStaff()`.
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
 * Every date of a series, source included, soonest first, with what the editor's header needs to
 * mark the open date and the ones unlike the others (§131). Archived dates included, so the count
 * is the series' own.
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
 * What a hard delete would destroy, read before anything is pressed (BR-REQ-037-06): how many
 * registrations, how many confirmed, how many `TEST`, and whether any is a real participant
 * (§30). `titles` carries every language's title with its locale, since the typed confirmation is
 * compared with the title the organizer sees in the backoffice's language.
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
      // The default locale first, so a plan read without a reader gets the club's language.
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

/** An event's title in one language (the other if missing), for the note on a series' date (§122). */
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
