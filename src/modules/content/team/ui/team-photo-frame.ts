import type { ImageCrop } from "@/modules/content/rich-text/domain/schema";
import { cropGeometry, cropImageSx } from "@/modules/content/rich-text/ui/image-layout";
import { coverMagnification } from "@/modules/media/ladder";

/**
 * How a card of «Echipa» draws its photograph (§NNN, amending §474): one rule for the public
 * page, the card on the backoffice list and the preview beside the upload, so the three cannot
 * disagree about what a person looks like.
 *
 * - **With a crop** — what the club drew in the crop box, 1∶1 by default and any of §454's shapes
 *   — the picture is drawn through §241's window: the window keeps the crop's own shape and the
 *   photograph is magnified and pulled so exactly that part fills it (`image-layout.ts`). The
 *   card is as tall as that shape: a 4∶5 portrait is a taller card, because the club chose it.
 * - **Without one** — every card saved before this, and a card whose crop was taken off — exactly
 *   what the page drew before: a square, covered, with the face near the top (`50% 25%`).
 *
 * `magnify` is how much wider than the card the photograph is drawn, for `sizes` (§414).
 * Pure, so a test reads it without a browser.
 */
export type TeamPhotoFrame =
  | { kind: "crop"; window: { aspectRatio: string }; image: ReturnType<typeof cropImageSx>; magnify: number }
  | { kind: "cover"; image: typeof COVER_SX; magnify: number };

/** Today's square: the rule every card without a crop keeps (§459). */
export const COVER_SX = {
  display: "block",
  width: "100%",
  height: "auto",
  aspectRatio: "1 / 1",
  objectFit: "cover",
  objectPosition: "50% 25%",
} as const;

export function teamPhotoFrame(photo: { width: number; height: number; crop: ImageCrop | null }): TeamPhotoFrame {
  const geometry = cropGeometry(photo.crop, photo);
  if (photo.crop && geometry) {
    return { kind: "crop", window: { aspectRatio: geometry.aspectRatio }, image: cropImageSx(geometry), magnify: 1 / photo.crop.w };
  }
  return { kind: "cover", image: COVER_SX, magnify: coverMagnification(photo.width, photo.height, 1) };
}
