import { asc, eq, sql } from "drizzle-orm";
import { memberDiscountCodes } from "@/db/schema/member-discount-codes";
import { memberTiers } from "@/db/schema/member-tiers";
import type { StaffUser } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit/repository";
import { revalidatePublicContent } from "@/modules/public-cache/cache";
import { canManageMemberTiers } from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";
import { isUuid } from "@/shared/ids";
import { MEMBER_TIERS_MAX, parseTierPosition, tierFieldsSchema } from "./fields";
import { DEFAULT_TIER_GLYPH } from "./glyph-keys";
import { NEW_TIER_ROW_KEY, orderTierRows, type PostedTierRow, tierBox, type TierRowBox } from "./tier-rows";
import { tierUsage } from "./admin-repository";

/**
 * «Niveluri de membru» (§NNN): the levels the club names for its members. Every write is asserted
 * here, on the server, whatever the screen offered (BR-REQ-060-01): the Administrator's and the
 * Superadministrator's (`canManageMemberTiers`), who runs the club (§450). A tier is a label and its
 * benefits, never a permission — nothing below grants or refuses anything to a member.
 *
 * - **Salvează tot nivelurile** (`saveMemberTiers`): every row of the card in one transaction, the
 *   volunteers' «Roluri» rule (§791): the first refused row refuses the whole save, naming its boxes,
 *   and nothing is written; a blank row with no word in it does nothing; the club's order is the
 *   numbers typed, rewritten 1 … n at the end, which also closes the gaps a delete left.
 * - **Șterge nivelul** (`deleteMemberTier`): refused while a member holds the level
 *   (`MEMBER_TIER_HAS_MEMBERS`) and while a discount code is for that level alone
 *   (`MEMBER_TIER_IN_CODES`: an empty limit means every member, so the code would open to all); a code
 *   shared with other levels loses the id in the same transaction.
 *
 * Every change leaves an `audit_logs` row naming the level by id and the parts that changed — never a
 * name or a description. Both writes expire the public members' page (`pages`), which lists the
 * visible levels.
 */

type Actor = Pick<StaffUser, "id" | "role">;

function assertMayManage(actor: Actor): void {
  if (!canManageMemberTiers(actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${actor.role} may not manage the member tiers; they are the Administrator's (§450)`);
  }
}

export type SavedTiers = { changed: boolean; created: number; edited: number; moved: number };

/** The row's box as the form names it, for a refusal that lands on it. */
const boxOf = (key: string, name: string) => tierBox(key, name as TierRowBox);

/** The whole of one row that says nothing: no word, no number, the default glyph — the blank row left alone. */
function isBlankNewRow(row: PostedTierRow): boolean {
  const { nameRo = "", nameEn = "", descriptionRo = "", descriptionEn = "", position = "", glyph = "" } = row.fields;
  return [nameRo, nameEn, descriptionRo, descriptionEn, position].every((value) => value.trim() === "") && (glyph.trim() === "" || glyph.trim() === DEFAULT_TIER_GLYPH);
}

export async function saveMemberTiers<T extends Record<string, unknown>>(
  db: Database<T>,
  input: { actor: Actor; rows: readonly PostedTierRow[]; now?: Date },
): Promise<SavedTiers> {
  assertMayManage(input.actor);
  const now = input.now ?? new Date();
  const posted = input.rows.filter((row) => !(row.id === null && isBlankNewRow(row)));
  if (posted.length > MEMBER_TIERS_MAX) throw new DomainError("VALIDATION_ERROR", `more than ${MEMBER_TIERS_MAX} member tiers`, []);
  // A key that is not an id names no tier, and never reaches a uuid column (§376): 404, not 500.
  for (const row of posted) {
    if (row.id !== null && !isUuid(row.id)) throw new DomainError("NOT_FOUND", "no such member tier", [boxOf(row.key, "nameRo")]);
  }
  if (new Set(posted.map((row) => row.key)).size !== posted.length) throw new DomainError("VALIDATION_ERROR", "a tier posted twice", []);

  const result = await db.transaction(async (tx) => {
    // Every tier locked, in the order every writer takes: a colleague's save in between waits, and reads what this one wrote.
    const stored = await tx.select().from(memberTiers).orderBy(asc(memberTiers.position), asc(memberTiers.createdAt)).for("update");
    const byId = new Map(stored.map((tier) => [tier.id, tier]));

    const refused = new Set<string>();
    const parsed: {
      row: PostedTierRow;
      fields: ReturnType<typeof tierFieldsSchema.parse>;
      hidden: boolean;
      typed: number | null;
      drawnAt: number | null;
    }[] = [];
    let created = 0;
    for (const row of posted) {
      const current = row.id === null ? undefined : byId.get(row.id);
      if (row.id !== null && !current) {
        // Deleted by a colleague since the form was drawn: the whole save is refused, the boxes kept.
        throw new DomainError("NOT_FOUND", "no such member tier", [boxOf(row.key, "nameRo")]);
      }
      if (row.id === null) created += 1;
      // A box a caller leaves out keeps what the tier has.
      const merged = {
        nameRo: row.fields.nameRo ?? current?.nameRo ?? "",
        nameEn: row.fields.nameEn ?? current?.nameEn ?? "",
        descriptionRo: row.fields.descriptionRo ?? current?.descriptionRo ?? "",
        descriptionEn: row.fields.descriptionEn ?? current?.descriptionEn ?? "",
        glyph: row.fields.glyph ?? current?.glyph ?? "",
      };
      const check = tierFieldsSchema.safeParse(merged);
      if (!check.success) {
        for (const issue of check.error.issues) refused.add(boxOf(row.key, String(issue.path[0] ?? "nameRo")));
        continue;
      }
      const position = parseTierPosition(row.fields.position);
      if (!position.ok) {
        refused.add(boxOf(row.key, "position"));
        continue;
      }
      const drawn = /^\d{1,3}$/.test((row.fields.was ?? "").trim()) ? Number(row.fields.was) : null;
      parsed.push({
        row,
        fields: check.data,
        hidden: "hidden" in row.fields ? row.fields.hidden === "on" : (current?.hidden ?? false),
        typed: position.value,
        drawnAt: drawn,
      });
    }
    if (stored.length + created > MEMBER_TIERS_MAX) {
      const blank = posted.find((row) => row.id === null);
      throw new DomainError("VALIDATION_ERROR", `more than ${MEMBER_TIERS_MAX} member tiers`, blank ? [boxOf(blank.key, "nameRo")] : []);
    }
    if (refused.size > 0) throw new DomainError("VALIDATION_ERROR", "a member tier row is not valid; nothing was saved", [...refused]);

    // The order: the saved tiers in their stored places, a typed number that differs from the one drawn moving its tier.
    const postedByKey = new Map(parsed.map((entry) => [entry.row.key, entry]));
    const entries = [
      ...stored.map((tier, index) => {
        const entry = postedByKey.get(tier.id);
        const moved = entry !== undefined && entry.typed !== null && entry.typed !== entry.drawnAt;
        return { key: tier.id, was: index + 1, typed: moved ? entry.typed : null };
      }),
      ...parsed.filter((entry) => entry.row.id === null).map((entry) => ({ key: NEW_TIER_ROW_KEY, was: null, typed: entry.typed })),
    ];
    const order = orderTierRows(entries);
    const placeOf = new Map(order.map((key, index) => [key, index + 1]));

    let edited = 0;
    let moved = 0;
    for (const tier of stored) {
      const entry = postedByKey.get(tier.id);
      const place = placeOf.get(tier.id) ?? tier.position;
      const parts: string[] = [];
      if (entry) {
        if (entry.fields.nameRo !== tier.nameRo || entry.fields.nameEn !== tier.nameEn) parts.push("name");
        if (entry.fields.descriptionRo !== tier.descriptionRo || entry.fields.descriptionEn !== tier.descriptionEn) parts.push("description");
        if (entry.fields.glyph !== tier.glyph) parts.push("glyph");
        if (entry.hidden !== tier.hidden) parts.push("hidden");
      }
      if (parts.length > 0 && entry) {
        await tx
          .update(memberTiers)
          .set({
            nameRo: entry.fields.nameRo,
            nameEn: entry.fields.nameEn,
            descriptionRo: entry.fields.descriptionRo,
            descriptionEn: entry.fields.descriptionEn,
            glyph: entry.fields.glyph,
            hidden: entry.hidden,
            position: place,
            updatedByStaffUserId: input.actor.id,
            updatedAt: now,
          })
          .where(eq(memberTiers.id, tier.id));
        await recordAuditEvent(tx, {
          actorStaffUserId: input.actor.id,
          action: "member_tier.edited",
          entityType: "member_tier",
          entityId: tier.id,
          metadata: { parts, hidden: entry.hidden },
          now,
        });
        edited += 1;
      } else if (place !== tier.position) {
        await tx.update(memberTiers).set({ position: place }).where(eq(memberTiers.id, tier.id));
      }
      // A tier whose number the person typed is audited as moved; one that only gave way to another is rewritten silently.
      const typedMove = entries.find((candidate) => candidate.key === tier.id)?.typed ?? null;
      if (typedMove !== null && place !== tier.position) {
        await recordAuditEvent(tx, {
          actorStaffUserId: input.actor.id,
          action: "member_tier.moved",
          entityType: "member_tier",
          entityId: tier.id,
          metadata: { from: tier.position, position: place },
          now,
        });
        moved += 1;
      }
    }
    for (const entry of parsed.filter((candidate) => candidate.row.id === null)) {
      const [row] = await tx
        .insert(memberTiers)
        .values({
          nameRo: entry.fields.nameRo,
          nameEn: entry.fields.nameEn,
          descriptionRo: entry.fields.descriptionRo,
          descriptionEn: entry.fields.descriptionEn,
          glyph: entry.fields.glyph,
          hidden: entry.hidden,
          position: placeOf.get(NEW_TIER_ROW_KEY) ?? stored.length + 1,
          updatedByStaffUserId: input.actor.id,
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: memberTiers.id });
      await recordAuditEvent(tx, {
        actorStaffUserId: input.actor.id,
        action: "member_tier.added",
        entityType: "member_tier",
        entityId: row.id,
        metadata: { hidden: entry.hidden, position: placeOf.get(NEW_TIER_ROW_KEY) ?? stored.length + 1 },
        now,
      });
    }
    return { changed: edited + moved + created > 0, created, edited, moved };
  });
  // The public members' page lists the visible levels: its cached copy goes with any change.
  if (result.changed) revalidatePublicContent("pages");
  return result;
}

/**
 * Delete a level for good. Refused while a member holds it or a discount code is for it alone; a code
 * shared with other levels loses this one's id. The positions close up, and the audit row outlives the
 * level, with the id and the count of codes it was taken off.
 */
export async function deleteMemberTier<T extends Record<string, unknown>>(
  db: Database<T>,
  input: { actor: Actor; tierId: string; now?: Date },
): Promise<void> {
  assertMayManage(input.actor);
  if (!isUuid(input.tierId)) throw new DomainError("NOT_FOUND", "no such member tier");
  const now = input.now ?? new Date();
  await db.transaction(async (tx) => {
    // The tier locked first: a member given this level meanwhile waits here, and is counted below.
    const [locked] = await tx.select({ id: memberTiers.id }).from(memberTiers).where(eq(memberTiers.id, input.tierId)).for("update");
    if (!locked) throw new DomainError("NOT_FOUND", "no such member tier");
    const usage = await tierUsage(tx, input.tierId);
    if (usage.members > 0) throw new DomainError("MEMBER_TIER_HAS_MEMBERS", "give the members another level first");
    if (usage.codesOnlyForIt > 0) throw new DomainError("MEMBER_TIER_IN_CODES", "change the codes that are for this level alone first");
    const shared = await tx
      .update(memberDiscountCodes)
      .set({ tierIds: sql`array_remove(${memberDiscountCodes.tierIds}, ${input.tierId}::uuid)`, version: sql`${memberDiscountCodes.version} + 1`, updatedAt: now })
      .where(sql`${input.tierId}::uuid = any(${memberDiscountCodes.tierIds})`)
      .returning({ id: memberDiscountCodes.id });
    await tx.delete(memberTiers).where(eq(memberTiers.id, input.tierId));
    // The gap closes: 1 … n by the order they had.
    const rest = await tx.select({ id: memberTiers.id }).from(memberTiers).orderBy(asc(memberTiers.position), asc(memberTiers.createdAt));
    for (const [index, row] of rest.entries()) {
      await tx.update(memberTiers).set({ position: index + 1 }).where(eq(memberTiers.id, row.id));
    }
    await recordAuditEvent(tx, {
      actorStaffUserId: input.actor.id,
      action: "member_tier.deleted",
      entityType: "member_tier",
      entityId: input.tierId,
      metadata: { codesUpdated: shared.length },
      now,
    });
  });
  revalidatePublicContent("pages");
}
