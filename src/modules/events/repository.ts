import { type AnyColumn, and, asc, desc, eq, gte, inArray, isNull, lt, type SQL, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import { eventTranslations, events } from "@/db/schema/events";
import type { EventType } from "@/modules/events/domain/event-type";
import type { Database as GenericDatabase } from "@/db/types";

type Locale = (typeof eventTranslations.locale.enumValues)[number];

/**
 * A fact about the place, or null while the place is to be announced (`DECISIONS.md` §328).
 *
 * In SQL, on every public read, rather than a flag each surface is trusted to check: a page, a
 * card, the calendar feed, the structured data, the share picture or an email that forgets the
 * flag then shows no place at all — never the one the organizer typed and has not announced.
 * The surfaces read `locationToBeAnnounced` only to say "Locația se anunță în curând" where the
 * place would be.
 */
const unlessToBeAnnounced = <T>(fact: SQL<T> | AnyColumn) =>
  sql<T | null>`CASE WHEN ${events.locationToBeAnnounced} THEN NULL ELSE ${fact} END`;

/**
 * The place's name as a page reads it: the language's own when the club gave one (migration
 * `0059`), else the event's — never the other language's (BR-REQ-040-02) — and nothing at all
 * while the place is to be announced.
 */
const publicLocationName = unlessToBeAnnounced<string | null>(
  sql<string | null>`COALESCE(NULLIF(btrim(${eventTranslations.locationName}), ''), ${events.locationName})`,
);

/**
 * The programme's rows (§117) as the public reads them: whole, except that each row's own place
 * is emptied while the place is to be announced (§328) — "Ridicarea kitului — Sala Sporturilor"
 * names the venue as surely as the meeting point does. The time and the label stay. The place
 * becomes `null`, the value a row without one already carries, never a missing key, which
 * `readScheduleItems` would refuse along with the whole programme. Only a well-formed list is
 * rewritten, and only its objects: anything else passes through untouched for
 * `readScheduleItems` to drop, as it always has, rather than failing the page's query.
 */
const publicScheduleItems = sql<unknown>`CASE
  WHEN ${events.locationToBeAnnounced} AND jsonb_typeof(${events.scheduleItems}) = 'array' THEN (
    SELECT jsonb_agg(CASE WHEN jsonb_typeof(r.item) = 'object' THEN jsonb_set(r.item, '{place}', 'null'::jsonb) ELSE r.item END ORDER BY r.n)
    FROM jsonb_array_elements(${events.scheduleItems}) WITH ORDINALITY AS r(item, n)
  )
  ELSE ${events.scheduleItems}
END`.mapWith(events.scheduleItems);

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
  type: events.type,
  // What it is run on; null on a meetup (`DECISIONS.md` §61).
  surface: events.surface,
  eventStatus: events.eventStatus,
  startsAt: events.startsAt,
  endsAt: events.endsAt,
  // The gun time, when it differs from when the event begins. Null on an ordinary run.
  raceStartsAt: events.raceStartsAt,
  timezone: events.timezone,
  // The meeting point on a map, as the organizer pasted it: stored, never assembled, because
  // AGENTS.md §8 forbids a provider hostname under src/. Null while the place is to be
  // announced (§328), like the name and the address below.
  mapUrl: unlessToBeAnnounced<string | null>(events.mapUrl),
  // The course, when the club has drawn one somewhere (BR-REQ-011-01 criterion 8).
  routeUrl: events.routeUrl,
  // A YouTube link, embedded from its id (BR-REQ-011-01 criterion 9).
  videoUrl: events.videoUrl,
  // The club's Strava group event for this occurrence (criterion 10).
  stravaEventUrl: events.stravaEventUrl,
  facebookEventUrl: events.facebookEventUrl,
  // The organizations the event is held with (§168), the list and the two columns it
  // replaced — read together, and only ever through `readCoHosts`.
  coHosts: events.coHosts,
  coHostName: events.coHostName,
  coHostUrl: events.coHostUrl,
  // "Linkuri și fișiere" (§332): addresses the organizer pasted to be clicked by anybody —
  // public by nature, read only through `readEventLinks`.
  links: events.links,
  featured: events.featured,
  // A special edition (§168): a badge on the card and the page, and a tie-break below.
  isSpecial: events.isSpecial,
  distanceMeters: events.distanceMeters,
  elevationGainMeters: events.elevationGainMeters,
  registrationMode: events.registrationMode,
  registrationOpensAt: events.registrationOpensAt,
  registrationClosesAt: events.registrationClosesAt,
  confirmationOpensDaysBefore: events.confirmationOpensDaysBefore,
  confirmationDeadlineDaysBefore: events.confirmationDeadlineDaysBefore,
  // Who may enter (§329): the page says it, the form's picker is bounded by it, and the
  // structured data states it as `typicalAgeRange`. A condition of the race, like its date.
  minAge: events.minAge,
  externalRegistrationUrl: events.externalRegistrationUrl,
  externalProvider: events.externalProvider,
  // Whether this event publishes a start list at all (BR-REQ-039-01). The names themselves are
  // a separate query, made only when this says NAMES.
  participantListVisibility: events.participantListVisibility,
  // The meeting point is one fact on the event row (`DECISIONS.md` §36); its *name* is read in
  // the page's language when the club gave it one (migration `0058`), else in the club's own
  // words as before. Never the other language's: a blank name reads the event, not the other
  // row (BR-REQ-040-02). While the place is to be announced (§328) all three are null and the
  // flag says why, so a surface says "se anunță în curând" instead of saying nothing.
  locationName: publicLocationName,
  locationAddress: unlessToBeAnnounced<string | null>(events.locationAddress),
  locationToBeAnnounced: events.locationToBeAnnounced,
  difficulty: events.difficulty,
  costType: events.costType,
  // What a paid event costs, or what a donation suggests, and where either is paid (§343) —
  // free text and an https link, read only through the phrase each surface builds from them.
  costAmount: events.costAmount,
  costUrl: events.costUrl,
  slug: eventTranslations.slug,
  title: eventTranslations.title,
  excerpt: eventTranslations.excerpt,
  // The short description as written (§73) — null for events from before it; `excerpt` then.
  excerptJson: eventTranslations.excerptJson,
  // The description, as a rich-text document (§11.3), rendered by `RichText`.
  bodyJson: eventTranslations.bodyJson,
  rulesJson: eventTranslations.rulesJson,
  scheduleJson: eventTranslations.scheduleJson,
  // "What to bring", one line (§81) — in the emails, and in the calendar's description (§159).
  checklist: eventTranslations.checklist,
  // The programme's rows (§117), the event's own; read through `readScheduleItems`. Without
  // their places while the place is to be announced (§328).
  scheduleItems: publicScheduleItems,
  /** When the event row last changed — the calendar feed's `DTSTAMP` (§107). */
  updatedAt: events.updatedAt,
  seoTitle: eventTranslations.seoTitle,
  seoDescription: eventTranslations.seoDescription,
  // When the event was first published — one date for both languages now that publication is
  // one state per event (`DECISIONS.md` §28).
  publishedAt: events.publishedAt,
};

/**
 * What every public query filters on: the event is published, and this locale has a translation.
 *
 * Publication moved to the event, so the status test is on `events`; the locale test is still
 * the join, and it is what keeps BR-REQ-040-02 true — a locale with no translation row is a 404
 * in that locale and never a fallback to the other language.
 */
const publishedIn = (locale: Locale) =>
  and(eq(events.editorialStatus, "PUBLISHED"), eq(eventTranslations.locale, locale));

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
 * Only published events are returned, and only in a locale that has a translation.
 * BR-REQ-020-01 criterion 1 and BR-REQ-040-02: an event that is not published is a 404, and so
 * is a locale with no translation of it — never a fallback to the other language. Both filters
 * belong in the query rather than in the caller.
 *
 * A CANCELLED event is still listed — BR-REQ-020-01 criterion 2 requires it to render with a
 * visible cancelled status rather than vanish.
 */
export async function listPublishedEvents(db: Database, locale: Locale) {
  return db
    .select(PUBLIC_COLUMNS)
    .from(events)
    .innerJoin(eventTranslations, eq(eventTranslations.eventId, events.id))
    .where(publishedIn(locale))
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
 * An unpublished event yields nothing at all, because advertising an alternate that 404s is
 * worse than advertising none (BR-REQ-040-02).
 */
export async function findPublishedTranslations(db: Database, eventId: string) {
  return db
    .select({ locale: eventTranslations.locale, slug: eventTranslations.slug })
    .from(eventTranslations)
    .innerJoin(events, eq(events.id, eventTranslations.eventId))
    .where(and(eq(eventTranslations.eventId, eventId), eq(events.editorialStatus, "PUBLISHED")));
}

/**
 * The same, for every event in `eventIds` at once — the sitemap's own twin of the single-event
 * version above (§342). Building the whole file with `findPublishedTranslations` per row asks
 * one query per event, and a weekly series is dozens of dated rows: this asks one query for the
 * lot, grouped by `eventId`, and costs nothing extra when the list is a single event.
 *
 * `eventIds` is trusted to already be published rows — `listPublishedEvents`'s own — so the
 * join's `editorialStatus` check here is belt and braces rather than the filter doing the work.
 */
export async function findPublishedTranslationsForEvents(
  db: Database,
  eventIds: readonly string[],
): Promise<Array<{ eventId: string; locale: Locale; slug: string }>> {
  if (eventIds.length === 0) return [];
  return db
    .select({ eventId: eventTranslations.eventId, locale: eventTranslations.locale, slug: eventTranslations.slug })
    .from(eventTranslations)
    .innerJoin(events, eq(events.id, eventTranslations.eventId))
    .where(and(inArray(eventTranslations.eventId, eventIds as string[]), eq(events.editorialStatus, "PUBLISHED")));
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
const RACES_FIRST = desc(sql`${events.type} = 'RACE'`);

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
 * A special edition leads its own band (`DECISIONS.md` §168).
 *
 * Third in the ordering, and third deliberately: the hero is decided by `FEATURED_FIRST`
 * alone — `listingSections` reads the first row's `featured` flag and nothing else, so no
 * number of special events can change which event the page leads with — and races still
 * outrank everything that is not the lead, because that trade is older than this flag and was
 * argued on its own terms above. What is left for "special" is the order *within* a band: the
 * anniversary cross above the ordinary races, the Wednesday the club joins another club's
 * race above the ordinary Wednesdays. The date is still the last word.
 */
const SPECIAL_FIRST = desc(events.isSpecial);

/**
 * Published events that have not happened yet: the featured one, then races, then the
 * special editions within each band, then soonest.
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
    .where(and(publishedIn(locale), gte(eventEndsAt, now)))
    .orderBy(FEATURED_FIRST, RACES_FIRST, SPECIAL_FIRST, asc(events.startsAt));
}

/**
 * Every instant at which a published event in this locale stops being upcoming — the one thing
 * the clock changes about the listing (`DECISIONS.md` §333).
 *
 * `listUpcomingEvents`, `listPastEvents` and `findLatestPastEvent` compare `now` against exactly
 * this expression and nothing else, so between two of these instants their answers cannot
 * change; the public cache keys them by the stretch `now` is in (`public-cache/clock.ts`). The
 * same expression, not a copy of it — a cut-off that drifted from the queries' would file an
 * answer under a stretch it was not true for.
 */
export async function listPublishedEventEndings(db: Database, locale: Locale): Promise<Date[]> {
  const rows = await db
    .selectDistinct({ endsAt: sql<Date>`${eventEndsAt}`.mapWith(events.startsAt) })
    .from(events)
    .innerJoin(eventTranslations, eq(eventTranslations.eventId, events.id))
    .where(publishedIn(locale));
  return rows.map((row) => row.endsAt);
}

/**
 * The published events that start inside `[from, to)`, soonest first — one month of them for
 * the calendar (`DECISIONS.md` §89). Past ones included: a calendar shows the month, and last
 * Monday's run is part of it.
 */
export async function listPublishedEventsBetween(db: Database, locale: Locale, from: Date, to: Date) {
  return db
    .select(PUBLIC_COLUMNS)
    .from(events)
    .innerJoin(eventTranslations, eq(eventTranslations.eventId, events.id))
    .where(and(publishedIn(locale), gte(events.startsAt, from), lt(events.startsAt, to)))
    .orderBy(asc(events.startsAt));
}

/**
 * The published events that have already finished, newest first (`DECISIONS.md` §267).
 *
 * The owner: "old or closed events must be shown at the bottom on a different category". Until
 * now the listing showed what is still to come and nothing else, so an event the club held —
 * the race somebody wants a photograph of, last Monday's run — existed only inside the
 * calendar's month view. It is a section of its own at the foot of the listing now, and the
 * part that matters is that a finished event is never mistaken for an invitation.
 *
 * `limit` is what keeps the page from growing without end: a weekly run is fifty rows a year.
 * The calendar (§107, §116) is where the whole history lives, and the section says so.
 *
 * `type` narrows it to one kind, which is the filter the listing above already carries (§272;
 * the owner: "la evenimentele trecute trebuie să pot pune tipul lor"). Filtered in the query
 * rather than after it, because the limit is applied by the database: filtering a page of
 * twelve mixed rows down to the two gear tests among them would show two and call it all of
 * them.
 *
 * **A date of a standing series is not history** (§275; the owner: "weekly events should not be
 * treated as past events, only the non-weekly ones"). Last Monday's Happy Monday is not
 * something the club held and moved on from — it is the run that happens again this Monday, and
 * it is already the first card on the page. What belongs here is the race, the gear test, the
 * hike: the things that happened once. A source with a rule and every occurrence of it are both
 * excluded, which is the pair `repeat_rule` and `repeat_of` name (§122).
 */
export async function listPastEvents(
  db: Database,
  locale: Locale,
  now: Date,
  limit: number,
  type?: EventType,
) {
  return db
    .select(PUBLIC_COLUMNS)
    .from(events)
    .innerJoin(eventTranslations, eq(eventTranslations.eventId, events.id))
    .where(
      and(
        publishedIn(locale),
        lt(eventEndsAt, now),
        isNull(events.repeatRule),
        isNull(events.repeatOf),
        ...(type ? [eq(events.type, type)] : []),
      ),
    )
    .orderBy(desc(events.startsAt))
    .limit(limit);
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
    .where(and(publishedIn(locale), lt(eventEndsAt, now)))
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
 * When an event starts, and nothing else — the event's own row, with no join through
 * `event_translations`.
 *
 * `findEventNotificationDetails` below is that join, and an event whose text nobody has
 * written yet returns nothing from it. The declaration link's lifetime is the event's start
 * since `DECISIONS.md` §160, and how long a secret lives must not depend on whether a
 * translation row happens to exist (AGENTS.md §12.8).
 */
export async function findEventStartsAt<T extends Record<string, unknown>>(
  db: GenericDatabase<T>,
  eventId: string,
): Promise<Date | undefined> {
  const [row] = await db.select({ startsAt: events.startsAt }).from(events).where(eq(events.id, eventId)).limit(1);
  return row?.startsAt;
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
      slug: eventTranslations.slug,
      // Whether the page has rules to link to (§96).
      hasRules: sql<boolean>`${eventTranslations.rulesJson} IS NOT NULL`,
      hasSchedule: sql<boolean>`${eventTranslations.scheduleJson} IS NOT NULL OR ${events.scheduleItems} IS NOT NULL`,
      // The rows themselves, for the reminder (§117) — without their places while the place is
      // to be announced (§328), as on the page.
      scheduleItems: publicScheduleItems,
      // Whether the page has "Linkuri și fișiere" to point at (§332), read by what the rows
      // mean — `readEventLinks` — rather than by the column being non-null.
      links: events.links,
      // "What to bring", the translation's line (§81); the map and the Strava event are the
      // event's own. The place's name in the runner's language when the club gave it one
      // (migration `0059`), else the event's — the same rule as `PUBLIC_COLUMNS`, and like it,
      // no place and no map while the place is to be announced (§328): an email is as public as
      // the page, and a reminder is the likeliest thing to be forwarded.
      checklist: eventTranslations.checklist,
      locationName: publicLocationName,
      mapUrl: unlessToBeAnnounced<string | null>(events.mapUrl),
      locationToBeAnnounced: events.locationToBeAnnounced,
      stravaEventUrl: events.stravaEventUrl,
      facebookEventUrl: events.facebookEventUrl,
      startsAt: events.startsAt,
      // A race's gun time, for the update notice that says the time changed (§331).
      raceStartsAt: events.raceStartsAt,
      timezone: events.timezone,
    })
    .from(eventTranslations)
    .innerJoin(events, eq(events.id, eventTranslations.eventId))
    .where(eq(eventTranslations.eventId, eventId));

  const row = rows.find((candidate) => candidate.locale === locale) ?? rows[0];
  if (!row) return undefined;
  /*
    The place in every language the event has, for the half of a bilingual message written in the
    other one (§362, `renderBilingual`): the English half names the English place, read by the same
    rule — and withheld the same way while the place is to be announced (§328).
  */
  const locationNames: Partial<Record<Locale, string | null>> = Object.fromEntries(rows.map((candidate) => [candidate.locale, candidate.locationName]));
  return { ...row, locationNames };
}

/** One published event by its locale-scoped slug, or undefined when it should 404. */
// Generic in the schema like its neighbours (§174): the outbox renderer reaches it with the
// application's own `Db`, and the public routes with theirs.
export async function findPublishedEventBySlug<T extends Record<string, unknown>>(
  db: GenericDatabase<T>,
  locale: Locale,
  slug: string,
) {
  const [row] = await db
    .select(PUBLIC_COLUMNS)
    .from(events)
    .innerJoin(eventTranslations, eq(eventTranslations.eventId, events.id))
    .where(and(publishedIn(locale), eq(eventTranslations.slug, slug)))
    .limit(1);

  return row;
}
