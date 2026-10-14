import { sql } from "drizzle-orm";
import { boolean, check, index, integer, jsonb, pgEnum, pgTable, primaryKey, smallint, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { events } from "./events";
import { legalDocuments } from "./legal-documents";
import { locale } from "./locale";
import { registrationSex, registrationTshirtSize } from "./registrations";
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
 * How a volunteer accepted the volunteer agreement (§758, amending §754): ticked on the event page's public
 * form («FORM»), from the single-use link an organizer sent by email («LINK»), or signed on a printed copy at
 * the desk and recorded by a staff member («PAPER»). A closed set, like every state here.
 */
export const volunteerAgreementMethod = pgEnum("volunteer_agreement_method", ["FORM", "LINK", "PAPER"]);

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
    /**
     * The one-line description of §754 (at most 200 characters), **kept only until a later contract release** (§765):
     * migration `0151` turned each value into the document below, and nothing reads or writes these two columns
     * any more. Code still serving while the migration runs reads them; they are dropped when no such code can be.
     */
    descriptionRo: text("description_ro"),
    descriptionEn: text("description_en"),
    /**
     * «Descrierea rolului» (§765; the owner, 2026-10-14: «I need the rich text editor here for responsibilities»): what
     * the person does in the role — where they stand, what they do, from what hour — in the editor every page uses,
     * one document per language, kept the FAQ's way: the document (`description_ro_json`) and its plain words
     * (`description_words_ro`, `richTextToPlainText`, written by every save). The words are what the agreement's
     * «Ce presupune rolul», its PDF and the emails say; the document is what the public form and the editor draw.
     * Both languages or neither (checked by the service, `resolveRichPair`); null is no description.
     */
    descriptionRoJson: jsonb("description_ro_json"),
    descriptionEnJson: jsonb("description_en_json"),
    descriptionWordsRo: text("description_words_ro"),
    descriptionWordsEn: text("description_words_en"),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /**
     * The colour of the role's band on a volunteer badge (§764), a hex triplet read for contrast
     * before it is saved (`badge-design.ts#badgeColourReadable`); null is the theme's own colour.
     */
    colour: text("colour"),
  },
  (t) => [
    index("event_volunteer_roles_event_idx").on(t.eventId, t.position),
    check("event_volunteer_roles_colour_is_hex", sql`${t.colour} IS NULL OR ${t.colour} ~ '^#[0-9a-fA-F]{6}$'`),
    check("event_volunteer_roles_needed_positive", sql`${t.needed} >= 1`),
    check("event_volunteer_roles_name_length", sql`char_length(${t.nameRo}) BETWEEN 1 AND 80 AND char_length(${t.nameEn}) BETWEEN 1 AND 80`),
    check(
      "event_volunteer_roles_description_length",
      sql`(${t.descriptionRo} IS NULL OR char_length(${t.descriptionRo}) BETWEEN 1 AND 200) AND (${t.descriptionEn} IS NULL OR char_length(${t.descriptionEn}) BETWEEN 1 AND 200)`,
    ),
    // The description's words: a document has its words and the words their document, within the bound the editor says (§765).
    check(
      "event_volunteer_roles_description_words",
      sql`(${t.descriptionRoJson} IS NULL) = (${t.descriptionWordsRo} IS NULL) AND (${t.descriptionEnJson} IS NULL) = (${t.descriptionWordsEn} IS NULL) AND (${t.descriptionWordsRo} IS NULL OR char_length(${t.descriptionWordsRo}) BETWEEN 1 AND 2000) AND (${t.descriptionWordsEn} IS NULL OR char_length(${t.descriptionWordsEn}) BETWEEN 1 AND 2000)`,
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
    /**
     * The role the organizers gave the person (§754; since §761 the *assigned* role). Null for an offer nobody
     * has placed yet — every public sign-up, which ticks the roles the person would do
     * (`event_volunteer_role_choices`) and leaves the choice to the organizers. Only an assigned role counts
     * against its need («N din M»). Nullable since migration `0149`: a relaxing change, expand only.
     */
    roleId: uuid("role_id").references(() => eventVolunteerRoles.id, { onDelete: "restrict" }),
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
    /*
      What the person says about themselves (§765; the owner, 2026-10-14: «când se înregistrează voluntarul trebuie să
      pună măcar vârstă, sex, oraș și o bifă dacă a mai fost voluntar sau nu»): asked on the public form only while the
      privacy notice in force names it (`describesVolunteerProfile`), optional on the organizers' own entry, null on a
      row from before. The person's own answers, never checked against anything. Kept and deleted with the row.
    */
    /** Whole years, as typed; the minimum (`VOLUNTEER_MINIMUM_AGE`) is the code's rule, so a lower one is no migration. */
    age: smallint("age"),
    /** The registration form's own two answers (`domain/sex.ts`); the retired `UNSPECIFIED` is never written here. */
    sex: registrationSex("sex"),
    city: text("city"),
    /** «Am mai fost voluntar în trecut la alte curse»: ticked or not — unticked is «nu», not unknown. */
    volunteeredBefore: boolean("volunteered_before").notNull().default(false),
    /** «Fac parte din grupul {club}»: the person's own claim, checked against nothing (like the registration form's, §48). */
    clubMember: boolean("club_member").notNull().default(false),
    /** The T-shirt's size, only while the event gives one (`events.volunteers_shirts`); null is none asked or none wanted. */
    shirtSize: registrationTshirtSize("shirt_size"),
    privacyNoticeVersion: integer("privacy_notice_version"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    /** The staff member who entered the row; null for the public form, and after that account is removed. */
    createdByStaffUserId: uuid("created_by_staff_user_id").references(() => staffUsers.id, { onDelete: "set null" }),

    /*
      The volunteer agreement (§758, amending §754; the owner, 2026-10-13: «un document gen „contract de
      voluntariat” simplu, unde zicem că nu sunt plătiți, că trebuie să respecte atribuțiunile»): the approved
      version accepted (`VOLUNTEER_AGREEMENT`), when, how, in which language, the SHA-256 of the exact text read
      with its blanks filled (§556's `signedTextHash`) and the blanks themselves as they were filled — the
      person, the role and what it asks, the event, its date and place — so a role renamed or an event moved
      since never changes what the volunteer accepted. All null until accepted, all set together (the CHECK
      below). `RESTRICT`: a version somebody accepted is never removed under them (§567 retires it instead).
    */
    agreementDocumentId: uuid("agreement_document_id").references(() => legalDocuments.id, { onDelete: "restrict" }),
    agreementAcceptedAt: timestamp("agreement_accepted_at", { withTimezone: true }),
    agreementMethod: volunteerAgreementMethod("agreement_method"),
    agreementLocale: locale("agreement_locale"),
    agreementTextHash: text("agreement_text_hash"),
    agreementFacts: jsonb("agreement_facts"),
    /** The staff member who recorded a paper acceptance at the desk; null otherwise, and after that account is removed. */
    agreementRecordedByStaffUserId: uuid("agreement_recorded_by_staff_user_id").references(() => staffUsers.id, { onDelete: "set null" }),
    /** «Am cel puțin 18 ani», the person's own tick on the form or the link's page, or the paper they signed, which states it. */
    declaredAdult: boolean("declared_adult").notNull().default(false),
    /*
      The single-use link to accept the agreement (AGENTS.md §12.8): only the SHA-256 of its secret is kept,
      minted when the email is sent; a newer link replaces it, accepting clears it, and it dies at its expiry.
      The secret itself exists in the email alone.
    */
    agreementTokenHash: text("agreement_token_hash").unique("event_volunteers_agreement_token_hash_unique"),
    agreementTokenExpiresAt: timestamp("agreement_token_expires_at", { withTimezone: true }),
    /** When an organizer last asked for the link to be sent: the card's «link trimis …». */
    agreementRequestedAt: timestamp("agreement_requested_at", { withTimezone: true }),
  },
  (t) => [
    unique("event_volunteers_event_canonical_email_unique").on(t.eventId, t.canonicalEmail),
    // «N din M»: the people counted against a role.
    index("event_volunteers_role_idx").on(t.roleId),
    // The retention sweep and the person lookup.
    index("event_volunteers_canonical_email_idx").on(t.canonicalEmail),
    // `/admin/legal`'s count of the people who accepted a version, and the RESTRICT's check on a delete.
    index("event_volunteers_agreement_document_idx").on(t.agreementDocumentId).where(sql`${t.agreementDocumentId} IS NOT NULL`),
    check("event_volunteers_name_length", sql`char_length(${t.name}) BETWEEN 1 AND 120`),
    check("event_volunteers_message_length", sql`${t.message} IS NULL OR char_length(${t.message}) BETWEEN 1 AND 300`),
    check("event_volunteers_note_length", sql`${t.note} IS NULL OR char_length(${t.note}) BETWEEN 1 AND 500`),
    check("event_volunteers_age_range", sql`${t.age} IS NULL OR ${t.age} BETWEEN 1 AND 120`),
    check("event_volunteers_city_length", sql`${t.city} IS NULL OR char_length(${t.city}) BETWEEN 1 AND 80`),
    // «Fără tricou» is no size: it is null (the registration enum's `NONE` is a registration's own answer).
    check("event_volunteers_shirt_is_a_size", sql`${t.shirtSize} IS NULL OR ${t.shirtSize} <> 'NONE'`),
    // An acceptance is the version, the moment, the way and the language together, or nothing.
    check(
      "event_volunteers_agreement_complete",
      sql`(${t.agreementDocumentId} IS NULL) = (${t.agreementAcceptedAt} IS NULL) AND (${t.agreementDocumentId} IS NULL) = (${t.agreementMethod} IS NULL) AND (${t.agreementDocumentId} IS NULL) = (${t.agreementLocale} IS NULL)`,
    ),
    check("event_volunteers_agreement_text_hash_sha256", sql`${t.agreementTextHash} IS NULL OR ${t.agreementTextHash} ~ '^[0-9a-f]{64}$'`),
    // Never the raw secret: a base64url secret cannot match a lower-case hex digest (§12.8, the action tokens' own CHECK).
    check("event_volunteers_agreement_token_sha256", sql`${t.agreementTokenHash} IS NULL OR ${t.agreementTokenHash} ~ '^[0-9a-f]{64}$'`),
    check("event_volunteers_agreement_token_expiry", sql`(${t.agreementTokenHash} IS NULL) = (${t.agreementTokenExpiresAt} IS NULL)`),
  ],
);

/**
 * The roles a volunteer is willing to do (§761, amending §754; the owner, 2026-10-14: «Când se înscrie un voluntar,
 * poate bifa mai multe atribuțiuni din ce e dispus să facă (definite de noi), de exemplu: stă la masă, stă pe
 * traseu, stă în punctele de alimentare etc.»). One row per ticked role: the public form's «Ce ești dispus(ă) să
 * faci» or the organizers' own ticks. The person's offer, not a place: nothing here counts against a role's need —
 * the organizers then give each volunteer one role (`event_volunteers.role_id`), which may be any of the event's.
 *
 * The volunteer's rows go with the volunteer (`CASCADE`: deleting a person, or the retention sweep, takes them).
 * A role somebody ticked is not deleted under them: the service refuses it (`VOLUNTEER_ROLE_HAS_PEOPLE`, as for a
 * role given). The reference to the role is `CASCADE` at the database, not `RESTRICT`: deleting an **event** cascades
 * to its roles and to its volunteers, and the choices would be reached only through the volunteers' second-level
 * cascade — after the roles' check, so a `RESTRICT` (or `NO ACTION`) here refused every event with an offer
 * (`tests/integration/volunteers/card.test.ts` deletes one). Migration `0149` made each existing volunteer's role
 * their one choice.
 */
export const eventVolunteerRoleChoices = pgTable(
  "event_volunteer_role_choices",
  {
    volunteerId: uuid("volunteer_id")
      .notNull()
      .references(() => eventVolunteers.id, { onDelete: "cascade" }),
    roleId: uuid("role_id")
      .notNull()
      .references(() => eventVolunteerRoles.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.volunteerId, t.roleId] }),
    // Who ticked a role: the service's check before a role's delete, and the cascade's own lookup.
    index("event_volunteer_role_choices_role_idx").on(t.roleId),
  ],
);

export type EventVolunteerRoleRow = typeof eventVolunteerRoles.$inferSelect;
export type EventVolunteerRow = typeof eventVolunteers.$inferSelect;
export type EventVolunteerState = (typeof eventVolunteerState.enumValues)[number];
export type EventVolunteerSource = (typeof eventVolunteerSource.enumValues)[number];
export type VolunteerAgreementMethod = (typeof volunteerAgreementMethod.enumValues)[number];
