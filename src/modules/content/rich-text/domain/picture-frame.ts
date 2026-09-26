import type { ImageCrop, ImageFocus } from "./schema";

/**
 * The shapes a picture is drawn in, as fractions of the stored photograph (§NNN; the owner,
 * 2026-09-26, of a listing card whose portrait photograph stood twice as tall as its neighbours':
 * "this card looks different than the others… I need some predefined crops and sizes for aspect
 * ratios").
 *
 * Two things live here, both pure arithmetic so the editor, the renderer and the tests read one
 * rule:
 *
 * - **The presets.** Four fixed shapes the crop box (§241) and the upload bar offer — 16∶9, the
 *   card's own; 4∶3, a camera's; 1∶1, a square; 4∶5, Instagram's portrait — plus «Liber», the
 *   free rectangle §241 already drew. A preset is only a way of *drawing* the crop: what is stored
 *   is still the four fractions §241 stores, so the page, the card and every body written before
 *   read it unchanged.
 * - **The card's frame.** Every picture on a listing card is drawn in the same 16∶9 window, so a
 *   row of cards is one height whatever was uploaded. The window covers the part the organizer
 *   cropped (the whole photograph when nothing was) and sits as near as it can to the focal point
 *   the club picked — the middle of that part when nobody picked one.
 *
 * Everything is a fraction: `x`, `y`, `w`, `h` of the stored photograph, as the crop is. A pixel
 * ratio becomes a fraction ratio through the photograph's own size — `k` below — which is why
 * nothing here works for a picture whose size was never stored (§241's refusal, kept).
 */

/** The listing card's picture frame: wide, the shape of a phone held sideways and of a film. */
export const CARD_FRAME_RATIO = 16 / 9;
/** The same, as CSS writes it — exact, rather than a rounded decimal. */
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

/** The photograph's own size in pixels, as the upload route recorded it. */
export type Intrinsic = { width: number; height: number };

/** Never smaller than a twentieth of the picture in either direction — the crop box's own floor. */
export const MIN_FRACTION = 0.05;

const WHOLE: ImageCrop = { x: 0, y: 0, w: 1, h: 1 };
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
/** Four decimals, the precision the schema keeps. */
const round = (value: number) => Math.round(value * 10_000) / 10_000;
const rounded = (crop: ImageCrop): ImageCrop => ({ x: round(crop.x), y: round(crop.y), w: round(crop.w), h: round(crop.h) });

/**
 * How many fractions of the height one fraction of the width is, for a rectangle of `ratio`:
 * a rectangle `w` wide (of the photograph's width) is `w · k` tall (of its height).
 */
function heightPerWidth(ratio: number, intrinsic: Intrinsic): number {
  return intrinsic.width / (intrinsic.height * ratio);
}

/**
 * The largest rectangle of `ratio` inside `region`, centred as near `centre` as it can be while
 * staying inside it. This is `object-fit: cover` written as a crop: the frame keeps the whole of
 * one of the region's dimensions and cuts the other.
 */
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
 * The crop a preset draws: the largest rectangle of its shape in the photograph, centred on the
 * crop already drawn (so switching from 4∶3 to 16∶9 keeps the same subject) or on the middle of
 * the photograph. `null` — the whole picture — when the photograph already has that shape.
 */
export function presetCrop(preset: FixedPreset, intrinsic: Intrinsic, around: ImageCrop | null = null): ImageCrop | null {
  const frame = rounded(largestInside(WHOLE, PRESET_RATIOS[preset], intrinsic, middleOf(around ?? WHOLE)));
  return frame.w >= 0.999 && frame.h >= 0.999 ? null : frame;
}

/**
 * Which preset a stored crop was drawn with, within a hundredth of its ratio — so the crop box
 * opens with the right button pressed and keeps that shape while the rectangle is moved. «Liber»
 * for no crop and for any other shape.
 */
export function presetOf(crop: ImageCrop | null, intrinsic: Intrinsic): CropPreset {
  if (!crop) return "free";
  const ratio = (crop.w * intrinsic.width) / (crop.h * intrinsic.height);
  for (const preset of CROP_PRESETS) {
    if (preset === "free") continue;
    if (Math.abs(ratio / PRESET_RATIOS[preset] - 1) < 0.01) return preset;
  }
  return "free";
}

/**
 * A rectangle dragged with a preset's shape held: from where the drag began, as far towards the
 * pointer as the larger of the two movements says, and never past the photograph's edge in the
 * direction of the drag.
 */
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

/**
 * `Shift` with an arrow, with a preset's shape held: the width grows or shrinks by `dw` and the
 * height follows it, from the same top-left corner, inside the photograph and above the floor.
 */
export function resizeLocked(crop: ImageCrop, dw: number, ratio: number, intrinsic: Intrinsic): ImageCrop {
  const k = heightPerWidth(ratio, intrinsic);
  const floor = Math.max(MIN_FRACTION, MIN_FRACTION / k);
  const ceiling = Math.min(1 - crop.x, (1 - crop.y) / k);
  const w = clamp(crop.w + dw, Math.min(floor, ceiling), ceiling);
  return rounded({ x: crop.x, y: crop.y, w, h: w * k });
}

/**
 * The point the card's frame is centred on: the club's own, or the middle of what was cropped.
 */
export function focalPoint(crop: ImageCrop | null, focus: ImageFocus | null): { x: number; y: number } {
  return focus ?? middleOf(crop ?? WHOLE);
}

/**
 * The part of the photograph a listing card shows: the largest 16∶9 rectangle inside the crop
 * (the whole photograph when there is none), as near the focal point as it can sit. A crop drawn
 * with the 16∶9 preset is its own frame, exactly.
 */
export function frameCrop(
  crop: ImageCrop | null,
  focus: ImageFocus | null,
  intrinsic: Intrinsic,
  ratio: number = CARD_FRAME_RATIO,
): ImageCrop {
  return rounded(largestInside(crop ?? WHOLE, ratio, intrinsic, focalPoint(crop, focus)));
}
