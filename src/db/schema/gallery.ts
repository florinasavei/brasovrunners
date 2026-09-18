import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { editorialStatus, events } from "./events";
import { locale } from "./locale";
import { staffUsers } from "./staff-users";

/**
 * The photo gallery (BR-REQ-054-01, AGENTS.md §12.10, §17; `DECISIONS.md` §66).
 *
 * Deliberately the small version of the M5 media library: an album is a titled, slugged,
 * published-or-not set of photos, and a photo is a stored image. No captions per photo, no
 * media picker for other content, no original files — "super light", by the owner's word.
 */

/**
 * One uploaded photo, as the two variants the site serves and nothing else.
 *
 * The original never reaches storage: the browser downsizes it before upload (the platform's
 * request limit is the reason, the bucket's size is the reward), and the server re-encodes what
 * arrives into a `web` and a `thumb` WebP after rotating it upright — which is also how every
 * EXIF field, the GPS position included, is dropped (§17). `key_prefix` is opaque; the object
 * keys are `<prefix>/web.webp` and `<prefix>/thumb.webp`, derived in `modules/media/storage.ts`.
 */
export const mediaAssets = pgTable(
  "media_assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    keyPrefix: text("key_prefix").notNull().unique(),
    /** The name the organizer's device gave the file — metadata, never a key (§17). */
    originalFilename: text("original_filename").notNull(),
    /** Of the `web` variant, in pixels and bytes; the thumbnail is derived and not recorded. */
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    byteSize: integer("byte_size").notNull(),
    createdByStaffUserId: uuid("created_by_staff_user_id").references(() => staffUsers.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      "media_assets_dimensions_positive",
      sql`${t.width} > 0 AND ${t.height} > 0 AND ${t.byteSize} > 0`,
    ),
  ],
);

export const galleryAlbums = pgTable(
  "gallery_albums",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    editorialStatus: editorialStatus("editorial_status").notNull().default("DRAFT"),
    publishedAt: timestamp("published_at", { withTimezone: true }),

    /** The event the photos are from, when they are; the album page links back to it. */
    eventId: uuid("event_id").references(() => events.id, { onDelete: "set null" }),
    /** When the photos were taken — what the public list orders by. */
    takenOn: timestamp("taken_on", { withTimezone: true }).notNull(),
    /** The photo the listing shows; null until one is chosen or the first is uploaded. */
    coverMediaAssetId: uuid("cover_media_asset_id").references(() => mediaAssets.id, {
      onDelete: "set null",
    }),

    createdByStaffUserId: uuid("created_by_staff_user_id").references(() => staffUsers.id, {
      onDelete: "set null",
    }),
    updatedByStaffUserId: uuid("updated_by_staff_user_id").references(() => staffUsers.id, {
      onDelete: "set null",
    }),

    version: integer("version").notNull().default(1),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("gallery_albums_version_positive", sql`${t.version} >= 1`),
    check(
      "gallery_albums_published_has_date",
      sql`${t.editorialStatus} <> 'PUBLISHED' OR ${t.publishedAt} IS NOT NULL`,
    ),
    index("gallery_albums_status_taken_on_idx").on(t.editorialStatus, t.takenOn),
  ],
);

export const galleryAlbumTranslations = pgTable(
  "gallery_album_translations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    albumId: uuid("album_id")
      .notNull()
      .references(() => galleryAlbums.id, { onDelete: "cascade" }),
    locale: locale("locale").notNull(),

    slug: text("slug").notNull(),
    title: text("title").notNull(),
    /** A sentence or two under the title. Plain text: a gallery is looked at, not read. */
    description: text("description"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("gallery_album_translations_album_locale_unique").on(t.albumId, t.locale),
    unique("gallery_album_translations_locale_slug_unique").on(t.locale, t.slug),
    check(
      "gallery_album_translations_required_fields_present",
      sql`length(btrim(${t.title})) > 0 AND length(btrim(${t.slug})) > 0`,
    ),
  ],
);

/** A photo's place in an album. Deleting the album deletes the rows; the service deletes the objects. */
export const galleryItems = pgTable(
  "gallery_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    albumId: uuid("album_id")
      .notNull()
      .references(() => galleryAlbums.id, { onDelete: "cascade" }),
    mediaAssetId: uuid("media_asset_id")
      .notNull()
      .references(() => mediaAssets.id, { onDelete: "cascade" }),
    /** Upload order, one-based; the album page shows photos in this order. */
    position: integer("position").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("gallery_items_album_asset_unique").on(t.albumId, t.mediaAssetId),
    check("gallery_items_position_positive", sql`${t.position} >= 1`),
    index("gallery_items_album_position_idx").on(t.albumId, t.position),
  ],
);

export type MediaAsset = typeof mediaAssets.$inferSelect;
export type GalleryAlbum = typeof galleryAlbums.$inferSelect;
export type GalleryAlbumTranslation = typeof galleryAlbumTranslations.$inferSelect;
export type GalleryItem = typeof galleryItems.$inferSelect;
