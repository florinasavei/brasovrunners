import { sql } from "drizzle-orm";
import { check, date, index, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { events } from "./events";
import { staffUsers } from "./staff-users";

/**
 * How soon an event's own to-do is wanted (§NNN): four steps, in the order the list sorts them.
 * A closed set at the database, like every other state here — «Urgentă», «Mare», «Normală»,
 * «Mică» in the backoffice's words; a fifth is a migration.
 */
export const eventTodoPriority = pgEnum("event_todo_priority", ["URGENT", "HIGH", "NORMAL", "LOW"]);

/**
 * The club's own to-dos for one event's page (§NNN; the owner, 2026-10-13: «aș vrea ca acest
 * tasklist să fie în aplicație, practic eu vreau doar TODOs pt site-ul evenimentului, nu pt tot»,
 * and «și trebuie să pot seta și un prio»).
 *
 * One row is one line the club typed on one event's «De făcut pentru pagina evenimentului» card —
 * backoffice-only and one language, so a plain `text` and no translation table. **A to-do belongs
 * to one date**: a weekly series' dates are separate events and each has its own list; nothing here
 * is copied by a repeat or a duplicate. The rows go with the event (`ON DELETE CASCADE`); a staff
 * account that is removed leaves the row, which then names nobody (`SET NULL`), like every
 * "who did it" column in the schema.
 *
 * What the page still lacks is NOT stored here: it is computed from the event on every read
 * (`content/events/domain/page-todos.ts`) and disappears the moment the field is filled.
 */
export const eventTodos = pgTable(
  "event_todos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    /** One line, at most 200 characters (`EVENT_TODO_TEXT_MAX`); checked at the database too. */
    text: text("text").notNull(),
    priority: eventTodoPriority("priority").notNull().default("NORMAL"),
    /** Who takes it: a staff member, or nobody yet. */
    assigneeStaffUserId: uuid("assignee_staff_user_id").references(() => staffUsers.id, { onDelete: "set null" }),
    /** A calendar day with no time and no zone: «până pe». */
    dueOn: date("due_on", { mode: "string" }),
    /** Set together with `done_by` by the tick, cleared by the untick. */
    doneAt: timestamp("done_at", { withTimezone: true }),
    doneByStaffUserId: uuid("done_by_staff_user_id").references(() => staffUsers.id, { onDelete: "set null" }),
    createdByStaffUserId: uuid("created_by_staff_user_id").references(() => staffUsers.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // "This event's list", the only question the editor asks of the table.
    index("event_todos_event_idx").on(t.eventId),
    check("event_todos_text_length", sql`char_length(${t.text}) BETWEEN 1 AND 200`),
  ],
);

export type EventTodoRow = typeof eventTodos.$inferSelect;
