import type { ImageCrop } from "@/modules/content/rich-text/domain/schema";
import { type PictureColumn, pictureSizes, pictureSrcSet } from "@/modules/media/ladder";
import { getStorage, objectKey } from "@/modules/media/storage";
import { readPublicCover } from "./domain/cover";

/**
 * Everything an `<img>` needs to draw an event's cover (the facelift's phase 2, §NNN): the master's
 * address, the ladder's `srcset` and `sizes` for the column it is drawn in (§414, §601), the small
 * file for a thumbnail, the picture's own size and the crop the club drew. Built on the server from
 * the public row's `cover` (`domain/cover.ts`), which came through the public cache with the row, so
 * drawing a cover asks the database nothing.
 *
 * Phases 3 to 5 draw it — the home page's cards, the calendar's next-event panel, the listing's
 * cards — as a plain `img` (the plan's visual system: no `next/image`, only the hero eager), the crop
 * as the shop's and the team's pictures lay it out (`TeamPhotoImage`, §541). No public page calls
 * this yet (phase 2 changes none); `tests/unit/events/event-cover.test.ts` holds what it answers.
 */
export type CoverSources = {
  src: string;
  /** Undefined for a picture stored before the ladder (§414): one file, drawn as it always was. */
  srcSet: string | undefined;
  sizes: string;
  thumb: string;
  width: number;
  height: number;
  crop: ImageCrop | null;
};

/**
 * The sources for `cover` (the public row's value) drawn in `column` (a listing card by default),
 * or null when the event has no cover. A cropped picture is drawn magnified by `1 / crop.w` over
 * its window (§241), so `sizes` asks for that much more — the ladder's own rule for a crop.
 */
export function coverSources(cover: unknown, column: PictureColumn = "card"): CoverSources | null {
  const read = readPublicCover(cover);
  if (!read) return null;
  const storage = getStorage();
  const src = storage.publicUrl(objectKey(read.keyPrefix, "web"));
  return {
    src,
    srcSet: pictureSrcSet(src, read.width),
    sizes: pictureSizes(column, 100, read.crop ? 1 / read.crop.w : 1),
    thumb: storage.publicUrl(objectKey(read.keyPrefix, "thumb")),
    width: read.width,
    height: read.height,
    crop: read.crop,
  };
}
