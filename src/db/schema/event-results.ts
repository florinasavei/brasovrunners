import { sql } from "drizzle-orm";
import { check, date, index, integer, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { events } from "./events";
import { registrations, registrationSex } from "./registrations";
import { staffUsers } from "./staff-users";

/**
 * How a runner's race ended (§808): finished with a time, did not finish, did not start, disqualified.
 * A closed set at the database, like every other state here — «Sosit», «Abandon», «Neprezentat»,
 * «Descalificat» in the backoffice's words; a fifth is a migration.
 */
export const eventResultStatus = pgEnum("event_result_status", ["FINISHED", "DNF", "DNS", "DSQ"]);

/**
 * One runner's result in one race (§808; the owner, 2026-10-17: «Aș vrea să pot pune și clasament la final după cursă»).
 *
 * **One race is one list**: a row per race number (`bib_number`), entered in the backoffice or imported from a
 * CSV, by bib. A runner who registered is found by the bib (`registration_id`) and **takes the registration's
 * name, sex and birth date at read** — nothing about them is copied here, so a correction on the registration
 * is the correction on the result. A runner the club typed by hand (a bib with no registration) carries a
 * `display_name`, and optionally a sex and a birth date, for a category; the public ranking shows that name only while the staff
 * recorded that the person agreed (`name_agreed_at`, the actor beside it — the paper declaration's shape, §67), and otherwise
 * «Participant #bib» (`modules/results/domain/public-name.ts`).
 *
 * The times are whole milliseconds from the gun (`gun_time_ms`, required for `FINISHED`, absent for the other
 * three), and the chip's own (`chip_time_ms`, optional). The three positions and the category are **computed on
 * save and stored** (`modules/results/domain/ranking.ts`): overall among the finishers by gun time, by sex, by
 * category (the sex and the age band on the event's day, the Excel's own bands, §787); a runner who did not
 * finish has none. **The stored positions and category are a cache, not the answer**: the sex and the age
 * they are made of belong to the registration (or the typed row), and a correction, a moved race day or an erasure
 * changes them outside a results save, so every page and file ranks again from the live answers when it reads
 * (`loadLiveRanking`), a save rewrites what moved, and erasing a registration re-ranks the event in the same
 * transaction (`rerankEventResults`).
 *
 * The rows go with the event (`ON DELETE CASCADE`). **Erasing a registration leaves its result row, nameless**
 * (`ON DELETE SET NULL`): the bib, the time and the overall place stay — the other runners' places do not move
 * under them — and nothing that names or describes the person does: the name, the sex and the birth date were
 * only ever the registration's, and the category and the places by sex and by category, which describe them, are
 * cleared by the same transaction (`rerankEventResults`). A race's rows are deleted three years after it, with its
 * registrations (`jobs/retention.ts`). A staff account that is removed leaves the row, which then names nobody.
 */
export const eventResults = pgTable(
  "event_results",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    /** The registration the bib belongs to, or null for a runner typed by hand (or one whose registration was erased). */
    registrationId: uuid("registration_id").references(() => registrations.id, { onDelete: "set null" }),
    bibNumber: integer("bib_number").notNull(),
    /** A typed runner's name; null for a registered one, who takes the registration's at read. */
    displayName: text("display_name"),
    /** A typed runner's sex and birth date, for a category; null for a registered one, whose registration answers. */
    sex: registrationSex("sex"),
    birthDate: date("birth_date", { mode: "string" }),
    /**
     * When the staff recorded that a runner typed by hand agreed to appear **by name** in the public ranking (§810, amending the
     * results decision: the owner, 2026-10-17: «ar trebui să-l putem adăuga totuși în sistem manual … să-l punem în rezultat»). Null
     * is no agreement. Only a row with no registration carries one — a registered runner's name follows their own tick on the form,
     * never a staff mark — and only with a name to show.
     */
    nameAgreedAt: timestamp("name_agreed_at", { withTimezone: true }),
    /** The staff member who recorded the agreement (the paper declaration's shape, §67); null when none, or when that account was removed. */
    nameAgreedByStaffUserId: uuid("name_agreed_by_staff_user_id").references(() => staffUsers.id, { onDelete: "set null" }),
    status: eventResultStatus("status").notNull(),
    gunTimeMs: integer("gun_time_ms"),
    chipTimeMs: integer("chip_time_ms"),
    note: text("note"),
    positionOverall: integer("position_overall"),
    positionSex: integer("position_sex"),
    positionCategory: integer("position_category"),
    /** The sex and the band, `FEMALE:from30`; null without both answers. */
    categoryKey: text("category_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedByStaffUserId: uuid("updated_by_staff_user_id").references(() => staffUsers.id, { onDelete: "set null" }),
  },
  (t) => [
    // One row per race number, and one per registration: the table the page draws has one line a runner.
    uniqueIndex("event_results_event_bib_unique").on(t.eventId, t.bibNumber),
    uniqueIndex("event_results_event_registration_unique")
      .on(t.eventId, t.registrationId)
      .where(sql`${t.registrationId} IS NOT NULL`),
    // «The rows of this race, best first» — the page and the public list's only question.
    index("event_results_event_position_idx").on(t.eventId, t.positionOverall),
    check("event_results_bib_positive", sql`${t.bibNumber} > 0`),
    // A finisher has a time and the others have none (the club types a time or a status, never both).
    check("event_results_time_matches_status", sql`(${t.status} = 'FINISHED') = (${t.gunTimeMs} IS NOT NULL)`),
    check("event_results_times_positive", sql`(${t.gunTimeMs} IS NULL OR ${t.gunTimeMs} > 0) AND (${t.chipTimeMs} IS NULL OR ${t.chipTimeMs} > 0)`),
    check("event_results_chip_only_finished", sql`${t.chipTimeMs} IS NULL OR ${t.status} = 'FINISHED'`),
    check("event_results_note_length", sql`${t.note} IS NULL OR char_length(${t.note}) BETWEEN 1 AND 200`),
    check("event_results_name_length", sql`${t.displayName} IS NULL OR char_length(btrim(${t.displayName})) BETWEEN 1 AND 120`),
    // The staff mark of a typed runner's agreement (§810): the actor only with the moment (the account may be removed, `SET NULL`, the moment stays),
    // on a row no registration holds, and with a name to show.
    check("event_results_name_agreed_actor", sql`${t.nameAgreedByStaffUserId} IS NULL OR ${t.nameAgreedAt} IS NOT NULL`),
    check("event_results_name_agreed_typed_only", sql`${t.nameAgreedAt} IS NULL OR ${t.registrationId} IS NULL`),
    check("event_results_name_agreed_needs_name", sql`${t.nameAgreedAt} IS NULL OR ${t.displayName} IS NOT NULL`),
    // Only a finisher is placed.
    check(
      "event_results_positions_finished",
      sql`${t.status} = 'FINISHED' OR (${t.positionOverall} IS NULL AND ${t.positionSex} IS NULL AND ${t.positionCategory} IS NULL)`,
    ),
    check(
      "event_results_positions_positive",
      sql`(${t.positionOverall} IS NULL OR ${t.positionOverall} > 0) AND (${t.positionSex} IS NULL OR ${t.positionSex} > 0) AND (${t.positionCategory} IS NULL OR ${t.positionCategory} > 0)`,
    ),
  ],
);

export type EventResultRow = typeof eventResults.$inferSelect;
export type EventResultStatus = (typeof eventResultStatus.enumValues)[number];
