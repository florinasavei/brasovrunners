import { sql } from "drizzle-orm";
import { boolean, check, index, integer, numeric, pgEnum, pgTable, text, time, timestamp, uuid } from "drizzle-orm/pg-core";
import { events } from "./events";

/**
 * What a checkpoint has to give a runner (§757): a small closed set — water, food, first aid, timing
 * and, since §770, direction (a volunteer who shows the way at a junction) — in the backoffice's words
 * «Apă», «Mâncare», «Prim ajutor», «Cronometrare», «Direcționare». A sixth is a migration, like every
 * other state here; the page and the bib draw each with its glyph and its word. A sixth came with
 * «Regrupare» (§824; the owner, 2026-10-19: «un punct de control de tipul „regrupare" … foarte util
 * pentru alergările de grup»): the group waits here — the point's note says for how long.
 */
export const eventCheckpointKind = pgEnum("event_checkpoint_kind", ["WATER", "FOOD", "FIRST_AID", "TIMING", "DIRECTION", "REGROUP"]);

/** The most characters «Notă pentru voluntari» holds in each language (§NNN); the check below holds the same bound. */
export const PLAN_POINT_NOTE_MAX = 500;

/**
 * The checkpoints of one event's route (§757; the owner, 2026-10-13: «other things for the route: I
 * need to put checkpoints and limit times»): a point at a distance along the route, where something
 * is — water, food, first aid, the timing mat — and, optionally, the time by which a runner has to
 * be there. They are the list under «Traseul» in the editor, the table «Puncte pe traseu» on the
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
 *
 * **Two kinds of rows live here since §961** (the owner, 2026-11-17, the day after «Planul
 * voluntarilor» got its picture: «După ce încarc acea poză cu harta de voluntari vreau să pot defini
 * punctele de mână, să pun nume punct și la ce km e și coordonate punct» — and «Practic voluntarii
 * sunt de 2 tipuri: start-finish și pe traseu»). Everything above is the first kind: the event's
 * public «Puncte pe traseu», kept in the editor. The second is a point of the volunteers' plan alone
 * (`plan_only`), added by hand on the plan's page: a place where volunteers stand, either on the
 * route — with a kilometre — or at the start–finish (`start_finish`), with none. One table because a
 * volunteer stands at one point whichever kind it is (the volunteers' table holds one reference to
 * these rows, §949), so the plan needs no second reference to keep in step with the first.
 *
 * A plan-only row is on no public page, chart, race number, file or copy of the event:
 * `event-checkpoints/checkpoints.ts`, which every one of those readers goes through, reads only the
 * rows that are not plan-only, and the volunteers' side has a reader of its own
 * (`volunteers/plan-points.ts`). A guard holds the list of files that may name the four columns
 * below, and the two of «Notă pentru voluntari» after them (§NNN), which are the plan's too
 * (`tests/unit/volunteers/plan-points-never-leave.test.ts`).
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
    /**
     * The point's name in each language, as the club typed it in the editor. **A plan-only point (§961) holds the one name
     * the organizers typed in both columns:** it is their own word for a place («Kituri», «Intersecția de la izvor»),
     * published nowhere — the plan's page and the volunteer's own email say it as typed — so the rule «both languages for
     * what the club publishes» has nothing to translate, and the table's own «a name in each» still holds.
     */
    nameRo: text("name_ro").notNull(),
    nameEn: text("name_en").notNull(),
    /**
     * Kilometres from the start, two decimals; never beyond the route's distance (checked at the save, which knows it).
     * A plan-only point on the route (§961) has the kilometre the organizers typed, held to no route's length; a
     * start–finish point holds 0 here and nobody reads it.
     */
    km: numeric("km", { precision: 6, scale: 2 }).notNull(),
    /** What there is: none or more of the closed set. */
    kinds: eventCheckpointKind("kinds").array().notNull().default(sql`'{}'`),
    /** The first answer's cut-off, a time of the day (§757): no longer written or read since §770, dropped by a later contract. */
    cutoffTime: time("cutoff_time"),
    /** Minutes from the start (the gun on a race that has one) by which the last runner has to be here; null for no limit (§770). */
    cutoffMinutes: integer("cutoff_minutes"),
    noteRo: text("note_ro"),
    noteEn: text("note_en"),
    /**
     * Whether the route's elevation profile draws this point (§802; the owner, 2026-10-16: «select which ones to show on the
     * elevation profile»). On by default: a new point is on the chart until the club unticks it. Only the chart reads it — the
     * public table lists every point, ticked or not.
     */
    onProfile: boolean("on_profile").notNull().default(true),
    /**
     * A point of the volunteers' plan alone (§961), added by hand on «Planul voluntarilor»: never on the event's page, the
     * route's chart, a race number, the event's file, a copy of the event or the editor's card — the readers of all of
     * those see only the rows where this is false (`event-checkpoints/checkpoints.ts`). Such a row has no kinds, no time
     * limit and no note, and `on_profile` false; its one name stands in both name columns. False for every point the
     * editor, a GPX file or an import wrote, which is every row from before this column.
     */
    planOnly: boolean("plan_only").notNull().default(false),
    /**
     * A point at the start–finish, not on the route (§961; the owner: «Practic voluntarii sunt de 2 tipuri: start-finish
     * și pe traseu»): the desk, the kits, the start line, the finish. It has no kilometre said anywhere and no number in
     * the route's order — `km` holds 0 and nobody reads it. Only a plan-only point may be one (a check below): the
     * public «Puncte pe traseu» are points of the route by what they are.
     */
    startFinish: boolean("start_finish").notNull().default(false),
    /**
     * Where the point is, in degrees with six decimals (about a tenth of a metre) — both or neither (a check below). Typed
     * on the plan's page for any point, the editor's too, as a maps application copies them (`domain/coordinates.ts`); read
     * by the plan's page and the volunteer's own email, which link to the place on a map. Never public: not in the event's
     * file, a copy, the event's page or a race number.
     */
    latitude: numeric("latitude", { precision: 8, scale: 6 }),
    longitude: numeric("longitude", { precision: 9, scale: 6 }),
    /**
     * «Notă pentru voluntari» (§NNN; the owner, 2026-11-19, of «Planul voluntarilor»: «si am nevoie de un nou field "noua pentru
     * voluntari"»): what everybody standing at this point has to know — «Direcționați spre stânga la intersecție; vestă
     * reflectorizantă» —, for any point, the editor's too, in each language: both or neither (a check below), at most
     * `PLAN_POINT_NOTE_MAX` characters each, plain text whose line breaks are kept. Written on the plan's page
     * (`volunteers/plan-points.ts#changePlanPoint`), read by the plan's page — on the screen and on paper — and by the one
     * email that tells a volunteer their point. Never public: not the event's page, its file, a copy or a race number — and
     * not the point's own `note_ro` / `note_en` above, which the event's page shows.
     */
    volunteerNoteRo: text("volunteer_note_ro"),
    volunteerNoteEn: text("volunteer_note_en"),
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
    // A start–finish point is a point of the volunteers' plan alone (§961): the public «Puncte pe traseu» are on the route.
    check("event_checkpoints_start_finish_plan_only", sql`NOT ${t.startFinish} OR ${t.planOnly}`),
    // The two coordinates are there together or not at all, each within what a latitude and a longitude can be.
    check("event_checkpoints_coordinates_pair", sql`(${t.latitude} IS NULL) = (${t.longitude} IS NULL)`),
    check(
      "event_checkpoints_coordinates_range",
      sql`(${t.latitude} IS NULL OR ${t.latitude} BETWEEN -90 AND 90) AND (${t.longitude} IS NULL OR ${t.longitude} BETWEEN -180 AND 180)`,
    ),
    // «Notă pentru voluntari» (§NNN) is in both languages or in neither, each 1 to `PLAN_POINT_NOTE_MAX` characters.
    check(
      "event_checkpoints_volunteer_note_both_languages",
      sql`(${t.volunteerNoteRo} IS NULL) = (${t.volunteerNoteEn} IS NULL) AND (${t.volunteerNoteRo} IS NULL OR (char_length(${t.volunteerNoteRo}) BETWEEN 1 AND ${sql.raw(String(PLAN_POINT_NOTE_MAX))} AND char_length(${t.volunteerNoteEn}) BETWEEN 1 AND ${sql.raw(String(PLAN_POINT_NOTE_MAX))}))`,
    ),
  ],
);

export type EventCheckpointRow = typeof eventCheckpoints.$inferSelect;
