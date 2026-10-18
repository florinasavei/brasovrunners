import { asc, eq, sql } from "drizzle-orm";
import { memberDiscountCodes } from "@/db/schema/member-discount-codes";
import { memberTiers } from "@/db/schema/member-tiers";
import { staffUsers } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";

/**
 * The member tiers (§NNN) as the backoffice counts them. Apart from `repository.ts` on purpose: these
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
      members: sql<number>`(select count(*) from ${staffUsers} where ${staffUsers.memberTierId} = ${memberTiers.id})`.mapWith(Number),
      codesOnlyForIt: sql<number>`(select count(*) from ${memberDiscountCodes} where ${memberDiscountCodes.tierIds} = array[${memberTiers.id}])`.mapWith(Number),
      codesForIt: sql<number>`(select count(*) from ${memberDiscountCodes} where ${memberTiers.id} = any(${memberDiscountCodes.tierIds}))`.mapWith(Number),
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
