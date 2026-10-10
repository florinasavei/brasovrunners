import { sql } from "drizzle-orm";
import { type AnyPgColumn, boolean, check, index, integer, jsonb, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
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
     * The words about them as plain text — both languages or neither. Since §474 the text is
     * written in the rich-text editor and kept in `bio_*_json`; these two carry its words
     * (`richTextToPlainText`), written by every save, so the code serving while a release rolls
     * out still shows something, and a row from before the editor still reads.
     */
    bioRo: text("bio_ro"),
    bioEn: text("bio_en"),
    /**
     * The words about them as the rich-text editor wrote them (§474; the owner: "editoarele
     * trebuie să fie tot așa smart, adică rich text"): paragraphs, lists, a link in the text, a
     * picture — the allowlist of `content/rich-text/domain/schema.ts`, less tables, which a card
     * two to a row has no room for. Null when nothing is written; a row from before reads its
     * plain `bio_*` as paragraphs.
     */
    bioRoJson: jsonb("bio_ro_json"),
    bioEnJson: jsonb("bio_en_json"),
    /**
     * One link the person chose to share — the only one before §474. Kept, and written with the
     * first of `links` by every save, for the code serving while a release rolls out; read only
     * when `links` is null (`content/team/links.ts#readTeamLinks`).
     */
    link: text("link"),
    /**
     * The person's links (§474): an ordered list of at most twelve `{ kind, url, labelRo, labelEn }`
     * — Strava, Instagram, Facebook, a site of their own, anything else — every address https,
     * each label both languages or neither. Null is "no list yet": the one `link` above is read.
     */
    links: jsonb("links"),

    /**
     * The organisational chart (§691; the club's president: «structura organizațională și
     * responsabilități»). One line under the role title — the sub-role, «Parteneriate sportive și
     * echipamente» — both languages or neither (§352), checked at the save.
     */
    subtitleRo: text("subtitle_ro"),
    subtitleEn: text("subtitle_en"),
    /**
     * «Responsabilități»: one responsibility per line, at most twelve lines of 160 characters, both
     * languages or neither; the page draws them as a bullet list under the card's role.
     */
    responsibilitiesRo: text("responsibilities_ro"),
    responsibilitiesEn: text("responsibilities_en"),
    /**
     * Whom this card answers to — another card, by reference (§691): `set null` on delete, never the
     * card itself (the CHECK below), a cycle of any length refused by the save (`service.ts`). Since
     * §701 the page draws no chart from it and the editor offers no box for it: the column stays
     * (expand only), written null by every save that posts nothing, read by nobody.
     */
    reportsToId: uuid("reports_to_id").references((): AnyPgColumn => teamMembers.id, { onDelete: "set null" }),
    /**
     * Where the card sat against the card it answered to (§691): `below` or `beside`. Kept with
     * `reports_to_id` (expand only); the service writes `below` for a card with no parent.
     */
    placement: text("placement").notNull().default("below"),
    /**
     * The card's level on the canvas (§701; the owner: «the president is top level 1, then the
     * advisor level 1.5 and the rest are level 2»). A whole or half step from 1 to 9: the whole
     * number is the row, top first; a `.0` card is the row's lead — wide on row 1, tall under it —
     * and a `.5` card is a small one beside the leads of its row (the president's counsellor). Null
     * is "not on the canvas": the card is drawn in the plain grid, under the canvas when there is one,
     * and while no shown card has a level the whole page is the grid it always was. The range is the
     * CHECK below; the half step is `content/team/fields.ts`'s to refuse. A number in code
     * (`mode: "number"`); `numeric(3, 1)` so `1.5` is stored exactly, never as a float's 1.4999.
     */
    level: numeric("level", { precision: 3, scale: 1, mode: "number" }),

    /**
     * The photograph, stored like every other picture (`media_assets`, §66, §414): the WebP
     * ladder, served with `srcset`. `set null` on delete, so a picture removed from the store
     * leaves a card without a photo, never a card that fails to render. The orphan sweep counts
     * this column as a reference (`media/references.ts`).
     */
    photoMediaAssetId: uuid("photo_media_asset_id").references(() => mediaAssets.id, { onDelete: "set null" }),
    /**
     * The part of the photograph the card shows (§541, amending §474 and §454): the crop box's own
     * four fractions `{ x, y, w, h }` of the stored picture — the JSON a picture in a text keeps
     * as its `crop` (§241) — drawn by the page through the ladder and `srcset`. Null is no crop:
     * the card draws the whole photograph as it did before, a square with the face near the top.
     * Cleared with the photograph; checked at the save (`content/team/fields.ts`), never here.
     */
    photoCrop: jsonb("photo_crop"),

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
     * The links (§474): an array of at most twelve (§491, raised from six), every address https —
     * the guarantee `events_links_is_a_short_array_of_https_links` gives an event's (§332), at the
     * layer that also refuses a seed's or a hand-written `UPDATE`. The six-link version was dropped
     * by migration 0093 and this one added by migration 0094; the number here is
     * `MAX_TEAM_LINKS` (`content/team/links.ts`), and a test holds the two together.
     */
    check(
      "team_members_links_is_a_short_array_of_https_links",
      sql`${t.links} IS NULL OR CASE WHEN jsonb_typeof(${t.links}) = 'array' THEN jsonb_array_length(${t.links}) <= 12 AND NOT jsonb_path_exists(${t.links}, '$[*] ? (!(@.url.type() == "string" && @.url starts with "https://"))') ELSE false END`,
    ),
    index("team_members_visible_position_idx").on(t.visible, t.position),
    /** A card never answers to itself (§691); a longer cycle is the service's to refuse. */
    check("team_members_reports_to_not_self", sql`${t.reportsToId} IS NULL OR ${t.reportsToId} <> ${t.id}`),
    check("team_members_placement_known", sql`${t.placement} IN ('below', 'beside')`),
    /** A level is on the canvas's scale of nine rows or it is nothing (§701); the half step is the save's rule. */
    check("team_members_level_range", sql`${t.level} IS NULL OR (${t.level} >= 1 AND ${t.level} <= 9)`),
  ],
);

export type TeamMember = typeof teamMembers.$inferSelect;

/**
 * «Casetele paginii» (§691): the titled texts under the chart of «Echipa» — a shared
 * responsibility, the partnerships the founder keeps (the partners' logos are pictures in the
 * text), a governance note — any number, in the club's order. A title in both languages, a body in
 * the rich-text editor with a bio's allowlist (paragraphs, lists, links, pictures; no table),
 * both languages or neither (§352). The plain words are written by every save, as a bio's are
 * (§474). A new box starts hidden; showing one is the Administrator's, as a card's «Pe site» is.
 * Nothing about a person: the club's own words.
 */
export const teamPageBoxes = pgTable(
  "team_page_boxes",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    /** The box's heading — «Responsabilitate colectivă» — both languages, always. */
    titleRo: text("title_ro").notNull(),
    titleEn: text("title_en").notNull(),
    /** The text as the editor wrote it; null when nothing is written. */
    bodyRoJson: jsonb("body_ro_json"),
    bodyEnJson: jsonb("body_en_json"),
    /** The text's words (`richTextToPlainText`), written by every save. */
    bodyRo: text("body_ro"),
    bodyEn: text("body_en"),

    /** Where the box sits under the chart, lowest first. */
    position: integer("position").notNull(),
    /** Whether the box is on the site. A new box starts hidden, as a card does. */
    visible: boolean("visible").notNull().default(false),

    createdByStaffUserId: uuid("created_by_staff_user_id").references(() => staffUsers.id, { onDelete: "set null" }),
    updatedByStaffUserId: uuid("updated_by_staff_user_id").references(() => staffUsers.id, { onDelete: "set null" }),

    /** Optimistic concurrency, as `team_members.version` is (AGENTS.md §11.5). */
    version: integer("version").notNull().default(1),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("team_page_boxes_title_ro_present", sql`length(btrim(${t.titleRo})) > 0`),
    check("team_page_boxes_title_en_present", sql`length(btrim(${t.titleEn})) > 0`),
    check("team_page_boxes_position_positive", sql`${t.position} >= 1`),
    check("team_page_boxes_version_positive", sql`${t.version} >= 1`),
    index("team_page_boxes_visible_position_idx").on(t.visible, t.position),
  ],
);

export type TeamPageBox = typeof teamPageBoxes.$inferSelect;
