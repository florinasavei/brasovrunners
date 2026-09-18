import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { mediaAssets } from "@/db/schema/gallery";
import type { Database } from "@/db/types";
import { processUploadedImage } from "./images";
import { getStorage, objectKey } from "./storage";

/**
 * A picture for a body (BR-REQ-050-03 criterion 8, `DECISIONS.md` §72): uploaded from the
 * rich-text editor, stored exactly as a gallery photo is — two WebP variants through the §17
 * adapter, one `media_assets` row — and handed back as the address the image node carries.
 *
 * Not tied to an album, and not tied to the page either: a body references the picture by
 * its address, so the row is the record of what was uploaded, by whom, and how big. A picture
 * removed from a body stays in the store — §17's "reference check before delete" is a sweep
 * for later, and the cost until then is a few hundred kilobytes per forgotten picture.
 */
export async function uploadBodyImage<T extends Record<string, unknown>>(
  db: Database<T>,
  input: { actorId: string; file: Buffer; originalFilename: string; now?: Date },
): Promise<{ assetId: string; src: string; width: number; height: number }> {
  const now = input.now ?? new Date();
  const storage = getStorage();
  const processed = await processUploadedImage(input.file);
  const keyPrefix = randomUUID();

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
    })
    .returning();

  try {
    await storage.put(objectKey(keyPrefix, "web"), processed.web, "image/webp");
    await storage.put(objectKey(keyPrefix, "thumb"), processed.thumb, "image/webp");
  } catch (error) {
    await db.delete(mediaAssets).where(eq(mediaAssets.id, asset.id));
    await storage.delete(objectKey(keyPrefix, "web")).catch(() => undefined);
    throw error;
  }

  return {
    assetId: asset.id,
    src: storage.publicUrl(objectKey(keyPrefix, "web")),
    width: processed.width,
    height: processed.height,
  };
}
