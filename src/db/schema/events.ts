import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { legalDocuments } from "./legal-documents";
import { locale } from "./locale";
import { staffUsers } from "./staff-users";

// AGENTS.md §10.1 defines these sets. They are database enums so an unsupported value is
// rejected by the database, not only by application validation (BR-REQ-010-01 criterion 3).

/**
 * What the event *is*: a group run, a race, a hike, a coffee, or another kind of meetup.
 *
 * It was one seven-value `event_kind` — community run, trail run, interval session, long run,
 * meetup, race, other — and that list mixed two questions. "Trail run" answered *where* you run,
 * "interval session" answered *how*, and the club had to pick one chip for an event that was
 * both. Migration `0023` split it (`DECISIONS.md` §61): this enum answers what the event is,
 * `event_surface` below answers what you run on, and the pace or the session shape is the
 * title's job. HIKE and COFFEE are the two things this club does on foot and at a table that are
 * not runs, by the owner's word on 2026-09-17. MEETUP was "what is left"; since §121 its label
 * is **special event** — the value keeps its name because Postgres does not rename enum values
 * — and GEAR_TEST (migration `0044`) is the shoe-testing evening that used to hide in it;
 * EXTERNAL (the same migration) is somebody else's event the club goes to together. An eighth
 * value is a migration, not free text.
 */
export const eventType = pgEnum("event_type", ["GROUP_RUN", "RACE", "HIKE", "COFFEE", "MEETUP", "GEAR_TEST", "EXTERNAL"]);

/**
 * What the event is run on. Nullable, because a meetup is run on nothing.
 *
 * Three values, the club's own three words. A fourth is a migration, not free text — the point
 * of a closed set is that adding to it is a decision, and that the public page renders it in
 * the reader's language rather than in whichever one the organizer typed.
 */
export const eventSurface = pgEnum("event_surface", ["ASPHALT", "TRAIL", "MIXED"]);

export const eventStatus = pgEnum("event_status", ["SCHEDULED", "CANCELLED", "COMPLETED"]);

export const editorialStatus = pgEnum("editorial_status", [
  "DRAFT",
  "IN_REVIEW",
  "PUBLISHED",
  "ARCHIVED",
]);

export const registrationMode = pgEnum("registration_mode", ["NONE", "INTERNAL", "EXTERNAL"]);

/**
 * How hard the event is, as a closed set rather than a typed word.
 *
 * It was `difficulty_label`, free text, and `DECISIONS.md` §36 accepted the consequence that an
 * English page would show whatever Romanian the club typed. For a fact with three possible
 * answers that trade buys nothing: an enum is the same single decision by the club, rendered in
 * the reader's own language, and it also stops "Mediu", "mediu" and "Medium" being three
 * difficulties in a filter that does not exist yet but will.
 *
 * Three values, because three is what the club uses. A fourth is a migration, not a free-text
 * escape hatch — the point of the closed set is that adding to it is a decision.
 */
export const eventDifficulty = pgEnum("event_difficulty", ["EASY", "MODERATE", "HARD"]);

/**
 * Whether the event costs money, and how — three answers, not two.
 *
 * `FREE` and `PAID` were migration `0018`'s pair, and the amount was deliberately left for "the
 * day the club runs an event that charges". That day arrived as a question rather than a race:
 * the owner, 2026-09-24, on "Cu taxă" showing no box for the money — "usually nothing is paid;
 * the exception is Wings for Life, where a donation is made on another site". `DONATION` is that
 * third answer: no fee the platform or the club takes, a link to somewhere else where a runner
 * gives what they choose. `cost_amount` (free text — a price is rarely just a number: "50 lei",
 * "20 € la ridicarea kitului") and `cost_url` (https, below) are what `PAID` and `DONATION` point
 * at — the amount required on a paid event, the link required on a donation, each optional the
 * other way round, and both null on `FREE` and on an event that has not said.
 */
export const eventCostType = pgEnum("event_cost_type", ["FREE", "PAID", "DONATION"]);

/**
 * Whether the event page publishes who is coming (BR-REQ-039-01, AGENTS.md §12.3).
 *
 * `HIDDEN` is the default and the only value any existing row has, because publishing the names
 * of the people who entered a race is a disclosure of their personal data — not a display
 * option. The club turns it on per event, knowing what it is turning on, and the approved
 * privacy notice has to say that it happens before it may be turned on at all.
 *
 * `NAMES` is the whole of the other setting: the registered name, and nothing else. There is no
 * value here that publishes an email, a status, a bib or a count of who has not confirmed —
 * those would each be a different disclosure, and adding one is a change to this enum with a
 * decision behind it rather than a flag somebody sets.
 */
export const participantListVisibility = pgEnum("participant_list_visibility", ["HIDDEN", "NAMES"]);

export type ParticipantListVisibility = (typeof participantListVisibility.enumValues)[number];

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

    type: eventType("type").notNull(),
    surface: eventSurface("surface"),
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
    /**
     * When the organizer sent the thank-you (§82): once per event, by hand, to everyone who
     * was checked in. Null until then; the button disappears afterwards.
     */
    thanksSentAt: timestamp("thanks_sent_at", { withTimezone: true }),
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
     * The meeting point on a map: a link the organizer pasted, stored and never assembled.
     *
     * `latitude` and `longitude` sat beside this until migration `0023` and are gone: an
     * organizer was asked for two decimal numbers to produce a link they could have pasted in
     * one move from the map they were already looking at (`DECISIONS.md` §61). Stored rather
     * than built also keeps the map provider out of the code — AGENTS.md §8 forbids a hostname
     * literal anywhere under `src/` and exempts no provider — and it lets the club link a named
     * venue page or a pin it has already dropped, which coordinates never could.
     *
     * The database requires https, so `javascript:` and `data:` cannot be stored even by a
     * seed or a hand-written `UPDATE`.
     *
     * It is **where to meet**, and nothing else. The route is `route_url` below — the two were
     * one column until somebody needed both on the same event (`DECISIONS.md` §49).
     */
    mapUrl: text("map_url"),

    /**
     * The course: where the run actually goes (BR-REQ-011-01 criterion 8).
     *
     * A link and never a file, because media storage is deferred (`AGENTS.md` §17) and there is
     * nowhere to put a GPX yet. The club already draws its routes somewhere — Strava, Komoot,
     * a map service — and the link to that is worth more than a copy that goes stale.
     *
     * Separate from `map_url` because a runner asks two different questions: "where do I turn
     * up" and "where does it go", and an event usually answers them with two different pages.
     * https at the database for the same reason `map_url` is: this URL is pasted by an
     * organizer and clicked by a visitor, and the constraint is what holds when the value
     * arrives from a seed or a hand-written `UPDATE` rather than from the form.
     */
    routeUrl: text("route_url"),

    /**
     * Last year's film (BR-REQ-011-01 criterion 9): a YouTube link as the organizer pasted it,
     * validated to carry a video id before it is stored (`events/domain/video.ts`), embedded
     * on the page from the id alone. Text rather than the id, so the row says what was given.
     */
    videoUrl: text("video_url"),

    /**
     * The club's Strava group event for this occurrence (BR-REQ-011-01 criterion 10): the
     * page where members RSVP on Strava. One occurrence's link, so it is never carried onto a
     * duplicate or a repeat. Checked to be a Strava page at the form (`isStravaLink`).
     */
    stravaEventUrl: text("strava_event_url"),
    /**
     * The Facebook event for this occurrence (§144): where most of the club says "going". One
     * occurrence's link, like the Strava one; checked to be a Facebook page at the form.
     */
    facebookEventUrl: text("facebook_event_url"),

    /**
     * The other organization an event is held with (`DECISIONS.md` §121; the owner: "a co-host
     * race — this year we had a featured co-host event with another ONG"): its name, and its
     * page. Shown beside the club's name on the page and named as a second organizer in the
     * structured data. Null when the club hosts alone, which is the rule.
     */
    coHostName: text("co_host_name"),
    coHostUrl: text("co_host_url"),

    /**
     * Every organization the event is held with (`DECISIONS.md` §168; the owner: "several
     * co-hosts, each with a name and an optional link"): an ordered array of
     * `[{ name, url }]` — the club's partners in the order the editor lists them, at most
     * eight. Read through `events/domain/co-hosts.ts`, which drops what is not a partner
     * rather than rendering it, and which reads a row written before this column as the one
     * co-host the two columns above held. Those two stay, unread, until a later contraction
     * removes them (`AGENTS.md` §7.6).
     *
     * Null and `[]` are different answers: null is "never saved since this column existed",
     * and only null falls back to the two columns above; `[]` is "the club removed every
     * partner", which must not bring the old name back.
     */
    coHosts: jsonb("co_hosts"),

    /**
     * "Linkuri și fișiere" (`DECISIONS.md` §332; the owner: "other links such as google drive
     * files for GPX track files, etc"): an ordered array of `[{ kind, url, labelRo, labelEn }]`,
     * at most twelve — the GPX on Google Drive, the extended rules as a PDF, the album, the
     * results. `kind` is one of `events/domain/links.ts#EVENT_LINK_KINDS`, the address https,
     * each label optional and at most 80 characters; an empty label is the kind's own word in the
     * reader's language, so a link never holds up publication (it is not part of §28's gate).
     *
     * Links and never files: the file stays wherever the club keeps it (`AGENTS.md` §17), which
     * is also why this is a sibling of `route_url` rather than an upload. The same on every date
     * of a series and carried by a duplicate, like the route (§49). Read through
     * `readEventLinks`, which drops an entry that is not a link rather than rendering it; null is
     * "no links", like `[]` — the save writes null for an empty list, so a row that never had any
     * and one whose links were all removed are the same value to a series edit.
     */
    links: jsonb("links"),

    /**
     * A standing recurrence (`DECISIONS.md` §122): on the *source* event, how it repeats —
     * `{ cadence, weekdays, until }`, `until` a date or null for "indefinitely" — and the
     * maintenance job keeps the coming weeks' occurrences created from it. Each occurrence is
     * its own row (a date can be cancelled or moved on its own), and names its source in
     * `repeat_of`, which is what the job counts from. Null on an event that does not repeat and
     * on every occurrence; a partial index finds the sources without reading the table.
     */
    repeatRule: jsonb("repeat_rule"),
    repeatOf: uuid("repeat_of").references((): AnyPgColumn => events.id, { onDelete: "set null" }),

    /**
     * The programme as data (`DECISIONS.md` §117): the timed rows — when, what, where — that
     * the page shows as a list, the reminder repeats and the calendar carries as one entry
     * each. `[{ startsAt, endsAt, label: { ro, en }, place }]`, instants as ISO strings, read
     * through `events/domain/schedule.ts` so a row nobody wrote this way is dropped, never
     * rendered. On the event rather than the translation: the time and the place are the same
     * fact in either language (§36), only the label is a translation, and it carries both.
     * Null is "no programme", like `schedule_json` on the translation, which stays as the
     * prose beneath the rows.
     */
    scheduleItems: jsonb("schedule_items"),

    distanceMeters: integer("distance_meters"),
    elevationGainMeters: integer("elevation_gain_meters"),

    /**
     * The four facts that are the same event in either language (`DECISIONS.md` §36).
     *
     * They lived on `event_translations` and were typed twice — and the second copy was not a
     * translation, it was the same fact again: the street address is identical word for word,
     * and the meeting point, the difficulty and the cost are one thing the club decided once.
     * An organizer filling an event in was answering the same question in two panels.
     *
     * The accepted consequence, recorded rather than discovered later: these render on the
     * English page in whatever words the club typed, so `/en/events/...` shows "Parcul
     * Tractorul" and "Gratuit". That is the club's own vocabulary for its own places, and the
     * owner chose it over retyping. The title, the page address, the short description and the
     * two SEO fields stay per language, because those genuinely are translations.
     *
     * Nullable at the database, required by `content/events/fields.ts` on every save: the column
     * has to accept the rows that existed before the migration that added it, and
     * `transitionEvent` refuses to publish an event whose meeting point is still blank — unless
     * the place is to be announced (below), which is the one state in which blank is an answer.
     */
    locationName: text("location_name"),
    locationAddress: text("location_address"),

    /**
     * The place is not announced yet (`DECISIONS.md` §328; the owner, 2026-09-23: "I want to be
     * able to set the location as TBD, and to not announce it yet").
     *
     * A state of the event, not an empty field. While it is true, every public reader is handed
     * no place at all — `events/repository.ts` returns null for the name (in either language),
     * the address and the map link, in SQL, so a surface that forgets the flag shows nothing
     * rather than the hidden place — and each surface says "Locația se anunță în curând" where
     * the place would be. What the organizer typed meanwhile stays in the three columns above,
     * visible to staff and published the moment this goes back to false.
     *
     * Not null with a default, so every row written before it reads as "announced", which is
     * what they were.
     */
    locationToBeAnnounced: boolean("location_to_be_announced").notNull().default(false),

    /**
     * The two facts that stopped being free text in migration `0018`.
     *
     * Null means the club has not said, and the page then omits the row rather than guessing —
     * an event with no stated cost is not thereby free, and one with no stated difficulty is
     * not thereby easy. That is why neither column has a default.
     */
    difficulty: eventDifficulty("difficulty"),
    costType: eventCostType("cost_type"),
    /**
     * What a paid event costs, or what a donation suggests — free text (§NNN), because a price
     * is rarely just a number: "50 lei", "20 € la ridicarea kitului", "sugerat 50 lei". Required
     * by `content/events/fields.ts` when `cost_type` is `PAID`, optional on `DONATION`, kept
     * whatever it holds while a different kind is chosen — like the meeting point while the
     * place is to be announced (§328) — so switching back does not lose what was typed.
     */
    costAmount: text("cost_amount"),
    /**
     * Where a paid event is settled, or where a donation is made — https, checked here as
     * `map_url` is. Optional on `PAID` ("Unde se plătește"); required by `fields.ts` on
     * `DONATION`, where it is the whole point of the fact. Null on `FREE` and on an unstated cost.
     */
    costUrl: text("cost_url"),

    /**
     * The one event the landing page leads with, or none.
     *
     * At most one row may carry it, and that is enforced by the partial unique index below
     * rather than by application code — the same reasoning as the capacity guard. Two featured
     * events is not a cosmetic bug: the hero would render one of them arbitrarily, and the
     * club would have no way to tell which without reading the database.
     */
    featured: boolean("featured").notNull().default(false),

    /**
     * A special edition (`DECISIONS.md` §168; the owner: "I need to define special events as
     * well") — an anniversary, a charity run, a date the club joins somebody else's race.
     *
     * Unlike `featured`, which is the one event the site leads with, any number of rows may
     * carry this and one date of a series may carry it alone: a weekly run that overlaps with
     * another club's race this Wednesday is special that Wednesday and ordinary the next. So
     * there is no unique index here and nothing to clear — it is a badge on the card and the
     * page, and a tie-break in the listing's order, never the hero's flag.
     */
    isSpecial: boolean("is_special").notNull().default(false),

    /**
     * Where this race's numbers start, and what colour they are printed (§173; the owner:
     * "cred că ar fi mai ușor să dăm numerele de concurs în ordinea înscrierii, așa se face de
     * obicei, dar există un prefix de cursă — spre exemplu numerele pot începe cu 1 acum dar la
     * alte curse sunt de la 100 în funcție de distanță și au altă culoare").
     *
     * This is what makes a bib a *race's* bib rather than a row's: the 5 km starts at 100 and
     * prints green, the 10 km starts at 500 and prints blue, and the number a runner is given
     * says which start line they belong on before anybody reads a word. Both are the event's,
     * because the club runs one distance per event today (multi-distance races are M2) and an
     * event is therefore exactly the unit a band belongs to.
     *
     * The start is where the first number is drawn from; it never renumbers anybody. The colour
     * is a hex triplet the sheet prints as the band behind the number, and null means the
     * club's own.
     */
    bibStartNumber: integer("bib_start_number").notNull().default(1),
    bibColour: text("bib_colour"),

    /**
     * The rest of what a bib looks like (`DECISIONS.md` §249): what is printed, how large the
     * number is, where the name sits, a picture instead of the coloured band, a sponsors'
     * strip, and whether the sheet carries cut marks.
     *
     * One JSON column rather than eight, because none of it is ever queried — a bib is drawn,
     * never filtered — and the ninth setting would otherwise be a ninth migration. Null is the
     * platform's own design, which is what every event created before this has;
     * `readBibDesign` in `modules/registrations/bib-design.ts` is the only reader, and it
     * answers with the defaults for anything it cannot read rather than throwing: a bib that
     * fails to print is worse than a bib that prints plainly.
     */
    bibDesign: jsonb("bib_design"),

    /**
     * When this event's race numbers were settled (`DECISIONS.md` §214).
     *
     * Registration closes, the entry list stops moving, and the maintenance job turns every
     * provisional number into a final one in a single dense sequence — then writes this. It is
     * the idempotency marker and nothing else: the job runs every few minutes and must do that
     * work exactly once, because a second pass would renumber people who have already been
     * told their number.
     *
     * Null means "not settled yet", which is every event before its window shuts and every
     * event written before this existed.
     */
    bibsSettledAt: timestamp("bibs_settled_at", { withTimezone: true }),

    capacity: integer("capacity"),
    /**
     * The participation window (`DECISIONS.md` §104): for an event further away than
     * `confirmation_opens_days_before`, a registration that clears email verification keeps its
     * place until `confirmation_deadline_days_before` the start, and the declaration — the
     * confirmation — is signed inside that window rather than within thirty minutes. Zero
     * "opens" switches the window off (sign at once, the pilot's rule); the deadline is days
     * before the start. Defaults 7 and 2.
     */
    confirmationOpensDaysBefore: integer("confirmation_opens_days_before").notNull().default(7),
    confirmationDeadlineDaysBefore: integer("confirmation_deadline_days_before").notNull().default(2),

    /**
     * The youngest a participant may be **on the day of the event**, in whole years (§329,
     * amending §321; the owner: "actually this min age must be set at event level!").
     *
     * The club's fourteen is the default — `MIN_PARTICIPANT_AGE` in `registrations/domain/age.ts`
     * says the same number, and every event that existed before this column was given it, so no
     * event's rule changed the day it was added. Zero means no minimum. `submitRegistration`
     * counts it at every door; the guardian rule (eighteen, §108) is not this column's.
     */
    minAge: integer("min_age").notNull().default(14),

    registrationMode: registrationMode("registration_mode").notNull().default("NONE"),
    registrationOpensAt: timestamp("registration_opens_at", { withTimezone: true }),
    registrationClosesAt: timestamp("registration_closes_at", { withTimezone: true }),

    // The EVENT_DECLARATION document version an internal registration must accept.
    declarationDocumentId: uuid("declaration_document_id").references(() => legalDocuments.id),

    externalProvider: text("external_provider"),
    externalRegistrationUrl: text("external_registration_url"),

    /**
     * Off, until the club decides otherwise for one specific event (BR-REQ-039-01).
     *
     * The default is the rule, not a convenience: every event that exists today, and every event
     * created after this column, publishes nobody. Switching it on is a deliberate act in the
     * backoffice, and a participant can still keep their own name off the page
     * (`registrations.list_opt_out`).
     */
    participantListVisibility: participantListVisibility("participant_list_visibility")
      .notNull()
      .default("HIDDEN"),

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
    /**
     * A band has to start somewhere a three- or four-digit bib can reach (§173), and the colour
     * has to be a colour: the sheet paints it straight into the printed band, so a stored
     * `red; background: url(...)` would be a style injection into a PDF the club hands out.
     * Six hex digits, hash included, or nothing.
     */
    check("events_bib_start_number_positive", sql`${t.bibStartNumber} >= 1 AND ${t.bibStartNumber} <= 99000`),
    check("events_bib_colour_is_hex", sql`${t.bibColour} IS NULL OR ${t.bibColour} ~ '^#[0-9a-fA-F]{6}$'`),

    check("events_map_url_is_https", sql`${t.mapUrl} IS NULL OR ${t.mapUrl} LIKE 'https://%'`),
    check("events_cost_url_is_https", sql`${t.costUrl} IS NULL OR ${t.costUrl} LIKE 'https://%'`),
    check(
      "events_route_url_is_https",
      sql`${t.routeUrl} IS NULL OR ${t.routeUrl} LIKE 'https://%'`,
    ),
    check(
      "events_video_url_is_https",
      sql`${t.videoUrl} IS NULL OR ${t.videoUrl} LIKE 'https://%'`,
    ),
    check(
      "events_strava_event_url_is_https",
      sql`${t.stravaEventUrl} IS NULL OR ${t.stravaEventUrl} LIKE 'https://%'`,
    ),
    check(
      "events_facebook_event_url_is_https",
      sql`${t.facebookEventUrl} IS NULL OR ${t.facebookEventUrl} LIKE 'https://%'`,
    ),
    check(
      "events_co_host_url_is_https",
      sql`${t.coHostUrl} IS NULL OR ${t.coHostUrl} LIKE 'https://%'`,
    ),

    /**
     * The links (§332): an array of at most twelve, every address https — the same guarantee
     * the single-link columns above give, for a list. The form refuses first and says which
     * row; this is what holds when a seed or a hand-written `UPDATE` writes the column. The
     * `CASE` fixes the order: `jsonb_array_length` raises on a scalar, and a check that raises
     * is a refusal nobody can read, where one that answers false names itself.
     */
    check(
      "events_links_is_a_short_array_of_https_links",
      sql`${t.links} IS NULL OR CASE WHEN jsonb_typeof(${t.links}) = 'array' THEN jsonb_array_length(${t.links}) <= 12 AND NOT jsonb_path_exists(${t.links}, '$[*] ? (!(@.url.type() == "string" && @.url starts with "https://"))') ELSE false END`,
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

    /**
     * A minimum age a person can have (§329): zero (no minimum) to ninety-nine. The form says
     * the same bounds; this is for the seed, the script and the hand-written `UPDATE`.
     */
    check("events_min_age_in_range", sql`${t.minAge} >= 0 AND ${t.minAge} <= 99`),

    /**
     * A start list can only be published for an event this platform actually registers.
     *
     * For `NONE` there are no participants to list, and for `EXTERNAL` the people who entered
     * are the other organizer's — the club holds no registrations for them and must not appear
     * to publish any. Set here as well as in the service for the reason every other check on
     * this table is: a seed or a hand-written `UPDATE` reaches this column too.
     */
    check(
      "events_participant_list_internal_only",
      sql`${t.participantListVisibility} = 'HIDDEN' OR ${t.registrationMode} = 'INTERNAL'`,
    ),

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
    check("events_race_id_implies_race_type", sql`${t.raceId} IS NULL OR ${t.type} = 'RACE'`),

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
    index("events_type_starts_at_idx").on(t.type, t.startsAt),
    index("events_registration_mode_starts_at_idx").on(t.registrationMode, t.startsAt),
    // The standing series (§122): the few sources with a rule, and each source's occurrences
    // by date — the two reads the job makes every quarter hour, both off an index.
    index("events_repeat_rule_idx").on(t.id).where(sql`${t.repeatRule} IS NOT NULL`),
    index("events_repeat_of_starts_at_idx").on(t.repeatOf, t.startsAt),
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
    /**
     * The short description as plain words — what the listing card, the meta description and
     * the JSON-LD carry, and what "complete before publishing" checks. Since `DECISIONS.md`
     * §73 it is *derived* from `excerpt_json` on save whenever that is set: the words of the
     * rich excerpt, without its pictures.
     */
    excerpt: text("excerpt"),
    /**
     * The short description as written in the editor (§11.3): a small rich body — a sentence
     * or two and, since §73, a picture — shown on the hero and at the top of the event page.
     * Null for events written before it existed; `excerpt` is then the whole of it.
     */
    excerptJson: jsonb("excerpt_json"),
    bodyJson: jsonb("body_json"),
    /**
     * The event's rules, per language, in the same editor as the description (§96): what the
     * declaration says the participant has read "on the event's page", shown there under
     * `#rules` and linked from every email. Null when the organizer wrote none.
     */
    rulesJson: jsonb("rules_json"),
    /**
     * The programme, per language (§96): kit pickup hours, the briefing, the start, the
     * cut-offs, the awards — what a trail race publishes and a runner reads the night before.
     * Same editor; shown under `#schedule`; linked from the emails.
     */
    scheduleJson: jsonb("schedule_json"),
    /**
     * "What to bring", one line, per language (`DECISIONS.md` §81): it goes on the
     * confirmation and the reminder — the two emails a participant keeps. Editorial, so it
     * lives on the translation; plain text, at most 300 characters, because an email is read
     * on a phone the morning of.
     */
    checklist: text("checklist"),

    /*
     * `location_name`, `location_address`, `difficulty_label` and `cost_text` were here and are
     * gone (migration `0017`, `DECISIONS.md` §36). They are the same fact in both languages
     * rather than a translation of one, so they live on `events`. The columns survived one
     * release after the code stopped reading them, which is what AGENTS.md §7.6 requires: a
     * rollback has to find a schema the previous code can still run against.
     *
     * `cover_alt_text` stays. It is genuinely per language — alt text is prose a translator
     * writes, not a fact about the event.
     */
    coverAltText: text("cover_alt_text"),

    /**
     * The place's *name* in this language, since migration `0058` — the one part of §36's
     * move the owner took back ("ar trebui să pot pune și denumirea locației în română și în
     * engleză"). The fact stays one: `events.location_name` is still required, still what the
     * desk, the calendar, the declaration and every reader without a translation at hand
     * shows. This is the word for it on this language's page — "Tractorul Park" on the English
     * one — and null means "the event's own name", which is what every row written before
     * this column has. Never a fallback to the *other* language: a blank here reads the event
     * row, exactly as before (BR-REQ-040-02 is untouched).
     */
    locationName: text("location_name"),

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
     * The two fields every public page renders, present rather than blank.
     *
     * `NOT NULL` alone permits `''`, and a translation whose title is an empty string is what a
     * half-filled second locale looks like. Publication requires a complete translation in every
     * locale (`content/events/service.ts#transitionEvent`); this is the part of "complete" a
     * CHECK can state honestly from inside one row.
     *
     * It was three until migration `0017`. The third named `location_name`, which is no longer
     * on this table — the meeting point is one value for the whole event and is checked there.
     */
    check(
      "event_translations_required_fields_present",
      sql`length(btrim(${t.title})) > 0
          AND length(btrim(${t.slug})) > 0`,
    ),
  ],
);
