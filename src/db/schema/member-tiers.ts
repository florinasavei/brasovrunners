import { sql } from "drizzle-orm";
import { boolean, check, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { staffUsers } from "./staff-users";

/**
 * «Niveluri de membru» (§811; the owner, 2026-10-18: «Also for the member zone I want member
 * Tiers»): the levels the club names for its members — «Membru», «Membru fondator», «Sprijinitor» — one
 * row each. A member (`staff_users.member_tier_id`) holds at most one.
 *
 * **A label and its benefits, never a permission.** No door, no verb and no role reads a tier (the
 * owner's 2026-10-10 rule: grants are per person, not by a level). A tier is the staff's label on the
 * member's row (§NNN): only the staff see it, and it limits which of the partners' discount codes a member
 * sees (`member_discount_codes.tier_ids`) — nothing else. No member and no visitor is shown a level.
 *
 * A name in each language and a description in each, both languages or neither (§352, checked in
 * `content/member-tiers/fields.ts`); `glyph` is a name from the tier glyph table
 * (`modules/events/ui/tier-glyphs.ts`), `star` by default; `position` the club's order, lowest first;
 * `hidden` a tier no longer offered or advertised — kept, and held by the members who have it.
 *
 * Nothing about a person: a name, its words and a level's place in a list.
 */
export const memberTiers = pgTable(
  "member_tiers",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    nameRo: text("name_ro").notNull(),
    nameEn: text("name_en").notNull(),
    descriptionRo: text("description_ro"),
    descriptionEn: text("description_en"),

    /** A key of the tier glyph table, drawn by `GlyphChip` as `tier:<glyph>`. */
    glyph: text("glyph").notNull().default("star"),

    /** Where the tier sits in the club's list, lowest first, from 1. */
    position: integer("position").notNull(),
    /** Not offered when giving a tier; members who hold it keep it. */
    hidden: boolean("hidden").notNull().default(false),

    updatedByStaffUserId: uuid("updated_by_staff_user_id").references(() => staffUsers.id, { onDelete: "set null" }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("member_tiers_name_ro_present", sql`length(btrim(${t.nameRo})) > 0`),
    check("member_tiers_name_en_present", sql`length(btrim(${t.nameEn})) > 0`),
    check("member_tiers_name_ro_short", sql`char_length(${t.nameRo}) <= 40`),
    check("member_tiers_name_en_short", sql`char_length(${t.nameEn}) <= 40`),
    check("member_tiers_description_ro_short", sql`${t.descriptionRo} IS NULL OR char_length(${t.descriptionRo}) <= 400`),
    check("member_tiers_description_en_short", sql`${t.descriptionEn} IS NULL OR char_length(${t.descriptionEn}) <= 400`),
    check("member_tiers_position_positive", sql`${t.position} >= 1`),
    index("member_tiers_position_idx").on(t.position),
  ],
);

export type MemberTier = typeof memberTiers.$inferSelect;
