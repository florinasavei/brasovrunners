import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgEnum, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { eventEliteEntries } from "./event-elite-entries";
import { eventVolunteers } from "./event-volunteers";
import { events } from "./events";
import { legalDocuments } from "./legal-documents";
import { locale } from "./locale";
import { registrations } from "./registrations";
import { staffUsers } from "./staff-users";

/** The longest name the public raffle form keeps as typed (§984): a registration's name fits well inside it. */
export const RAFFLE_TYPED_NAME_MAX = 120;

/**
 * Which door a raffle sign-up came through (§984): `LINK` — the «Tombolă» card on the person's own «Gestionează înscrierea»;
 * `FORM` — the public page `/events/[slug]/tombola`, a race number and a name; `DESK` — the race-day desk's view of a person,
 * the person having accepted the rules on paper or aloud; `STAFF` — the organizers, on a volunteer's page or on the «Tombolă» tab.
 */
export const raffleEntryMethod = pgEnum("raffle_entry_method", ["LINK", "FORM", "DESK", "STAFF"]);
export type RaffleEntryMethod = (typeof raffleEntryMethod.enumValues)[number];

/**
 * «Înscrierea la tombolă» (migration `0217`, §984; the owner, 2026-11-18: «pentru tombolă trebuie să am o înscriere separată»):
 * one row per person who signed up for an event's raffle in the sign-up mode («Cu înscriere separată», `events.raffle_sign_up`).
 *
 * **The person is exactly one of three** (`event_raffle_entries_one_person`): a registration, a volunteer or a line of the race's
 * elite list — each a foreign key `ON DELETE CASCADE`, so the entry goes with its person, and with its event. One row per person
 * (each person's column is unique, and a person belongs to one event), so a second sign-up finds the first and writes nothing.
 *
 * **The rules' acceptance** is kept as the volunteer agreement's is (§758, §771): the version accepted (`rules_document_id`), the
 * moment, the language, the SHA-256 of the exact text read with its blanks filled (`rules_text_hash`, §556's `signedTextHash`) and
 * the blanks themselves (`rules_facts`); for an electronic sign-up (`LINK`, `FORM`) the IP address and browser of the press, and
 * for one the staff recorded (`DESK`, `STAFF`) who recorded it (`SET NULL` when that account goes). `typed_name` is the name typed
 * on the public form, `FORM` only. `privacy_notice_version` is the privacy notice in force in the sign-up's language at the moment.
 *
 * **Never leaves the organizers** (`tests/unit/volunteers/raffle-entries-never-leave.test.ts`): no email, no public list, no badge,
 * no count the public is given. Deleted thirty days after the event's start by the maintenance sweep (`jobs/retention.ts`, step
 * `event-raffle-entries`) and listed in «Toate datele unei persoane» (art. 15 GDPR). The trail names the method and the kind of
 * person, never a name (`event_raffle.entry_created` / `event_raffle.entry_withdrawn`).
 */
export const eventRaffleEntries = pgTable(
  "event_raffle_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    registrationId: uuid("registration_id").references(() => registrations.id, { onDelete: "cascade" }),
    volunteerId: uuid("volunteer_id").references(() => eventVolunteers.id, { onDelete: "cascade" }),
    eliteEntryId: uuid("elite_entry_id").references(() => eventEliteEntries.id, { onDelete: "cascade" }),
    method: raffleEntryMethod("method").notNull(),
    /** The «Regulamentul tombolei» version accepted; `RESTRICT`, as every acceptance's: a version somebody accepted is never deleted. */
    rulesDocumentId: uuid("rules_document_id")
      .notNull()
      .references(() => legalDocuments.id, { onDelete: "restrict" }),
    rulesAcceptedAt: timestamp("rules_accepted_at", { withTimezone: true }).notNull(),
    rulesLocale: locale("rules_locale").notNull(),
    rulesTextHash: text("rules_text_hash").notNull(),
    rulesFacts: jsonb("rules_facts").notNull(),
    /** The name as typed on the public form (`FORM`): trimmed, inner spaces collapsed. */
    typedName: text("typed_name"),
    /** The electronic sign-up's trace (§771): the IP address and browser of the press, `LINK` and `FORM` only. */
    ip: text("ip"),
    userAgent: text("user_agent"),
    /** Who recorded a `DESK` or `STAFF` sign-up. */
    recordedByStaffUserId: uuid("recorded_by_staff_user_id").references(() => staffUsers.id, { onDelete: "set null" }),
    /** The privacy notice in force, in the sign-up's language, when the person signed up. */
    privacyNoticeVersion: integer("privacy_notice_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("event_raffle_entries_event_idx").on(t.eventId),
    // One sign-up per person: a person row belongs to one event, so its id alone is the person at the event.
    unique("event_raffle_entries_registration_unique").on(t.registrationId),
    unique("event_raffle_entries_volunteer_unique").on(t.volunteerId),
    unique("event_raffle_entries_elite_entry_unique").on(t.eliteEntryId),
    check("event_raffle_entries_one_person", sql`num_nonnulls(${t.registrationId}, ${t.volunteerId}, ${t.eliteEntryId}) = 1`),
    check("event_raffle_entries_rules_hash_sha256", sql`${t.rulesTextHash} ~ '^[0-9a-f]{64}$'`),
    // The typed name is the public form's alone; the trace the electronic doors'; a recorder the staff's.
    check("event_raffle_entries_typed_name_form", sql`${t.typedName} IS NULL OR (${t.method} = 'FORM' AND char_length(${t.typedName}) BETWEEN 1 AND ${sql.raw(String(RAFFLE_TYPED_NAME_MAX))})`),
    check("event_raffle_entries_trace_electronic", sql`(${t.ip} IS NULL AND ${t.userAgent} IS NULL) OR ${t.method} IN ('LINK', 'FORM')`),
    check("event_raffle_entries_recorder_staff", sql`${t.recordedByStaffUserId} IS NULL OR ${t.method} IN ('DESK', 'STAFF')`),
    check("event_raffle_entries_notice_version_positive", sql`${t.privacyNoticeVersion} >= 1`),
  ],
);

export type EventRaffleEntry = typeof eventRaffleEntries.$inferSelect;
