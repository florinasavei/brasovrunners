import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { mediaAssets } from "@/db/schema/gallery";
import type { Database } from "@/db/types";
import { type ImageEncoding, type ProcessedImage, processUploadedImage, storedBytes } from "./images";
import { type ImageQuality, ladderKeyPrefixOf } from "./ladder";
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
};

export function storedImageFacts(processed: ProcessedImage): StoredImageFacts {
  return {
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
