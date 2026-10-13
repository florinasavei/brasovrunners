import { z } from "zod";
import { canEditClubTodo, canReadClubTodo, isCalendarDay } from "@/modules/club-todo/domain/club-todo";
import type { StaffRole } from "@/modules/staff-identity/domain/roles";

/**
 * An event's own to-dos (§NNN; the owner, 2026-10-13: «aș vrea ca acest tasklist să fie în
 * aplicație, practic eu vreau doar TODOs pt site-ul evenimentului, nu pt tot», «și trebuie să pot
 * seta și un prio») — the pure part: the priorities, what a form may post, who may do what, and
 * the one order the card lists its rows in.
 *
 * The card lists two kinds of row together: what the event's page still lacks, **computed** from
 * the event (`content/events/domain/page-todos.ts`), and the lines the club **typed** (the table
 * `event_todos`). They share a priority scale and one sort — priority, then the due day, then
 * age — so an urgent missing declaration and an urgent line somebody typed stand side by side.
 *
 * Pure and free of the database, so the order and the rules are unit-tested without one;
 * `event-todos.ts` beside this folder is the writer.
 */

/** The four steps, most pressing first: the order the list sorts by (`PRIORITY_RANK`). */
export const EVENT_TODO_PRIORITIES = ["URGENT", "HIGH", "NORMAL", "LOW"] as const;
export type EventTodoPriority = (typeof EVENT_TODO_PRIORITIES)[number];

export const DEFAULT_EVENT_TODO_PRIORITY: EventTodoPriority = "NORMAL";

/** One line: a to-do is a sentence, and the database holds the same bound. */
export const EVENT_TODO_TEXT_MAX = 200;

const PRIORITY_RANK: Record<EventTodoPriority, number> = { URGENT: 0, HIGH: 1, NORMAL: 2, LOW: 3 };

/** Whether a posted value is one of the four; anything else reads as «Normală», never as a refusal of the whole press. */
export function readEventTodoPriority(value: unknown): EventTodoPriority {
  return EVENT_TODO_PRIORITIES.find((priority) => priority === value) ?? DEFAULT_EVENT_TODO_PRIORITY;
}

// ---------------------------------------------------------------------------------------------
// Who may read and who may write (BR-REQ-060-01: asserted by the service, not by a hidden button)
// ---------------------------------------------------------------------------------------------

/**
 * Reading the list: every role that reads the club's content — the Redactor, the Organizer, the
 * Tehnic, the Administrators — the same set that reads the event editor and the club's own
 * checklist «De făcut» (§438). The volunteer never opens the editor.
 */
export function canReadEventTodos(role: StaffRole): boolean {
  return canReadClubTodo(role);
}

/**
 * Writing it — add, edit, tick, assign, delete: the Organizer (who runs the race's preparation),
 * the Administrator and the Superadministrator. The Tehnic and the Redactor read and ask. The
 * same set as the club's checklist (§438), by the same function, so moving that boundary moves
 * this one with it.
 */
export function canEditEventTodos(role: StaffRole): boolean {
  return canEditClubTodo(role);
}

// ---------------------------------------------------------------------------------------------
// What a form posts
// ---------------------------------------------------------------------------------------------

const optionalUuid = z
  .string()
  .transform((value) => value.trim())
  .refine((value) => value === "" || z.uuid().safeParse(value).success)
  .transform((value) => (value === "" ? null : value));

/**
 * The line, its priority, who takes it and the day. A blank «cine» and a blank day are "none"; the
 * line is required and at most `EVENT_TODO_TEXT_MAX` characters, with its whitespace folded. The
 * field names are the form's own `name`s, so a refusal's summary links to the box (§47).
 */
export const eventTodoInputSchema = z.object({
  text: z
    .string()
    .transform((value) => value.trim().replace(/\s+/g, " "))
    .pipe(z.string().min(1).max(EVENT_TODO_TEXT_MAX)),
  priority: z.string().transform(readEventTodoPriority),
  assignee: optionalUuid,
  due: z
    .string()
    .transform((value) => value.trim())
    .refine((value) => value === "" || isCalendarDay(value))
    .transform((value) => (value === "" ? null : value)),
});

export type EventTodoInput = z.infer<typeof eventTodoInputSchema>;

// ---------------------------------------------------------------------------------------------
// The one list
// ---------------------------------------------------------------------------------------------

/**
 * What the sort needs of a row of either kind. `dueOn` is a `YYYY-MM-DD` day or null; `createdAt`
 * an ISO instant, or null for a row computed from the event — which has no age, and is the
 * oldest thing on the list by definition (the page has lacked it since it was made), so it goes
 * before a typed row of the same priority and day.
 */
export type SortableTodo = {
  priority: EventTodoPriority;
  dueOn: string | null;
  createdAt: string | null;
  /** A last tiebreak, so the order is total and a re-render never shuffles two equal rows. */
  key: string;
};

/**
 * Priority first (urgent before low), then the due day (the earlier first, a row with no day
 * after every row with one), then age (the older first). One comparator for the whole card.
 */
export function compareTodos(a: SortableTodo, b: SortableTodo): number {
  return (
    PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
    (a.dueOn ?? "9999-99-99").localeCompare(b.dueOn ?? "9999-99-99") ||
    (a.createdAt ?? "").localeCompare(b.createdAt ?? "") ||
    a.key.localeCompare(b.key)
  );
}

/** The rows in the card's order; the input is left alone. */
export function sortTodos<T extends SortableTodo>(rows: readonly T[]): T[] {
  return [...rows].sort(compareTodos);
}

/** A calendar day is overdue when it is before today; a ticked row is never overdue. Both `YYYY-MM-DD`. */
export function isTodoOverdue(row: { dueOn: string | null; done: boolean }, today: string): boolean {
  return !row.done && row.dueOn !== null && row.dueOn < today;
}
