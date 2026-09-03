import { sql } from "drizzle-orm";
import {
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
  uuid,
} from "drizzle-orm/pg-core";

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

export const locale = pgEnum("locale", ["ro", "en"]);

/**
 * Events.
 *
 * The full M1 column set from AGENTS.md §12.3 is present even though the pilot reads only a
 * few of them. Columns are free to add now and a migration later, and the M2 footprints
 * (`race_id`) are required to be here from the start.
 *
 * Staff attribution columns are deliberately absent until `staff_users` exists; adding them
 * before the table they reference would mean a fake foreign key or none at all.
 */
export const events = pgTable(
  "events",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    // M2 footprint: a race groups child distance events (BR-REQ-012-01). No behaviour yet.
    raceId: uuid("race_id"),

    kind: eventKind("kind").notNull(),
    eventStatus: eventStatus("event_status").notNull().default("SCHEDULED"),

    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    timezone: text("timezone").notNull().default("Europe/Bucharest"),

    latitude: numeric("latitude"),
    longitude: numeric("longitude"),
    distanceMeters: integer("distance_meters"),
    elevationGainMeters: integer("elevation_gain_meters"),

    // Must stay NULL for the whole pilot. See the check constraint below.
    capacity: integer("capacity"),

    registrationMode: registrationMode("registration_mode").notNull().default("NONE"),
    registrationOpensAt: timestamp("registration_opens_at", { withTimezone: true }),
    registrationClosesAt: timestamp("registration_closes_at", { withTimezone: true }),

    // References legal_documents once that table exists; unconstrained until then.
    declarationDocumentId: uuid("declaration_document_id"),

    externalProvider: text("external_provider"),
    externalRegistrationUrl: text("external_registration_url"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /**
     * The pilot guard rail. BR-REQ-034-02 requires that a capped event never overbooks, and
     * that guarantee comes from a locked capacity transaction with a concurrency test, which
     * does not exist yet. Deferring the capacity engine is only safe if the system is
     * physically incapable of storing a capacity, so the database refuses one.
     *
     * Removing this constraint is the last step of building the capacity transaction, never
     * the first. WEEKEND.md records the reasoning.
     */
    check("events_capacity_must_be_null_during_pilot", sql`${t.capacity} IS NULL`),

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
    check("events_race_id_implies_race_kind", sql`${t.raceId} IS NULL OR ${t.kind} = 'RACE'`),

    index("events_status_starts_at_idx").on(t.eventStatus, t.startsAt),
    index("events_kind_starts_at_idx").on(t.kind, t.startsAt),
    index("events_registration_mode_starts_at_idx").on(t.registrationMode, t.startsAt),
  ],
);

/**
 * Event translations. One row per event per locale, each with its own editorial status so
 * Romanian can be published while English is still a draft (BR-REQ-040-02: no cross-locale
 * fallback — an unpublished locale is a 404, not the other language).
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

    seoTitle: text("seo_title"),
    seoDescription: text("seo_description"),

    editorialStatus: editorialStatus("editorial_status").notNull().default("DRAFT"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    version: integer("version").notNull().default(1),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("event_translations_event_locale_unique").on(t.eventId, t.locale),
    // Slugs are scoped per locale, so `ro` and `en` may each use "crosul-brasovului".
    unique("event_translations_locale_slug_unique").on(t.locale, t.slug),
    index("event_translations_status_idx").on(t.locale, t.editorialStatus),
  ],
);
