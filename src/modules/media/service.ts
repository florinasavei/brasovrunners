import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { mediaAssets } from "@/db/schema/gallery";
import type { Database } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit/repository";
import { DomainError } from "@/shared/errors/domain-error";
import { type ImageEncoding, type ProcessedImage, processUploadedImage, storedBytes } from "./images";
import { type ImageQuality, ladderKeyPrefixOf } from "./ladder";
import { deleteAssetsNoLongerReferenced } from "./references";
import { bodyImageSrc, deleteAssetObjects, getStorage, objectKey, type Storage } from "./storage";

/**
 * What the person who uploaded a picture is told about it afterwards (§414): the size it was
 * stored at, the choice they made and what "high" turned into, what a wide screen loads, and how
 * many files it became. Facts, not advice — the sentence around them is the page's.
 */
export type StoredImageFacts = {
  width: number;
  height: number;
  quality: ImageQuality;
  encoding: ImageEncoding;
  /** The master, `web.webp`: what a wide screen loads. */
  bytes: number;
  files: number;
  totalBytes: number;
  /** The widest rung below the master (§437): what a laptop at 2× loads; `null` without one. */
  topRung: { width: number; bytes: number } | null;
};

export function storedImageFacts(processed: ProcessedImage): StoredImageFacts {
  const top = processed.rungs.at(-1);
  return {
    topRung: top ? { width: top.width, bytes: top.body.byteLength } : null,
    width: processed.width,
    height: processed.height,
    quality: processed.quality,
    encoding: processed.encoding,
    bytes: processed.web.byteLength,
    files: 2 + processed.rungs.length,
    totalBytes: storedBytes(processed),
  };
}

/**
 * A new asset's opaque prefix: a random UUID marked as carrying a ladder (`ladder.ts`
 * `isLadderKeyPrefix`), which is how a body's `<img>` knows it may ask for the smaller files.
 */
export function newAssetKeyPrefix(): string {
  return ladderKeyPrefixOf(randomUUID());
}

/**
 * Every file of a processed picture into the store. On a failure the files already written are
 * removed again and the error goes on to the caller, who removes its row — a row pointing at a
 * picture that is half there is the broken image §66 says a row must never be.
 */
export async function putImageObjects(storage: Storage, keyPrefix: string, processed: ProcessedImage): Promise<void> {
  try {
    await storage.put(objectKey(keyPrefix, "web"), processed.web, "image/webp");
    await storage.put(objectKey(keyPrefix, "thumb"), processed.thumb, "image/webp");
    for (const rung of processed.rungs) await storage.put(objectKey(keyPrefix, rung.width), rung.body, "image/webp");
  } catch (error) {
    await deleteAssetObjects(storage, keyPrefix);
    throw error;
  }
}

/**
 * A picture for a body (BR-REQ-050-03 criterion 8, `DECISIONS.md` §72): uploaded from the
 * rich-text editor, stored exactly as a gallery photo is — the WebP ladder through the §17
 * adapter, one `media_assets` row — and handed back as the address the image node carries.
 *
 * Not tied to an album, and not tied to the page either: a body references the picture by
 * its address, so the row is the record of what was uploaded, by whom, and how big. A picture
 * removed from a body is swept once nothing has referenced it for a week (§73).
 */
export async function uploadBodyImage<T extends Record<string, unknown>>(
  db: Database<T>,
  input: { actorId: string; file: Buffer; originalFilename: string; quality?: ImageQuality; now?: Date },
): Promise<{ assetId: string; src: string; width: number; height: number; stored: StoredImageFacts }> {
  const now = input.now ?? new Date();
  const storage = getStorage();
  const processed = await processUploadedImage(input.file, { quality: input.quality });
  const keyPrefix = newAssetKeyPrefix();

  const [asset] = await db
    .insert(mediaAssets)
    .values({
      keyPrefix,
      originalFilename: input.originalFilename.slice(0, 255),
      width: processed.width,
      height: processed.height,
      byteSize: processed.web.byteLength,
      createdByStaffUserId: input.actorId,
      createdAt: now,
      lastReferencedAt: now,
    })
    .returning();

  try {
    await putImageObjects(storage, keyPrefix, processed);
  } catch (error) {
    await db.delete(mediaAssets).where(eq(mediaAssets.id, asset.id));
    throw error;
  }

  return {
    assetId: asset.id,
    src: bodyImageSrc(objectKey(keyPrefix, "web")),
    width: processed.width,
    height: processed.height,
    stored: storedImageFacts(processed),
  };
}

/** The place whose reference a replacement moves, for the audit row (§NNN). */
export type PictureReplacementPlace = { kind: "album"; albumId: string; itemId: string };

/**
 * «Înlocuiește» (§NNN, amending §72 and §73): one stored picture replaced in place by a new upload,
 * wherever the caller says it is used. The one verb every place that keeps a picture by its id
 * calls, so they replace alike.
 *
 * - **A new key prefix, always.** Every public address embeds the prefix, and every cache on the
 *   way — the browser's, the CDN's, the rendered page — holds the old bytes under the old address.
 *   Writing new bytes under the old prefix would show the old picture to whoever cached it and
 *   the new one to nobody else; a new prefix is a new address, which no cache has seen.
 * - **The objects first, then one transaction:** the new row, `repoint` (the caller moves its own
 *   references to the new id, and throws to undo everything), the old row deleted only when the
 *   one references predicate says nothing else uses it (another album, a text, a card, a bib
 *   design, a draft — `deleteAssetsNoLongerReferenced`), and the audit row. A failed transaction
 *   removes the new objects again, so no row ever names a picture that is half there.
 * - **Then** `expire` (the public cache tags of the places that moved, written by the caller as
 *   it writes them on a save), and last the old objects, best effort, as a photo's delete does.
 *
 * A picture in a rich text is not replaced here: the text is the reference, and it is not saved
 * yet when the editor replaces its picture, so its old picture waits for the sweep (§73).
 */
export async function replaceStoredPicture<T extends Record<string, unknown>>(
  db: Database<T>,
  input: {
    actor: { id: string };
    oldAssetId: string;
    processed: ProcessedImage;
    originalFilename: string;
    where: PictureReplacementPlace;
    repoint: (tx: Database<T>, ids: { oldAssetId: string; newAssetId: string }) => Promise<void>;
    expire: () => void;
    now?: Date;
  },
): Promise<{ assetId: string; src: string; width: number; height: number; stored: StoredImageFacts; oldDeleted: boolean }> {
  const now = input.now ?? new Date();
  const storage = getStorage();
  const { processed } = input;
  const keyPrefix = newAssetKeyPrefix();

  // Removes what it wrote and throws on a failure: nothing in the database has moved yet.
  await putImageObjects(storage, keyPrefix, processed);

  let outcome: { assetId: string; oldPrefixes: string[] };
  try {
    outcome = await db.transaction(async (tx) => {
      const [old] = await tx.select({ id: mediaAssets.id }).from(mediaAssets).where(eq(mediaAssets.id, input.oldAssetId)).limit(1);
      if (!old) throw new DomainError("NOT_FOUND", "no such picture");

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
        .returning({ id: mediaAssets.id });

      await input.repoint(tx, { oldAssetId: old.id, newAssetId: asset.id });
      const oldPrefixes = await deleteAssetsNoLongerReferenced(tx, [old.id]);

      await recordAuditEvent(tx, {
        actorStaffUserId: input.actor.id,
        action: "media.picture_replaced",
        entityType: "media_asset",
        entityId: asset.id,
        metadata: { from: old.id, to: asset.id, where: input.where, oldDeleted: oldPrefixes.length > 0 },
        now,
      });
      return { assetId: asset.id, oldPrefixes };
    });
  } catch (error) {
    await deleteAssetObjects(storage, keyPrefix);
    throw error;
  }

  // Only once the rows commit, or a cached page points at the old address a moment longer.
  input.expire();
  for (const prefix of outcome.oldPrefixes) {
    // Best effort: the row is gone; a failed delete leaves a stray object, never a broken image.
    await deleteAssetObjects(storage, prefix);
  }

  return {
    assetId: outcome.assetId,
    src: bodyImageSrc(objectKey(keyPrefix, "web")),
    width: processed.width,
    height: processed.height,
    stored: storedImageFacts(processed),
    oldDeleted: outcome.oldPrefixes.length > 0,
  };
}

/**
 * The small picture of the newest stored asset, for the network check (§436): a real object on the
 * host pictures are read from, so a browser that can load it can load the gallery. `null` when no
 * picture is stored yet, or the store is not configured here.
 */
export async function newestThumbnailUrl<T extends Record<string, unknown>>(db: Database<T>): Promise<string | null> {
  const [row] = await db.select({ keyPrefix: mediaAssets.keyPrefix }).from(mediaAssets).orderBy(desc(mediaAssets.createdAt)).limit(1);
  if (!row) return null;
  try {
    return getStorage().publicUrl(objectKey(row.keyPrefix, "thumb"));
  } catch {
    return null;
  }
}
