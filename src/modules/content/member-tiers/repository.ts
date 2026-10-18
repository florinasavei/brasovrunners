import { asc, eq, inArray } from "drizzle-orm";
import { type MemberTier, memberTiers } from "@/db/schema/member-tiers";
import type { Database } from "@/db/types";
import type { Locale } from "@/i18n/routing";
import { DEFAULT_TIER_GLYPH, isTierGlyphKey, type TierGlyphKey } from "./glyph-keys";

/**
 * The member tiers (§NNN), read. A tier is a label and its benefits, never a permission: nothing here
 * decides what anybody may do. The reads:
 *
 * - every level, in the club's order, and the visible ones — «Niveluri de membru»'s chips and the team page's select
 *   (the backoffice's counts are `admin-repository.ts`, which meets the members' and the codes' tables);
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
