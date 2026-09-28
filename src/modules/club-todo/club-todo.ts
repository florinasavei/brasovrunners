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
  readClubTodoSeenDefaults,
  readClubTodoValue,
  sortClubTodo,
} from "./domain/club-todo";
import { CLUB_TODO_DEFAULT_IDS, mergeClubTodoDefaults, startingClubTodo } from "./domain/starting-list";

/**
 * «De făcut» (§438): the `clubTodo` `platform_settings` row (§100), role asserted here
 * (BR-REQ-060-01), one audit row per write with the line's words (no participant data, §12.12).
 *
 * Concurrency: each write ensures the row exists (`ON CONFLICT DO NOTHING`), locks it `FOR UPDATE`,
 * applies one change and writes back, so two simultaneous presses both land.
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
  // New starting lines (§538) are added on read but stored only by the next write, under the lock.
  const { items } = mergeClubTodoDefaults(readClubTodoValue(row.value), readClubTodoSeenDefaults(row.value));
  return { items: sortClubTodo(items), stored: true, updatedAt: row.updatedAt };
}

/** What a form posts; the service validates, the action only reads fields. */
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
 * One change by one staff member: FORBIDDEN, VALIDATION_ERROR (naming the box) or NOT_FOUND (a line
 * just deleted). A no-op press audits nothing (§377's rule), but the first write still stores the row.
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
      .values({
        key: CLUB_TODO_SETTING_KEY,
        value: { items: startingClubTodo(), seenDefaults: [...CLUB_TODO_DEFAULT_IDS] },
        updatedAt: now,
        updatedByStaffUserId: actor.id,
      })
      .onConflictDoNothing({ target: platformSettings.key });
    const [row] = await tx
      .select()
      .from(platformSettings)
      .where(eq(platformSettings.key, CLUB_TODO_SETTING_KEY))
      .for("update");
    const storedSeen = readClubTodoSeenDefaults(row?.value);
    const merge = mergeClubTodoDefaults(readClubTodoValue(row?.value), storedSeen);
    const current = merge.items;
    // A missing starting line or `seenDefaults` marker (§538) is stored even by a no-op press.
    const mergeChanged =
      merge.added.length > 0 || storedSeen === null || merge.seenDefaults.length !== new Set(storedSeen).size;

    let result: ClubTodoResult;
    try {
      result = applyClubTodo(current, op, { now, by: actor.displayName, newId: randomUUID });
    } catch (error) {
      if (error instanceof ClubTodoMissing) throw new DomainError("NOT_FOUND", error.message);
      if (error instanceof ClubTodoFull) throw new DomainError("VALIDATION_ERROR", error.message, ["text"]);
      throw error;
    }
    if (!result.changed && !mergeChanged) return result;

    await tx
      .update(platformSettings)
      .set({ value: { items: result.items, seenDefaults: merge.seenDefaults }, updatedAt: now, updatedByStaffUserId: actor.id })
      .where(eq(platformSettings.key, CLUB_TODO_SETTING_KEY));
    // Audit a person's changes only, not the starting lines.
    if (!result.changed) return result;
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
