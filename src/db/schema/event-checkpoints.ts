import { sql } from "drizzle-orm";
import { check, index, integer, numeric, pgEnum, pgTable, text, time, timestamp, uuid } from "drizzle-orm/pg-core";
import { events } from "./events";

/**
 * What a checkpoint has to give a runner (§757): a small closed set — water, food, first aid, timing
 * and, since §770, direction (a volunteer who shows the way at a junction) — in the backoffice's words
 * «Apă», «Mâncare», «Prim ajutor», «Cronometrare», «Direcționare». A sixth is a migration, like every
 * other state here; the page and the bib draw each with its glyph and its word.
 */
export const eventCheckpointKind = pgEnum("event_checkpoint_kind", ["WATER", "FOOD", "FIRST_AID", "TIMING", "DIRECTION"]);

/**
 * The checkpoints of one event's route (§757; the owner, 2026-10-13: «other things for the route: I
 * need to put checkpoints and limit times»): a point at a distance along the route, where something
 * is — water, food, first aid, the timing mat — and, optionally, the time by which a runner has to
 * be there. They are the list under «Traseul» in the editor, the table «Puncte de control» on the
 * event page and the marks on the bib's profile strip (§750).
 *
 * **The cut-off is a time limit, minutes from the gun, not a time of the day** (§770, reversing
 * §757's first answer; the owner, 2026-10-14: «în loc de ora limită, trebuie să punem „timp limită”
 * ca să fie dinamic»). `cutoff_minutes` is how long after the start the last runner may pass: the
 * club types a duration — the race's own «Timp limită» boxes, hours and minutes — and the clock
 * follows the start, so moving the start or the gun moves every cut-off with it and nobody
 * retypes anything. The page says both, «Timp limită: 1 h 30 min · se închide la 11:30»
 * (`domain/start.ts#cutoffClockOf`). The minutes count from the gun a race has (§71), else the
 * event's start — the instant the race's own «Timp limită» counts from — so a point's limit and the
 * finish's are compared as minutes against minutes. `cutoff_time`, the first answer's column, stays
 * until a later contract release and is no longer written or read; migration 0157 filled
 * `cutoff_minutes` from it where the event's start was known.
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
    /** The first answer's cut-off, a time of the day (§757): no longer written or read since §770, dropped by a later contract. */
    cutoffTime: time("cutoff_time"),
    /** Minutes from the start (the gun on a race that has one) by which the last runner has to be here; null for no limit (§770). */
    cutoffMinutes: integer("cutoff_minutes"),
    noteRo: text("note_ro"),
    noteEn: text("note_en"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // "This event's checkpoints", the only question the editor, the page and the bib ask of the table.
    index("event_checkpoints_event_idx").on(t.eventId),
    check("event_checkpoints_km_not_negative", sql`${t.km} >= 0`),
    // A limit is a positive time, at most the week the race's own «Timp limită» may be.
    check("event_checkpoints_cutoff_minutes_range", sql`${t.cutoffMinutes} IS NULL OR ${t.cutoffMinutes} BETWEEN 1 AND 10080`),
    check("event_checkpoints_name_length", sql`char_length(${t.nameRo}) BETWEEN 1 AND 60 AND char_length(${t.nameEn}) BETWEEN 1 AND 60`),
    // The note is in both languages or in neither, at most 120 characters each.
    check(
      "event_checkpoints_note_both_languages",
      sql`(${t.noteRo} IS NULL) = (${t.noteEn} IS NULL) AND (${t.noteRo} IS NULL OR (char_length(${t.noteRo}) BETWEEN 1 AND 120 AND char_length(${t.noteEn}) BETWEEN 1 AND 120))`,
    ),
  ],
);

export type EventCheckpointRow = typeof eventCheckpoints.$inferSelect;
