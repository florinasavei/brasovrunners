import { sql } from "drizzle-orm";
import { boolean, check, date, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { staffUsers } from "./staff-users";

/**
 * «Coduri de reducere» (§552; the owner, 2026-09-28): the discount codes the club's partners give
 * its members, one row each, shown only inside the members' zone (§524) — never on a public page,
 * in the public cache, a feed or an email. §517 took them out of the newsletter for exactly that
 * reason: "the club's discount codes are for its members only, not for anyone who subscribes".
 *
 * A code is the partner's name, the code itself, a short description in Romanian **and** English
 * or in neither (§352, checked at the save in `content/member-codes/fields.ts`), an optional https
 * link, an optional last day it is valid, and the place it takes in the list. `hidden` is a code the
 * club stops showing without deleting it; a code past its day is not shown either, by the read.
 *
 * Nothing about a person: a code and the words around it.
 */
export const memberDiscountCodes = pgTable(
  "member_discount_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    /** Who gives the discount — «Magazinul X» — a proper name, not translated. */
    partnerName: text("partner_name").notNull(),
    /** The code as the member types it at the partner's. */
    code: text("code").notNull(),
    /** What it gives and how, a line or two — both languages or neither. */
    descriptionRo: text("description_ro"),
    descriptionEn: text("description_en"),
    /** Where the code is used, https, or null. */
    link: text("link"),
    /** The last day the code is valid, on the club's calendar, or null for no end. */
    validUntil: date("valid_until", { mode: "string" }),

    /** Where the code sits in the list, lowest first. */
    position: integer("position").notNull(),
    /** Kept but not shown to the members. A new code is shown at once: the zone is not public. */
    hidden: boolean("hidden").notNull().default(false),

    createdByStaffUserId: uuid("created_by_staff_user_id").references(() => staffUsers.id, { onDelete: "set null" }),
    updatedByStaffUserId: uuid("updated_by_staff_user_id").references(() => staffUsers.id, { onDelete: "set null" }),

    /** Optimistic concurrency, as `team_members.version` is (AGENTS.md §11.5). */
    version: integer("version").notNull().default(1),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("member_discount_codes_partner_present", sql`length(btrim(${t.partnerName})) > 0`),
    check("member_discount_codes_code_present", sql`length(btrim(${t.code})) > 0`),
    check("member_discount_codes_link_https", sql`${t.link} IS NULL OR ${t.link} LIKE 'https://%'`),
    check("member_discount_codes_position_positive", sql`${t.position} >= 1`),
    check("member_discount_codes_version_positive", sql`${t.version} >= 1`),
    index("member_discount_codes_hidden_position_idx").on(t.hidden, t.position),
  ],
);

export type MemberDiscountCode = typeof memberDiscountCodes.$inferSelect;
