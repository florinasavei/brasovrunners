import type { ImageAlignment, ImageWidthPercent } from "../domain/schema";

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
