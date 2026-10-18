import { asc, eq, sql } from "drizzle-orm";
import { memberDiscountCodes } from "@/db/schema/member-discount-codes";
import { memberTiers } from "@/db/schema/member-tiers";
import { staffUsers } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";

/**
 * The member tiers (§811) as the backoffice counts them. Apart from `repository.ts` on purpose: these
 * reads meet the members' table and the discount codes' — «how many members hold this level», «how
 * many codes are for it alone» — and the public members' page and the zone's frame read the other
 * file, which meets neither (`tests/unit/events/members-only.test.ts` holds the codes to the zone and
 * the backoffice). Never reached by a public route.
 */

/** Every tier, in the club's order, for «Niveluri de membru»: with the members who hold it and the codes limited to it. */
export async function listMemberTiersForAdmin<T extends Record<string, unknown>>(db: Database<T>) {
  return db
    .select({
      tier: memberTiers,
      // Qualified by hand: a select over one table drops the table's name from its columns, and inside a subquery a bare `id` would mean the other table's.
      members: sql<number>`(select count(*) from staff_users where staff_users.member_tier_id = member_tiers.id)`.mapWith(Number),
      codesOnlyForIt: sql<number>`(select count(*) from member_discount_codes where member_discount_codes.tier_ids = array[member_tiers.id])`.mapWith(Number),
      codesForIt: sql<number>`(select count(*) from member_discount_codes where member_tiers.id = any(member_discount_codes.tier_ids))`.mapWith(Number),
    })
    .from(memberTiers)
    .orderBy(asc(memberTiers.position), asc(memberTiers.createdAt));
}

export type AdminMemberTier = Awaited<ReturnType<typeof listMemberTiersForAdmin>>[number];

/** How many members hold a tier, and how many codes are for it alone: what stops its deletion. */
export async function tierUsage<T extends Record<string, unknown>>(db: Database<T>, id: string): Promise<{ members: number; codesOnlyForIt: number }> {
  const [members] = await db.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(staffUsers).where(eq(staffUsers.memberTierId, id));
  const [codes] = await db
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(memberDiscountCodes)
    .where(sql`${memberDiscountCodes.tierIds} = array[${id}]::uuid[]`);
  return { members: members?.n ?? 0, codesOnlyForIt: codes?.n ?? 0 };
}
