import { boolean, check, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { events } from "./events";
import { staffUsers } from "./staff-users";

/** The longest name an elite bib carries (§895): two lines of the bib's largest type still hold it, shrunk, never cut. */
export const ELITE_NAME_MAX = 80;
/** The widest number a bib draws: five digits, as `bib-design-query.ts#bibNumberFromQuery` reads one. */
export const ELITE_NUMBER_MAX = 99_999;

/**
 * «Elită — doar numele pe BIB» (§895; the owner, 2026-11-03, «Listă separată»): the race's elite runners, a
 * name per line, printed as bibs that carry the **name where the number usually is** — the number only when
 * the design ticks «Număr pe BIB-urile de elită» and the line has one.
 *
 * **Not a registration**: no participant, no address, no declaration, no place, no slot in the queue, no state,
 * no email, no count the club or the public is given — the allocator, «Locuri», the kits, the registrations'
 * summary and export, the sponsors' list and the desk never read this table, and the results read only which
 * lines run hors concours (§910, below). The declaration rule stays whole precisely because an elite line is a
 * name to print and nothing else.
 * Beside the registrations list, «Planul locurilor» counts the lines too — among the runners, a kit and a bib each to order — never in the places.
 *
 * Read by whoever reads the registrations (`canReadRegistrations`: the Organizer and above), written by the
 * Administrator (`canManageRegistrations`), asserted in `elite-list.ts`. **Deleted with the event**
 * (`ON DELETE CASCADE`), and three years after the race at the latest, with its registrations
 * (`jobs/retention.ts`, step `event-elite-entries`); the trail names the line's id, never the name.
 *
 * A line's number is one person's: refused when the event already has it on somebody or among the
 * desk's spares, and read as worn by every draw (`bibs.ts#wornNumbers`) so no runner is given it.
 *
 * **Two ticks of the Administrator's per line (§910)**: «Apare în clasament» (`in_results`, ticked by default) —
 * unticked, the result the club typed for this line's number (or, for a line with no number, for its name) is
 * left out of the public results and of everybody's positions (`results/domain/hors-concours.ts`); and «Apare pe
 * site» (`on_site`, unticked by default) — ticked, only with the person's agreement, the name and the number are
 * shown on the event page under «Elitele cursei», while its public list is on (`listPublicEliteEntries`).
 */
export const eventEliteEntries = pgTable(
  "event_elite_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    /** As printed: trimmed, inner spaces collapsed, 1 to `ELITE_NAME_MAX` characters. */
    name: text("name").notNull(),
    /** The number printed under the name when the design asks for it; optional, a positive whole number. */
    bibNumber: integer("bib_number"),
    /** «Apare în clasament» (§910): false, the line's result runs hors concours — out of the public results and of the positions. */
    inResults: boolean("in_results").notNull().default(true),
    /** «Apare pe site» (§910): true, the name (and number) shows under «Elitele cursei» on the event page while its public list is on. */
    onSite: boolean("on_site").notNull().default(false),
    createdByStaffUserId: uuid("created_by_staff_user_id").references(() => staffUsers.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One event's list, in the order the club typed it.
    index("event_elite_entries_event_idx").on(t.eventId),
    check("event_elite_entries_name_length", sql`char_length(${t.name}) BETWEEN 1 AND ${sql.raw(String(ELITE_NAME_MAX))}`),
    check("event_elite_entries_bib_number", sql`${t.bibNumber} IS NULL OR ${t.bibNumber} BETWEEN 1 AND ${sql.raw(String(ELITE_NUMBER_MAX))}`),
  ],
);

export type EventEliteEntry = typeof eventEliteEntries.$inferSelect;
