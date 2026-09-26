import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { platformSettings } from "@/db/schema/platform-settings";
import type { StaffUser } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import { type AuditAction, recordAuditEvent } from "@/modules/audit/repository";
import { DomainError } from "@/shared/errors/domain-error";
import {
  applyClubTodo,
  canEditClubTodo,
  CLUB_TODO_ENTITY_ID,
  CLUB_TODO_SETTING_KEY,
  type ClubTodoItem,
  ClubTodoFull,
  clubTodoInputSchema,
  ClubTodoMissing,
  type ClubTodoOp,
  type ClubTodoResult,
  readClubTodoValue,
} from "./domain/club-todo";
import { startingClubTodo } from "./domain/starting-list";

/**
 * The club's checklist «De făcut» (§438): read by `/admin/tasks`, written one line at a time.
 *
 * `platform_settings` row `clubTodo`, the §100 shape — one row, a strict schema per line, the
 * role asserted here and not only by the hidden form (BR-REQ-060-01), and one audit row per write
 * naming who did it and the line's words (§12.12 allows what somebody typed about the club's own
 * work; nothing here is about a participant).
 *
 * **Two people pressing at once.** Every write runs in one transaction that first makes sure the
 * row exists (the starting list, `ON CONFLICT DO NOTHING`), then reads it `FOR UPDATE`, applies
 * the one change and writes the list back — so a tick by one and an edit by the other both land,
 * in turn, rather than the second overwriting the first with the list it read before.
 */

export type ClubTodoState = {
  items: ClubTodoItem[];
  /** False while nobody has changed the starting list — nothing is stored yet. */
  stored: boolean;
  updatedAt: Date | null;
};

export async function readClubTodo<T extends Record<string, unknown>>(db: Database<T>): Promise<ClubTodoState> {
  const [row] = await db
    .select()
    .from(platformSettings)
    .where(eq(platformSettings.key, CLUB_TODO_SETTING_KEY))
    .limit(1);
  if (!row) return { items: startingClubTodo(), stored: false, updatedAt: null };
  return { items: readClubTodoValue(row.value), stored: true, updatedAt: row.updatedAt };
}

/** What a form posts, before it is an operation: the service validates, the action only reads fields. */
export type ClubTodoRequest =
  | { kind: "add"; text: unknown; owner: unknown; due: unknown }
  | { kind: "edit"; id: string; text: unknown; owner: unknown; due: unknown }
  | { kind: "setDone"; id: string; done: boolean }
  | { kind: "move"; id: string; direction: "up" | "down"; owner?: string }
  | { kind: "delete"; id: string };

function inputOf(request: { text: unknown; owner: unknown; due: unknown }) {
  const parsed = clubTodoInputSchema.safeParse({
    text: typeof request.text === "string" ? request.text : "",
    owner: typeof request.owner === "string" ? request.owner : "",
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

function opOf(request: ClubTodoRequest): ClubTodoOp {
  switch (request.kind) {
    case "add":
      return { kind: "add", input: inputOf(request) };
    case "edit":
      return { kind: "edit", id: request.id, input: inputOf(request) };
    default:
      return request;
  }
}

const AUDIT_ACTION: Record<ClubTodoOp["kind"], (done?: boolean) => AuditAction> = {
  add: () => "club_todo.added",
  edit: () => "club_todo.edited",
  setDone: (done) => (done ? "club_todo.done" : "club_todo.reopened"),
  move: () => "club_todo.moved",
  delete: () => "club_todo.deleted",
};

/** The audit row's shape: the line's id and words, and what the operation changed about it. */
function auditMetadata(op: ClubTodoOp, result: ClubTodoResult): Record<string, unknown> {
  const { item } = result;
  const base = { itemId: item.id, text: item.text, owner: item.owner };
  switch (op.kind) {
    case "add":
      return { ...base, due: item.due };
    case "edit": {
      const before = result.before ?? item;
      return {
        ...base,
        from: { text: before.text, owner: before.owner, due: before.due },
        to: { text: item.text, owner: item.owner, due: item.due },
      };
    }
    case "move":
      return { ...base, direction: op.direction };
    default:
      return base;
  }
}

/**
 * One change to the list, by one staff member. Refuses a role that may only read it (FORBIDDEN),
 * a line typed wrong (VALIDATION_ERROR, naming the box), and a line a colleague has just deleted
 * (NOT_FOUND). A change that changes nothing — a tick on a ticked line, a move at the end —
 * records nothing: the trail records changes, not presses (§377's rule). The first write of any
 * kind still stores the starting list under the row's lock (`onConflictDoNothing`), whether or
 * not that particular press changed anything, so later reads and writes find a row to lock.
 */
export async function changeClubTodo<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Pick<StaffUser, "id" | "role" | "displayName">,
  request: ClubTodoRequest,
  now: Date,
): Promise<ClubTodoResult> {
  if (!canEditClubTodo(actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${actor.role} may read the club's list but not change it`);
  }
  const op = opOf(request);

  return db.transaction(async (tx) => {
    await tx
      .insert(platformSettings)
      .values({ key: CLUB_TODO_SETTING_KEY, value: { items: startingClubTodo() }, updatedAt: now, updatedByStaffUserId: actor.id })
      .onConflictDoNothing({ target: platformSettings.key });
    const [row] = await tx
      .select()
      .from(platformSettings)
      .where(eq(platformSettings.key, CLUB_TODO_SETTING_KEY))
      .for("update");
    const current = readClubTodoValue(row?.value);

    let result: ClubTodoResult;
    try {
      result = applyClubTodo(current, op, { now, by: actor.displayName, newId: randomUUID });
    } catch (error) {
      if (error instanceof ClubTodoMissing) throw new DomainError("NOT_FOUND", error.message);
      if (error instanceof ClubTodoFull) throw new DomainError("VALIDATION_ERROR", error.message, ["text"]);
      throw error;
    }
    if (!result.changed) return result;

    await tx
      .update(platformSettings)
      .set({ value: { items: result.items }, updatedAt: now, updatedByStaffUserId: actor.id })
      .where(eq(platformSettings.key, CLUB_TODO_SETTING_KEY));
    await recordAuditEvent(tx, {
      actorStaffUserId: actor.id,
      action: AUDIT_ACTION[op.kind](op.kind === "setDone" ? op.done : undefined),
      entityType: "platform_setting",
      entityId: CLUB_TODO_ENTITY_ID,
      metadata: auditMetadata(op, result),
      now,
    });
    return result;
  });
}
