import { check, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { registrations } from "./registrations";
import { staffUsers } from "./staff-users";

/**
 * The longest note, in characters (§777). Written once: the form's `maxLength`, the service's refusal and the
 * table's own check read it, so the three cannot drift.
 */
export const REGISTRATION_NOTE_MAX = 2000;

/**
 * An internal note on one registration (§777; the owner, 2026-10-15: «trebuie să putem lăsa comentarii pe
 * fiecare înscriere în parte, doar pentru organizatori și administratori»).
 *
 * What the organizers tell each other about a registration while they organise the event — «cere
 * tricou S», «a sunat, vine cu o oră mai târziu». Plain text in the author's own language, never shown
 * to the participant, never on the race-day desk, never on the public list, and in one file only — the registrations export, as a last column for those same roles (§782); read and
 * written by the Organizer and above only (`canKeepRegistrationNotes`), asserted in the service.
 *
 * - **Deleted with the registration.** `ON DELETE CASCADE`: an erase, the retention sweep and an event's
 *   hard delete take the notes with the row, so no word about a person outlives the registration.
 * - **A delete keeps no words.** «Șterge» stamps `deleted_at` and empties `body`: the row stays only as the
 *   anchor of the trail («cine și când»), which never carries the words either. Nothing reads a deleted row.
 * - **The author is a reference, not a copy.** `ON DELETE SET NULL`, as the audit trail's: a colleague
 *   removed from the team does not take their notes with them, and the note then says its author is gone.
 */
export const registrationNotes = pgTable(
  "registration_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    registrationId: uuid("registration_id")
      .notNull()
      .references(() => registrations.id, { onDelete: "cascade" }),
    authorStaffUserId: uuid("author_staff_user_id").references(() => staffUsers.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    // «Note interne»: one registration's notes, newest first, and the list's one grouped count.
    index("registration_notes_registration_idx").on(t.registrationId, t.createdAt),
    check("registration_notes_body_length", sql`char_length(${t.body}) <= ${sql.raw(String(REGISTRATION_NOTE_MAX))}`),
  ],
);

export type RegistrationNote = typeof registrationNotes.$inferSelect;
