import { and, asc, eq, sql } from "drizzle-orm";
import type { StaffUser } from "@/db/schema/staff-users";
import { type TeamMember, teamMembers } from "@/db/schema/team";
import type { Database } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit/repository";
import { revalidatePublicContent } from "@/modules/public-cache/cache";
import { canEditTeamPage, canShowTeamMember } from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";
import { type TeamMemberFields, teamFieldName, teamMemberFieldsSchema, teamReportsToSelf } from "./fields";
import { mediaAssetKeyPrefix } from "./repository";

/**
 * «Echipa» — the team page's cards (§459). Asserted on the server (BR-REQ-060-01): writing a card
 * is `canEditTeamPage`; showing, hiding or deleting a shown card is `canShowTeamMember` (§201).
 * Every write audits the card id and the actor, never the person's name or words (§12.12), and
 * expires the `pages` cache (§333).
 */

type Actor = Pick<StaffUser, "id" | "role">;

function parseOrThrow(value: unknown): TeamMemberFields {
  const parsed = teamMemberFieldsSchema.safeParse(value);
  if (!parsed.success) {
    throw new DomainError(
      "VALIDATION_ERROR",
      parsed.error.issues.map((issue) => `${teamFieldName(issue.path)}: ${issue.message}`).join("; "),
      [...new Set(parsed.error.issues.map((issue) => teamFieldName(issue.path)))],
    );
  }
  return parsed.data;
}

/** A photo id must name a stored picture; one that does not is refused on the photo box. */
async function assertPhotoExists<T extends Record<string, unknown>>(db: Database<T>, fields: TeamMemberFields): Promise<void> {
  if (!fields.photoAssetId) return;
  const keyPrefix = await mediaAssetKeyPrefix(db, fields.photoAssetId);
  if (keyPrefix === null) {
    throw new DomainError("VALIDATION_ERROR", "the photo is not a stored picture", ["photoAssetId"]);
  }
  // A film's automatic poster is not a person's photo (§485); also refused by the picker.
  if (keyPrefix.startsWith("yt-")) {
    throw new DomainError("VALIDATION_ERROR", "a film's poster is not a card's photo", ["photoAssetId"]);
  }
}

function assertMayEdit(actor: Actor): void {
  if (!canEditTeamPage(actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${actor.role} may not edit the team page`);
  }
}

/** The «Răspunde în fața» box refused (§691), with the rest of the card kept (§315). */
function refuseReportsTo(message: string): never {
  throw new DomainError("VALIDATION_ERROR", message, ["reportsToId"]);
}

/**
 * The card this one answers to must be a stored card, not itself and not one of its own
 * descendants — a cycle of any length (§691). Read inside the save's transaction, so a parent
 * re-pointed by a colleague in the same moment is still seen: the walk follows `reports_to_id`
 * upward from the chosen parent and stops on the saved card, on the top, or on a stale cycle in
 * the data (a visited set), which it then also refuses rather than looping.
 */
async function assertReportsToIsSound<T extends Record<string, unknown>>(
  tx: Database<T>,
  fields: TeamMemberFields,
  selfId: string | null,
): Promise<void> {
  if (fields.reportsToId === null) return;
  if (teamReportsToSelf(fields, selfId)) refuseReportsTo("a card cannot answer to itself");
  const visited = new Set<string>();
  let current: string | null = fields.reportsToId;
  while (current !== null) {
    if (selfId !== null && current === selfId) refuseReportsTo("the chosen card already answers to this one: that would be a circle");
    if (visited.has(current)) refuseReportsTo("the chosen card is on a circle of its own");
    visited.add(current);
    const [row] = await tx.select({ reportsToId: teamMembers.reportsToId }).from(teamMembers).where(eq(teamMembers.id, current)).limit(1);
    if (!row) {
      if (current === fields.reportsToId) refuseReportsTo("the chosen card does not exist");
      return;
    }
    current = row.reportsToId;
  }
}

/** Add a card at the end of the list, hidden until an Administrator shows it. */
export async function createTeamMember<T extends Record<string, unknown>>(
  db: Database<T>,
  input: { actor: Actor; fields: unknown; now?: Date },
): Promise<TeamMember> {
  assertMayEdit(input.actor);
  const fields = parseOrThrow(input.fields);
  const now = input.now ?? new Date();
  await assertPhotoExists(db, fields);

  const created = await db.transaction(async (tx) => {
    // A new card answers to nobody's descendant: only "exists" and the data's own soundness apply (§691).
    await assertReportsToIsSound(tx, fields, null);
    const [last] = await tx
      .select({ position: sql<number>`coalesce(max(${teamMembers.position}), 0)`.mapWith(Number) })
      .from(teamMembers);
    const [row] = await tx
      .insert(teamMembers)
      .values({
        name: fields.name,
        roleRo: fields.roleRo,
        roleEn: fields.roleEn,
        bioRo: fields.bioRo,
        bioEn: fields.bioEn,
        bioRoJson: fields.bioRoJson,
        bioEnJson: fields.bioEnJson,
        link: fields.link,
        links: fields.links.length > 0 ? fields.links : null,
        photoMediaAssetId: fields.photoAssetId,
        // §541; null is the whole photograph.
        photoCrop: fields.photoCrop,
        // The chart (§691).
        subtitleRo: fields.subtitleRo,
        subtitleEn: fields.subtitleEn,
        responsibilitiesRo: fields.responsibilitiesRo,
        responsibilitiesEn: fields.responsibilitiesEn,
        reportsToId: fields.reportsToId,
        placement: fields.placement,
        // The canvas (§701).
        level: fields.level,
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
      action: "team_member.created",
      entityType: "team_member",
      entityId: row.id,
      metadata: { photo: fields.photoAssetId !== null, links: fields.links.length },
      now,
    });
    return row;
  });
  // Hidden, but every write expires the cache: no exceptions to remember.
  revalidatePublicContent("pages");
  return created;
}

/**
 * Save a card's words and photo against its loaded version; CONFLICT otherwise (AGENTS.md §11.5).
 * The Redactor may write a shown card, as a live page's text (§103).
 */
export async function saveTeamMember<T extends Record<string, unknown>>(
  db: Database<T>,
  input: { actor: Actor; memberId: string; expectedVersion: number; fields: unknown; now?: Date },
): Promise<TeamMember> {
  assertMayEdit(input.actor);
  const fields = parseOrThrow(input.fields);
  const now = input.now ?? new Date();
  await assertPhotoExists(db, fields);

  const row = await db.transaction(async (tx) => {
    // Not itself, not a descendant of its own, and a card that exists — read under the same transaction (§691).
    await assertReportsToIsSound(tx, fields, input.memberId);
    const [updated] = await tx
      .update(teamMembers)
      .set({
        name: fields.name,
        roleRo: fields.roleRo,
        roleEn: fields.roleEn,
        bioRo: fields.bioRo,
        bioEn: fields.bioEn,
        bioRoJson: fields.bioRoJson,
        bioEnJson: fields.bioEnJson,
        link: fields.link,
        links: fields.links.length > 0 ? fields.links : null,
        photoMediaAssetId: fields.photoAssetId,
        // §541; null is the whole photograph.
        photoCrop: fields.photoCrop,
        // The chart (§691).
        subtitleRo: fields.subtitleRo,
        subtitleEn: fields.subtitleEn,
        responsibilitiesRo: fields.responsibilitiesRo,
        responsibilitiesEn: fields.responsibilitiesEn,
        reportsToId: fields.reportsToId,
        placement: fields.placement,
        // The canvas (§701).
        level: fields.level,
        updatedByStaffUserId: input.actor.id,
        version: input.expectedVersion + 1,
        updatedAt: now,
      })
      .where(and(eq(teamMembers.id, input.memberId), eq(teamMembers.version, input.expectedVersion)))
      .returning();
    if (!updated) return undefined;
    await recordAuditEvent(tx, {
      actorStaffUserId: input.actor.id,
      action: "team_member.saved",
      entityType: "team_member",
      entityId: updated.id,
      metadata: { version: updated.version, photo: fields.photoAssetId !== null, links: fields.links.length },
      now,
    });
    return updated;
  });
  if (!row) return refuseStale(db, input.memberId, input.expectedVersion);
  revalidatePublicContent("pages");
  return row;
}

async function refuseStale<T extends Record<string, unknown>>(db: Database<T>, memberId: string, expected: number): Promise<never> {
  const [current] = await db.select({ version: teamMembers.version }).from(teamMembers).where(eq(teamMembers.id, memberId)).limit(1);
  if (!current) throw new DomainError("NOT_FOUND", "no such team member");
  throw new DomainError(
    "CONFLICT",
    `this card was saved by someone else: you loaded version ${expected}, the current version is ${current.version}`,
  );
}

/** Show a card on the site, or take it off — the Administrator's (§201). */
export async function setTeamMemberVisible<T extends Record<string, unknown>>(
  db: Database<T>,
  input: { actor: Actor; memberId: string; expectedVersion: number; visible: boolean; now?: Date },
): Promise<TeamMember> {
  if (!canShowTeamMember(input.actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${input.actor.role} may not show or hide a team member`);
  }
  const now = input.now ?? new Date();
  const row = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(teamMembers)
      .set({ visible: input.visible, updatedByStaffUserId: input.actor.id, version: input.expectedVersion + 1, updatedAt: now })
      .where(and(eq(teamMembers.id, input.memberId), eq(teamMembers.version, input.expectedVersion)))
      .returning();
    if (!updated) return undefined;
    await recordAuditEvent(tx, {
      actorStaffUserId: input.actor.id,
      action: input.visible ? "team_member.shown" : "team_member.hidden",
      entityType: "team_member",
      entityId: updated.id,
      metadata: { visible: input.visible },
      now,
    });
    return updated;
  });
  if (!row) return refuseStale(db, input.memberId, input.expectedVersion);
  revalidatePublicContent("pages");
  return row;
}

/** Move a card one place up or down, renumbering the whole list (as `movePageInNav`). */
export async function moveTeamMember<T extends Record<string, unknown>>(
  db: Database<T>,
  input: { actor: Actor; memberId: string; direction: "up" | "down"; now?: Date },
): Promise<void> {
  assertMayEdit(input.actor);
  const now = input.now ?? new Date();
  await db.transaction(async (tx) => {
    const ordered = await tx
      .select({ id: teamMembers.id })
      .from(teamMembers)
      .orderBy(asc(teamMembers.position), asc(teamMembers.createdAt));
    const index = ordered.findIndex((row) => row.id === input.memberId);
    if (index === -1) throw new DomainError("NOT_FOUND", "no such team member");
    const target = input.direction === "up" ? index - 1 : index + 1;
    if (target < 0 || target >= ordered.length) return;
    const moved = [...ordered];
    [moved[index], moved[target]] = [moved[target], moved[index]];
    for (const [position, row] of moved.entries()) {
      await tx.update(teamMembers).set({ position: position + 1 }).where(eq(teamMembers.id, row.id));
    }
    await recordAuditEvent(tx, {
      actorStaffUserId: input.actor.id,
      action: "team_member.moved",
      entityType: "team_member",
      entityId: input.memberId,
      metadata: { direction: input.direction, position: target + 1 },
      now,
    });
  });
  revalidatePublicContent("pages");
}

/**
 * Delete a card; a shown one is the Administrator's (§201). The photo is swept a week after
 * nothing uses it (§73).
 */
export async function deleteTeamMember<T extends Record<string, unknown>>(
  db: Database<T>,
  input: { actor: Actor; memberId: string; now?: Date },
): Promise<void> {
  assertMayEdit(input.actor);
  const now = input.now ?? new Date();
  const [current] = await db
    .select({ visible: teamMembers.visible })
    .from(teamMembers)
    .where(eq(teamMembers.id, input.memberId))
    .limit(1);
  if (!current) throw new DomainError("NOT_FOUND", "no such team member");
  if (current.visible && !canShowTeamMember(input.actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${input.actor.role} may not delete a card that is on the site`);
  }
  // Visibility is re-checked in the delete itself, against a colleague showing it meanwhile.
  const mayRemoveShown = canShowTeamMember(input.actor.role);
  const deleted = await db.transaction(async (tx) => {
    const gone = await tx
      .delete(teamMembers)
      .where(and(eq(teamMembers.id, input.memberId), mayRemoveShown ? undefined : eq(teamMembers.visible, false)))
      .returning({ id: teamMembers.id, visible: teamMembers.visible });
    if (gone.length > 0) {
      // The id and whether it was shown, never the name (§12.12).
      await recordAuditEvent(tx, {
        actorStaffUserId: input.actor.id,
        action: "team_member.deleted",
        entityType: "team_member",
        entityId: input.memberId,
        metadata: { wasVisible: gone[0]!.visible },
        now,
      });
    }
    return gone;
  });
  if (deleted.length === 0) throw new DomainError("FORBIDDEN", "the card went on the site before it could be deleted");
  revalidatePublicContent("pages");
}
