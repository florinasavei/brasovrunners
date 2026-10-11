import { and, asc, eq, sql } from "drizzle-orm";
import type { StaffUser } from "@/db/schema/staff-users";
import { type TeamPageBox, teamPageBoxes } from "@/db/schema/team";
import type { Database } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit/repository";
import { revalidatePublicContent } from "@/modules/public-cache/cache";
import { canEditTeamPage, canShowTeamMember } from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";
import { isUuid } from "@/shared/ids";
import { type TeamBoxFields, teamBoxFieldsSchema } from "./fields";

/**
 * «Casetele paginii» (§691): the titled texts under the chart of «Echipa» — add, write, move,
 * show or hide, delete. §459's two gates, reused rather than a rule of their own: writing a box is
 * `canEditTeamPage` (the Redactor's and the Administrator's, like a card's words); showing one,
 * hiding one and deleting one that is on the site is `canShowTeamMember` (the Administrator's, the
 * threshold of public view, §201). Every write audits the box by id and the actor, never its words
 * (§12.12), against its loaded `version` (AGENTS.md §11.5), and expires the `pages` cache (§333).
 */

type Actor = Pick<StaffUser, "id" | "role">;

function parseOrThrow(value: unknown): TeamBoxFields {
  const parsed = teamBoxFieldsSchema.safeParse(value);
  if (!parsed.success) {
    throw new DomainError(
      "VALIDATION_ERROR",
      parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
      [...new Set(parsed.error.issues.map((issue) => issue.path.join(".")))],
    );
  }
  return parsed.data;
}

function assertMayEdit(actor: Actor): void {
  if (!canEditTeamPage(actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${actor.role} may not edit the team page`);
  }
}

/** A posted id that is not a uuid names no box, and never reaches a uuid column (§376): 404, not 500. */
function assertBoxId(boxId: string): void {
  if (!isUuid(boxId)) throw new DomainError("NOT_FOUND", "no such box");
}

async function refuseStale<T extends Record<string, unknown>>(db: Database<T>, boxId: string, expected: number): Promise<never> {
  const [current] = await db.select({ version: teamPageBoxes.version }).from(teamPageBoxes).where(eq(teamPageBoxes.id, boxId)).limit(1);
  if (!current) throw new DomainError("NOT_FOUND", "no such box");
  throw new DomainError("CONFLICT", `this box was saved by someone else: you loaded version ${expected}, the current version is ${current.version}`);
}

/** Add a box at the end of the list, hidden until an Administrator shows it. */
export async function createTeamBox<T extends Record<string, unknown>>(
  db: Database<T>,
  input: { actor: Actor; fields: unknown; now?: Date },
): Promise<TeamPageBox> {
  assertMayEdit(input.actor);
  const fields = parseOrThrow(input.fields);
  const now = input.now ?? new Date();
  const created = await db.transaction(async (tx) => {
    const [last] = await tx.select({ position: sql<number>`coalesce(max(${teamPageBoxes.position}), 0)`.mapWith(Number) }).from(teamPageBoxes);
    const [row] = await tx
      .insert(teamPageBoxes)
      .values({
        ...fields,
        position: (last?.position ?? 0) + 1,
        visible: false,
        createdByStaffUserId: input.actor.id,
        updatedByStaffUserId: input.actor.id,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    await recordAuditEvent(tx, {
      actorStaffUserId: input.actor.id,
      action: "team.box.created",
      entityType: "team_page_box",
      entityId: row.id,
      metadata: { written: fields.bodyRoJson !== null },
      now,
    });
    return row;
  });
  revalidatePublicContent("pages");
  return created;
}

/** Save a box's title and text against its loaded version; CONFLICT otherwise. The Redactor may write a shown one, as a card (§103). */
export async function saveTeamBox<T extends Record<string, unknown>>(
  db: Database<T>,
  input: { actor: Actor; boxId: string; expectedVersion: number; fields: unknown; now?: Date },
): Promise<TeamPageBox> {
  assertMayEdit(input.actor);
  assertBoxId(input.boxId);
  const fields = parseOrThrow(input.fields);
  const now = input.now ?? new Date();
  const row = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(teamPageBoxes)
      .set({ ...fields, updatedByStaffUserId: input.actor.id, version: input.expectedVersion + 1, updatedAt: now })
      .where(and(eq(teamPageBoxes.id, input.boxId), eq(teamPageBoxes.version, input.expectedVersion)))
      .returning();
    if (!updated) return undefined;
    await recordAuditEvent(tx, {
      actorStaffUserId: input.actor.id,
      action: "team.box.saved",
      entityType: "team_page_box",
      entityId: updated.id,
      metadata: { version: updated.version, written: fields.bodyRoJson !== null },
      now,
    });
    return updated;
  });
  if (!row) return refuseStale(db, input.boxId, input.expectedVersion);
  revalidatePublicContent("pages");
  return row;
}

/** Move a box one place up or down, renumbering the whole list (as a card is moved). */
export async function moveTeamBox<T extends Record<string, unknown>>(
  db: Database<T>,
  input: { actor: Actor; boxId: string; direction: "up" | "down"; now?: Date },
): Promise<void> {
  assertMayEdit(input.actor);
  assertBoxId(input.boxId);
  const now = input.now ?? new Date();
  await db.transaction(async (tx) => {
    const ordered = await tx.select({ id: teamPageBoxes.id }).from(teamPageBoxes).orderBy(asc(teamPageBoxes.position), asc(teamPageBoxes.createdAt));
    const index = ordered.findIndex((row) => row.id === input.boxId);
    if (index === -1) throw new DomainError("NOT_FOUND", "no such box");
    const target = input.direction === "up" ? index - 1 : index + 1;
    if (target < 0 || target >= ordered.length) return;
    const moved = [...ordered];
    [moved[index], moved[target]] = [moved[target], moved[index]];
    for (const [position, row] of moved.entries()) {
      await tx.update(teamPageBoxes).set({ position: position + 1 }).where(eq(teamPageBoxes.id, row.id));
    }
    await recordAuditEvent(tx, {
      actorStaffUserId: input.actor.id,
      action: "team.box.moved",
      entityType: "team_page_box",
      entityId: input.boxId,
      metadata: { direction: input.direction, position: target + 1 },
      now,
    });
  });
  revalidatePublicContent("pages");
}

/** Show a box on the site, or take it off — the Administrator's (§201). */
export async function setTeamBoxVisible<T extends Record<string, unknown>>(
  db: Database<T>,
  input: { actor: Actor; boxId: string; expectedVersion: number; visible: boolean; now?: Date },
): Promise<TeamPageBox> {
  if (!canShowTeamMember(input.actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${input.actor.role} may not show or hide a box of the team page`);
  }
  assertBoxId(input.boxId);
  const now = input.now ?? new Date();
  const row = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(teamPageBoxes)
      .set({ visible: input.visible, updatedByStaffUserId: input.actor.id, version: input.expectedVersion + 1, updatedAt: now })
      .where(and(eq(teamPageBoxes.id, input.boxId), eq(teamPageBoxes.version, input.expectedVersion)))
      .returning();
    if (!updated) return undefined;
    await recordAuditEvent(tx, {
      actorStaffUserId: input.actor.id,
      action: input.visible ? "team.box.shown" : "team.box.hidden",
      entityType: "team_page_box",
      entityId: updated.id,
      metadata: { visible: input.visible },
      now,
    });
    return updated;
  });
  if (!row) return refuseStale(db, input.boxId, input.expectedVersion);
  revalidatePublicContent("pages");
  return row;
}

/** Delete a box; a shown one is the Administrator's (§201). Its pictures are swept a week after nothing uses them (§73). */
export async function deleteTeamBox<T extends Record<string, unknown>>(
  db: Database<T>,
  input: { actor: Actor; boxId: string; now?: Date },
): Promise<void> {
  assertMayEdit(input.actor);
  assertBoxId(input.boxId);
  const now = input.now ?? new Date();
  const [current] = await db.select({ visible: teamPageBoxes.visible }).from(teamPageBoxes).where(eq(teamPageBoxes.id, input.boxId)).limit(1);
  if (!current) throw new DomainError("NOT_FOUND", "no such box");
  if (current.visible && !canShowTeamMember(input.actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${input.actor.role} may not delete a box that is on the site`);
  }
  // Visibility is re-checked in the delete itself, against a colleague showing it meanwhile.
  const mayRemoveShown = canShowTeamMember(input.actor.role);
  const deleted = await db.transaction(async (tx) => {
    const gone = await tx
      .delete(teamPageBoxes)
      .where(and(eq(teamPageBoxes.id, input.boxId), mayRemoveShown ? undefined : eq(teamPageBoxes.visible, false)))
      .returning({ id: teamPageBoxes.id, visible: teamPageBoxes.visible });
    if (gone.length > 0) {
      await recordAuditEvent(tx, {
        actorStaffUserId: input.actor.id,
        action: "team.box.deleted",
        entityType: "team_page_box",
        entityId: input.boxId,
        metadata: { wasVisible: gone[0]!.visible },
        now,
      });
    }
    return gone;
  });
  if (deleted.length === 0) throw new DomainError("FORBIDDEN", "the box went on the site before it could be deleted");
  revalidatePublicContent("pages");
}
