import { check, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { eventVolunteers } from "./event-volunteers";
import { REGISTRATION_NOTE_MAX } from "./registration-notes";
import { staffUsers } from "./staff-users";

/**
 * The longest note on a volunteer, in characters: an internal note's own (§777), so the two kinds of note hold the same.
 * Written once: the add form's and the card's `maxLength`, the service's refusal and the table's own check read it.
 */
export const VOLUNTEER_NOTE_MAX = REGISTRATION_NOTE_MAX;

/**
 * An internal note on one volunteer («Note interne» for volunteers, amending the single organizers' line of §754): what the
 * organizers tell each other about one person who offered to help — «vine doar dimineața», «are mașină». Plain text, line
 * breaks kept, in the author's own language; read and written by whoever manages the volunteers (`canManageVolunteers`:
 * the Organizer, the Administrator, the Superadministrator), asserted in `modules/volunteers/volunteer-notes.ts`.
 *
 * Shown on the volunteer's page, counted on the «Voluntari» list, written into the volunteers' files (the «Notă» column) and
 * listed in «Toate datele unei persoane» — never on the public volunteers' list, in an email or on a badge.
 *
 * - **Deleted with the volunteer.** `ON DELETE CASCADE`: «Șterge voluntarul», the thirty-day retention sweep and an event's
 *   hard delete take the notes with the row, with no code of their own.
 * - **A delete keeps no words.** «Șterge» stamps `deleted_at` and empties `body`; the trail («cine și când») never carries them.
 * - **The author is a reference, not a copy.** `ON DELETE SET NULL`; a note carried from the old single line with nobody
 *   the trail could name has none from the start. Either way it reads «autor necunoscut».
 */
export const eventVolunteerNotes = pgTable(
  "event_volunteer_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    volunteerId: uuid("volunteer_id")
      .notNull()
      .references(() => eventVolunteers.id, { onDelete: "cascade" }),
    authorStaffUserId: uuid("author_staff_user_id").references(() => staffUsers.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    // One volunteer's notes, newest first, and the list's one grouped count.
    index("event_volunteer_notes_volunteer_idx").on(t.volunteerId, t.createdAt),
    check("event_volunteer_notes_body_length", sql`char_length(${t.body}) <= ${sql.raw(String(VOLUNTEER_NOTE_MAX))}`),
  ],
);

export type EventVolunteerNote = typeof eventVolunteerNotes.$inferSelect;
