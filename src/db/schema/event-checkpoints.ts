import { sql } from "drizzle-orm";
import { check, index, integer, numeric, pgEnum, pgTable, text, time, timestamp, uuid } from "drizzle-orm/pg-core";
import { events } from "./events";

/**
 * What a checkpoint has to give a runner (§757): a small closed set — water, food, first aid, timing
 * — in the backoffice's words «Apă», «Mâncare», «Prim ajutor», «Cronometrare». A fifth is a migration,
 * like every other state here; the page and the bib draw each with its glyph and its word.
 */
export const eventCheckpointKind = pgEnum("event_checkpoint_kind", ["WATER", "FOOD", "FIRST_AID", "TIMING"]);

/**
 * The checkpoints of one event's route (§757; the owner, 2026-10-13: «other things for the route: I
 * need to put checkpoints and limit times»): a point at a distance along the route, where something
 * is — water, food, first aid, the timing mat — and, optionally, the time by which a runner has to
 * be there. They are the list under «Traseul» in the editor, the table «Puncte de control» on the
 * event page and the marks on the bib's profile strip (§750).
 *
 * **The cut-off is a time of the day, not an instant.** `cutoff_time` is `time` without a zone: the
 * wall clock of the event's own zone (`events.timezone`) on the race's day — «11:30». A `timestamptz`
 * would be the same answer on the day it is typed and a wrong one the day the club moves the race:
 * the instant stays on the old date while everything else — the start, the programme — follows the
 * new one, and the editor would have to shift every cut-off by hand. A time of the day follows the
 * date by construction. A race that ends on the next day (the event's end says so) reads a cut-off
 * earlier than the start's time of day as the next day's, any other event refuses it
 * (`domain/checkpoint.ts#cutoffOffset`); one race is shorter than a day.
 *
 * Both languages for every word the club typed (the owner's rule): the name is required in each;
 * the note is optional but both-or-neither (a check below). The rows go with the event (`ON DELETE
 * CASCADE`). The order is by distance (`km`); `position` only breaks a tie and keeps the order the
 * club saw when two points stand at the same kilometre.
 */
export const eventCheckpoints = pgTable(
  "event_checkpoints",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    /** The order the club saw: renumbered by distance at every save, so ties keep how they were typed. */
    position: integer("position").notNull().default(0),
    nameRo: text("name_ro").notNull(),
    nameEn: text("name_en").notNull(),
    /** Kilometres from the start, two decimals; never beyond the route's distance (checked at the save, which knows it). */
    km: numeric("km", { precision: 6, scale: 2 }).notNull(),
    /** What there is: none or more of the closed set. */
    kinds: eventCheckpointKind("kinds").array().notNull().default(sql`'{}'`),
    /** The time of the day, in the event's zone, by which a runner has to be here; null for no limit. */
    cutoffTime: time("cutoff_time"),
    noteRo: text("note_ro"),
    noteEn: text("note_en"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // "This event's checkpoints", the only question the editor, the page and the bib ask of the table.
    index("event_checkpoints_event_idx").on(t.eventId),
    check("event_checkpoints_km_not_negative", sql`${t.km} >= 0`),
    check("event_checkpoints_name_length", sql`char_length(${t.nameRo}) BETWEEN 1 AND 60 AND char_length(${t.nameEn}) BETWEEN 1 AND 60`),
    // The note is in both languages or in neither, at most 120 characters each.
    check(
      "event_checkpoints_note_both_languages",
      sql`(${t.noteRo} IS NULL) = (${t.noteEn} IS NULL) AND (${t.noteRo} IS NULL OR (char_length(${t.noteRo}) BETWEEN 1 AND 120 AND char_length(${t.noteEn}) BETWEEN 1 AND 120))`,
    ),
  ],
);

export type EventCheckpointRow = typeof eventCheckpoints.$inferSelect;
