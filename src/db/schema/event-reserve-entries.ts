import { check, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { REGISTRATION_NOTE_MAX } from "./registration-notes";
import { events } from "./events";
import { staffUsers } from "./staff-users";

/** The longest name part and address the internal list keeps — the registration form's own bounds. */
export const RESERVE_NAME_MAX = 100;
export const RESERVE_EMAIL_MAX = 254;
/** The longest note: an internal note's own (§777), since it becomes one on «Trece pe lista oficială». */
export const RESERVE_NOTE_MAX = REGISTRATION_NOTE_MAX;

/**
 * «Lista internă de așteptare» (§NNN; the owner, 2026-10-26: «aș vrea să pot pune manual oameni pe lista
 * de așteptare, dar fără să le zic sau să le trimit vreun email … după vreau să-i pot pune și pe lista
 * oficială, practic ei au cerut prin formularul de contact … și e important să putem lăsa note interne»).
 *
 * The organizers' own notebook of people who asked — usually through the contact form — to be kept in
 * mind for one event. **Not a registration**: no participant, no place, no slot in the queue, no state,
 * no email, no count the club or the public is given; the allocator never reads this table. The person is
 * told nothing until staff press «Trece pe lista oficială», which opens the ordinary staff entry
 * (BR-REQ-037-05) prefilled — from there it is a registration like any other, with its own email — and
 * the entry's note follows it as an internal note (§777); the line here is then gone.
 *
 * Read and written by the Organizer and above (`canKeepRegistrationNotes`), asserted in the service.
 * **Deleted with the event** (`ON DELETE CASCADE`), and the trail never carries a name, an address or
 * the note's words.
 */
export const eventReserveEntries = pgTable(
  "event_reserve_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    /** The address they wrote from, when the club has it; never written to by the platform. */
    email: text("email"),
    /** The organizers' internal note — plain text, line breaks kept, up to `RESERVE_NOTE_MAX`. */
    note: text("note"),
    createdByStaffUserId: uuid("created_by_staff_user_id").references(() => staffUsers.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One event's list, in the order the club wrote it down.
    index("event_reserve_entries_event_idx").on(t.eventId, t.createdAt),
    check("event_reserve_entries_name_length", sql`char_length(${t.firstName}) BETWEEN 1 AND ${sql.raw(String(RESERVE_NAME_MAX))} AND char_length(${t.lastName}) BETWEEN 1 AND ${sql.raw(String(RESERVE_NAME_MAX))}`),
    check("event_reserve_entries_email_length", sql`${t.email} IS NULL OR char_length(${t.email}) BETWEEN 3 AND ${sql.raw(String(RESERVE_EMAIL_MAX))}`),
    check("event_reserve_entries_note_length", sql`${t.note} IS NULL OR char_length(${t.note}) <= ${sql.raw(String(RESERVE_NOTE_MAX))}`),
  ],
);

export type EventReserveEntry = typeof eventReserveEntries.$inferSelect;
