import { and, asc, eq, sql } from "drizzle-orm";
import { type MemberDiscountCode, memberDiscountCodes } from "@/db/schema/member-discount-codes";
import type { StaffUser } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit/repository";
import { canEditDiscountCodeWords, canManageDiscountCodes } from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";
import { isUuid } from "@/shared/ids";
import { existingTierIdsShared } from "@/modules/content/member-tiers/repository";
import { type DiscountCodeFields, discountCodeFieldsSchema } from "./fields";

/**
 * The members' discount codes (§552): add, write, hide or show, move, delete. Every write is asserted
 * here, on the server, whatever the screen offered (BR-REQ-060-01):
 *
 * - adding, the code, its link and its last day, hiding, moving and deleting — `canManageDiscountCodes`,
 *   the Administrator's and the Superadministrator's (§450);
 * - the words around a code — the partner's name and the description — `canEditDiscountCodeWords`,
 *   the Redactor's too, the rule of the Membri texts (§524): a Redactor's save writes those three and
 *   keeps everything else as it was, whatever was posted.
 *
 * Every write leaves an `audit_logs` row in its own transaction, naming the code by id and the staff
 * member who acted — never the code or the partner (§12.12). The limit to some member tiers (§811) is
 * the code's own, so an Administrator's: a Redactor's save keeps it as stored. Nothing here expires the public cache:
 * the codes are on no public page (`repository.ts`).
 */

type Actor = Pick<StaffUser, "id" | "role">;

function parseOrThrow(value: unknown): DiscountCodeFields {
  const parsed = discountCodeFieldsSchema.safeParse(value);
  if (!parsed.success) {
    throw new DomainError(
      "VALIDATION_ERROR",
      parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
      // The boxes' own names, so the refusal summary lands on them.
      [...new Set(parsed.error.issues.map((issue) => issue.path.join(".")))],
    );
  }
  return parsed.data;
}

/** A posted id that is not a uuid names no code, and never reaches a uuid column (§376): 404, not 500. */
function assertCodeId(codeId: string): void {
  if (!isUuid(codeId)) throw new DomainError("NOT_FOUND", "no such discount code");
}

function assertMayManage(actor: Actor): void {
  if (!canManageDiscountCodes(actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${actor.role} may not manage the members' discount codes`);
  }
}

/**
 * Every id of the limit names a member tier (§811), read under a share lock so a tier cannot be deleted
 * between this check and the write (`member-tiers/service.ts#deleteMemberTier` locks the tier first). An id
 * that names none is a refusal on the chips' box, `tierIds`.
 */
async function assertTiersExist<T extends Record<string, unknown>>(db: Database<T>, ids: readonly string[]): Promise<void> {
  const known = await existingTierIdsShared(db, ids);
  if (ids.some((id) => !known.has(id))) throw new DomainError("VALIDATION_ERROR", "a limit names a member tier that does not exist", ["tierIds"]);
}

/**
 * The limit as stored: «Toți membrii» is `null`, every member (§811, amended — the meaning of the column did not change, so every
 * code saved before the choice was explicit reads as «Toți membrii»); levels are their ids. The fields' schema has already refused
 * a post that chose neither or both, so `forAll` and an empty list are the same fact here.
 */
const storedTierIds = (fields: Pick<DiscountCodeFields, "forAll" | "tierIds">): string[] | null => (fields.forAll || fields.tierIds.length === 0 ? null : [...fields.tierIds]);

/** The choice a stored code stands for, in the shape the fields' schema reads: no limit is «Toți membrii», else its levels. */
const choiceOf = (stored: readonly string[] | null) => ({ tierIds: stored ?? [], forAll: stored === null || stored.length === 0 });

/** Add a code at the end of the list. Shown at once: the members' zone is not public. */
export async function createDiscountCode<T extends Record<string, unknown>>(
  db: Database<T>,
  input: { actor: Actor; fields: unknown; now?: Date },
): Promise<MemberDiscountCode> {
  assertMayManage(input.actor);
  const fields = parseOrThrow(input.fields);
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    await assertTiersExist(tx, fields.tierIds);
    const [last] = await tx
      .select({ position: sql<number>`coalesce(max(${memberDiscountCodes.position}), 0)`.mapWith(Number) })
      .from(memberDiscountCodes);
    const [row] = await tx
      .insert(memberDiscountCodes)
      .values({
        partnerName: fields.partnerName,
        code: fields.code,
        descriptionRo: fields.descriptionRo,
        descriptionEn: fields.descriptionEn,
        link: fields.link,
        validUntil: fields.validUntil,
        tierIds: storedTierIds(fields),
        position: (last?.position ?? 0) + 1,
        hidden: false,
        createdByStaffUserId: input.actor.id,
        updatedByStaffUserId: input.actor.id,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    await recordAuditEvent(tx, {
      actorStaffUserId: input.actor.id,
      action: "member_code.created",
      entityType: "member_discount_code",
      entityId: row.id,
      metadata: { link: fields.link !== null, validUntil: fields.validUntil !== null, tiers: fields.tierIds.length },
      now,
    });
    return row;
  });
}

/**
 * Save a code against the version it was loaded with: a colleague's save in between is a CONFLICT,
 * never an overwrite (AGENTS.md §11.5). A Redactor writes the words alone (the partner, the two
 * descriptions); the code, its link and its day stay as stored.
 */
export async function saveDiscountCode<T extends Record<string, unknown>>(
  db: Database<T>,
  input: { actor: Actor; codeId: string; expectedVersion: number; fields: unknown; now?: Date },
): Promise<MemberDiscountCode> {
  if (!canEditDiscountCodeWords(input.actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${input.actor.role} may not write the members' discount codes`);
  }
  assertCodeId(input.codeId);
  const manage = canManageDiscountCodes(input.actor.role);
  const now = input.now ?? new Date();
  const [current] = await db.select().from(memberDiscountCodes).where(eq(memberDiscountCodes.id, input.codeId)).limit(1);
  if (!current) throw new DomainError("NOT_FOUND", "no such discount code");
  // The words alone, for a role that may not touch the code: the stored code, link and day stand in
  // for whatever was posted, so the same schema checks what the Redactor did write.
  const posted = (input.fields ?? {}) as Record<string, unknown>;
  const fields = parseOrThrow(
    manage
      ? // A caller that posts no choice at all (a script, a test) keeps the one stored; the form always posts one — levels or «Toți membrii».
        posted.tierIds === undefined && posted.forAll === undefined
        ? { ...posted, ...choiceOf(current.tierIds) }
        : posted
      : { ...posted, code: current.code, link: current.link ?? "", validUntil: current.validUntil ?? "", ...choiceOf(current.tierIds) },
  );
  const row = await db.transaction(async (tx) => {
    if (manage) await assertTiersExist(tx, fields.tierIds);
    const [updated] = await tx
      .update(memberDiscountCodes)
      .set({
        partnerName: fields.partnerName,
        descriptionRo: fields.descriptionRo,
        descriptionEn: fields.descriptionEn,
        ...(manage ? { code: fields.code, link: fields.link, validUntil: fields.validUntil, tierIds: storedTierIds(fields) } : {}),
        updatedByStaffUserId: input.actor.id,
        version: input.expectedVersion + 1,
        updatedAt: now,
      })
      .where(and(eq(memberDiscountCodes.id, input.codeId), eq(memberDiscountCodes.version, input.expectedVersion)))
      .returning();
    if (!updated) return undefined;
    await recordAuditEvent(tx, {
      actorStaffUserId: input.actor.id,
      action: "member_code.saved",
      entityType: "member_discount_code",
      entityId: updated.id,
      metadata: { version: updated.version, wordsOnly: !manage, ...(manage ? { tiers: fields.tierIds.length } : {}) },
      now,
    });
    return updated;
  });
  if (!row) return refuseStale(db, input.codeId, input.expectedVersion);
  return row;
}

async function refuseStale<T extends Record<string, unknown>>(db: Database<T>, codeId: string, expected: number): Promise<never> {
  const [current] = await db.select({ version: memberDiscountCodes.version }).from(memberDiscountCodes).where(eq(memberDiscountCodes.id, codeId)).limit(1);
  if (!current) throw new DomainError("NOT_FOUND", "no such discount code");
  throw new DomainError(
    "CONFLICT",
    `this code was saved by someone else: you loaded version ${expected}, the current version is ${current.version}`,
  );
}

/** Stop showing a code to the members, or show it again — kept either way. */
export async function setDiscountCodeHidden<T extends Record<string, unknown>>(
  db: Database<T>,
  input: { actor: Actor; codeId: string; expectedVersion: number; hidden: boolean; now?: Date },
): Promise<MemberDiscountCode> {
  assertMayManage(input.actor);
  assertCodeId(input.codeId);
  const now = input.now ?? new Date();
  const row = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(memberDiscountCodes)
      .set({ hidden: input.hidden, updatedByStaffUserId: input.actor.id, version: input.expectedVersion + 1, updatedAt: now })
      .where(and(eq(memberDiscountCodes.id, input.codeId), eq(memberDiscountCodes.version, input.expectedVersion)))
      .returning();
    if (!updated) return undefined;
    await recordAuditEvent(tx, {
      actorStaffUserId: input.actor.id,
      action: input.hidden ? "member_code.hidden" : "member_code.shown",
      entityType: "member_discount_code",
      entityId: updated.id,
      metadata: { hidden: input.hidden },
      now,
    });
    return updated;
  });
  if (!row) return refuseStale(db, input.codeId, input.expectedVersion);
  return row;
}

/**
 * One place up or down. The whole list is renumbered from the order on screen, as «Echipa»'s cards
 * are (`moveTeamMember`): duplicates and gaps heal, and a replayed press at an end does nothing.
 */
export async function moveDiscountCode<T extends Record<string, unknown>>(
  db: Database<T>,
  input: { actor: Actor; codeId: string; direction: "up" | "down"; now?: Date },
): Promise<void> {
  assertMayManage(input.actor);
  assertCodeId(input.codeId);
  const now = input.now ?? new Date();
  await db.transaction(async (tx) => {
    const ordered = await tx
      .select({ id: memberDiscountCodes.id })
      .from(memberDiscountCodes)
      .orderBy(asc(memberDiscountCodes.position), asc(memberDiscountCodes.createdAt));
    const index = ordered.findIndex((row) => row.id === input.codeId);
    if (index === -1) throw new DomainError("NOT_FOUND", "no such discount code");
    const target = input.direction === "up" ? index - 1 : index + 1;
    if (target < 0 || target >= ordered.length) return;
    const moved = [...ordered];
    [moved[index], moved[target]] = [moved[target], moved[index]];
    for (const [position, row] of moved.entries()) {
      await tx.update(memberDiscountCodes).set({ position: position + 1 }).where(eq(memberDiscountCodes.id, row.id));
    }
    await recordAuditEvent(tx, {
      actorStaffUserId: input.actor.id,
      action: "member_code.moved",
      entityType: "member_discount_code",
      entityId: input.codeId,
      metadata: { direction: input.direction, position: target + 1 },
      now,
    });
  });
}

/** Delete a code for good. The audit row outlives it, with the id and nothing of the code. */
export async function deleteDiscountCode<T extends Record<string, unknown>>(
  db: Database<T>,
  input: { actor: Actor; codeId: string; now?: Date },
): Promise<void> {
  assertMayManage(input.actor);
  assertCodeId(input.codeId);
  const now = input.now ?? new Date();
  const gone = await db.transaction(async (tx) => {
    const deleted = await tx
      .delete(memberDiscountCodes)
      .where(eq(memberDiscountCodes.id, input.codeId))
      .returning({ id: memberDiscountCodes.id, hidden: memberDiscountCodes.hidden });
    if (deleted.length > 0) {
      await recordAuditEvent(tx, {
        actorStaffUserId: input.actor.id,
        action: "member_code.deleted",
        entityType: "member_discount_code",
        entityId: input.codeId,
        metadata: { wasHidden: deleted[0]!.hidden },
        now,
      });
    }
    return deleted;
  });
  if (gone.length === 0) throw new DomainError("NOT_FOUND", "no such discount code");
}
