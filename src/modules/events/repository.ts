import { and, asc, desc, eq, gte, lt, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import { eventTranslations, events } from "@/db/schema/events";
import type { Database as GenericDatabase } from "@/db/types";

type Locale = (typeof eventTranslations.locale.enumValues)[number];

/**
 * Any Drizzle database over this schema: the application's node-postgres pool in production,
 * PGlite in tests. Queries are written once and exercised by both.
 */
type Schema = { events: typeof events; eventTranslations: typeof eventTranslations };
export type Database = NodePgDatabase<Schema> | PgliteDatabase<Schema>;

/**
 * Exactly the columns a public page may show.
 *
 * Written out rather than `select()`-ing the whole row on purpose. When registrations and
 * participants land, `SELECT *` on a joined query is how an email address reaches a public
 * template; an explicit list cannot do that by accident (BR-REQ-070-01).
 */
const PUBLIC_COLUMNS = {
  id: events.id,
  kind: events.kind,
  eventStatus: events.eventStatus,
  startsAt: events.startsAt,
  endsAt: events.endsAt,
  // The gun time, when it differs from when the event begins. Null on an ordinary run.
  raceStartsAt: events.raceStartsAt,
  timezone: events.timezone,
  // The exact spot, and the override for it. The link itself is built by `mapLinkFor`, from
  // configuration: AGENTS.md §8 forbids a provider hostname under src/.
  latitude: events.latitude,
  longitude: events.longitude,
  mapUrl: events.mapUrl,
  featured: events.featured,
  distanceMeters: events.distanceMeters,
  elevationGainMeters: events.elevationGainMeters,
  registrationMode: events.registrationMode,
  registrationOpensAt: events.registrationOpensAt,
  registrationClosesAt: events.registrationClosesAt,
  externalRegistrationUrl: events.externalRegistrationUrl,
  externalProvider: events.externalProvider,
  slug: eventTranslations.slug,
  title: eventTranslations.title,
  excerpt: eventTranslations.excerpt,
  locationName: eventTranslations.locationName,
  locationAddress: eventTranslations.locationAddress,
  difficultyLabel: eventTranslations.difficultyLabel,
  costText: eventTranslations.costText,
  seoTitle: eventTranslations.seoTitle,
  seoDescription: eventTranslations.seoDescription,
  publishedAt: eventTranslations.publishedAt,
};

/**
 * The row shape the public pages receive.
 *
 * Derived from the query rather than written by hand, so nullability always matches the
 * schema. A hand-written version silently claimed `endsAt` was never null.
 */
export type PublicEvent = Awaited<ReturnType<typeof listPublishedEvents>>[number];

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

/**
 * The locales in which one event is published, with each locale's own slug.
 *
 * BR-REQ-040-01 criterion 5: an alternate-locale link must point at the *corresponding
 * localized slug*, never at the current slug with a different prefix glued on. The slugs
 * genuinely differ — `tura-pe-tampa` and `tampa-trail` are the same event — so a concatenated
 * URL is a 404 rather than a cosmetic problem.
 *
 * Draft locales are excluded, because advertising an alternate that 404s is worse than
 * advertising none (BR-REQ-040-02).
 */
export async function findPublishedTranslations(db: Database, eventId: string) {
  return db
    .select({ locale: eventTranslations.locale, slug: eventTranslations.slug })
    .from(eventTranslations)
    .where(
      and(
        eq(eventTranslations.eventId, eventId),
        eq(eventTranslations.editorialStatus, "PUBLISHED"),
      ),
    );
}

/**
 * When an event stops being "upcoming".
 *
 * An event that started this morning and ends this afternoon is still today's event, so the
 * comparison is against the end when there is one and the start otherwise. Written in SQL
 * rather than filtered in the application so the ordering and the cut-off agree — a filter
 * applied after `LIMIT` would silently return fewer rows than asked for.
 */
const eventEndsAt = sql`coalesce(${events.endsAt}, ${events.startsAt})`;

/**
 * Races outrank everything else, and only then does the date decide.
 *
 * The club's races are why this site exists: a visitor arrives to find the next one and enter
 * it, and a training session that happens to fall sooner should not push it below the fold.
 * PostgreSQL sorts `false` before `true`, so the comparison is ordered descending to put races
 * at the top.
 *
 * This is a deliberate trade, not a neutral sort: a race three months out will sit above a
 * community run tomorrow. That is the intended reading of the page — the race is the thing
 * being advertised, the weekly run is the thing regulars already know about.
 */
const RACES_FIRST = desc(sql`${events.kind} = 'RACE'`);

/**
 * The featured event outranks even a race.
 *
 * This is the flag the ordering comment used to predict: when one specific event has to lead
 * the page — the anniversary cross, the day registration opens — the club says so on the row
 * rather than someone adding another clause here. At most one row may carry it, and that is
 * the database's job, not this file's.
 */
const FEATURED_FIRST = desc(events.featured);

/**
 * Published events that have not happened yet: the featured one, then races, then soonest.
 *
 * The listing shows these rather than everything: a page whose first card is last month's run
 * reads as abandoned, which for a club whose events are its whole purpose is the worst thing
 * the page can say. Past events stay published, stay linkable and stay in the sitemap — they
 * are simply not what the listing leads with.
 */
export async function listUpcomingEvents(db: Database, locale: Locale, now: Date) {
  return db
    .select(PUBLIC_COLUMNS)
    .from(events)
    .innerJoin(eventTranslations, eq(eventTranslations.eventId, events.id))
    .where(
      and(
        eq(eventTranslations.locale, locale),
        eq(eventTranslations.editorialStatus, "PUBLISHED"),
        gte(eventEndsAt, now),
      ),
    )
    .orderBy(FEATURED_FIRST, RACES_FIRST, asc(events.startsAt));
}

/**
 * The most recently finished published event, or undefined when the club has never held one.
 *
 * Between seasons there may be nothing scheduled. Rather than showing an empty page — which
 * looks like a broken site rather than a quiet month — the listing falls back to the last
 * event that happened, shown with its date so nobody mistakes it for an invitation.
 */
export async function findLatestPastEvent(db: Database, locale: Locale, now: Date) {
  const [row] = await db
    .select(PUBLIC_COLUMNS)
    .from(events)
    .innerJoin(eventTranslations, eq(eventTranslations.eventId, events.id))
    .where(
      and(
        eq(eventTranslations.locale, locale),
        eq(eventTranslations.editorialStatus, "PUBLISHED"),
        lt(eventEndsAt, now),
      ),
    )
    .orderBy(desc(events.startsAt))
    .limit(1);

  return row;
}

/**
 * The full internal event row — including `capacity`, which `PUBLIC_COLUMNS` deliberately
 * omits. Registration needs the raw number to compute occupancy; the public site only ever
 * needs the *derived* available-places count (BR-REQ-034-01), never the capacity itself.
 */
export async function findEventForRegistrationById(db: Database, eventId: string) {
  const [row] = await db.select().from(events).where(eq(events.id, eventId)).limit(1);
  return row;
}

/**
 * The title, meeting point and start time an email template needs, in one locale — falling
 * back to the other published locale if this one has none, since a notification must never
 * fail to render for a locale gap that a 404 would be the right answer to on the public site.
 */
export async function findEventNotificationDetails<T extends Record<string, unknown>>(
  db: GenericDatabase<T>,
  eventId: string,
  locale: Locale,
) {
  const rows = await db
    .select({
      locale: eventTranslations.locale,
      title: eventTranslations.title,
      locationName: eventTranslations.locationName,
      startsAt: events.startsAt,
      timezone: events.timezone,
    })
    .from(eventTranslations)
    .innerJoin(events, eq(events.id, eventTranslations.eventId))
    .where(eq(eventTranslations.eventId, eventId));

  return rows.find((row) => row.locale === locale) ?? rows[0];
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
