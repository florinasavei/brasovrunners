import { sql } from "drizzle-orm";
import { boolean, check, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { events } from "./events";
import { staffUsers } from "./staff-users";

/**
 * «Lucruri de adus» (§979; the owner, 2026-11-18: «un alt tab pentru ziua cursei unde sa bifam "lucruri de adus" un fel de
 * inventar, unde sa punem: prelungitoare, markere, etc»): one event's checklist of the things the organizers bring to the
 * race, ticked on race day from «Ziua cursei».
 *
 * One row is one thing the club typed for one event — backoffice-only and one language, so a plain `text` and no
 * translation table. **A list belongs to one date**: nothing here is copied by a series' edit, a repeat, a duplicate or the
 * event's file. The rows go with the event (`ON DELETE CASCADE`); a staff account that is removed leaves the tick, which then
 * names nobody (`SET NULL`), like every "who did it" column in the schema.
 */
export const eventRaceDayItems = pgTable(
  "event_race_day_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    /** What to bring, at most 120 characters («Prelungitoare»); checked at the database too. */
    label: text("label").notNull(),
    /** How many, or who brings it («3 bucăți», «le aduce Ana»), at most 200 characters; or nothing. */
    note: text("note"),
    /** Brought or not: set with `brought_at` and `brought_by` by the tick, the three cleared by the untick. */
    brought: boolean("brought").notNull().default(false),
    broughtAt: timestamp("brought_at", { withTimezone: true }),
    broughtByStaffUserId: uuid("brought_by_staff_user_id").references(() => staffUsers.id, { onDelete: "set null" }),
    /** The list's order: a new thing goes last. */
    position: integer("position").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // "This event's list, in its order", the only question the page asks of the table.
    index("event_race_day_items_event_position_idx").on(t.eventId, t.position),
    check("event_race_day_items_label_length", sql`char_length(${t.label}) BETWEEN 1 AND 120`),
    check("event_race_day_items_note_length", sql`${t.note} IS NULL OR char_length(${t.note}) <= 200`),
    check("event_race_day_items_position_positive", sql`${t.position} >= 1`),
  ],
);

export type EventRaceDayItemRow = typeof eventRaceDayItems.$inferSelect;
