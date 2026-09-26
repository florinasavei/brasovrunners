import { sql } from "drizzle-orm";
import { boolean, check, index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { mediaAssets } from "./gallery";
import { staffUsers } from "./staff-users";

/**
 * «Echipa» / "The team" (§459): the people who run the club, one card each, on a page of its own
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
    /**
     * The words about them as plain text — both languages or neither. Since §NNN the text is
     * written in the rich-text editor and kept in `bio_*_json`; these two carry its words
     * (`richTextToPlainText`), written by every save, so the code serving while a release rolls
     * out still shows something, and a row from before the editor still reads.
     */
    bioRo: text("bio_ro"),
    bioEn: text("bio_en"),
    /**
     * The words about them as the rich-text editor wrote them (§NNN; the owner: "editoarele
     * trebuie să fie tot așa smart, adică rich text"): paragraphs, lists, a link in the text, a
     * picture — the allowlist of `content/rich-text/domain/schema.ts`, less tables, which a card
     * two to a row has no room for. Null when nothing is written; a row from before reads its
     * plain `bio_*` as paragraphs.
     */
    bioRoJson: jsonb("bio_ro_json"),
    bioEnJson: jsonb("bio_en_json"),
    /**
     * One link the person chose to share — the only one before §NNN. Kept, and written with the
     * first of `links` by every save, for the code serving while a release rolls out; read only
     * when `links` is null (`content/team/links.ts#readTeamLinks`).
     */
    link: text("link"),
    /**
     * The person's links (§NNN): an ordered list of at most six `{ kind, url, labelRo, labelEn }`
     * — Strava, Instagram, Facebook, a site of their own, anything else — every address https,
     * each label both languages or neither. Null is "no list yet": the one `link` above is read.
     */
    links: jsonb("links"),

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
    /**
     * The links (§NNN): an array of at most six, every address https — the guarantee
     * `events_links_is_a_short_array_of_https_links` gives an event's (§332), at the layer that
     * also refuses a seed's or a hand-written `UPDATE`.
     */
    check(
      "team_members_links_is_a_short_array_of_https_links",
      sql`${t.links} IS NULL OR CASE WHEN jsonb_typeof(${t.links}) = 'array' THEN jsonb_array_length(${t.links}) <= 6 AND NOT jsonb_path_exists(${t.links}, '$[*] ? (!(@.url.type() == "string" && @.url starts with "https://"))') ELSE false END`,
    ),
    index("team_members_visible_position_idx").on(t.visible, t.position),
  ],
);

export type TeamMember = typeof teamMembers.$inferSelect;
