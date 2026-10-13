import { aliasedTable, and, asc, count, eq, inArray, isNull } from "drizzle-orm";
import { eventTodos } from "@/db/schema/event-todos";
import { events } from "@/db/schema/events";
import { staffUsers } from "@/db/schema/staff-users";
import type { StaffUser } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import { type AuditAction, recordAuditEvent } from "@/modules/audit/repository";
import { isBackofficeRole } from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";
import { canEditEventTodos, type EventTodoInput, eventTodoInputSchema, type EventTodoPriority } from "./domain/event-todo";

/**
 * An event's own to-dos (§NNN): read by the editor's «De făcut pentru pagina evenimentului» card,
 * written one line at a time. The role is asserted here and not only by the hidden buttons
 * (BR-REQ-060-01); every change that changes something writes one audit row naming who did it and
 * the line's words — §12.12 allows what somebody typed about the club's own work, and nothing here
 * is about a participant.
 *
 * **A to-do belongs to one date.** `event_id` is the date's own id: a weekly series' dates each
 * have their own list, and neither a repeat nor a duplicate copies a line.
 */

/** One typed line, with the names the card draws (a staff member removed since reads as nobody). */
export type EventTodoItem = {
  id: string;
  eventId: string;
  text: string;
  priority: EventTodoPriority;
  assigneeStaffUserId: string | null;
  assigneeName: string | null;
  /** A `YYYY-MM-DD` day, or null. */
  dueOn: string | null;
  doneAt: Date | null;
  doneByName: string | null;
  createdAt: Date;
};

/** An event's typed lines, oldest first (the card sorts them with the computed rows). */
export async function listEventTodos<T extends Record<string, unknown>>(db: Database<T>, eventId: string): Promise<EventTodoItem[]> {
  const assignee = aliasedTable(staffUsers, "assignee");
  const doneBy = aliasedTable(staffUsers, "done_by");
  const rows = await db
    .select({
      row: eventTodos,
      assigneeName: assignee.displayName,
      doneByName: doneBy.displayName,
    })
    .from(eventTodos)
    .leftJoin(assignee, eq(assignee.id, eventTodos.assigneeStaffUserId))
    .leftJoin(doneBy, eq(doneBy.id, eventTodos.doneByStaffUserId))
    .where(eq(eventTodos.eventId, eventId))
    .orderBy(asc(eventTodos.createdAt), asc(eventTodos.id));
  return rows.map(({ row, assigneeName, doneByName }) => ({
    id: row.id,
    eventId: row.eventId,
    text: row.text,
    priority: row.priority,
    assigneeStaffUserId: row.assigneeStaffUserId,
    assigneeName,
    dueOn: row.dueOn,
    doneAt: row.doneAt,
    doneByName,
    createdAt: row.createdAt,
  }));
}

/** How many typed lines are still open, per event, for the events list's chip — one grouped query. */
export async function countOpenEventTodos<T extends Record<string, unknown>>(
  db: Database<T>,
  eventIds: readonly string[],
): Promise<Map<string, number>> {
  if (eventIds.length === 0) return new Map();
  const rows = await db
    .select({ eventId: eventTodos.eventId, open: count() })
    .from(eventTodos)
    .where(and(inArray(eventTodos.eventId, [...eventIds]), isNull(eventTodos.doneAt)))
    .groupBy(eventTodos.eventId);
  return new Map(rows.map((row) => [row.eventId, row.open]));
}

/** What a form posts, before it is an operation: this service validates, the action only reads fields. */
export type EventTodoRequest =
  | { kind: "add"; eventId: string; text: unknown; priority: unknown; assignee: unknown; due: unknown }
  | { kind: "edit"; eventId: string; id: string; text: unknown; priority: unknown; assignee: unknown; due: unknown }
  | { kind: "setDone"; eventId: string; id: string; done: boolean }
  | { kind: "delete"; eventId: string; id: string };

export type EventTodoResult = { changed: boolean; item: { id: string; text: string } };

function inputOf(request: { text: unknown; priority: unknown; assignee: unknown; due: unknown }): EventTodoInput {
  const parsed = eventTodoInputSchema.safeParse({
    text: typeof request.text === "string" ? request.text : "",
    priority: typeof request.priority === "string" ? request.priority : "",
    assignee: typeof request.assignee === "string" ? request.assignee : "",
    due: typeof request.due === "string" ? request.due : "",
  });
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((issue) => String(issue.path[0] ?? "")))];
    throw new DomainError(
      "VALIDATION_ERROR",
      parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
      fields,
    );
  }
  return parsed.data;
}

/** Who may be given a line: somebody with a backoffice account — a member of the club's zone has no screen to read it on. */
async function assertAssignable<T extends Record<string, unknown>>(db: Database<T>, staffUserId: string | null): Promise<void> {
  if (staffUserId === null) return;
  const [person] = await db.select({ role: staffUsers.role }).from(staffUsers).where(eq(staffUsers.id, staffUserId)).limit(1);
  if (!person || !isBackofficeRole(person.role)) {
    throw new DomainError("VALIDATION_ERROR", "the person a to-do is given to must be a backoffice account", ["assignee"]);
  }
}

/**
 * One change to one event's list, by one staff member. Refuses a role that may only read it
 * (FORBIDDEN), a line typed wrong (VALIDATION_ERROR, naming the box), a person who is no staff
 * account (VALIDATION_ERROR, `assignee`), and an event or a line that is not there — or a line of
 * another event (NOT_FOUND). A press that changes nothing — a tick on a ticked line, a save of
 * unchanged words — writes nothing and records nothing: the trail records changes, not presses.
 */
export async function changeEventTodo<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Pick<StaffUser, "id" | "role">,
  request: EventTodoRequest,
  now: Date,
): Promise<EventTodoResult> {
  if (!canEditEventTodos(actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${actor.role} may read an event's to-dos but not change them`);
  }
  const input = request.kind === "add" || request.kind === "edit" ? inputOf(request) : null;

  return db.transaction(async (tx) => {
    const [event] = await tx.select({ id: events.id }).from(events).where(eq(events.id, request.eventId)).limit(1);
    if (!event) throw new DomainError("NOT_FOUND", "the event is not there");
    if (input) await assertAssignable(tx, input.assignee);

    const audit = (action: AuditAction, metadata: Record<string, unknown>) =>
      recordAuditEvent(tx, { actorStaffUserId: actor.id, action, entityType: "event", entityId: request.eventId, metadata, now });

    if (request.kind === "add" && input) {
      const [row] = await tx
        .insert(eventTodos)
        .values({
          eventId: request.eventId,
          text: input.text,
          priority: input.priority,
          assigneeStaffUserId: input.assignee,
          dueOn: input.due,
          createdByStaffUserId: actor.id,
          createdAt: now,
        })
        .returning({ id: eventTodos.id });
      await audit("event_todo.added", { itemId: row.id, text: input.text, priority: input.priority, assignee: input.assignee, due: input.due });
      return { changed: true, item: { id: row.id, text: input.text } };
    }

    // Every other verb is about one line of this event, locked for the change.
    const itemId = request.kind === "add" ? "" : request.id;
    const [current] = await tx
      .select()
      .from(eventTodos)
      .where(and(eq(eventTodos.id, itemId), eq(eventTodos.eventId, request.eventId)))
      .for("update");
    if (!current) throw new DomainError("NOT_FOUND", "the to-do is not there");
    const item = { id: current.id, text: current.text };

    if (request.kind === "delete") {
      await tx.delete(eventTodos).where(eq(eventTodos.id, current.id));
      await audit("event_todo.deleted", { itemId: current.id, text: current.text, priority: current.priority });
      return { changed: true, item };
    }

    if (request.kind === "setDone") {
      if ((current.doneAt !== null) === request.done) return { changed: false, item };
      await tx
        .update(eventTodos)
        .set(request.done ? { doneAt: now, doneByStaffUserId: actor.id } : { doneAt: null, doneByStaffUserId: null })
        .where(eq(eventTodos.id, current.id));
      await audit(request.done ? "event_todo.done" : "event_todo.reopened", { itemId: current.id, text: current.text });
      return { changed: true, item };
    }

    // «Salvează» on a line: its words, priority, who takes it and the day.
    if (!input) throw new DomainError("VALIDATION_ERROR", "nothing to save");
    const before = { text: current.text, priority: current.priority, assignee: current.assigneeStaffUserId, due: current.dueOn };
    const after = { text: input.text, priority: input.priority, assignee: input.assignee, due: input.due };
    if (JSON.stringify(before) === JSON.stringify(after)) return { changed: false, item };
    await tx
      .update(eventTodos)
      .set({ text: input.text, priority: input.priority, assigneeStaffUserId: input.assignee, dueOn: input.due })
      .where(eq(eventTodos.id, current.id));
    await audit("event_todo.edited", { itemId: current.id, from: before, to: after });
    return { changed: true, item: { id: current.id, text: input.text } };
  });
}
