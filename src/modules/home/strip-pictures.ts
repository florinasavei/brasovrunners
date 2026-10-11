import { coverMagnification, pictureSizes, pictureSrcSet } from "@/modules/media/ladder";
import { getStorage, objectKey } from "@/modules/media/storage";

/**
 * Everything the strip's `<img>` needs, built on the server from a stored picture of the gallery
 * (§NNN): the master's address, the ladder's `srcset` and `sizes` for the strip's square tile (§414,
 * §601 — a phone downloads a rung its tile needs, never the 2400-pixel master), the picture's own
 * size, and the words a screen reader hears. A picture stored before the ladder has no `srcset` and
 * draws its thumbnail, as every older picture does (§414).
 *
 * The wiring reads the ids the setting holds from `media_assets`, puts them in the club's order
 * (`orderStripPictures`) and hands them here; this asks the database nothing.
 */
export type StripPicture = {
  id: string;
  src: string;
  srcSet: string | undefined;
  sizes: string | undefined;
  width: number;
  height: number;
  /** What the picture shows, in the reader's language; empty for a picture the strip uses as decoration. */
  alt: string;
};

/**
 * A stored picture as the store holds it (`media_assets`): its key prefix and its size. The alt is
 * required: gallery photos carry none of their own, so the wiring passes the album-based text
 * (`Gallery.photoAlt`) or a chosen empty string, never a silent default.
 */
export type StoredStripPicture = { id: string; keyPrefix: string; width: number; height: number; alt: string };

/** The strip's tile is a square: a wider photograph is cut to it, so the rung is chosen that much wider. */
export const STRIP_TILE_RATIO = 1;

export function stripPictures(stored: readonly StoredStripPicture[]): StripPicture[] {
  const storage = getStorage();
  return stored
    .filter((picture) => !picture.keyPrefix.startsWith("yt-"))
    .map((picture) => {
      const master = storage.publicUrl(objectKey(picture.keyPrefix, "web"));
      const srcSet = pictureSrcSet(master, picture.width);
      return {
        id: picture.id,
        // The thumbnail is the `src`, as on the album page: a browser that reads `srcset` chooses a
        // rung from it, and one that does not gets the small file rather than the master.
        src: storage.publicUrl(objectKey(picture.keyPrefix, "thumb")),
        srcSet,
        sizes: srcSet ? pictureSizes("strip", 100, coverMagnification(picture.width, picture.height, STRIP_TILE_RATIO)) : undefined,
        width: picture.width,
        height: picture.height,
        alt: picture.alt.trim(),
      };
    });
}
