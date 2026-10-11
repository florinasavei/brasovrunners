import { z } from "zod";
import type { ImageCrop } from "@/modules/content/rich-text/domain/schema";
import { storedTeamPhotoCrop } from "@/modules/content/team/photo-crop";

/**
 * An event's cover as the public read carries it (the facelift's phase 2, §NNN): the stored
 * picture's key prefix and size — what the ladder's `srcset` is built from (§414, §601) — and the
 * crop the club drew in «Copertă» (§541), or null for the whole picture. Read in SQL beside every
 * other public column (`events/repository.ts`, `cover`), so it travels through the public cache with
 * the row and a card never asks the database about its picture.
 *
 * A film's poster (`yt-…`, §485) is never a cover: the read leaves it out and the save refuses it.
 */
export type PublicCover = { keyPrefix: string; width: number; height: number; crop: ImageCrop | null };

const coverRow = z.object({
  keyPrefix: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  crop: z.unknown().optional(),
});

/**
 * The row's `cover` as a page may draw it, or null: no cover, a picture that left the store, or a
 * value that is not one (a hand-written row). Never throws — a card without its picture is a card,
 * a card that fails is a hole in the listing. A malformed crop reads as the whole picture.
 */
export function readPublicCover(value: unknown): PublicCover | null {
  const parsed = coverRow.safeParse(value);
  if (!parsed.success || parsed.data.keyPrefix.startsWith("yt-")) return null;
  const { keyPrefix, width, height, crop } = parsed.data;
  return { keyPrefix, width, height, crop: storedTeamPhotoCrop(crop) };
}
