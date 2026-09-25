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
    /**
     * The optional "socials" (§106): a Strava profile link and an Instagram handle, as the
     * person typed them, for the club to follow back and tag. Never published by the platform,
     * shown to Administrators and in the export; deleted with the row three years after the
     * event like every other detail here.
     */
    stravaUrl: text("strava_url"),
    instagramHandle: text("instagram_handle"),
    /**
     * The parent or legal guardian who registers a minor (§108): required by the form when the
     * birth date gives under eighteen, the name that signs the declaration on the child's
     * behalf and that the desk hands the kit to. Null for an adult.
     */
    guardianName: text("guardian_name"),

    /**
     * "I am a Brașov Runners team member", as the person filling the form said it
     * (BR-REQ-031-06, `DECISIONS.md` §48).
     *
     * `_declared` is in the name because the value is a **claim and never a fact**. Nothing
     * checks it against `staff_users` and nothing checks it against a roster, because most
     * members of this club have no backoffice account and never will — so a verified flag
     * would be wrong for exactly the people it is meant to find.
     *
     * It is therefore informational only. It MUST NOT decide a price, a place, or a position
     * in the queue: `AGENTS.md` §12.6 keeps conditions like this one out of the allocator and
     * the capacity formula, and a self-ticked box that granted anything would be granted to
     * anybody who ticked it. An organizer corrects a wrong one in the backoffice.
     */
    clubMemberDeclared: boolean("club_member_declared").notNull().default(false),

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

    /**
     * "I declare I am medically fit to take part" (§171; the owner: "nu e clar cu informațiile
     * medicale, trebuie să bifeze doar «declar că sunt apt»").
     *
     * **Not health data.** It is a statement the participant makes about themselves, the same
     * kind of thing the declaration they sign later says, and it carries no diagnosis, no
     * condition and nothing an Article 9 category covers — which is exactly why it can be
     * required where `health_notes` cannot. The free text and its own consent stay where they
     * were, optional and folded: somebody who wants the medical team to know something still
     * has somewhere to write it.
     *
     * Null for every registration taken before this existed, and for a row a staff member
     * entered at the desk on a paper declaration — there the paper carries the statement.
     */
    fitnessDeclaredAt: timestamp("fitness_declared_at", { withTimezone: true }),

    /**
     * When the entrant confirmed they had read the race's conditions (`DECISIONS.md` §195).
     *
     * The tick is behind a reading: the conditions open in a panel, the button that agrees is
     * dead until the text has been scrolled to its end, and only then does the box become
     * tickable. What is *recorded* is this timestamp and nothing else — scrolling cannot be
     * proved and this column does not pretend to prove it. It says the person was shown the
     * text and said they had read it, at this moment, which is what a paper form records too.
     *
     * Null for every registration taken before this existed, and for a desk entry: there the
     * paper declaration carries the same sentence, signed (§67).
     */
    rulesAcknowledgedAt: timestamp("rules_acknowledged_at", { withTimezone: true }),

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
     *
     * Defaults to **not listed** since §323 (migration `0060`). Every insert in the code states
     * the answer the person gave, so the default decides nothing today; it is there so that a row
     * written any other way — a script, a seed, a future door — is off the public list rather
     * than on it, which is the direction a disclosure has to fail in.
     */
    listOptOut: boolean("list_opt_out").notNull().default(true),

    /**
     * The race number on the participant's chest (BR-REQ-038-01, `DECISIONS.md` §65).
     *
     * Assigned by `modules/registrations/bibs.ts` to confirmed, real registrations, in order
     * of confirmation, one event at a time under a lock on the event row; never by the form
     * and never by the allocator, which does not know the column exists. Unique per event while
     * a number is set — the partial index below — and one-per-race across a race's child events
     * is M2's, with `race_id`. The pilot's `CHECK (bib_number IS NULL)` guard is gone with
     * migration `0024`, for the same reason the capacity guard went: the transaction that makes
     * the column safe exists and is tested.
     */
    bibNumber: integer("bib_number"),

    /**
     * The number held for this registration while it can still change (`DECISIONS.md` §214).
     *
     * The owner, looking at his own row stuck on "waiting for the email": "I need the BID to be
     * reserved ASAP". A number that arrives only at confirmation arrives after the two steps
     * most likely to strand somebody — an email that does not come, a declaration nobody has
     * read yet — so the club cannot plan and the runner cannot ask about a number they do not
     * have.
     *
     * **It is the opposite of `bib_number` in the one way that matters: it is released.** A
     * provisional number belongs to a registration *while it occupies a place*, and the moment
     * the place goes — cancelled, expired, pushed onto the waiting list — the number goes back
     * into the pool for the next person. That is safe precisely because it is never printed and
     * never emailed: nothing exists in the world that has to keep matching it. `bib_number`
     * is the opposite and stays so — once given it is never reissued, because two people
     * wearing 17 is the failure that rule exists to prevent.
     *
     * Unique per event while it is set, like `bib_number` and for the same reason, and drawn
     * under the event row's lock — the serialization point capacity already uses (§10.6).
     */
    provisionalBibNumber: integer("provisional_bib_number"),

    /**
     * When this registration's bib was last printed (`DECISIONS.md` §264).
     *
     * The owner: "ar trebui să pot descărca BID-urile din pagina de înscriere ca și batch! și
     * să pot marca 'BID printat'". Numbers arrive in waves — somebody registers on Thursday,
     * the sheet went to the printer on Wednesday — so the club needs to know *which* bibs are
     * already on paper. Without it the choice is reprinting everything or remembering.
     *
     * A timestamp rather than a flag, because "when" answers the question a flag cannot: a bib
     * printed before the design changed has to be printed again. It is set by the club marking
     * a batch printed, never by the download itself — a GET does not mutate (`AGENTS.md` §12.8),
     * and the sheet is a GET so it can be opened in a tab, saved and reopened.
     *
     * Cleared when the club says "not printed" for a reprint. It belongs to the printed sheet
     * and nothing else: no email, no page, no count the club is given.
     */
    bibPrintedAt: timestamp("bib_printed_at", { withTimezone: true }),

    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
    /**
     * When the email link of this cycle lapses unconfirmed (§377): written when the registration
     * enters `PENDING_EMAIL_CONFIRMATION` — the first submission and a restart alike — from the
     * club's "Termene" in force at that moment, and never rewritten by a later change of it.
     * Null on rows written before the column: they lapse at `submitted_at` plus the setting, as
     * every row did before.
     */
    emailLinkExpiresAt: timestamp("email_link_expires_at", { withTimezone: true }),
    emailConfirmedAt: timestamp("email_confirmed_at", { withTimezone: true }),
    waitlistedAt: timestamp("waitlisted_at", { withTimezone: true }),
    offerCreatedAt: timestamp("offer_created_at", { withTimezone: true }),
    holdExpiresAt: timestamp("hold_expires_at", { withTimezone: true }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    expiredAt: timestamp("expired_at", { withTimezone: true }),

    expiryReason: registrationExpiryReason("expiry_reason"),
    cancellationSource: registrationCancellationSource("cancellation_source"),

    /**
     * Race day (BR-REQ-037-08, `DECISIONS.md` §67).
     *
     * `checkin_code` identifies a registration to staff at the desk: it is what the QR in the
     * confirmation email encodes, and what the participant shows to pick up their number. An
     * identifier, not a credential — the page it opens is behind staff sign-in, and it confers
     * nothing on the person holding it — so it is stored as it is, unlike an action token.
     * Minted when a registration is confirmed; unique across every event.
     *
     * `checked_in_at` is the fact; `checked_in_by_staff_user_id` says who — null when the
     * participant checked themselves in from their own link.
     *
     * `email_confirmed_by_staff_user_id` records that a member of staff, not a click on a link,
     * vouched for the address (BR-REQ-037-07): a fast-track entry at the desk, where the person
     * is standing in front of them. The participant's own `email_verified_at` is deliberately
     * *not* set by that — a staff attestation is a different fact from a delivered click.
     */
    checkinCode: text("checkin_code").unique(),
    checkedInAt: timestamp("checked_in_at", { withTimezone: true }),
    checkedInByStaffUserId: uuid("checked_in_by_staff_user_id").references(() => staffUsers.id, {
      onDelete: "set null",
    }),
    emailConfirmedByStaffUserId: uuid("email_confirmed_by_staff_user_id").references(
      () => staffUsers.id,
      { onDelete: "set null" },
    ),

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

    check("registrations_bib_number_positive", sql`${t.bibNumber} IS NULL OR ${t.bibNumber} > 0`),
    // Two runners cannot wear the same number at one event. Partial, so the many rows with no
    // number yet do not collide with each other.
    uniqueIndex("registrations_event_bib_number_unique")
      .on(t.eventId, t.bibNumber)
      .where(sql`${t.bibNumber} IS NOT NULL`),

    check(
      "registrations_provisional_bib_number_positive",
      sql`${t.provisionalBibNumber} IS NULL OR ${t.provisionalBibNumber} > 0`,
    ),
    // The same guarantee for the number held before confirmation (§214). It is released when
    // the place is, so this index is what makes a released number safe to hand to the next
    // person: the release and the draw both happen under the event row's lock, and this is
    // what would surface a mistake rather than let two rows quietly share a number.
    uniqueIndex("registrations_event_provisional_bib_unique")
      .on(t.eventId, t.provisionalBibNumber)
      .where(sql`${t.provisionalBibNumber} IS NOT NULL`),

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
