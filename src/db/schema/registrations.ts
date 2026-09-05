import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { events } from "./events";
import { locale } from "./locale";
import { participants } from "./participants";
import { staffUsers } from "./staff-users";

/** AGENTS.md §10.5. */
export const registrationStatus = pgEnum("registration_status", [
  "PENDING_EMAIL_CONFIRMATION",
  "PENDING_DECLARATION",
  "WAITLISTED",
  "WAITLIST_OFFERED",
  "CONFIRMED",
  "CANCELLED",
  "EXPIRED",
]);

export type RegistrationStatus = (typeof registrationStatus.enumValues)[number];

/** A registration occupies capacity, or has priority for it, in exactly these states. */
export const ACTIVE_REGISTRATION_STATUSES: readonly RegistrationStatus[] = [
  "PENDING_EMAIL_CONFIRMATION",
  "PENDING_DECLARATION",
  "WAITLISTED",
  "WAITLIST_OFFERED",
  "CONFIRMED",
];

export const registrationExpiryReason = pgEnum("registration_expiry_reason", [
  "EMAIL_CONFIRMATION_LAPSED",
  "DECLARATION_HOLD_LAPSED",
  "WAITLIST_OFFER_LAPSED",
  "EVENT_STARTED",
]);

export const registrationCancellationSource = pgEnum("registration_cancellation_source", [
  "PARTICIPANT",
  "ADMIN",
]);

/**
 * Whether a registration is somebody's, or a demonstration of the queue.
 *
 * There is no "test participant" account type and none is added: participants have no accounts
 * at all (AGENTS.md §10.3), and the staff role enum stays at three. This is a property of the
 * *registration*, and it exists so that the waiting list can be filled and watched without ten
 * real mailboxes.
 *
 * The rule that gives it its meaning: `TEST` occupies a place exactly as `REAL` does. It goes
 * through `modules/registrations/service.ts` like any other registration, expires on the same
 * hold deadlines, and is promoted by the same allocator — `kind` appears in no condition inside
 * the allocator or the capacity formula, and `tests/integration/registrations/test-kind.test.ts`
 * asserts that the same scenario run either way produces identical transitions. What it changes
 * is what the club counts: the CSV export omits `TEST` rows, and every screen that lists a
 * registration labels them.
 *
 * `TEST` cannot be created when `APP_ENV=production` — refused in
 * `modules/registrations/test-registrations.ts` and again in `repository.ts` at the insert, the
 * same double guard the development staff switcher carries, because one guard eventually gets
 * refactored away.
 */
export const registrationKind = pgEnum("registration_kind", ["REAL", "TEST"]);

export type RegistrationKind = (typeof registrationKind.enumValues)[number];

/**
 * Who put this row in the table: the participant, or an organizer on their behalf
 * (BR-REQ-037-05).
 *
 * People phone the club, catch an organizer after a run, or have no email of their own to hand.
 * A registration entered by staff is still that person's registration, so it goes through the
 * same allocator, occupies a place in the same order, and starts in the same
 * `PENDING_EMAIL_CONFIRMATION` state — it never jumps the queue and it never arrives confirmed,
 * because confirming means signing a declaration and nobody may sign one for somebody else
 * (AGENTS.md §10.8). What this column changes is only the record of how the row got here, next
 * to `created_by_staff_user_id` and the `audit_logs` entry that names the organizer.
 */
export const registrationSource = pgEnum("registration_source", ["PUBLIC", "STAFF"]);

/**
 * Race category, not identity (BR-BUS-031, BR-REQ-031-04).
 *
 * Three values because a race has categories and a person may decline to be sorted into one.
 * `UNSPECIFIED` is a real answer, not a missing one: a registration that carries it is
 * complete, and a results table simply lists that runner outside the two category tables.
 */
export const registrationSex = pgEnum("registration_sex", ["FEMALE", "MALE", "UNSPECIFIED"]);

export type RegistrationSex = (typeof registrationSex.enumValues)[number];

/** Only ever useful when there is a shirt, which is why `NONE` is a value and not a null. */
export const registrationTshirtSize = pgEnum("registration_tshirt_size", [
  "NONE",
  "XS",
  "S",
  "M",
  "L",
  "XL",
  "XXL",
]);

export type RegistrationTshirtSize = (typeof registrationTshirtSize.enumValues)[number];

export type RegistrationSource = (typeof registrationSource.enumValues)[number];

/**
 * Registrations (AGENTS.md §12.6; BR-REQ-030-01 through BR-REQ-036-02).
 *
 * Priority-1 code: this table is what `AGENTS.md` §10.5's state machine and §10.6's capacity
 * formula are actually about. Every transition is written in
 * `modules/registrations/repository.ts` as one `UPDATE ... WHERE id = ? AND status = ANY(?)`
 * naming the allowed *from* states — the status column is its own concurrency guard, the same
 * role `event_translations.version` plays for editorial saves, so no separate version column
 * is needed here.
 *
 * Timestamps below are historical facts, not a mirror of the current status: `confirmed_at`
 * stays set after a later self-cancellation, the same way `event_translations.published_at`
 * survives an unpublish. Only `cancelled_at`/`cancellation_source` and `expired_at`/
 * `expiry_reason` are checked against each other, because each pair is written together at
 * exactly one moment and never independently.
 */
export const registrations = pgTable(
  "registrations",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id),
    participantId: uuid("participant_id")
      .notNull()
      .references(() => participants.id),

    status: registrationStatus("status").notNull(),
    // REAL by default, so every row written before this column existed — and every row written
    // by the ordinary public form — is somebody's registration without anything having to say so.
    kind: registrationKind("kind").notNull().default("REAL"),

    // PUBLIC by default, so every row written before this column existed — and every row the
    // public form writes — says how it arrived without anything having to set it.
    source: registrationSource("source").notNull().default("PUBLIC"),
    /**
     * The organizer who entered it, when one did.
     *
     * `ON DELETE SET NULL`, like `events.created_by_staff_user_id`: removing somebody from the
     * staff list must not delete a participant's registration, and a row whose creator has left
     * the club still says it was staff-entered through `source`. That is also why the two are
     * not tied together by a CHECK — the constraint would fire on the day an account is removed.
     */
    createdByStaffUserId: uuid("created_by_staff_user_id").references(() => staffUsers.id, {
      onDelete: "set null",
    }),

    locale: locale("locale").notNull(),
    /**
     * The legal name of record — first and last, joined (BR-REQ-031-04 criterion 6).
     *
     * Composed at write time from `first_name` and `last_name` rather than derived at read
     * time, because this is the string the declaration was signed against and §10.5 invariant 11
     * makes declaration acceptance a historical fact: a later correction to the parts must not
     * silently rewrite what somebody agreed to. Everything that means "this participant's legal
     * name" — the declaration, the emails, the backoffice — reads this column.
     */
    registeredName: text("registered_name").notNull(),

    /**
     * Race entry details (BR-REQ-031-04). Nullable in the database, required by the *public*
     * form.
     *
     * Not a weaker rule than it looks: BR-REQ-031-04 criterion 5 is why. An organizer entering
     * a registration for somebody who telephoned records what that person said, and a missing
     * date of birth must not cost the club the registration. The public path enforces presence
     * in `fields.ts`; the staff path deliberately does not, and `display_name` is the one
     * exception below because it can always be derived.
     */
    firstName: text("first_name"),
    lastName: text("last_name"),

    /**
     * What a start list or a results table publishes (BR-REQ-039-02).
     *
     * NOT NULL and non-empty, unlike its neighbours, because it is always derivable: a blank one
     * becomes a first name and a last initial before the insert. Publishing the legal name
     * because a field was left empty is exactly the disclosure §10.10 exists to prevent.
     */
    displayName: text("display_name").notNull(),

    birthDate: date("birth_date"),
    sex: registrationSex("sex"),
    /** ISO 3166-1 alpha-2, rendered per locale by `Intl.DisplayNames` — no country-name table. */
    nationality: text("nationality"),
    city: text("city"),

    phone: text("phone"),
    emergencyContactName: text("emergency_contact_name"),
    emergencyContactPhone: text("emergency_contact_phone"),

    clubName: text("club_name"),
    tshirtSize: registrationTshirtSize("tshirt_size"),

    /**
     * Health information (BR-REQ-031-05). GDPR Article 9 special category.
     *
     * Kept beside its own consent rather than under the privacy-notice acknowledgment, because
     * Article 9 wants a separate and explicit one. Three consequences are enforced elsewhere and
     * named here so they are not lost: the CSV export omits it (`csv.ts`), no public surface
     * renders it (`tests/privacy/public-surface.test.ts`), and withdrawing consent clears the
     * text rather than flagging it.
     */
    healthNotes: text("health_notes"),
    healthConsentVersion: integer("health_consent_version"),
    healthConsentAt: timestamp("health_consent_at", { withTimezone: true }),

    privacyNoticeVersion: integer("privacy_notice_version").notNull(),
    privacyAcknowledgedAt: timestamp("privacy_acknowledged_at", { withTimezone: true }).notNull(),

    // Denormalized from the event at submission time so the race-level uniqueness index below
    // does not need to join `events` — AGENTS.md §10.1: "a participant may hold at most one
    // active registration across the child events of one race."
    raceId: uuid("race_id"),

    resultsNameConsent: boolean("results_name_consent").notNull(),
    resultsConsentVersion: integer("results_consent_version").notNull(),

    /**
     * "Keep my name off the public start list" (BR-REQ-039-01).
     *
     * A separate answer from `results_name_consent`, which is about the *results* after the
     * event, and deliberately shaped the other way round: the club decides per event whether a
     * start list is published at all (`events.participant_list_visibility`, HIDDEN by default),
     * and this is one participant's refusal within an event that publishes one. Two questions,
     * two columns — folding them together would mean a person who wants to be listed at the
     * start line and not in a permanent results table cannot say so.
     */
    listOptOut: boolean("list_opt_out").notNull().default(false),

    // M1 footprint only. Assignment is an M2 feature with its own uniqueness-per-race
    // transaction; the CHECK below keeps this column physically empty until that exists,
    // exactly as `events.capacity` was kept empty until this branch's capacity transaction.
    bibNumber: integer("bib_number"),

    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
    emailConfirmedAt: timestamp("email_confirmed_at", { withTimezone: true }),
    waitlistedAt: timestamp("waitlisted_at", { withTimezone: true }),
    offerCreatedAt: timestamp("offer_created_at", { withTimezone: true }),
    holdExpiresAt: timestamp("hold_expires_at", { withTimezone: true }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    expiredAt: timestamp("expired_at", { withTimezone: true }),

    expiryReason: registrationExpiryReason("expiry_reason"),
    cancellationSource: registrationCancellationSource("cancellation_source"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("registrations_event_participant_unique").on(t.eventId, t.participantId),

    // One distance per race, but only while the registration is still active — a cancelled
    // attempt at one distance must not block joining another.
    uniqueIndex("registrations_race_participant_active_unique")
      .on(t.raceId, t.participantId)
      .where(
        sql`${t.raceId} IS NOT NULL AND ${t.status} IN ('PENDING_EMAIL_CONFIRMATION', 'PENDING_DECLARATION', 'WAITLISTED', 'WAITLIST_OFFERED', 'CONFIRMED')`,
      ),

    index("registrations_event_status_idx").on(t.eventId, t.status),
    // The export's exclusion filter and the "remove the test registrations" sweep.
    index("registrations_event_kind_idx").on(t.eventId, t.kind),
    index("registrations_participant_status_idx").on(t.participantId, t.status),
    // FIFO waitlist order: oldest `waitlisted_at` first, `id` breaks a tie.
    index("registrations_event_waitlisted_at_id_idx").on(t.eventId, t.waitlistedAt, t.id),
    // The maintenance sweep's hold-expiry scan.
    index("registrations_event_hold_expires_at_idx").on(t.eventId, t.holdExpiresAt),

    check("registrations_bib_number_not_assigned_in_m1", sql`${t.bibNumber} IS NULL`),

    // NOT NULL permits '', and an empty display name on a published start list is the legal
    // name leaking or a blank row. Neither is acceptable, so the emptiness is refused here too.
    check("registrations_display_name_present", sql`length(btrim(${t.displayName})) > 0`),

    /**
     * Health text cannot exist without the consent that permits holding it (BR-REQ-031-05
     * criterion 2), and withdrawing consent clears the text (criterion 6) — which is the same
     * statement read the other way round, so one constraint covers both directions.
     */
    check(
      "registrations_health_consent_present",
      sql`${t.healthNotes} IS NULL OR (${t.healthConsentAt} IS NOT NULL AND ${t.healthConsentVersion} IS NOT NULL)`,
    ),

    // Each pair is written together at exactly one moment (§15.5, §15.7) and never
    // independently, so either both are set or neither is.
    check(
      "registrations_cancellation_fields_together",
      sql`(${t.cancellationSource} IS NULL) = (${t.cancelledAt} IS NULL)`,
    ),
    check(
      "registrations_expiry_fields_together",
      sql`(${t.expiryReason} IS NULL) = (${t.expiredAt} IS NULL)`,
    ),
  ],
);

export type Registration = typeof registrations.$inferSelect;
