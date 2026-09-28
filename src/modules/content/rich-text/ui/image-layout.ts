import { CARD_FRAME_ASPECT, frameCrop } from "../domain/picture-frame";
import type { ImageAlignment, ImageCrop, ImageFocus, ImageWidthPercent } from "../domain/schema";

/**
 * Where a picture sits in the text column, as `sx` (amends §73, keeping its reasons where true):
 * - nothing floats below `sm` (at 320 px a third-width float leaves two words a line);
 * - every figure in a body that floats also clears, so two pictures are never side by side (§72);
 * - a body that floats nothing emits no clearing rule, so older bodies render unchanged.
 */
export function imageFigureSx(
  attrs: { align: ImageAlignment; widthPercent: ImageWidthPercent },
  /** Whether *this document* floats a picture anywhere. */
  floats: boolean,
) {
  const floated = attrs.align !== "block";
  return {
    m: 0,
    my: 2,
    mx: floated ? { xs: "auto", sm: 0 } : "auto",
    ...(floated
      ? {
          // Gutter on the inner side only; `auto` below `sm`, where it is a centred band.
          ...(attrs.align === "left"
            ? { mr: { xs: "auto", sm: 3 } as const }
            : { ml: { xs: "auto", sm: 3 } as const }),
          float: { xs: "none", sm: attrs.align } as const,
        }
      : {}),
    // Absent, not "none", in a body that floats nothing (see above).
    ...(floats ? { clear: { xs: "none", sm: "both" } as const } : {}),
    /**
     * Unchanged by the float: a full-width float is not refused here, the editor halves it when a
     * side is chosen.
     */
    width: { xs: "100%", sm: `${attrs.widthPercent}%` },
    maxWidth: "100%",
  } as const;
}

/**
 * A crop in CSS (§241). `object-fit: cover` can pan but not zoom into a corner, so a crop is a
 * window with the crop's `aspect-ratio`, the photograph inside at `100 / w`% width, pulled by
 * `-x / w` and `-y / h`. All fractions, so it holds at any width.
 *
 * `null` without the photograph's stored size: the window's shape cannot be computed, so the
 * picture renders whole.
 */
export type CropGeometry = { aspectRatio: string; width: string; left: string; top: string };

/** Four decimals: finer than any screen, short in the markup. */
const ratio = (value: number) => String(Math.round(value * 10_000) / 10_000);
const percent = (value: number) => `${Math.round(value * 1_000_000) / 10_000}%`;

export function cropGeometry(
  crop: ImageCrop | null | undefined,
  intrinsic: { width?: number | null; height?: number | null },
): CropGeometry | null {
  if (!crop) return null;
  const { width, height } = intrinsic;
  if (!width || !height) return null;
  return {
    aspectRatio: ratio((width * crop.w) / (height * crop.h)),
    width: percent(1 / crop.w),
    left: percent(-crop.x / crop.w),
    top: percent(-crop.y / crop.h),
  };
}

export function cropWindowSx(geometry: CropGeometry) {
  return {
    position: "relative",
    overflow: "hidden",
    width: "100%",
    aspectRatio: geometry.aspectRatio,
    borderRadius: 1,
  } as const;
}

export function cropImageSx(geometry: CropGeometry) {
  return {
    position: "absolute",
    display: "block",
    width: geometry.width,
    height: "auto",
    maxWidth: "none",
    left: geometry.left,
    top: geometry.top,
  } as const;
}

/** The same two rules as inline CSS for the editor, whose Tiptap DOM never sees an `sx`. */
export function cropWindowCss(geometry: CropGeometry): string {
  return `position:relative;overflow:hidden;aspect-ratio:${geometry.aspectRatio}`;
}

export function cropImageCss(geometry: CropGeometry): string {
  return `position:absolute;display:block;width:${geometry.width};height:auto;max-width:none;left:${geometry.left};top:${geometry.top};margin:0;border-radius:0`;
}

/**
 * A listing card's picture in the one 16∶9 frame (§454, reversing §275), drawn with §241's window
 * from `frameCrop`. `null` without a stored size: use `cardCoverSx`. `magnify` feeds `sizes` (§414).
 */
export function cardFrameGeometry(attrs: {
  crop?: ImageCrop | null;
  focus?: ImageFocus | null;
  width?: number | null;
  height?: number | null;
}): { geometry: CropGeometry; magnify: number } | null {
  const { width, height } = attrs;
  if (!width || !height) return null;
  const frame = frameCrop(attrs.crop ?? null, attrs.focus ?? null, { width, height });
  return {
    geometry: {
      aspectRatio: CARD_FRAME_ASPECT,
      width: percent(1 / frame.w),
      left: percent(-frame.x / frame.w),
      top: percent(-frame.y / frame.h),
    },
    magnify: 1 / frame.w,
  };
}

export const CARD_FRAME_SX = {
  position: "relative",
  overflow: "hidden",
  width: "100%",
  aspectRatio: CARD_FRAME_ASPECT,
  borderRadius: 1,
} as const;

/** A picture without a stored size, covering the card's frame at the focal point (approximate). */
export function cardCoverSx(focus: ImageFocus | null | undefined) {
  const at = focus ?? { x: 0.5, y: 0.5 };
  return {
    display: "block",
    width: "100%",
    height: "100%",
    objectFit: "cover",
    objectPosition: `${percent(at.x)} ${percent(at.y)}`,
  } as const;
}

/** The caption follows its picture: centred under a band, against the float's edge otherwise. */
export function imageCaptionSx(attrs: { align: ImageAlignment }) {
  return {
    mt: 1,
    textAlign: attrs.align === "block" ? "center" : { xs: "center", sm: attrs.align },
  } as const;
}
