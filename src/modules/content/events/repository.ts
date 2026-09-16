import { and, asc, count, desc, eq, inArray } from "drizzle-orm";
import { eventTranslations, events } from "@/db/schema/events";
import { registrations } from "@/db/schema/registrations";
import type { Database } from "@/db/types";

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
): Promise<Map<string, number>> {
  const rows = await db
    .select({ eventId: registrations.eventId, total: count() })
    .from(registrations)
    .groupBy(registrations.eventId);

  return new Map(rows.map((row) => [row.eventId, row.total]));
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
