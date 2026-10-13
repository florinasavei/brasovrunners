import { sql } from "drizzle-orm";
import { check, index, integer, pgEnum, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { events } from "./events";
import { locale } from "./locale";
import { staffUsers } from "./staff-users";

/**
 * A volunteer's state on one event (§754): «Înscris» (the person offered, nobody has answered),
 * «Confirmat» (an organizer said yes) and «Anulat» (the offer was declined or withdrawn — the row
 * stays so the same address is not asked to start again, and so it is never counted against a
 * role). A closed set at the database, like every state here; a fourth is a migration.
 */
export const eventVolunteerState = pgEnum("event_volunteer_state", ["REGISTERED", "CONFIRMED", "CANCELLED"]);

/** Who put the row there: a staff member's hand («staff») or the event page's public form («public»). */
export const eventVolunteerSource = pgEnum("event_volunteer_source", ["STAFF", "PUBLIC"]);

/**
 * One role an event needs people for (§754; the owner, 2026-10-13: «I want to register volunteers
 * for a race and be able to define custom roles» — answering «per event», not a club-wide list).
 *
 * The club types the role's name in both languages (the bilingual rule: both or neither, never one
 * language's text under the other's page), how many people it needs and, optionally, a line that says
 * what the person would do. `position` is the order the organizers and the public form list them in.
 * The rows go with the event (`ON DELETE CASCADE`); a role with volunteers on it cannot be deleted
 * (`event_volunteers.role_id` is `RESTRICT`), the service says so first and asks to move them.
 *
 * Nothing here is personal data: the roles are the club's own words and stay as long as the event.
 */
export const eventVolunteerRoles = pgTable(
  "event_volunteer_roles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    nameRo: text("name_ro").notNull(),
    nameEn: text("name_en").notNull(),
    /** How many people the role needs, at least one: «N din M» on the card and the form's «still needs people». */
    needed: integer("needed").notNull(),
    descriptionRo: text("description_ro"),
    descriptionEn: text("description_en"),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("event_volunteer_roles_event_idx").on(t.eventId, t.position),
    check("event_volunteer_roles_needed_positive", sql`${t.needed} >= 1`),
    check("event_volunteer_roles_name_length", sql`char_length(${t.nameRo}) BETWEEN 1 AND 80 AND char_length(${t.nameEn}) BETWEEN 1 AND 80`),
    check(
      "event_volunteer_roles_description_length",
      sql`(${t.descriptionRo} IS NULL OR char_length(${t.descriptionRo}) BETWEEN 1 AND 200) AND (${t.descriptionEn} IS NULL OR char_length(${t.descriptionEn}) BETWEEN 1 AND 200)`,
    ),
  ],
);

/**
 * A person who offered to help at one event, or whom the club entered (§754).
 *
 * **Not a registration and not a staff account.** A volunteer does not run, takes no place of the
 * race's capacity, is on no public list and signs in nowhere: the row is a name, a way to reach the
 * person, the role and a state. The address goes through the versioned canonicalizer (AGENTS.md
 * §10.4) and `UNIQUE (event_id, canonical_email)` is the identity — one row per person per event,
 * whoever typed it and whatever the role — so a repeated public sign-up finds the row and says the same
 * «am primit» a new one gets (the same answer, BR-REQ-031-01 criterion 3).
 *
 * `message` is what the person wrote on the public form (at most 300 characters); `note` is the
 * organizers' own line and never leaves the backoffice. `privacy_notice_version` is the notice in force
 * when a person signed up on the page: the consent's record (GDPR art. 7(1)), null for a row the club
 * entered by hand. `locale` is the language of the page the person wrote from: their email's language.
 *
 * Kept until thirty days after the event's start, then deleted by the maintenance job
 * (`jobs/retention.ts`, step `volunteers`); the privacy notice says so in its own words.
 */
export const eventVolunteers = pgTable(
  "event_volunteers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    roleId: uuid("role_id")
      .notNull()
      .references(() => eventVolunteerRoles.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    /** The address as typed, minus whitespace: where the one message goes. */
    email: text("email").notNull(),
    /** The identity the UNIQUE constraint below is on (`canonicalizeEmail`, §10.4). */
    canonicalEmail: text("canonical_email").notNull(),
    canonicalizationVersion: integer("canonicalization_version").notNull(),
    phone: text("phone").notNull(),
    locale: locale("locale").notNull().default("ro"),
    state: eventVolunteerState("state").notNull().default("REGISTERED"),
    source: eventVolunteerSource("source").notNull(),
    /** What the person wrote on the public form, optional. */
    message: text("message"),
    /** The organizers' own line; backoffice only. */
    note: text("note"),
    privacyNoticeVersion: integer("privacy_notice_version"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    /** The staff member who entered the row; null for the public form, and after that account is removed. */
    createdByStaffUserId: uuid("created_by_staff_user_id").references(() => staffUsers.id, { onDelete: "set null" }),
  },
  (t) => [
    unique("event_volunteers_event_canonical_email_unique").on(t.eventId, t.canonicalEmail),
    // «N din M»: the people counted against a role.
    index("event_volunteers_role_idx").on(t.roleId),
    // The retention sweep and the person lookup.
    index("event_volunteers_canonical_email_idx").on(t.canonicalEmail),
    check("event_volunteers_name_length", sql`char_length(${t.name}) BETWEEN 1 AND 120`),
    check("event_volunteers_message_length", sql`${t.message} IS NULL OR char_length(${t.message}) BETWEEN 1 AND 300`),
    check("event_volunteers_note_length", sql`${t.note} IS NULL OR char_length(${t.note}) BETWEEN 1 AND 500`),
  ],
);

export type EventVolunteerRoleRow = typeof eventVolunteerRoles.$inferSelect;
export type EventVolunteerRow = typeof eventVolunteers.$inferSelect;
export type EventVolunteerState = (typeof eventVolunteerState.enumValues)[number];
export type EventVolunteerSource = (typeof eventVolunteerSource.enumValues)[number];
