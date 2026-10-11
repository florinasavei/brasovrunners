import { z } from "zod";
import { homeTextSchema, type HomeText } from "./home-text";

/**
 * The photo strip (§NNN; `docs/REDESIGN.md`, decisions 6 and 7): the pictures the club chose from
 * its own gallery, in its order, drawn as a row that scrolls sideways with the thumb (CSS scroll
 * snap, no script), and a link to the club's Instagram — a link, never a feed: an embed is forbidden
 * (AGENTS.md §18.3) and a feed needs a Meta app and a token.
 *
 * **Real club photos only** (decision 6): the strip holds stored pictures of the gallery by id
 * (`media_assets`), never an address typed by hand, so nothing but what the club uploaded can stand
 * in it; whether the people in a picture agreed to the home page is the club's to know before it
 * picks one. **An unset strip is not drawn** (phase 3): no picture, no section — never a stock or a
 * generated stand-in.
 */

/** Six fill the row on a laptop (the plan's «six chosen pictures»); up to twelve scroll. */
export const STRIP_WIDE_COUNT = 6;
export const MAX_STRIP_PICTURES = 12;

export type StripContent = {
  title: HomeText | null;
  /** Stored pictures of the gallery, in the order the club put them, no repeats. */
  pictureIds: readonly string[];
};

export const EMPTY_STRIP: StripContent = { title: null, pictureIds: [] };

export const stripContentSchema = z.object({
  title: homeTextSchema(80),
  pictureIds: z
    .array(z.uuid())
    .max(MAX_STRIP_PICTURES)
    .default([])
    .refine((ids) => new Set(ids).size === ids.length, "a picture is in the strip once"),
});

/** A stored value that no longer parses reads as the empty strip, which is not drawn. */
export function readStripContent(value: unknown): StripContent {
  const parsed = stripContentSchema.safeParse(value);
  return parsed.success ? parsed.data : EMPTY_STRIP;
}

/**
 * The stored pictures the ids still name, in the club's order: a picture deleted from the gallery
 * since is skipped rather than drawn as a hole (the cover's rule, §709), and an id the store returned
 * twice is drawn once.
 */
export function orderStripPictures<T extends { id: string }>(pictureIds: readonly string[], found: readonly T[]): T[] {
  const byId = new Map(found.map((picture) => [picture.id, picture]));
  const seen = new Set<string>();
  const ordered: T[] = [];
  for (const id of pictureIds) {
    const picture = byId.get(id);
    if (!picture || seen.has(id)) continue;
    seen.add(id);
    ordered.push(picture);
  }
  return ordered;
}
