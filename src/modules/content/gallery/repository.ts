import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { eventTranslations, events } from "@/db/schema/events";
import {
  galleryAlbumTranslations,
  galleryAlbums,
  galleryItems,
  mediaAssets,
  type GalleryAlbum,
} from "@/db/schema/gallery";
import type { Database } from "@/db/types";
import type { Locale } from "@/i18n/routing";
import { getStorage, objectKey } from "@/modules/media/storage";

/**
 * Reads for the gallery, public and backoffice. Public queries name their columns and never
 * `select()` a whole row (BR-REQ-070-01), and read only PUBLISHED albums in the requested
 * locale — no translation row is a 404, never the other language (BR-REQ-040-02).
 */

export type PublicPhoto = {
  id: string;
  position: number;
  width: number;
  height: number;
  webUrl: string;
  thumbUrl: string;
};

export type PublicAlbumSummary = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  takenOn: Date;
  /** When the album row last changed — the sitemap's `lastModified` (§NNN). */
  updatedAt: Date;
  photoCount: number;
  coverThumbUrl: string | null;
};

function urlsFor(keyPrefix: string) {
  const storage = getStorage();
  return { webUrl: storage.publicUrl(objectKey(keyPrefix, "web")), thumbUrl: storage.publicUrl(objectKey(keyPrefix, "thumb")) };
}

const cover = { keyPrefix: mediaAssets.keyPrefix };

export async function listPublishedAlbums<T extends Record<string, unknown>>(
  db: Database<T>,
  locale: Locale,
): Promise<PublicAlbumSummary[]> {
  const rows = await db
    .select({
      id: galleryAlbums.id,
      slug: galleryAlbumTranslations.slug,
      title: galleryAlbumTranslations.title,
      description: galleryAlbumTranslations.description,
      takenOn: galleryAlbums.takenOn,
      updatedAt: galleryAlbums.updatedAt,
      coverKeyPrefix: cover.keyPrefix,
      photoCount: sql<number>`(select count(*) from ${galleryItems} where ${galleryItems.albumId} = ${galleryAlbums.id})`,
    })
    .from(galleryAlbums)
    .innerJoin(
      galleryAlbumTranslations,
      and(eq(galleryAlbumTranslations.albumId, galleryAlbums.id), eq(galleryAlbumTranslations.locale, locale)),
    )
    .leftJoin(mediaAssets, eq(mediaAssets.id, galleryAlbums.coverMediaAssetId))
    .where(eq(galleryAlbums.editorialStatus, "PUBLISHED"))
    .orderBy(desc(galleryAlbums.takenOn), desc(galleryAlbums.publishedAt));

  return rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    takenOn: row.takenOn,
    updatedAt: row.updatedAt,
    photoCount: Number(row.photoCount),
    coverThumbUrl: row.coverKeyPrefix ? urlsFor(row.coverKeyPrefix).thumbUrl : null,
  }));
}

export type PublicAlbum = PublicAlbumSummary & {
  photos: PublicPhoto[];
  /** The event the photos are from, when it is published in this locale. */
  event: { slug: string; title: string } | null;
};

export async function findPublishedAlbumBySlug<T extends Record<string, unknown>>(
  db: Database<T>,
  locale: Locale,
  slug: string,
): Promise<PublicAlbum | undefined> {
  const [row] = await db
    .select({
      id: galleryAlbums.id,
      slug: galleryAlbumTranslations.slug,
      title: galleryAlbumTranslations.title,
      description: galleryAlbumTranslations.description,
      takenOn: galleryAlbums.takenOn,
      updatedAt: galleryAlbums.updatedAt,
      eventId: galleryAlbums.eventId,
      coverKeyPrefix: cover.keyPrefix,
    })
    .from(galleryAlbums)
    .innerJoin(
      galleryAlbumTranslations,
      and(eq(galleryAlbumTranslations.albumId, galleryAlbums.id), eq(galleryAlbumTranslations.locale, locale)),
    )
    .leftJoin(mediaAssets, eq(mediaAssets.id, galleryAlbums.coverMediaAssetId))
    .where(and(eq(galleryAlbums.editorialStatus, "PUBLISHED"), eq(galleryAlbumTranslations.slug, slug)))
    .limit(1);
  if (!row) return undefined;

  const photos = await listPhotos(db, row.id);

  let event: PublicAlbum["event"] = null;
  if (row.eventId) {
    const [linked] = await db
      .select({ slug: eventTranslations.slug, title: eventTranslations.title })
      .from(events)
      .innerJoin(eventTranslations, and(eq(eventTranslations.eventId, events.id), eq(eventTranslations.locale, locale)))
      .where(and(eq(events.id, row.eventId), eq(events.editorialStatus, "PUBLISHED")))
      .limit(1);
    event = linked ?? null;
  }

  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    takenOn: row.takenOn,
    updatedAt: row.updatedAt,
    photoCount: photos.length,
    coverThumbUrl: row.coverKeyPrefix ? urlsFor(row.coverKeyPrefix).thumbUrl : null,
    photos,
    event,
  };
}

/** Every photo of an album in upload order, with the addresses to load it from. */
export async function listPhotos<T extends Record<string, unknown>>(
  db: Database<T>,
  albumId: string,
): Promise<PublicPhoto[]> {
  const rows = await db
    .select({
      id: galleryItems.id,
      position: galleryItems.position,
      width: mediaAssets.width,
      height: mediaAssets.height,
      keyPrefix: mediaAssets.keyPrefix,
    })
    .from(galleryItems)
    .innerJoin(mediaAssets, eq(mediaAssets.id, galleryItems.mediaAssetId))
    .where(eq(galleryItems.albumId, albumId))
    .orderBy(asc(galleryItems.position));
  return rows.map((row) => ({ id: row.id, position: row.position, width: row.width, height: row.height, ...urlsFor(row.keyPrefix) }));
}

export type AlbumListRow = {
  id: string;
  editorialStatus: GalleryAlbum["editorialStatus"];
  /** The optimistic version, so the list can publish and unpublish a row (§256). */
  version: number;
  takenOn: Date;
  title: string;
  photoCount: number;
};

/** The backoffice list: every album, titled in the backoffice's locale, newest first. */
export async function listAlbumsForAdmin<T extends Record<string, unknown>>(
  db: Database<T>,
  locale: Locale,
): Promise<AlbumListRow[]> {
  const rows = await db
    .select({
      id: galleryAlbums.id,
      editorialStatus: galleryAlbums.editorialStatus,
      version: galleryAlbums.version,
      takenOn: galleryAlbums.takenOn,
      title: galleryAlbumTranslations.title,
      photoCount: sql<number>`(select count(*) from ${galleryItems} where ${galleryItems.albumId} = ${galleryAlbums.id})`,
    })
    .from(galleryAlbums)
    .innerJoin(
      galleryAlbumTranslations,
      and(eq(galleryAlbumTranslations.albumId, galleryAlbums.id), eq(galleryAlbumTranslations.locale, locale)),
    )
    .orderBy(desc(galleryAlbums.takenOn));
  return rows.map((row) => ({ ...row, photoCount: Number(row.photoCount) }));
}

export type EditableAlbum = {
  album: GalleryAlbum;
  translations: Array<{ locale: string; slug: string; title: string; description: string | null }>;
  photos: PublicPhoto[];
};

export async function findAlbumForEditor<T extends Record<string, unknown>>(
  db: Database<T>,
  id: string,
): Promise<EditableAlbum | undefined> {
  const [album] = await db.select().from(galleryAlbums).where(eq(galleryAlbums.id, id)).limit(1);
  if (!album) return undefined;
  const translations = await db
    .select({
      locale: galleryAlbumTranslations.locale,
      slug: galleryAlbumTranslations.slug,
      title: galleryAlbumTranslations.title,
      description: galleryAlbumTranslations.description,
    })
    .from(galleryAlbumTranslations)
    .where(eq(galleryAlbumTranslations.albumId, id))
    .orderBy(asc(galleryAlbumTranslations.locale));
  return { album, translations, photos: await listPhotos(db, id) };
}

/**
 * Every locale one published album lives in, with that locale's own slug — its `hreflang`
 * alternates (§NNN). An album that is not published yields nothing.
 */
export async function findPublishedAlbumTranslations<T extends Record<string, unknown>>(
  db: Database<T>,
  albumId: string,
): Promise<Array<{ locale: Locale; slug: string }>> {
  return db
    .select({ locale: galleryAlbumTranslations.locale, slug: galleryAlbumTranslations.slug })
    .from(galleryAlbumTranslations)
    .innerJoin(galleryAlbums, eq(galleryAlbums.id, galleryAlbumTranslations.albumId))
    .where(and(eq(galleryAlbumTranslations.albumId, albumId), eq(galleryAlbums.editorialStatus, "PUBLISHED")));
}

/**
 * The same, for every album in `albumIds` at once — the sitemap's own twin of the single-album
 * version above (§NNN), one query for the whole list rather than one per row.
 */
export async function findPublishedAlbumTranslationsForAlbums<T extends Record<string, unknown>>(
  db: Database<T>,
  albumIds: readonly string[],
): Promise<Array<{ albumId: string; locale: Locale; slug: string }>> {
  if (albumIds.length === 0) return [];
  return db
    .select({ albumId: galleryAlbumTranslations.albumId, locale: galleryAlbumTranslations.locale, slug: galleryAlbumTranslations.slug })
    .from(galleryAlbumTranslations)
    .innerJoin(galleryAlbums, eq(galleryAlbums.id, galleryAlbumTranslations.albumId))
    .where(and(inArray(galleryAlbumTranslations.albumId, albumIds as string[]), eq(galleryAlbums.editorialStatus, "PUBLISHED")));
}

/** The other locale's slug of a published album, for the language switcher (BR-REQ-040-01). */
export async function findPublishedAlbumSiblingSlug<T extends Record<string, unknown>>(
  db: Database<T>,
  fromLocale: Locale,
  slug: string,
  toLocale: Locale,
): Promise<string | undefined> {
  const [row] = await db
    .select({ id: galleryAlbums.id })
    .from(galleryAlbums)
    .innerJoin(
      galleryAlbumTranslations,
      and(eq(galleryAlbumTranslations.albumId, galleryAlbums.id), eq(galleryAlbumTranslations.locale, fromLocale)),
    )
    .where(and(eq(galleryAlbums.editorialStatus, "PUBLISHED"), eq(galleryAlbumTranslations.slug, slug)))
    .limit(1);
  if (!row) return undefined;
  const [sibling] = await db
    .select({ slug: galleryAlbumTranslations.slug })
    .from(galleryAlbumTranslations)
    .where(and(eq(galleryAlbumTranslations.albumId, row.id), eq(galleryAlbumTranslations.locale, toLocale)))
    .limit(1);
  return sibling?.slug;
}

/** Published events, titled in the backoffice locale, for the "from the event" select. */
export async function listEventsForAlbumSelect<T extends Record<string, unknown>>(
  db: Database<T>,
  locale: Locale,
): Promise<Array<{ id: string; title: string; startsAt: Date }>> {
  return db
    .select({ id: events.id, title: eventTranslations.title, startsAt: events.startsAt })
    .from(events)
    .innerJoin(eventTranslations, and(eq(eventTranslations.eventId, events.id), eq(eventTranslations.locale, locale)))
    .orderBy(desc(events.startsAt))
    .limit(200);
}
