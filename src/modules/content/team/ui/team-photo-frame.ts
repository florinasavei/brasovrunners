import type { ImageCrop } from "@/modules/content/rich-text/domain/schema";
import { cropGeometry, cropImageSx } from "@/modules/content/rich-text/ui/image-layout";
import { coverMagnification } from "@/modules/media/ladder";

/**
 * How a card of «Echipa» draws its photo (§541) — one rule for the page, the backoffice list and
 * the upload preview. With a crop, §241's window in the crop's own shape (`image-layout.ts`), so
 * the card is as tall as that shape; without one, a covered square with the face near the top.
 * `magnify` feeds `sizes` (§414). Pure, for tests.
 */
export type TeamPhotoFrame =
  | { kind: "crop"; window: { aspectRatio: string }; image: ReturnType<typeof cropImageSx>; magnify: number }
  | { kind: "cover"; image: typeof COVER_SX; magnify: number };

/** The square every card without a crop keeps (§459). */
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
