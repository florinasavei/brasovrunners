import { and, asc, eq, sql } from "drizzle-orm";
import { type FaqItem, faqItems } from "@/db/schema/faq";
import type { StaffUser } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit/repository";
import { revalidatePublicContent } from "@/modules/public-cache/cache";
import { canEditFaqPage, canShowFaqItem } from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";
import { type FaqItemFields, faqItemFieldsSchema } from "./fields";

/**
 * «Întrebări frecvente» — the FAQ page's questions (§NNN): add, write, show or hide, move, delete.
 * «Echipa»'s service (§459) for a question instead of a person, and its two thresholds, asserted
 * here whatever the screen offered (BR-REQ-060-01):
 *
 * - adding, writing, moving, and deleting a question that is not on the site — `canEditFaqPage`,
 *   the Redactor's and the Administrator's, because a question is words;
 * - showing a question, taking it off, and deleting one that is on the site — `canShowFaqItem`,
 *   the Administrator's, the crossing into public view since §201.
 *
 * Every write leaves an `audit_logs` row in its own transaction, naming the question by id and the
 * staff member who acted — never the words (§12.12) — and expires the public cache's `pages` kind
 * (§333), under which the page, its menu entry and its sitemap entry are read.
 */

type Actor = Pick<StaffUser, "id" | "role">;

function parseOrThrow(value: unknown): FaqItemFields {
  const parsed = faqItemFieldsSchema.safeParse(value);
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
  if (!canEditFaqPage(actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${actor.role} may not edit the FAQ page`);
  }
}

/** Add a question at the end of the list, hidden until an Administrator shows it. */
export async function createFaqItem<T extends Record<string, unknown>>(
  db: Database<T>,
  input: { actor: Actor; fields: unknown; now?: Date },
): Promise<FaqItem> {
  assertMayEdit(input.actor);
  const fields = parseOrThrow(input.fields);
  const now = input.now ?? new Date();

  const created = await db.transaction(async (tx) => {
    const [last] = await tx.select({ position: sql<number>`coalesce(max(${faqItems.position}), 0)`.mapWith(Number) }).from(faqItems);
    const [row] = await tx
      .insert(faqItems)
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
      action: "faq_item.created",
      entityType: "faq_item",
      entityId: row.id,
      metadata: {},
      now,
    });
    return row;
  });
  revalidatePublicContent("pages");
  return created;
}

/**
 * Save a question and its answer, against the version it was loaded with: a colleague's save in
 * between is a CONFLICT, never an overwrite (AGENTS.md §11.5). Writing a question that is on the
 * site is the Redactor's too, as a page's live text is (§103).
 */
export async function saveFaqItem<T extends Record<string, unknown>>(
  db: Database<T>,
  input: { actor: Actor; itemId: string; expectedVersion: number; fields: unknown; now?: Date },
): Promise<FaqItem> {
  assertMayEdit(input.actor);
  const fields = parseOrThrow(input.fields);
  const now = input.now ?? new Date();

  const row = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(faqItems)
      .set({ ...fields, updatedByStaffUserId: input.actor.id, version: input.expectedVersion + 1, updatedAt: now })
      .where(and(eq(faqItems.id, input.itemId), eq(faqItems.version, input.expectedVersion)))
      .returning();
    if (!updated) return undefined;
    await recordAuditEvent(tx, {
      actorStaffUserId: input.actor.id,
      action: "faq_item.saved",
      entityType: "faq_item",
      entityId: updated.id,
      metadata: { version: updated.version },
      now,
    });
    return updated;
  });
  if (!row) return refuseStale(db, input.itemId, input.expectedVersion);
  revalidatePublicContent("pages");
  return row;
}

async function refuseStale<T extends Record<string, unknown>>(db: Database<T>, itemId: string, expected: number): Promise<never> {
  const [current] = await db.select({ version: faqItems.version }).from(faqItems).where(eq(faqItems.id, itemId)).limit(1);
  if (!current) throw new DomainError("NOT_FOUND", "no such question");
  throw new DomainError(
    "CONFLICT",
    `this question was saved by someone else: you loaded version ${expected}, the current version is ${current.version}`,
  );
}

/** Show a question on the site, or take it off — the Administrator's (§201). */
export async function setFaqItemVisible<T extends Record<string, unknown>>(
  db: Database<T>,
  input: { actor: Actor; itemId: string; expectedVersion: number; visible: boolean; now?: Date },
): Promise<FaqItem> {
  if (!canShowFaqItem(input.actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${input.actor.role} may not show or hide a question`);
  }
  const now = input.now ?? new Date();
  const row = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(faqItems)
      .set({ visible: input.visible, updatedByStaffUserId: input.actor.id, version: input.expectedVersion + 1, updatedAt: now })
      .where(and(eq(faqItems.id, input.itemId), eq(faqItems.version, input.expectedVersion)))
      .returning();
    if (!updated) return undefined;
    await recordAuditEvent(tx, {
      actorStaffUserId: input.actor.id,
      action: input.visible ? "faq_item.shown" : "faq_item.hidden",
      entityType: "faq_item",
      entityId: updated.id,
      metadata: { visible: input.visible },
      now,
    });
    return updated;
  });
  if (!row) return refuseStale(db, input.itemId, input.expectedVersion);
  revalidatePublicContent("pages");
  return row;
}

/**
 * Move a question one place up or down; the whole list is renumbered from the order on screen, as
 * `moveTeamMember` does — duplicates and gaps heal, and a replayed press at an end does nothing.
 */
export async function moveFaqItem<T extends Record<string, unknown>>(
  db: Database<T>,
  input: { actor: Actor; itemId: string; direction: "up" | "down"; now?: Date },
): Promise<void> {
  assertMayEdit(input.actor);
  const now = input.now ?? new Date();
  await db.transaction(async (tx) => {
    const ordered = await tx.select({ id: faqItems.id }).from(faqItems).orderBy(asc(faqItems.position), asc(faqItems.createdAt));
    const index = ordered.findIndex((row) => row.id === input.itemId);
    if (index === -1) throw new DomainError("NOT_FOUND", "no such question");
    const target = input.direction === "up" ? index - 1 : index + 1;
    if (target < 0 || target >= ordered.length) return;
    const moved = [...ordered];
    [moved[index], moved[target]] = [moved[target], moved[index]];
    for (const [position, row] of moved.entries()) {
      await tx.update(faqItems).set({ position: position + 1 }).where(eq(faqItems.id, row.id));
    }
    await recordAuditEvent(tx, {
      actorStaffUserId: input.actor.id,
      action: "faq_item.moved",
      entityType: "faq_item",
      entityId: input.itemId,
      metadata: { direction: input.direction, position: target + 1 },
      now,
    });
  });
  revalidatePublicContent("pages");
}

/**
 * Delete a question. One that is on the site is the Administrator's to remove (§201); a hidden
 * one, whoever may write questions. The visibility is asked again inside the delete, so a question
 * shown a moment ago by a colleague is not taken off the site by somebody who may not.
 */
export async function deleteFaqItem<T extends Record<string, unknown>>(
  db: Database<T>,
  input: { actor: Actor; itemId: string; now?: Date },
): Promise<void> {
  assertMayEdit(input.actor);
  const now = input.now ?? new Date();
  const [current] = await db.select({ visible: faqItems.visible }).from(faqItems).where(eq(faqItems.id, input.itemId)).limit(1);
  if (!current) throw new DomainError("NOT_FOUND", "no such question");
  const mayRemoveShown = canShowFaqItem(input.actor.role);
  if (current.visible && !mayRemoveShown) {
    throw new DomainError("FORBIDDEN", `role ${input.actor.role} may not delete a question that is on the site`);
  }
  const deleted = await db.transaction(async (tx) => {
    const gone = await tx
      .delete(faqItems)
      .where(and(eq(faqItems.id, input.itemId), mayRemoveShown ? undefined : eq(faqItems.visible, false)))
      .returning({ id: faqItems.id, visible: faqItems.visible });
    if (gone.length > 0) {
      await recordAuditEvent(tx, {
        actorStaffUserId: input.actor.id,
        action: "faq_item.deleted",
        entityType: "faq_item",
        entityId: input.itemId,
        metadata: { wasVisible: gone[0]!.visible },
        now,
      });
    }
    return gone;
  });
  if (deleted.length === 0) throw new DomainError("FORBIDDEN", "the question went on the site before it could be deleted");
  revalidatePublicContent("pages");
}
