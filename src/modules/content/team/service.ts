import { and, asc, eq, sql } from "drizzle-orm";
import type { StaffUser } from "@/db/schema/staff-users";
import { type TeamMember, teamMembers } from "@/db/schema/team";
import type { Database } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit/repository";
import { revalidatePublicContent } from "@/modules/public-cache/cache";
import { canEditTeamPage, canShowTeamMember } from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";
import { type TeamMemberFields, teamFieldName, teamMemberFieldsSchema } from "./fields";
import { mediaAssetKeyPrefix } from "./repository";

/**
 * «Echipa» — the team page's cards (§459): add, write, show or hide, move, delete.
 *
 * The page is the platform's, like the contact form: its title and its introduction are in the
 * catalogue, and what the club keeps is the list of people. Every write is asserted here, on the
 * server, whatever the screen offered (BR-REQ-060-01):
 *
 * - adding, writing, moving, and deleting a card that is not on the site — `canEditTeamPage`,
 *   the Redactor's and the Administrator's, because a card is words and a photograph;
 * - showing a card, taking it off, and deleting one that is on the site — `canShowTeamMember`,
 *   the Administrator's, because that is what crossing public view is since §201.
 *
 * Every write leaves an `audit_logs` row in its own transaction, naming the card by id and the
 * staff member who acted — never the person's name or words (§12.12): whoever put a photograph on
 * the site, or deleted a card, can be told months later.
 *
 * The cards are read from the public cache under `pages` (§333): «Echipa» is a standing page and
 * sits in the navigation, and every write here expires that kind, as a page's save does.
 */

type Actor = Pick<StaffUser, "id" | "role">;

function parseOrThrow(value: unknown): TeamMemberFields {
  const parsed = teamMemberFieldsSchema.safeParse(value);
  if (!parsed.success) {
    throw new DomainError(
      "VALIDATION_ERROR",
      parsed.error.issues.map((issue) => `${teamFieldName(issue.path)}: ${issue.message}`).join("; "),
      // The boxes' own names — `links[1].url` for the second link's address — so the summary lands on them.
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
  // A film's automatic poster is YouTube's 480-pixel thumbnail, not a person's photo (§485) — the
  // same refusal an album gives it (`addStoredPhoto`), held here and not only in the picker.
  if (keyPrefix.startsWith("yt-")) {
    throw new DomainError("VALIDATION_ERROR", "a film's poster is not a card's photo", ["photoAssetId"]);
  }
}

function assertMayEdit(actor: Actor): void {
  if (!canEditTeamPage(actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${actor.role} may not edit the team page`);
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
        // The part the card shows (§NNN); null is the whole photograph, as before.
        photoCrop: fields.photoCrop,
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
  // Hidden, so nothing public changed — but the count the header reads is cheap to expire, and a
  // rule that every write expires is one nobody has to remember the exceptions of.
  revalidatePublicContent("pages");
  return created;
}

/**
 * Save a card's words and photo, against the version it was loaded with: a colleague's save in
 * between is a CONFLICT, never an overwrite (AGENTS.md §11.5). Writing a card that is on the site
 * is allowed to the Redactor as a page's live text is (§103) — the words change, the card's being
 * there does not.
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
        // The part the card shows (§NNN); null is the whole photograph, as before.
        photoCrop: fields.photoCrop,
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

/**
 * Move a card one place up or down. The whole list is renumbered from the order on screen, as
 * `movePageInNav` does and for its reasons: duplicates and gaps heal, and a replayed press at an
 * end does nothing rather than fail.
 */
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
 * Delete a card. One that is on the site is the Administrator's to remove (§201); a hidden one,
 * whoever may write cards. The photo stays in the store and is swept a week after nothing uses it
 * (§73), so a card deleted by mistake can be made again with the same picture.
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
  // The visibility is asked again in the delete itself, so a card shown a moment ago by a
  // colleague is not taken off the site by somebody who may not.
  const mayRemoveShown = canShowTeamMember(input.actor.role);
  const deleted = await db.transaction(async (tx) => {
    const gone = await tx
      .delete(teamMembers)
      .where(and(eq(teamMembers.id, input.memberId), mayRemoveShown ? undefined : eq(teamMembers.visible, false)))
      .returning({ id: teamMembers.id, visible: teamMembers.visible });
    if (gone.length > 0) {
      // The row outlives the card: the id and whether it was on the site, never the name (§12.12).
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
