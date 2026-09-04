import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { legalDocuments } from "./legal-documents";
import { locale } from "./locale";
import { staffUsers } from "./staff-users";

// AGENTS.md §10.1 defines these sets. They are database enums so an unsupported value is
// rejected by the database, not only by application validation (BR-REQ-010-01 criterion 3).
export const eventKind = pgEnum("event_kind", [
  "COMMUNITY_RUN",
  "TRAIL_RUN",
  "INTERVAL_SESSION",
  "LONG_RUN",
  "MEETUP",
  "RACE",
  "OTHER",
]);

export const eventStatus = pgEnum("event_status", ["SCHEDULED", "CANCELLED", "COMPLETED"]);

export const editorialStatus = pgEnum("editorial_status", [
  "DRAFT",
  "IN_REVIEW",
  "PUBLISHED",
  "ARCHIVED",
]);

export const registrationMode = pgEnum("registration_mode", ["NONE", "INTERNAL", "EXTERNAL"]);

/**
 * Events.
 *
 * The full M1 column set from AGENTS.md §12.3 is present even though the pilot reads only a
 * few of them. Columns are free to add now and a migration later, and the M2 footprints
 * (`race_id`) are required to be here from the start.
 */
export const events = pgTable(
  "events",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    // M2 footprint: a race groups child distance events (BR-REQ-012-01). No behaviour yet.
    raceId: uuid("race_id"),

    kind: eventKind("kind").notNull(),
    eventStatus: eventStatus("event_status").notNull().default("SCHEDULED"),

    /**
     * Publication, for the whole event rather than per language.
     *
     * This column used to live on `event_translations`, so Romanian could be PUBLISHED while
     * English was still a draft. It no longer can: an event is published or it is not, and both
     * languages go live together (`DECISIONS.md` §28, superseding the per-locale wording of
     * AGENTS.md §11.2). BR-REQ-040-02 still forbids a cross-locale fallback — a locale with no
     * translation row is a 404, and so is an event that is not PUBLISHED — but the half-published
     * state that rule used to have to describe cannot occur any more.
     *
     * The rule that makes it safe is enforced in `content/events/service.ts#transitionEvent`:
     * PUBLISHED requires a complete translation in every locale. A CHECK cannot say that
     * honestly — it would have to read `event_translations` — so the only thing asserted here is
     * what a CHECK *can* see: a published event carries the date it was first published.
     */
    editorialStatus: editorialStatus("editorial_status").notNull().default("DRAFT"),

    /**
     * When the event was first published — and it is never cleared.
     *
     * Unpublishing moves `editorial_status` back to DRAFT, which is what every public query
     * reads, but the timestamp stays. It is the record of "this has been public at least once",
     * which is what AGENTS.md §11.5 keys slug stability on: a slug is editable before first
     * publication and stable afterwards, and clearing this on unpublish would hand back an
     * editable slug for a URL people have already followed and search engines have indexed.
     */
    publishedAt: timestamp("published_at", { withTimezone: true }),

    /**
     * Optimistic concurrency for the event row (AGENTS.md §11.5, BR-REQ-051-01 criterion 5).
     *
     * The same guard `event_translations.version` gives a translation save, now that the event
     * row carries publication and the whole registration block: two organizers configuring one
     * race on a Sunday morning is the ordinary case, and last-write-wins would silently discard
     * one of them. Incremented by every save and every transition.
     */
    version: integer("version").notNull().default(1),

    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }),

    /**
     * The gun time, when the race's own start differs from when the event begins.
     *
     * `starts_at` keeps its meaning exactly: when the event begins — the gathering — and it is
     * what the ordering, the upcoming/past cut-off, the sitemap and the listing all read. A
     * runner needs both times, and they are not the same fact: gather at 09:00, start at
     * 10:00. Null when the club has stated only one time; the page then shows only that one
     * rather than inventing a gathering an hour before.
     */
    raceStartsAt: timestamp("race_starts_at", { withTimezone: true }),

    timezone: text("timezone").notNull().default("Europe/Bucharest"),

    /**
     * The exact spot, in decimal degrees.
     *
     * A name is not a location: "Parcul Tractorul" puts a runner somewhere in a park, and the
     * start is one corner of it. These are what the map link is built from, and what the
     * `SportsEvent` block publishes as `geo` so a search result can show the right pin.
     *
     * Both or neither — half a coordinate is a point in the Atlantic.
     */
    latitude: numeric("latitude"),
    longitude: numeric("longitude"),

    /**
     * An override for the map link, when the club wants one specific page.
     *
     * The ordinary way to get a map link is the coordinates above: the application builds one
     * from them and `MAP_LINK_BASE_URL`, which is configuration. That indirection is not
     * decoration — AGENTS.md §8 forbids a hostname literal anywhere under `src/` and exempts no
     * provider, so a maps URL can be *configured* but never written into the code.
     *
     * This column wins when it is set, for the case coordinates cannot express: a named venue
     * page, a route the club has already drawn, a shared list. The database requires https, so
     * `javascript:` and `data:` cannot be stored even by a seed or a hand-written `UPDATE`.
     */
    mapUrl: text("map_url"),

    distanceMeters: integer("distance_meters"),
    elevationGainMeters: integer("elevation_gain_meters"),

    /**
     * The one event the landing page leads with, or none.
     *
     * At most one row may carry it, and that is enforced by the partial unique index below
     * rather than by application code — the same reasoning as the capacity guard. Two featured
     * events is not a cosmetic bug: the hero would render one of them arbitrarily, and the
     * club would have no way to tell which without reading the database.
     */
    featured: boolean("featured").notNull().default(false),

    capacity: integer("capacity"),

    registrationMode: registrationMode("registration_mode").notNull().default("NONE"),
    registrationOpensAt: timestamp("registration_opens_at", { withTimezone: true }),
    registrationClosesAt: timestamp("registration_closes_at", { withTimezone: true }),

    // The EVENT_DECLARATION document version an internal registration must accept.
    declarationDocumentId: uuid("declaration_document_id").references(() => legalDocuments.id),

    externalProvider: text("external_provider"),
    externalRegistrationUrl: text("external_registration_url"),

    // AGENTS.md §12.3. Nullable because every row that exists today was written by a seed
    // rather than by a person, and inventing an author for it would be a lie in the trail.
    createdByStaffUserId: uuid("created_by_staff_user_id").references(() => staffUsers.id, {
      onDelete: "set null",
    }),
    updatedByStaffUserId: uuid("updated_by_staff_user_id").references(() => staffUsers.id, {
      onDelete: "set null",
    }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // The pilot guard rail that blocked any capacity value — `events_capacity_must_be_null_
    // during_pilot` — is removed here, and only here: BR-REQ-034-02's locked capacity
    // transaction (`modules/registrations/service.ts`) and its concurrency suite
    // (`tests/concurrency/capacity.test.ts`) exist and pass first. WEEKEND.md and
    // DECISIONS.md record why the guard existed and when removing it became safe.

    // AGENTS.md §12.3: capacity and a declaration are internal-registration concepts only.
    check(
      "events_capacity_and_declaration_are_internal_only",
      sql`(${t.registrationMode} = 'INTERNAL') OR (${t.capacity} IS NULL AND ${t.declarationDocumentId} IS NULL)`,
    ),

    // External registration must be an HTTPS link and only on external events.
    check(
      "events_external_fields_external_only",
      sql`(${t.registrationMode} = 'EXTERNAL' AND ${t.externalRegistrationUrl} LIKE 'https://%')
          OR (${t.registrationMode} <> 'EXTERNAL' AND ${t.externalRegistrationUrl} IS NULL AND ${t.externalProvider} IS NULL)`,
    ),

    check("events_end_after_start", sql`${t.endsAt} IS NULL OR ${t.endsAt} > ${t.startsAt}`),

    /**
     * The race cannot start before the event begins, nor after it ends.
     *
     * A gun time before the gathering is a typo every time, and it would render as a page
     * telling runners to arrive an hour after the race started.
     */
    check(
      "events_race_start_within_event",
      sql`${t.raceStartsAt} IS NULL
          OR (${t.raceStartsAt} >= ${t.startsAt}
              AND (${t.endsAt} IS NULL OR ${t.raceStartsAt} <= ${t.endsAt}))`,
    ),

    /**
     * https only, at the database.
     *
     * The form validates too, but the form is not the last line: a seed, a migration or a
     * direct `UPDATE` all reach this column, and a stored `javascript:` URL is a script that
     * runs when a visitor clicks the club's own map link.
     */
    check("events_map_url_is_https", sql`${t.mapUrl} IS NULL OR ${t.mapUrl} LIKE 'https://%'`),

    /**
     * A coordinate is a pair, and each half has a range.
     *
     * Latitude beyond ±90 does not exist, and longitude beyond ±180 wraps — both are what a
     * transposed pair looks like, which is the mistake this catches: Brașov is 45.65, 25.60,
     * and typed the other way round it is a field in Somalia.
     */
    check(
      "events_coordinates_are_a_pair",
      sql`(${t.latitude} IS NULL) = (${t.longitude} IS NULL)`,
    ),
    check(
      "events_coordinates_in_range",
      sql`(${t.latitude} IS NULL OR (${t.latitude} >= -90 AND ${t.latitude} <= 90))
          AND (${t.longitude} IS NULL OR (${t.longitude} >= -180 AND ${t.longitude} <= 180))`,
    ),

    check(
      "events_non_negative_measurements",
      sql`(${t.distanceMeters} IS NULL OR ${t.distanceMeters} >= 0)
          AND (${t.elevationGainMeters} IS NULL OR ${t.elevationGainMeters} >= 0)`,
    ),
    check(
      "events_registration_window_ordered",
      sql`${t.registrationOpensAt} IS NULL OR ${t.registrationClosesAt} IS NULL
          OR ${t.registrationClosesAt} >= ${t.registrationOpensAt}`,
    ),

    /**
     * A capacity is a number of places, so zero is not one.
     *
     * AGENTS.md §12.3 lists "positive capacity" among the checks; it could not be written while
     * the pilot guard forced the column to stay NULL, and it matters now that an organizer types
     * the number into a form. Capacity 0 would read as "unlimited is off, and nobody may enter",
     * which is what `registration_mode = NONE` already says honestly.
     */
    check("events_capacity_positive", sql`${t.capacity} IS NULL OR ${t.capacity} > 0`),

    check("events_version_positive", sql`${t.version} >= 1`),

    /**
     * A published event has a first-publication date.
     *
     * The whole of "PUBLISHED requires both locales complete" cannot be a CHECK — the rows it
     * would have to read are in another table — so this asserts the half that is honestly
     * visible from here, and `content/events/service.ts` asserts the rest.
     */
    check(
      "events_published_has_a_publication_date",
      sql`${t.editorialStatus} <> 'PUBLISHED' OR ${t.publishedAt} IS NOT NULL`,
    ),
    check("events_race_id_implies_race_kind", sql`${t.raceId} IS NULL OR ${t.kind} = 'RACE'`),

    /**
     * At most one featured event, enforced by the database.
     *
     * A partial unique index over the flag: every row with `featured = true` collides with
     * every other, and rows with `false` are not in the index at all, so the ordinary case
     * has no contention. Application code that "remembers" to clear the previous flag is a
     * race between two organizers, not a rule.
     */
    uniqueIndex("events_only_one_featured").on(t.featured).where(sql`${t.featured}`),

    index("events_status_starts_at_idx").on(t.eventStatus, t.startsAt),
    // Every public query filters on publication and orders by the start, now that publication
    // is a column here rather than on the translation the query joins.
    index("events_editorial_status_starts_at_idx").on(t.editorialStatus, t.startsAt),
    index("events_kind_starts_at_idx").on(t.kind, t.startsAt),
    index("events_registration_mode_starts_at_idx").on(t.registrationMode, t.startsAt),
  ],
);

/**
 * Event translations. One row per event per locale.
 *
 * No editorial status here: publication is one state for the whole event (`events`
 * `editorial_status`, `DECISIONS.md` §28), so both languages go live together and a
 * half-published event cannot exist. BR-REQ-040-02 still holds — a locale with no translation
 * row is a 404 in that locale and never a fallback to the other language.
 */
export const eventTranslations = pgTable(
  "event_translations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    locale: locale("locale").notNull(),

    slug: text("slug").notNull(),
    title: text("title").notNull(),
    excerpt: text("excerpt"),
    bodyJson: jsonb("body_json"),

    locationName: text("location_name").notNull(),
    locationAddress: text("location_address"),
    difficultyLabel: text("difficulty_label"),
    coverAltText: text("cover_alt_text"),

    // Free text, per locale: "Gratuit" / "Free", or "50 lei". BR-REQ-041-01 criterion 2 and
    // BR-REQ-070-03 criterion 2 both require cost to be readable as text on the event page,
    // and it is localized wording rather than a number, so it belongs on the translation.
    // Null means the club has not stated a cost; the page then says nothing about it rather
    // than guessing that the event is free.
    costText: text("cost_text"),

    seoTitle: text("seo_title"),
    seoDescription: text("seo_description"),

    // AGENTS.md §12.4. The author is what turns "an Author edits their own drafts"
    // (BR-REQ-051-01 criterion 1) into a rule the server can check rather than a description.
    authorStaffUserId: uuid("author_staff_user_id").references(() => staffUsers.id, {
      onDelete: "set null",
    }),
    reviewedByStaffUserId: uuid("reviewed_by_staff_user_id").references(() => staffUsers.id, {
      onDelete: "set null",
    }),

    /**
     * Optimistic concurrency (AGENTS.md §11.5, BR-REQ-051-01 criterion 5).
     *
     * Incremented by every save. A save carrying a stale number is a conflict, never a
     * last-write-wins overwrite — see `saveEventTranslation` in
     * `src/modules/content/events/service.ts`.
     */
    version: integer("version").notNull().default(1),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("event_translations_event_locale_unique").on(t.eventId, t.locale),
    // Slugs are scoped per locale, so `ro` and `en` may each use "crosul-brasovului".
    unique("event_translations_locale_slug_unique").on(t.locale, t.slug),
    check("event_translations_version_positive", sql`${t.version} >= 1`),

    /**
     * The three fields every public page renders, present rather than blank.
     *
     * `NOT NULL` alone permits `''`, and a translation whose title is an empty string is what a
     * half-filled second locale looks like. Publication requires a complete translation in every
     * locale (`content/events/service.ts#transitionEvent`); this is the part of "complete" a
     * CHECK can state honestly from inside one row.
     */
    check(
      "event_translations_required_fields_present",
      sql`length(btrim(${t.title})) > 0
          AND length(btrim(${t.slug})) > 0
          AND length(btrim(${t.locationName})) > 0`,
    ),
  ],
);
