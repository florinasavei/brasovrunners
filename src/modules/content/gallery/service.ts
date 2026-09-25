import { and, eq, sql } from "drizzle-orm";
import {
  galleryAlbumTranslations,
  galleryAlbums,
  galleryItems,
  mediaAssets,
  type GalleryAlbum,
} from "@/db/schema/gallery";
import type { StaffUser } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import { routing } from "@/i18n/routing";
import { processUploadedImage } from "@/modules/media/images";
import type { ImageQuality } from "@/modules/media/ladder";
import { newAssetKeyPrefix, putImageObjects, type StoredImageFacts, storedImageFacts } from "@/modules/media/service";
import { deleteAssetObjects, getStorage } from "@/modules/media/storage";
import { revalidatePublicContent } from "@/modules/public-cache/cache";
import {
  canCreateEvent,
  canEditEventFields,
  canTransition,
  type EditorialStatus,
} from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";
import { albumFieldsSchema, type AlbumFieldsInput } from "./fields";

/**
 * Albums and their photos (BR-REQ-054-01, `DECISIONS.md` §66).
 *
 * The same shape as standing pages — create, save with a version, transition, delete — plus
 * the two things a gallery adds: a photo comes in as bytes and goes out as its ladder of objects (§414) and two
 * rows; and deleting anything that owns objects deletes the objects too, because a bucket
 * nobody sweeps fills with photos nobody can find (§17 "reference check before delete; orphan
 * cleanup"). Objects are removed *after* the rows commit: a row without objects is a broken
 * image somebody notices; an object without a row is a cost nobody does.
 */

type Actor = Pick<StaffUser, "id" | "role">;

function parseOrThrow(value: unknown): AlbumFieldsInput {
  const parsed = albumFieldsSchema.safeParse(value);
  if (!parsed.success) {
    throw new DomainError(
      "VALIDATION_ERROR",
      parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
      [...new Set(parsed.error.issues.map((issue) => issue.path.join(".")))],
    );
  }
  return parsed.data;
}

async function assertSlugsAreFree<T extends Record<string, unknown>>(
  db: Database<T>,
  fields: AlbumFieldsInput,
  exceptAlbumId: string | null,
): Promise<void> {
  for (const locale of routing.locales) {
    const [taken] = await db
      .select({ albumId: galleryAlbumTranslations.albumId })
      .from(galleryAlbumTranslations)
      .where(and(eq(galleryAlbumTranslations.locale, locale), eq(galleryAlbumTranslations.slug, fields.translations[locale].slug)))
      .limit(1);
    if (taken && taken.albumId !== exceptAlbumId) {
      throw new DomainError("VALIDATION_ERROR", `the ${locale} album address is already in use`, [
        `translations.${locale}.slug`,
      ]);
    }
  }
}

export async function createAlbum<T extends Record<string, unknown>>(
  db: Database<T>,
  input: { actor: Actor; fields: unknown; now?: Date },
): Promise<GalleryAlbum> {
  if (!canCreateEvent(input.actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${input.actor.role} may not create an album`);
  }
  const fields = parseOrThrow(input.fields);
  const now = input.now ?? new Date();

  return db.transaction(async (tx) => {
    await assertSlugsAreFree(tx, fields, null);
    const [album] = await tx
      .insert(galleryAlbums)
      .values({
        takenOn: fields.takenOn,
        eventId: fields.eventId,
        createdByStaffUserId: input.actor.id,
        updatedByStaffUserId: input.actor.id,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    await tx.insert(galleryAlbumTranslations).values(
      routing.locales.map((locale) => ({
        albumId: album.id,
        locale,
        slug: fields.translations[locale].slug,
        title: fields.translations[locale].title,
        description: fields.translations[locale].description,
        createdAt: now,
        updatedAt: now,
      })),
    );
    return album;
  });
}

export async function saveAlbum<T extends Record<string, unknown>>(
  db: Database<T>,
  input: { actor: Actor; albumId: string; expectedVersion: number; fields: unknown; now?: Date },
): Promise<GalleryAlbum> {
  if (!canEditEventFields(input.actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${input.actor.role} may not edit an album`);
  }
  const fields = parseOrThrow(input.fields);
  const now = input.now ?? new Date();

  const saved = await db.transaction(async (tx) => {
    await assertSlugsAreFree(tx, fields, input.albumId);
    const [album] = await tx
      .update(galleryAlbums)
      .set({
        takenOn: fields.takenOn,
        eventId: fields.eventId,
        updatedByStaffUserId: input.actor.id,
        version: input.expectedVersion + 1,
        updatedAt: now,
      })
      .where(and(eq(galleryAlbums.id, input.albumId), eq(galleryAlbums.version, input.expectedVersion)))
      .returning();
    if (!album) {
      const [current] = await tx.select().from(galleryAlbums).where(eq(galleryAlbums.id, input.albumId)).limit(1);
      if (!current) throw new DomainError("NOT_FOUND", "no such album");
      throw new DomainError(
        "CONFLICT",
        `this album was saved by someone else: you loaded version ${input.expectedVersion}, the current version is ${current.version}`,
      );
    }
    for (const locale of routing.locales) {
      const translation = fields.translations[locale];
      await tx
        .update(galleryAlbumTranslations)
        .set({ slug: translation.slug, title: translation.title, description: translation.description, updatedAt: now })
        .where(and(eq(galleryAlbumTranslations.albumId, input.albumId), eq(galleryAlbumTranslations.locale, locale)));
    }
    return album;
  });
  // The gallery pages read albums from the public cache (§333); every write below says so.
  revalidatePublicContent("gallery");
  return saved;
}

/**
 * Publish, unpublish, archive — the editorial workflow of §11.2, with one gallery-specific
 * rule: an album with no photo cannot be published. An empty album page is a broken promise.
 */
export async function transitionAlbum<T extends Record<string, unknown>>(
  db: Database<T>,
  input: { actor: Actor; albumId: string; expectedVersion: number; to: EditorialStatus; now?: Date },
): Promise<GalleryAlbum> {
  const now = input.now ?? new Date();
  const moved = await db.transaction(async (tx) => {
    const [current] = await tx.select().from(galleryAlbums).where(eq(galleryAlbums.id, input.albumId)).limit(1);
    if (!current) throw new DomainError("NOT_FOUND", "no such album");

    const isOwnDraft = current.createdByStaffUserId === input.actor.id;
    if (!canTransition(input.actor.role, current.editorialStatus, input.to, isOwnDraft)) {
      throw new DomainError(
        "FORBIDDEN",
        `role ${input.actor.role} may not move an album from ${current.editorialStatus} to ${input.to}`,
      );
    }
    if (input.to === "PUBLISHED") {
      const [{ count }] = await tx
        .select({ count: sql<number>`count(*)` })
        .from(galleryItems)
        .where(eq(galleryItems.albumId, input.albumId));
      if (Number(count) === 0) {
        throw new DomainError("VALIDATION_ERROR", "an album needs at least one photo before it is published");
      }
    }

    const [updated] = await tx
      .update(galleryAlbums)
      .set({
        editorialStatus: input.to,
        publishedAt: input.to === "PUBLISHED" ? (current.publishedAt ?? now) : current.publishedAt,
        updatedByStaffUserId: input.actor.id,
        version: input.expectedVersion + 1,
        updatedAt: now,
      })
      .where(and(eq(galleryAlbums.id, input.albumId), eq(galleryAlbums.version, input.expectedVersion)))
      .returning();
    if (!updated) {
      throw new DomainError(
        "CONFLICT",
        `this album was saved by someone else: you loaded version ${input.expectedVersion}, the current version is ${current.version}`,
      );
    }
    return updated;
  });
  // Published or taken down: the album, the gallery, "Galerie" in every page's navigation.
  revalidatePublicContent("gallery");
  return moved;
}

/**
 * A photo, from the bytes the uploader posted to its ladder of objects (§414) and two rows, at
 * the quality chosen beside the upload.
 *
 * Rows first, inside a transaction, then the objects — and if an object fails to store, the
 * rows are removed again rather than left pointing at nothing. The first photo of an album
 * becomes its cover, so a listing never shows an album as a blank.
 */
export async function addPhoto<T extends Record<string, unknown>>(
  db: Database<T>,
  input: { actor: Actor; albumId: string; file: Buffer; originalFilename: string; quality?: ImageQuality; now?: Date },
): Promise<{ itemId: string; assetId: string; stored: StoredImageFacts }> {
  if (!canEditEventFields(input.actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${input.actor.role} may not add a photo`);
  }
  const now = input.now ?? new Date();
  const storage = getStorage();
  const processed = await processUploadedImage(input.file, { quality: input.quality });
  const keyPrefix = newAssetKeyPrefix();

  const rows = await db.transaction(async (tx) => {
    const [album] = await tx.select({ id: galleryAlbums.id, cover: galleryAlbums.coverMediaAssetId }).from(galleryAlbums).where(eq(galleryAlbums.id, input.albumId)).limit(1);
    if (!album) throw new DomainError("NOT_FOUND", "no such album");

    const [asset] = await tx
      .insert(mediaAssets)
      .values({
        keyPrefix,
        originalFilename: input.originalFilename.slice(0, 255),
        width: processed.width,
        height: processed.height,
        byteSize: processed.web.byteLength,
        createdByStaffUserId: input.actor.id,
        createdAt: now,
        lastReferencedAt: now,
      })
      .returning();

    const [{ next }] = await tx
      .select({ next: sql<number>`coalesce(max(${galleryItems.position}), 0) + 1` })
      .from(galleryItems)
      .where(eq(galleryItems.albumId, input.albumId));
    const [item] = await tx
      .insert(galleryItems)
      .values({ albumId: input.albumId, mediaAssetId: asset.id, position: Number(next), createdAt: now })
      .returning();

    if (!album.cover) {
      await tx.update(galleryAlbums).set({ coverMediaAssetId: asset.id, updatedAt: now }).where(eq(galleryAlbums.id, input.albumId));
    }
    return { itemId: item.id, assetId: asset.id };
  });

  try {
    await putImageObjects(storage, keyPrefix, processed);
  } catch (error) {
    await db.delete(mediaAssets).where(eq(mediaAssets.id, rows.assetId));
    throw error;
  }
  // Only once the objects exist: a cached album pointing at a photo not yet stored is a broken
  // picture on a published page.
  revalidatePublicContent("gallery");
  return { ...rows, stored: storedImageFacts(processed) };
}

/** Remove one photo: its rows, then its objects. A cover that was this photo moves on. */
export async function deletePhoto<T extends Record<string, unknown>>(
  db: Database<T>,
  input: { actor: Actor; itemId: string },
): Promise<void> {
  if (!canEditEventFields(input.actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${input.actor.role} may not remove a photo`);
  }
  const keyPrefix = await db.transaction(async (tx) => {
    const [item] = await tx
      .select({ albumId: galleryItems.albumId, assetId: galleryItems.mediaAssetId, keyPrefix: mediaAssets.keyPrefix })
      .from(galleryItems)
      .innerJoin(mediaAssets, eq(mediaAssets.id, galleryItems.mediaAssetId))
      .where(eq(galleryItems.id, input.itemId))
      .limit(1);
    if (!item) throw new DomainError("NOT_FOUND", "no such photo");

    // The asset row goes; the item cascades from it, and the album's cover reference is set
    // null by its foreign key — then re-pointed at the first remaining photo, if any.
    await tx.delete(mediaAssets).where(eq(mediaAssets.id, item.assetId));
    const [first] = await tx
      .select({ assetId: galleryItems.mediaAssetId })
      .from(galleryItems)
      .where(eq(galleryItems.albumId, item.albumId))
      .orderBy(galleryItems.position)
      .limit(1);
    await tx
      .update(galleryAlbums)
      .set({ coverMediaAssetId: first?.assetId ?? null })
      .where(and(eq(galleryAlbums.id, item.albumId), sql`${galleryAlbums.coverMediaAssetId} IS NULL`));
    return item.keyPrefix;
  });
  revalidatePublicContent("gallery");
  await removeObjects([keyPrefix]);
}

export async function setCover<T extends Record<string, unknown>>(
  db: Database<T>,
  input: { actor: Actor; albumId: string; itemId: string },
): Promise<void> {
  if (!canEditEventFields(input.actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${input.actor.role} may not choose a cover`);
  }
  const [item] = await db
    .select({ assetId: galleryItems.mediaAssetId })
    .from(galleryItems)
    .where(and(eq(galleryItems.id, input.itemId), eq(galleryItems.albumId, input.albumId)))
    .limit(1);
  if (!item) throw new DomainError("NOT_FOUND", "no such photo in this album");
  await db.update(galleryAlbums).set({ coverMediaAssetId: item.assetId }).where(eq(galleryAlbums.id, input.albumId));
  revalidatePublicContent("gallery");
}

/** The album, its translations, its items, its assets — and every object they owned. */
export async function deleteAlbum<T extends Record<string, unknown>>(
  db: Database<T>,
  input: { actor: Actor; albumId: string },
): Promise<void> {
  if (!canEditEventFields(input.actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${input.actor.role} may not delete an album`);
  }
  const prefixes = await db.transaction(async (tx) => {
    const assets = await tx
      .select({ id: mediaAssets.id, keyPrefix: mediaAssets.keyPrefix })
      .from(galleryItems)
      .innerJoin(mediaAssets, eq(mediaAssets.id, galleryItems.mediaAssetId))
      .where(eq(galleryItems.albumId, input.albumId));
    const [deleted] = await tx.delete(galleryAlbums).where(eq(galleryAlbums.id, input.albumId)).returning();
    if (!deleted) throw new DomainError("NOT_FOUND", "no such album");
    for (const asset of assets) await tx.delete(mediaAssets).where(eq(mediaAssets.id, asset.id));
    return assets.map((asset) => asset.keyPrefix);
  });
  revalidatePublicContent("gallery");
  await removeObjects(prefixes);
}

async function removeObjects(prefixes: readonly string[]): Promise<void> {
  const storage = getStorage();
  for (const prefix of prefixes) {
    // Best effort, one by one: the rows are already gone, and a failed delete is a stray
    // object to sweep, not a reason to report the removal as failed. Every file of the ladder
    // too (§414).
    await deleteAssetObjects(storage, prefix);
  }
}
