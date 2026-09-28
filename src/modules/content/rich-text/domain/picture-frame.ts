import type { ImageCrop, ImageFocus } from "./schema";

/**
 * Crop presets and the listing card's 16∶9 frame, as pure arithmetic (§454).
 *
 * A preset only draws the crop; what is stored is still §241's four fractions. The card frame is
 * the largest 16∶9 window inside the crop, as near the focal point as it fits, so a row of cards
 * is one height. All values are fractions of the stored photograph; pixel ratios convert through
 * its intrinsic size (`k`), so nothing here works without one (§241).
 */

export const CARD_FRAME_RATIO = 16 / 9;
/** Exact, for CSS `aspect-ratio`. */
export const CARD_FRAME_ASPECT = "16 / 9";

export const CROP_PRESETS = ["free", "16:9", "4:3", "1:1", "4:5"] as const;
export type CropPreset = (typeof CROP_PRESETS)[number];
export type FixedPreset = Exclude<CropPreset, "free">;

/** Width over height, in pixels. */
export const PRESET_RATIOS: Record<FixedPreset, number> = {
  "16:9": 16 / 9,
  "4:3": 4 / 3,
  "1:1": 1,
  "4:5": 4 / 5,
};

/** Pixel size as the upload route recorded it. */
export type Intrinsic = { width: number; height: number };

/** The crop box's floor, per direction. */
export const MIN_FRACTION = 0.05;

const WHOLE: ImageCrop = { x: 0, y: 0, w: 1, h: 1 };
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
/** Four decimals, the precision the schema keeps. */
const round = (value: number) => Math.round(value * 10_000) / 10_000;
const rounded = (crop: ImageCrop): ImageCrop => ({ x: round(crop.x), y: round(crop.y), w: round(crop.w), h: round(crop.h) });

/** `k`: a rectangle of `ratio` that is `w` of the width is `w · k` of the height. */
function heightPerWidth(ratio: number, intrinsic: Intrinsic): number {
  return intrinsic.width / (intrinsic.height * ratio);
}

/** The largest `ratio` rectangle inside `region`, as near `centre` as fits (`object-fit: cover` as a crop). */
function largestInside(region: ImageCrop, ratio: number, intrinsic: Intrinsic, centre: { x: number; y: number }): ImageCrop {
  const k = heightPerWidth(ratio, intrinsic);
  let w = region.w;
  let h = w * k;
  if (h > region.h) {
    h = region.h;
    w = h / k;
  }
  return {
    x: clamp(centre.x - w / 2, region.x, region.x + region.w - w),
    y: clamp(centre.y - h / 2, region.y, region.y + region.h - h),
    w,
    h,
  };
}

const middleOf = (region: ImageCrop) => ({ x: region.x + region.w / 2, y: region.y + region.h / 2 });

/**
 * Centred on the existing crop, so switching presets keeps the subject. `null` when the
 * photograph already has that shape.
 */
export function presetCrop(preset: FixedPreset, intrinsic: Intrinsic, around: ImageCrop | null = null): ImageCrop | null {
  const frame = rounded(largestInside(WHOLE, PRESET_RATIOS[preset], intrinsic, middleOf(around ?? WHOLE)));
  return frame.w >= 0.999 && frame.h >= 0.999 ? null : frame;
}

/** The preset whose ratio is within 1% of the crop's; «Liber» otherwise. */
export function presetOf(crop: ImageCrop | null, intrinsic: Intrinsic): CropPreset {
  if (!crop) return "free";
  const ratio = (crop.w * intrinsic.width) / (crop.h * intrinsic.height);
  for (const preset of CROP_PRESETS) {
    if (preset === "free") continue;
    if (Math.abs(ratio / PRESET_RATIOS[preset] - 1) < 0.01) return preset;
  }
  return "free";
}

/** A drag with the shape held: sized by the larger movement, clipped at the photograph's edge. */
export function drawLocked(
  from: { x: number; y: number },
  to: { x: number; y: number },
  ratio: number,
  intrinsic: Intrinsic,
): ImageCrop {
  const k = heightPerWidth(ratio, intrinsic);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const roomX = dx >= 0 ? 1 - from.x : from.x;
  const roomY = dy >= 0 ? 1 - from.y : from.y;
  const w = Math.max(0, Math.min(Math.max(Math.abs(dx), Math.abs(dy) / k), roomX, roomY / k));
  const h = w * k;
  return {
    x: dx >= 0 ? from.x : from.x - w,
    y: dy >= 0 ? from.y : from.y - h,
    w,
    h,
  };
}

/** `Shift`+arrow with the shape held: resize from the top-left corner, within the floor and the edge. */
export function resizeLocked(crop: ImageCrop, dw: number, ratio: number, intrinsic: Intrinsic): ImageCrop {
  const k = heightPerWidth(ratio, intrinsic);
  const floor = Math.max(MIN_FRACTION, MIN_FRACTION / k);
  const ceiling = Math.min(1 - crop.x, (1 - crop.y) / k);
  const w = clamp(crop.w + dw, Math.min(floor, ceiling), ceiling);
  return rounded({ x: crop.x, y: crop.y, w, h: w * k });
}

export function focalPoint(crop: ImageCrop | null, focus: ImageFocus | null): { x: number; y: number } {
  return focus ?? middleOf(crop ?? WHOLE);
}

/** The card's window; a crop drawn with the 16∶9 preset is its own frame. */
export function frameCrop(
  crop: ImageCrop | null,
  focus: ImageFocus | null,
  intrinsic: Intrinsic,
  ratio: number = CARD_FRAME_RATIO,
): ImageCrop {
  return rounded(largestInside(crop ?? WHOLE, ratio, intrinsic, focalPoint(crop, focus)));
}
