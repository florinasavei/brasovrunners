import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { mediaAssets } from "@/db/schema/gallery";
import type { Database } from "@/db/types";
import { type ImageEncoding, type ProcessedImage, processUploadedImage, storedBytes } from "./images";
import { type ImageQuality, ladderKeyPrefixOf } from "./ladder";
import { bodyImageSrc, deleteAssetObjects, getStorage, objectKey, type Storage } from "./storage";

/** What the uploader is told afterwards (§414); the sentence around the facts is the page's. */
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

/** A new asset's opaque prefix, marked as carrying a ladder (`isLadderKeyPrefix`). */
export function newAssetKeyPrefix(): string {
  return ladderKeyPrefixOf(randomUUID());
}

/**
 * Every file of a processed picture into the store; on failure the written files are removed and
 * the error rethrown for the caller to remove its row (§66).
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
 * A picture for a body (BR-REQ-050-03 criterion 8, §72), stored like a gallery photo and answered
 * as the address the image node carries. Tied to no album or page; the sweep takes it once
 * unreferenced (§73).
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

/** The newest asset's thumbnail, a real object for the network check (§436); `null` when none. */
export async function newestThumbnailUrl<T extends Record<string, unknown>>(db: Database<T>): Promise<string | null> {
  const [row] = await db.select({ keyPrefix: mediaAssets.keyPrefix }).from(mediaAssets).orderBy(desc(mediaAssets.createdAt)).limit(1);
  if (!row) return null;
  try {
    return getStorage().publicUrl(objectKey(row.keyPrefix, "thumb"));
  } catch {
    return null;
  }
}
