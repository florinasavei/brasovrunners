import { z } from "zod";
import { homeTextSchema, type HomeText } from "./home-text";

/**
 * The photo strip (§NNN; `docs/REDESIGN.md`, decisions 6 and 7): the pictures the club chose from
 * its own gallery, in its order, drawn as a row that scrolls sideways with the thumb (CSS scroll
 * snap, no script), and a link to the club's Instagram — a link, never a feed: an embed is forbidden
 * (AGENTS.md §18.3) and a feed needs a Meta app and a token.
 *
 * **Real club photos only** (decision 6): the strip holds stored pictures of the gallery
 * (`media_assets`), never an address typed by hand, so nothing but what the club uploaded can stand
 * in it; whether the people in a picture agreed to the home page is the club's to know before it
 * picks one. **An unset strip is not drawn** (phase 3): no picture, no section — never a stock or a
 * generated stand-in.
 *
 * **Each picture keeps its facts beside its id** — the key prefix and the size, copied from the store
 * when the club adds it, as the hero's photograph and an event's cover do (§709) — so the public read
 * asks the store nothing, and the pictures page and the orphan sweep, which look for a picture's key
 * prefix in the setting's text, see it used (`media/references.ts`).
 */

/** Six fill the row on a laptop (the plan's «six chosen pictures»); up to twelve scroll. */
export const STRIP_WIDE_COUNT = 6;
export const MAX_STRIP_PICTURES = 12;

/** One chosen picture: the stored picture's id and the facts the ladder's `srcset` is built from. */
export const stripPictureSchema = z
  .object({
    assetId: z.uuid(),
    keyPrefix: z.string().min(1),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  })
  .strict();
export type StripPictureRef = z.infer<typeof stripPictureSchema>;

export type StripContent = {
  title: HomeText | null;
  /** Stored pictures of the gallery, in the order the club put them, each once. */
  pictures: readonly StripPictureRef[];
};

export const EMPTY_STRIP: StripContent = { title: null, pictures: [] };

export const stripContentSchema = z.object({
  title: homeTextSchema(80),
  pictures: z
    .array(stripPictureSchema)
    .max(MAX_STRIP_PICTURES)
    .default([])
    .refine((pictures) => new Set(pictures.map((picture) => picture.assetId)).size === pictures.length, "a picture is in the strip once")
    .readonly(),
});

/** A stored value that no longer parses reads as the empty strip, which is not drawn. */
export function readStripContent(value: unknown): StripContent {
  const parsed = stripContentSchema.safeParse(value);
  return parsed.success ? parsed.data : EMPTY_STRIP;
}

/**
 * The strip with one picture moved a place towards the start (`up`) or the end (`down`): the move
 * buttons' rule. A picture already first (or last), or one not in the strip, leaves it as it was.
 */
export function moveStripPicture<T extends { assetId: string }>(pictures: readonly T[], assetId: string, direction: "up" | "down"): T[] {
  const next = [...pictures];
  const from = next.findIndex((picture) => picture.assetId === assetId);
  const to = direction === "up" ? from - 1 : from + 1;
  if (from < 0 || to < 0 || to >= next.length) return next;
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}
