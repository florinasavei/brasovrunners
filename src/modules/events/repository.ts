import { type AnyColumn, and, asc, desc, eq, gte, inArray, isNull, lt, or, type SQL, sql } from "drizzle-orm";
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
 * A date, or null while the date is to be announced (`DECISIONS.md` §533) — the place's discipline
 * (§328) applied to the start, the end and the race's start. In SQL, so a surface that forgets the
 * flag shows no date at all, never the provisional one the organizer typed.
 */
/**
 * "The start is not announced" (§533): its date, or only its time. One rule for both — the same
 * lists leave it out, the same reads withhold the start — and one expression, so they cannot drift.
 */
const startHeldBack = sql`(${events.dateToBeAnnounced} OR ${events.timeToBeAnnounced})`;

const unlessDateToBeAnnounced = <C extends AnyColumn>(column: C) =>
  // Decoded as the column is (a `Date`), and typed as possibly null, which the column's own type is not.
  sql`CASE WHEN ${startHeldBack} THEN NULL ELSE ${column} END`.mapWith(column) as SQL<C["_"]["data"] | null>;

/**
 * The day, when only the time is to be announced (§533): `YYYY-MM-DD` on the event's own calendar,
 * a date with no time in it — the one part of the start the club has announced. Null otherwise,
 * the date's switch included (it wins: no day). Computed in SQL, so no reader is handed the hour.
 */
const announcedDay = sql<string | null>`CASE WHEN ${events.timeToBeAnnounced} AND NOT ${events.dateToBeAnnounced}
  THEN to_char(${events.startsAt} AT TIME ZONE ${events.timezone}, 'YYYY-MM-DD') END`;

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
  // Every read over these columns is of a dated event (`publishedIn` keeps the undated out); an
  // undated one is read through `UNDATED_PUBLIC_COLUMNS`, where all three are null (§533).
  startsAt: events.startsAt,
  endsAt: events.endsAt,
  // The gun time, when it differs from when the event begins. Null on an ordinary run.
  raceStartsAt: events.raceStartsAt,
  dateToBeAnnounced: events.dateToBeAnnounced,
  timeToBeAnnounced: events.timeToBeAnnounced,
  // «Doar pentru membrii BVR» (§552): always false on a public read — `publishedAnyDateIn` keeps the
  // members' events out — and true only on the members' own reads, whose card and page say so.
  membersOnly: events.membersOnly,
  timezone: events.timezone,
  // The meeting point on a map, as the organizer pasted it: stored, never assembled, because
  // AGENTS.md §8 forbids a provider hostname under src/. Null while the place is to be
  // announced (§328), like the name and the address below.
  mapUrl: unlessToBeAnnounced<string | null>(events.mapUrl),
  // «Coordonate» (§416): where the forecast is read when the map link carries no pin — withheld
  // with the place (§328), so a place not announced yet is never given away by its weather.
  latitude: unlessToBeAnnounced<number | null>(events.latitude),
  longitude: unlessToBeAnnounced<number | null>(events.longitude),
  // The course, when the club has drawn one somewhere (BR-REQ-011-01 criterion 8).
  routeUrl: events.routeUrl,
  // No `video_url` / `video_poster_url` (§481): a film is a figure in the description, where
  // migration `0092` moved every stored link (BR-REQ-011-01 criterion 9), and the two columns
  // leave the database in BR-V2.11's contract migration (§491, AGENTS.md §7.6).
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
  // «Aproximativ» (§598): the distance is approximate, and every surface says «≈» (`distanceWords`).
  distanceEstimated: events.distanceEstimated,
  elevationGainMeters: events.elevationGainMeters,
  // «Estimativ» (§585): the climb is a guess, and every surface says «≈» (`elevationWords`).
  elevationGainEstimated: events.elevationGainEstimated,
  // The night override (§394): with the start and the zone above, whether this date is a night
  // event — the pill on the card and the page, a line in the calendar entry and the `.ics`.
  nightOverride: events.nightOverride,
  // The group run's optional self-declaration (§393): the button under the route's pills.
  offersGroupRunDeclaration: events.offersGroupRunDeclaration,
  registrationMode: events.registrationMode,
  registrationOpensAt: events.registrationOpensAt,
  registrationOpensSoon: events.registrationOpensSoon,
  registrationClosesAt: events.registrationClosesAt,
  // «Kit de participare» → «Tricou» (§554): whether the registration form asks the T-shirt size.
  kitShirt: events.kitShirt,
  // «Condiții de participare» → «Informații medicale» (§557): whether the form asks the health note.
  askHealthNote: events.askHealthNote,
  confirmationOpensDaysBefore: events.confirmationOpensDaysBefore,
  confirmationDeadlineDaysBefore: events.confirmationDeadlineDaysBefore,
  // Who may enter (§329): the page says it, the form's picker is bounded by it, and the
  // structured data states it as `typicalAgeRange`. A condition of the race, like its date.
  minAge: events.minAge,
  // The event's own reminder lead (§377), for the five steps' "we send a reminder … before".
  reminderHoursBefore: events.reminderHoursBefore,
  externalRegistrationUrl: events.externalRegistrationUrl,
  externalProvider: events.externalProvider,
  // Whether this event publishes a start list at all (BR-REQ-039-01). The names themselves are
  // a separate query, made only when this says NAMES.
  participantListVisibility: events.participantListVisibility,
  // «Lista de așteptare e publică» (§628): whether that list may also draw the ticked waiting-list
  // rows, on top of the privacy notice's two gates (§396, §421). Off, none is even read.
  waitlistPublic: events.waitlistPublic,
  // «Arată public câți așteaptă» (§634): whether the door says how many wait. The live door reads it
  // from the availability entry it counts with (`cachedPublicAvailability`), so the number and its
  // switch come off one row; the editor's preview draws it from here.
  waitlistCountPublic: events.waitlistCountPublic,
  // «Arată public numărătoarea» and «Lista ascunsă» (§647): whether «Cine vine» says its numbers (on
  // every event), and whether they count the hidden list (only while its switch is on) — read by
  // `StartList` through `hiddenListCounting`. Never which names it shows.
  hiddenListEnabled: events.hiddenListEnabled,
  participantCountPublic: events.participantCountPublic,
  hiddenListCounted: events.hiddenListCounted,
  // The meeting point is one fact on the event row (`DECISIONS.md` §36); its *name* is read in
  // the page's language when the club gave it one (migration `0058`), else in the club's own
  // words as before. Never the other language's: a blank name reads the event, not the other
  // row (BR-REQ-040-02). While the place is to be announced (§328) all three are null and the
  // flag says why, so a surface says "se anunță în curând" instead of saying nothing.
  locationName: publicLocationName,
  locationAddress: unlessToBeAnnounced<string | null>(events.locationAddress),
  locationToBeAnnounced: events.locationToBeAnnounced,
  // The level on the club's scale of fifteen (§526) — the difficulty's one column; the retired
  // `difficulty` is never read.
  difficultyLevel: events.difficultyLevel,
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
  // The route / training description (§387), under `#route` with the route's links.
  routeDescriptionJson: eventTranslations.routeDescriptionJson,
  // "What to bring", one line (§81) — in the emails, and in the calendar's description (§159).
  checklist: eventTranslations.checklist,
  // The club's discount on an external event's own fee (`DECISIONS.md` §394): read on every
  // event, null everywhere but an `EXTERNAL`-registration, `PAID` one — the service clears it
  // elsewhere, so a null here means "no discount stated" rather than "read the box".
  discountNote: eventTranslations.discountNote,
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
const publishedAnyDateIn = (locale: Locale) =>
  and(publishedForMembersIn(locale), NOT_MEMBERS_ONLY);

/**
 * **Not an event for the members alone (§552).** «Doar pentru membrii BVR» withheld in SQL, the way
 * the place (§328) and the start (§533) are: in the condition every public read shares, so the
 * listing, the calendar, the feed, the `.ics` list, the sitemap, the share pictures, the event page's
 * public read and whatever list is built on them next cannot meet such a row. A members' event is
 * read only through `findPublishedEventBySlug(…, "members")` and `listMembersOnlyEvents`, which the
 * pages call after asking for a members' session — never through the public cache.
 */
const NOT_MEMBERS_ONLY = eq(events.membersOnly, false);

/**
 * Published in this locale, a members' event included (§552) — only for a read made after the
 * session was asked: the members' zone and the event's own page, form and `.ics` for a member.
 */
const publishedForMembersIn = (locale: Locale) =>
  and(eq(events.editorialStatus, "PUBLISHED"), eq(eventTranslations.locale, locale));

/**
 * The same, for every read that places an event in time — the listing, the calendar, the feed,
 * the months, the past — and so of dated events only (§533). An event whose date is to be
 * announced is on none of them: its provisional date would sort it, file it under a month and
 * put it in a calendar app. It is read only through `listUndatedPublishedEvents` and
 * `findPublishedEventBySlug`, whose columns carry no date at all.
 */
const publishedIn = (locale: Locale) => and(publishedAnyDateIn(locale), sql`NOT ${startHeldBack}`);

/**
 * `PUBLIC_COLUMNS` for a read that may meet an event whose date is to be announced: the start, the
 * end and the race's start are null while it is (§533), in SQL, as the place is (§328).
 */
const UNDATED_PUBLIC_COLUMNS = {
  ...PUBLIC_COLUMNS,
  startsAt: unlessDateToBeAnnounced(events.startsAt),
  endsAt: unlessDateToBeAnnounced(events.endsAt),
  raceStartsAt: unlessDateToBeAnnounced(events.raceStartsAt),
  // The programme's rows are instants too — «Sâmbătă, 20 nov., 16:00» names the day as surely as
  // the start does — so an undated event has no programme on the page until its date is announced.
  scheduleItems: sql<unknown>`CASE WHEN ${startHeldBack} THEN NULL ELSE ${publicScheduleItems} END`.mapWith(events.scheduleItems),
  // The day alone, when only the time is to be announced (§533).
  announcedDay,
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
    // No alternates for a members' event (§552): its page carries no canonical and no hreflang (§342).
    .where(and(eq(eventTranslations.eventId, eventId), eq(events.editorialStatus, "PUBLISHED"), NOT_MEMBERS_ONLY));
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
    .where(and(inArray(eventTranslations.eventId, eventIds as string[]), eq(events.editorialStatus, "PUBLISHED"), NOT_MEMBERS_ONLY));
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
  return eventNotificationDetailsIn(await findEventNotificationRows(db, eventId), locale);
}

/**
 * One language's row of `findEventNotificationRows`, or the first there is when it has none —
 * carrying `locationNames`, the place's name in every language the event has, for the half of a
 * bilingual message written in the other one (§362, `renderBilingual`): the English half names
 * the English place, read by the same rule — and withheld the same way while the place is to be
 * announced (§328).
 */
export function eventNotificationDetailsIn<R extends { locale: Locale; locationName: string | null }>(
  rows: readonly R[],
  locale: Locale,
) {
  const row = rows.find((candidate) => candidate.locale === locale) ?? rows[0];
  if (!row) return undefined;
  const locationNames: Partial<Record<Locale, string | null>> = Object.fromEntries(
    rows.map((candidate) => [candidate.locale, candidate.locationName]),
  );
  return { ...row, locationNames };
}

export type EventNotificationRow = Awaited<ReturnType<typeof findEventNotificationRows>>[number];

/**
 * Every language's row of what an email needs about one event, in one query — the same query
 * `findEventNotificationDetails` always ran, which already read each translation and kept one.
 *
 * The send path keeps them all (§373, email follow-up): each half of the bilingual message reads
 * its own language's title, "what to bring" and name for the place, so the English half of a
 * Romanian registrant's message is English (`notifications/render.ts`, read once per event per
 * batch).
 */
export async function findEventNotificationRows<T extends Record<string, unknown>>(
  db: GenericDatabase<T>,
  eventId: string,
) {
  return db
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
      // The route / training description (§387), so an email can tell whether this language's
      // route section exists — a route-kind link moves into it and out of "Linkuri și fișiere",
      // exactly as the page draws it (`partitionEventLinks`).
      routeDescriptionJson: eventTranslations.routeDescriptionJson,
      // "What to bring", the translation's line (§81); the map and the Strava event are the
      // event's own. The place's name in the runner's language when the club gave it one
      // (migration `0059`), else the event's — the same rule as `PUBLIC_COLUMNS`, and like it,
      // no place and no map while the place is to be announced (§328): an email is as public as
      // the page, and a reminder is the likeliest thing to be forwarded.
      checklist: eventTranslations.checklist,
      locationName: publicLocationName,
      mapUrl: unlessToBeAnnounced<string | null>(events.mapUrl),
      // Where the reminder's forecast is read when the map link carries no pin (§416), as on the page.
      latitude: unlessToBeAnnounced<number | null>(events.latitude),
      longitude: unlessToBeAnnounced<number | null>(events.longitude),
      // The street under the place's name, in the emails' facts block (§392) — withheld with the
      // place while it is to be announced (§328), as on the page.
      locationAddress: unlessToBeAnnounced<string | null>(events.locationAddress),
      locationToBeAnnounced: events.locationToBeAnnounced,
      stravaEventUrl: events.stravaEventUrl,
      facebookEventUrl: events.facebookEventUrl,
      // The route's facts and the cost, as the page's pills say them (§392, `eventFactsBlock`):
      // the same public columns `PUBLIC_COLUMNS` reads, nothing a public page does not show.
      surface: events.surface,
      difficultyLevel: events.difficultyLevel,
      distanceMeters: events.distanceMeters,
      distanceEstimated: events.distanceEstimated,
      elevationGainMeters: events.elevationGainMeters,
      elevationGainEstimated: events.elevationGainEstimated,
      routeUrl: events.routeUrl,
      costType: events.costType,
      costAmount: events.costAmount,
      costUrl: events.costUrl,
      startsAt: events.startsAt,
      // Whether the event will still run, for «Nu mai pot ajunge» (§558): read with the rest, never a second query per row.
      eventStatus: events.eventStatus,
      // The event's own end (§394): the night line's span reads it before the programme's rows,
      // as the pill does — a run whose «Durata» carries it past dusk is a night run here too.
      endsAt: events.endsAt,
      // A race's gun time, for the update notice that says the time changed (§331).
      raceStartsAt: events.raceStartsAt,
      timezone: events.timezone,
      // The event's own minimum age (§329), for a declaration's `{{minimumAge}}` (§440).
      minAge: events.minAge,
      // The night override (§394): with the start and the zone, whether the reminder says to bring a light.
      nightOverride: events.nightOverride,
      // Whether the reminder's night line calls it a run rather than an event (§394).
      type: events.type,
      // The route pills' source (`RouteFactsSource`) carries it, as the page's row does.
      registrationMode: events.registrationMode,
      // The deadlines the words state (§377): this event's own reminder lead ("este peste 2
      // zile"), and when its participation window opens ("când îți reamintim cu o săptămână").
      reminderHoursBefore: events.reminderHoursBefore,
      confirmationOpensDaysBefore: events.confirmationOpensDaysBefore,
    })
    .from(eventTranslations)
    .innerJoin(events, eq(events.id, eventTranslations.eventId))
    .where(eq(eventTranslations.eventId, eventId));
}

/** One published event by its locale-scoped slug, or undefined when it should 404. */
// Generic in the schema like its neighbours (§174): the outbox renderer reaches it with the
// application's own `Db`, and the public routes with theirs.
export async function findPublishedEventBySlug<T extends Record<string, unknown>>(
  db: GenericDatabase<T>,
  locale: Locale,
  slug: string,
  /**
   * Who is reading (§552): `public` — every caller by default, the public cache included — never
   * meets a members' event; `members` meets it too, and is passed only by a caller that asked for a
   * members' session first (`events/members-only.ts`) or that is past the door already: the email
   * renderer, writing to somebody registered for it.
   */
  audience: EventAudience = "public",
) {
  const [row] = await db
    .select(UNDATED_PUBLIC_COLUMNS)
    .from(events)
    .innerJoin(eventTranslations, eq(eventTranslations.eventId, events.id))
    .where(and(audience === "members" ? publishedForMembersIn(locale) : publishedAnyDateIn(locale), eq(eventTranslations.slug, slug)))
    .limit(1);

  return row;
}

/** Who a published event is read for (§552): anybody, or a member of the club and the backoffice. */
export type EventAudience = "public" | "members";

/**
 * The club's events for its members alone (§552), for the members' zone: published in this language,
 * «Doar pentru membrii BVR», going ahead — the dated ones soonest first while they have not ended,
 * then those whose date is to be announced (§533), which never pass. Read with the undated columns,
 * so a start held back is null here as on every other read. Called only after the zone asked for the
 * account (`canOpenMembersZone`), and never through the public cache.
 */
export async function listMembersOnlyEvents(db: Database, locale: Locale, now: Date) {
  return db
    .select(UNDATED_PUBLIC_COLUMNS)
    .from(events)
    .innerJoin(eventTranslations, eq(eventTranslations.eventId, events.id))
    .where(
      and(
        publishedForMembersIn(locale),
        eq(events.membersOnly, true),
        or(
          and(sql`NOT ${startHeldBack}`, gte(eventEndsAt, now)),
          and(startHeldBack, eq(events.eventStatus, "SCHEDULED")),
        ),
      ),
    )
    .orderBy(sql`${startHeldBack} ASC`, asc(events.startsAt), asc(events.id));
}

/**
 * Every published event's address in one locale, dated or not (§533) — the sitemap's rows, which
 * need the page and when it was first published, never a date: one query, as before the date could
 * be held back.
 */
export async function listPublishedEventAddresses(db: Database, locale: Locale) {
  return db
    .select({ id: events.id, slug: eventTranslations.slug, publishedAt: events.publishedAt })
    .from(events)
    .innerJoin(eventTranslations, eq(eventTranslations.eventId, events.id))
    .where(publishedAnyDateIn(locale))
    .orderBy(asc(events.startsAt));
}

/** An event's page as it reads: its date is null while it is to be announced (§533). */
type PublicEventPageRow = NonNullable<Awaited<ReturnType<typeof findPublishedEventBySlug>>>;
export type PublicEventPage = Omit<PublicEventPageRow, "announcedDay"> & {
  /**
   * The day alone, `YYYY-MM-DD`, when only the time is to be announced (§533). Optional because only
   * this read carries it: a listing row (`PublicEvent`) is dated, and is an event page as it is.
   */
  announcedDay?: string | null;
};

/**
 * The published events whose date is to be announced (§533), for the listing's own section under
 * the dated ones: never in a month, a calendar or a feed. Their dates are null in SQL; they are
 * ordered by their announced day when only the time is held back, then by when they were published,
 * and only while going ahead.
 */
export async function listUndatedPublishedEvents(db: Database, locale: Locale) {
  return db
    .select(UNDATED_PUBLIC_COLUMNS)
    .from(events)
    .innerJoin(eventTranslations, eq(eventTranslations.eventId, events.id))
    // Going ahead only: a dated event leaves the listing when it has passed, and one with no date
    // never passes — so a cancelled one leaves the section when it is cancelled (its page stays).
    .where(and(publishedAnyDateIn(locale), startHeldBack, eq(events.eventStatus, "SCHEDULED")))
    // The ones whose day is announced by that day, then those with no day at all (§533).
    .orderBy(sql`${announcedDay} ASC NULLS LAST`, asc(events.publishedAt), asc(events.id));
}
