import { asc, eq, inArray, sql } from "drizzle-orm";
import { memberDiscountCodes } from "@/db/schema/member-discount-codes";
import { type MemberTier, memberTiers } from "@/db/schema/member-tiers";
import { staffUsers } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import type { Locale } from "@/i18n/routing";
import { DEFAULT_TIER_GLYPH, isTierGlyphKey, type TierGlyphKey } from "./glyph-keys";

/**
 * The member tiers (§NNN), read. A tier is a label and its benefits, never a permission: nothing here
 * decides what anybody may do. The reads:
 *
 * - the backoffice's whole list with how many members hold each and how many discount codes are for
 *   it alone — «Niveluri de membru» and the team page's select;
 * - the visible levels, in the club's order — what «Echipa» offers when giving a level;
 * - a level by id — the member's own badge in the zone;
 * - the public members' page's levels, in one language — through the public cache (§333), so a save
 *   expires `pages` (`service.ts`).
 */

/** A level as the screens draw it in one language. `glyph` is always a key of the tiers' table. */
export type TierView = { id: string; name: string; description: string | null; glyph: TierGlyphKey };

/** A stored glyph that is not in the table (hand-edited SQL) draws as the default, never as a missing picture. */
export function glyphOf(value: string): TierGlyphKey {
  return isTierGlyphKey(value) ? value : DEFAULT_TIER_GLYPH;
}

/** One tier in the reader's language. */
export function tierViewOf(tier: Pick<MemberTier, "id" | "nameRo" | "nameEn" | "descriptionRo" | "descriptionEn" | "glyph">, locale: Locale | string): TierView {
  const en = locale === "en";
  return {
    id: tier.id,
    name: en ? tier.nameEn : tier.nameRo,
    description: (en ? tier.descriptionEn : tier.descriptionRo) ?? null,
    glyph: glyphOf(tier.glyph),
  };
}

/** Every tier, in the club's order, for «Niveluri de membru»: with the members who hold it and the codes for it alone. */
export async function listMemberTiersForAdmin<T extends Record<string, unknown>>(db: Database<T>) {
  return db
    .select({
      tier: memberTiers,
      members: sql<number>`(select count(*) from ${staffUsers} where ${staffUsers.memberTierId} = ${memberTiers.id})`.mapWith(Number),
      codesOnlyForIt: sql<number>`(select count(*) from ${memberDiscountCodes} where ${memberDiscountCodes.tierIds} = array[${memberTiers.id}])`.mapWith(Number),
      codesForIt: sql<number>`(select count(*) from ${memberDiscountCodes} where ${memberTiers.id} = any(${memberDiscountCodes.tierIds}))`.mapWith(Number),
    })
    .from(memberTiers)
    .orderBy(asc(memberTiers.position), asc(memberTiers.createdAt));
}

export type AdminMemberTier = Awaited<ReturnType<typeof listMemberTiersForAdmin>>[number];

/** Every tier with no counts, in the club's order — the codes' chips name them, hidden ones included. */
export async function listAllMemberTiers<T extends Record<string, unknown>>(db: Database<T>): Promise<MemberTier[]> {
  return db.select().from(memberTiers).orderBy(asc(memberTiers.position), asc(memberTiers.createdAt));
}

/** The tiers not hidden, in the club's order. */
export async function listVisibleMemberTiers<T extends Record<string, unknown>>(db: Database<T>): Promise<MemberTier[]> {
  return db.select().from(memberTiers).where(eq(memberTiers.hidden, false)).orderBy(asc(memberTiers.position), asc(memberTiers.createdAt));
}

/** One tier by id, or nothing. */
export async function findMemberTier<T extends Record<string, unknown>>(db: Database<T>, id: string): Promise<MemberTier | undefined> {
  const [row] = await db.select().from(memberTiers).where(eq(memberTiers.id, id)).limit(1);
  return row;
}

/** The levels the public members' page lists, in one language: visible ones, in order, nothing about a person. */
export async function readPublicMemberTiers<T extends Record<string, unknown>>(db: Database<T>, locale: Locale): Promise<TierView[]> {
  return (await listVisibleMemberTiers(db)).map((tier) => tierViewOf(tier, locale));
}

/**
 * The ids among `ids` that are tiers, read with a share lock (§NNN): a code limited to a level (or a member
 * given one) holds the level's row against its deletion until the transaction ends, so the delete — which locks
 * the row first and then counts — sees what this write did.
 */
export async function existingTierIdsShared<T extends Record<string, unknown>>(db: Database<T>, ids: readonly string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await db.select({ id: memberTiers.id }).from(memberTiers).where(inArray(memberTiers.id, [...ids])).for("share");
  return new Set(rows.map((row) => row.id));
}

/** One tier by id, read with a share lock (§NNN): giving it to a member holds its row against deletion until the transaction ends. */
export async function findMemberTierShared<T extends Record<string, unknown>>(db: Database<T>, id: string): Promise<MemberTier | undefined> {
  const [row] = await db.select().from(memberTiers).where(eq(memberTiers.id, id)).limit(1).for("share");
  return row;
}

/** How many members hold a tier, and how many codes are for it alone: what stops its deletion. */
export async function tierUsage<T extends Record<string, unknown>>(db: Database<T>, id: string): Promise<{ members: number; codesOnlyForIt: number }> {
  const [members] = await db.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(staffUsers).where(eq(staffUsers.memberTierId, id));
  const [codes] = await db
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(memberDiscountCodes)
    .where(sql`${memberDiscountCodes.tierIds} = array[${id}]::uuid[]`);
  return { members: members?.n ?? 0, codesOnlyForIt: codes?.n ?? 0 };
}
