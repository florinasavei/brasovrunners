import { and, asc, eq, gte, isNull, or } from "drizzle-orm";
import { memberDiscountCodes } from "@/db/schema/member-discount-codes";
import type { Database } from "@/db/types";
import { CLUB_TIME_ZONE } from "@/i18n/dates";
import { dayIn } from "@/modules/registrations/domain/age";

/**
 * The members' discount codes (§552), read. Two reads and no third: the backoffice's whole list, and
 * the members' zone's — which is called only behind the account (`canOpenMembersZone`, the zone's own
 * door) and never through the public cache (§333), a feed, an email or a public page. A public read
 * of this table does not exist, and `tests/unit/events/members-only.test.ts` holds it so.
 */

/** Every code, in the list's order, for «Pagini» → «Membri» → «Coduri de reducere». */
export async function listDiscountCodesForAdmin<T extends Record<string, unknown>>(db: Database<T>) {
  return db
    .select()
    .from(memberDiscountCodes)
    .orderBy(asc(memberDiscountCodes.position), asc(memberDiscountCodes.createdAt));
}

export type AdminDiscountCode = Awaited<ReturnType<typeof listDiscountCodesForAdmin>>[number];

/** The club's calendar day at `now`: a code whose last day is today is still shown today. */
export function clubToday(now: Date): string {
  return dayIn(now, CLUB_TIME_ZONE);
}

/**
 * The codes a member sees at `now`, in the list's order: not hidden, and not past their last day
 * on the club's calendar (`codeShownToMembers`, the same rule in words). Exactly the columns the
 * zone's cards draw — never who wrote them or when.
 */
export async function listDiscountCodesForMembers<T extends Record<string, unknown>>(db: Database<T>, now: Date) {
  return db
    .select({
      id: memberDiscountCodes.id,
      partnerName: memberDiscountCodes.partnerName,
      code: memberDiscountCodes.code,
      descriptionRo: memberDiscountCodes.descriptionRo,
      descriptionEn: memberDiscountCodes.descriptionEn,
      link: memberDiscountCodes.link,
      validUntil: memberDiscountCodes.validUntil,
    })
    .from(memberDiscountCodes)
    .where(
      and(
        eq(memberDiscountCodes.hidden, false),
        or(isNull(memberDiscountCodes.validUntil), gte(memberDiscountCodes.validUntil, clubToday(now))),
      ),
    )
    .orderBy(asc(memberDiscountCodes.position), asc(memberDiscountCodes.createdAt));
}

export type MembersDiscountCode = Awaited<ReturnType<typeof listDiscountCodesForMembers>>[number];
