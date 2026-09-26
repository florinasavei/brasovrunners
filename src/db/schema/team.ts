import { sql } from "drizzle-orm";
import { boolean, check, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { mediaAssets } from "./gallery";
import { staffUsers } from "./staff-users";

/**
 * «Echipa» / "The team" (§NNN): the people who run the club, one card each, on a page of its own
 * — a platform page like the contact form, not a standing page the club writes from nothing.
 *
 * A card is a name, what the person does for the club, a few words about them and a photograph.
 * The name is one: a person's name is not translated. What they do and the words about them are
 * the club's own text, so they are Romanian **and** English, both or neither (§352) — checked at
 * the save (`content/team/fields.ts`), not here, the way every other pair is.
 *
 * Not an account and not a staff row: the page introduces people to visitors, and a person on it
 * need not have a backoffice sign-in at all. Nothing here is personal data beyond what the person
 * agreed to show — no address, no telephone, no email.
 */
export const teamMembers = pgTable(
  "team_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    /** The name the page shows, as the person wants it written. */
    name: text("name").notNull(),
    /** What they do for the club — "Antrenor", "Coach" — both languages or neither. */
    roleRo: text("role_ro"),
    roleEn: text("role_en"),
    /** A short paragraph about them, plain text — both languages or neither. */
    bioRo: text("bio_ro"),
    bioEn: text("bio_en"),
    /**
     * One link the person chose to share — a Strava profile, an Instagram page — or none. An
     * `https://` address, checked at the save (`content/team/fields.ts`); not a language pair,
     * because an address is the same in both.
     */
    link: text("link"),

    /**
     * The photograph, stored like every other picture (`media_assets`, §66, §414): the WebP
     * ladder, served with `srcset`. `set null` on delete, so a picture removed from the store
     * leaves a card without a photo, never a card that fails to render. The orphan sweep counts
     * this column as a reference (`media/references.ts`).
     */
    photoMediaAssetId: uuid("photo_media_asset_id").references(() => mediaAssets.id, { onDelete: "set null" }),

    /** Where the card sits on the page, lowest first, moved with two arrows as pages are. */
    position: integer("position").notNull(),
    /**
     * Whether the card is on the site. A new card starts hidden: it goes up when an
     * Administrator shows it, as a page goes live when she publishes it (§201).
     */
    visible: boolean("visible").notNull().default(false),

    createdByStaffUserId: uuid("created_by_staff_user_id").references(() => staffUsers.id, { onDelete: "set null" }),
    updatedByStaffUserId: uuid("updated_by_staff_user_id").references(() => staffUsers.id, { onDelete: "set null" }),

    /** Optimistic concurrency, as `pages.version` is (AGENTS.md §11.5). */
    version: integer("version").notNull().default(1),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("team_members_name_present", sql`length(btrim(${t.name})) > 0`),
    check("team_members_position_positive", sql`${t.position} >= 1`),
    check("team_members_version_positive", sql`${t.version} >= 1`),
    index("team_members_visible_position_idx").on(t.visible, t.position),
  ],
);

export type TeamMember = typeof teamMembers.$inferSelect;
