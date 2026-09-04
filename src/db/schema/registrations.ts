import { sql } from "drizzle-orm";
import {
  boolean,
  check,
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
    locale: locale("locale").notNull(),
    registeredName: text("registered_name").notNull(),

    privacyNoticeVersion: integer("privacy_notice_version").notNull(),
    privacyAcknowledgedAt: timestamp("privacy_acknowledged_at", { withTimezone: true }).notNull(),

    // Denormalized from the event at submission time so the race-level uniqueness index below
    // does not need to join `events` — AGENTS.md §10.1: "a participant may hold at most one
    // active registration across the child events of one race."
    raceId: uuid("race_id"),

    resultsNameConsent: boolean("results_name_consent").notNull(),
    resultsConsentVersion: integer("results_consent_version").notNull(),

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
