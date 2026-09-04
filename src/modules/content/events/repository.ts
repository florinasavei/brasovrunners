import { and, asc, desc, eq } from "drizzle-orm";
import { eventTranslations, events } from "@/db/schema/events";
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

export async function findEventForEditing<T extends Record<string, unknown>>(
  db: Database<T>,
  eventId: string,
): Promise<{ event: EditableEvent; translations: EditableTranslation[] } | undefined> {
  const [event] = await db.select().from(events).where(eq(events.id, eventId)).limit(1);
  if (!event) return undefined;

  const translations = await db
    .select()
    .from(eventTranslations)
    .where(eq(eventTranslations.eventId, eventId))
    .orderBy(asc(eventTranslations.locale));

  return { event, translations };
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
