import { and, asc, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import { eventTranslations, events } from "@/db/schema/events";

type Locale = (typeof eventTranslations.locale.enumValues)[number];

/**
 * Any Drizzle database over this schema: the application's node-postgres pool in production,
 * PGlite in tests. Queries are written once and exercised by both.
 */
type Schema = { events: typeof events; eventTranslations: typeof eventTranslations };
export type Database = NodePgDatabase<Schema> | PgliteDatabase<Schema>;

const PUBLIC_COLUMNS = {
  id: events.id,
  kind: events.kind,
  eventStatus: events.eventStatus,
  startsAt: events.startsAt,
  endsAt: events.endsAt,
  timezone: events.timezone,
  distanceMeters: events.distanceMeters,
  registrationMode: events.registrationMode,
  externalRegistrationUrl: events.externalRegistrationUrl,
  slug: eventTranslations.slug,
  title: eventTranslations.title,
  excerpt: eventTranslations.excerpt,
  locationName: eventTranslations.locationName,
  locationAddress: eventTranslations.locationAddress,
  difficultyLabel: eventTranslations.difficultyLabel,
  seoTitle: eventTranslations.seoTitle,
  seoDescription: eventTranslations.seoDescription,
};

/**
 * Events visible on the public site in one locale, soonest first.
 *
 * Only PUBLISHED translations are returned. BR-REQ-020-01 criterion 1 and BR-REQ-040-02:
 * a Draft or In review translation is a 404 in that locale, never a fallback to the other
 * language, so the locale filter and the status filter both belong in the query rather than
 * in the caller.
 *
 * A CANCELLED event is still listed — BR-REQ-020-01 criterion 2 requires it to render with a
 * visible cancelled status rather than vanish.
 */
export async function listPublishedEvents(db: Database, locale: Locale) {
  return db
    .select(PUBLIC_COLUMNS)
    .from(events)
    .innerJoin(eventTranslations, eq(eventTranslations.eventId, events.id))
    .where(
      and(eq(eventTranslations.locale, locale), eq(eventTranslations.editorialStatus, "PUBLISHED")),
    )
    .orderBy(asc(events.startsAt));
}

/** One published event by its locale-scoped slug, or undefined when it should 404. */
export async function findPublishedEventBySlug(db: Database, locale: Locale, slug: string) {
  const [row] = await db
    .select(PUBLIC_COLUMNS)
    .from(events)
    .innerJoin(eventTranslations, eq(eventTranslations.eventId, events.id))
    .where(
      and(
        eq(eventTranslations.locale, locale),
        eq(eventTranslations.slug, slug),
        eq(eventTranslations.editorialStatus, "PUBLISHED"),
      ),
    )
    .limit(1);

  return row;
}
