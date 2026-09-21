import type { ImageAlignment, ImageCrop, ImageWidthPercent } from "../domain/schema";

/**
 * Where a picture sits in the text column, as `sx` — separated from `RichText` because this is
 * the whole of the rule and it is worth reading and testing on its own.
 *
 * ## What this reverses
 *
 * `DECISIONS.md` §73 decided "a picture is a block in the flow, never floated, so two pictures
 * are never side by side". The owner asked for the opposite on 2026-09-20 — "vreau sa pot seta
 * imaginile ca si «inline» ca sa pot scrie text in stanga sau dreapta lor" — and he is right
 * about the common case: a portrait photograph of a runner across a whole column is a banner
 * with a paragraph under it, where every publishing tool lets you put the photograph beside the
 * paragraph. What survives of §73 is the *reason* it gave, narrowed to where it is true:
 *
 * - **On a phone, nothing floats.** 320 pixels is a hard target in this codebase, and a third
 *   of 320 pixels beside a paragraph is two words a line. `float` is a media query from `sm`
 *   up; below it every picture is the full-width band it has always been.
 * - **Two pictures are never side by side.** Every figure in a body that floats anything also
 *   clears, so the second picture drops below the first instead of forming a row. Floating is
 *   a way to write beside *one* picture, not a way to lay out a grid — which is the part of
 *   §72 ("a page is text with pictures, not a layout") that still holds.
 * - **A body that floats nothing is styled exactly as before.** `floats` is false for every
 *   document written before this existed, and a false one emits no clearing rule at all.
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
    // A floated figure sits against its own edge of the column; a band is centred, as before.
    mx: floated ? { xs: "auto", sm: 0 } : "auto",
    ...(floated
      ? {
          // The gutter the text wraps against, on the inner side only, so the picture still
          // reaches the column's edge. `auto` below `sm`, where it is a centred band again.
          ...(attrs.align === "left"
            ? { mr: { xs: "auto", sm: 3 } as const }
            : { ml: { xs: "auto", sm: 3 } as const }),
          float: { xs: "none", sm: attrs.align } as const,
        }
      : {}),
    // Absent, not "none", in a body that floats nothing: such a body emits the styles it
    // emitted before this existed, rather than new rules that happen to be no-ops.
    ...(floats ? { clear: { xs: "none", sm: "both" } as const } : {}),
    /**
     * The share of the column the organizer chose, unchanged by the float: the two questions
     * are "how big" and "where", and answering the second should not silently re-answer the
     * first. A picture floated at the full width is not refused here either — the browser puts
     * the text below it, which is what a band looks like — because the place to stop that is
     * the editor, where choosing a side from a full-width picture halves it and the organizer
     * can see what happened.
     */
    width: { xs: "100%", sm: `${attrs.widthPercent}%` },
    maxWidth: "100%",
  } as const;
}

/**
 * The four numbers that draw a crop, in CSS (`DECISIONS.md` §241).
 *
 * A crop is a *rectangle*, so `object-fit: cover` with an `object-position` cannot express it:
 * cover scales the photograph until it fills the box, which means the visible part always keeps
 * the whole of one dimension — you can pan, you cannot zoom into a corner. The arrangement that
 * can is a window with the photograph inside it:
 *
 * - the window keeps the visible rectangle's own shape (`aspect-ratio`) and hides the rest;
 * - the photograph is laid over it at `100 / w` per cent of the window's width, which is exactly
 *   the magnification that makes the chosen slice fill it;
 * - and it is pulled left and up by the chosen corner — `x / w` of the window's width, `y / h`
 *   of its height, which is where those two percentages resolve against.
 *
 * Everything is a fraction of the window, so the same four numbers are right in a text column,
 * on a listing card and at 320 pixels; nothing here is a pixel.
 *
 * `null` when the picture's own size was never stored — bodies from before the upload route
 * recorded it. The shape of the window cannot be computed without the photograph's own ratio,
 * and a window guessed wrong is a band of background under the picture, so such a picture is
 * rendered whole, exactly as it was.
 */
export type CropGeometry = { aspectRatio: string; width: string; left: string; top: string };

/** Four decimals: finer than any screen this runs on, and short enough to read in the markup. */
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

/** The window, as `sx`: it keeps the crop's shape and hides everything outside it. */
export function cropWindowSx(geometry: CropGeometry) {
  return {
    position: "relative",
    overflow: "hidden",
    width: "100%",
    aspectRatio: geometry.aspectRatio,
    borderRadius: 1,
  } as const;
}

/** The photograph inside that window: magnified and pulled to the chosen corner. */
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

/**
 * The same two rules as inline CSS, for the editor — Tiptap renders its own DOM from strings
 * and never sees an `sx`. One function per rule would be two places where a crop is drawn;
 * these two read the same geometry, so the editor cannot drift from the page.
 */
export function cropWindowCss(geometry: CropGeometry): string {
  return `position:relative;overflow:hidden;aspect-ratio:${geometry.aspectRatio}`;
}

export function cropImageCss(geometry: CropGeometry): string {
  return `position:absolute;display:block;width:${geometry.width};height:auto;max-width:none;left:${geometry.left};top:${geometry.top};margin:0;border-radius:0`;
}

/**
 * The caption under the picture.
 *
 * A caption belongs to its picture, so it follows it: centred under a band, and set against the
 * same edge as the float. Centred under a third-width picture with a paragraph beside it, a
 * caption reads as a stray line in the middle of the text rather than as a caption.
 */
export function imageCaptionSx(attrs: { align: ImageAlignment }) {
  return {
    mt: 1,
    textAlign: attrs.align === "block" ? "center" : { xs: "center", sm: attrs.align },
  } as const;
}
