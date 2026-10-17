import { frameCrop, type Intrinsic } from "@/modules/content/rich-text/domain/picture-frame";
import type { ImageCrop } from "@/modules/content/rich-text/domain/schema";
import { BIB_CARD, BIB_LAYOUT, bibProfileChartWidth } from "./bib-geometry";

/**
 * The bib's two picture places and the one rule that draws a crop in them (§560, amending §249
 * and §485; the owner, 2026-09-29: «la bib designer, la partea cu sponsori, trebuie să pot încărca
 * imagine, și face crop și previzualizare»).
 *
 * - **header** — «Imagine în locul benzii colorate»: the card's whole width by the band's height,
 *   559.28 × 62 points, a shape of about 9 : 1.
 * - **sponsors** — «Bandă cu sponsori»: the card less its inset each side by the strip's picture
 *   height, 523.28 × 24 points, a shape of about 22 : 1.
 * - **memberCard** — a member's bib drawn «Tot numărul» (§NNN): the card's whole width by its height
 *   less the small print's one line, 559.28 × 362.95 points, about 1.54 : 1. A footer of two lines or
 *   a sponsors' strip covers the photograph's foot in white; the shape stays the same.
 * - **profile** — «O poză încărcată» for the route's profile (§759): the strip's whole width by the
 *   picture's height, 523.28 × 36 points. Never cropped: the picture is fitted whole, across the strip
 *   or beside the figures (`bibProfileChartWidth`), so the place's shape is only its largest box.
 *
 * Each place has one fixed shape: the crop box draws only rectangles of it, and what is stored is
 * §241's four fractions of the photograph, like every other crop. The sheet (`bibs-pdf.ts`), the
 * picture of one bib (`bib-image.tsx`) and the editor's preview all draw through
 * `bibPictureDrawing`, so the three show the same part of the picture — §541's «one rule draws it».
 *
 * Pure, importing only pure modules: the client's crop box reads the shapes from here too.
 */

export const BIB_PICTURE_SLOTS = ["header", "sponsors", "memberCard", "profile"] as const;
export type BibPictureSlot = (typeof BIB_PICTURE_SLOTS)[number];

/** Each place's box on the paper, in points (`bib-geometry.ts`). */
export const BIB_PICTURE_BOX: Record<BibPictureSlot, { width: number; height: number }> = {
  header: { width: BIB_CARD.width, height: BIB_LAYOUT.bandHeight },
  sponsors: { width: BIB_CARD.width - 2 * BIB_LAYOUT.inset, height: BIB_LAYOUT.sponsorPicture },
  memberCard: { width: BIB_CARD.width, height: BIB_CARD.height - BIB_LAYOUT.footerHeight },
  profile: { width: BIB_CARD.width - 2 * BIB_LAYOUT.inset, height: BIB_LAYOUT.profilePictureHeight },
};

/** Each place's shape, width over height: about 9.02 for the header, 21.8 for the sponsors, 1.54 for a member's card. */
export const BIB_PICTURE_RATIO: Record<BibPictureSlot, number> = {
  header: BIB_PICTURE_BOX.header.width / BIB_PICTURE_BOX.header.height,
  sponsors: BIB_PICTURE_BOX.sponsors.width / BIB_PICTURE_BOX.sponsors.height,
  memberCard: BIB_PICTURE_BOX.memberCard.width / BIB_PICTURE_BOX.memberCard.height,
  // The largest box the profile's picture is fitted in — the strip alone — by the one rule for its shape (`bibProfilePictureRatio`).
  profile: bibProfilePictureRatio(false),
};

/**
 * **The one rule for the profile picture's shape** (§804; the owner, 2026-10-16: «if we choose to put a picture, we need to
 * say what is the aspect ratio recommended for it»): the box the picture is fitted whole in — `bibProfileChartWidth`
 * wide, `profilePictureHeight` tall — as width over height, for the design's current «Arată distanța și diferența de
 * nivel». The crop box's «Forma» line (`BIB_PICTURE_RATIO.profile`) and the sentence the panel prints
 * before the upload (`bibProfilePictureExample`) both come from here, never from a number typed in a message.
 */
export function bibProfilePictureRatio(figuresShown: boolean): number {
  return bibProfileChartWidth(figuresShown) / BIB_LAYOUT.profilePictureHeight;
}

/** The print resolution the recommended example size is given at: dots per inch, the usual one for a picture on paper. */
export const BIB_PICTURE_PRINT_DPI = 300;

/**
 * An example size for the profile picture, in pixels, at `BIB_PICTURE_PRINT_DPI` over the picture's box on the paper (72
 * points an inch), rounded to tens: for the strip beside the figures about 1 580 × 150, alone about 2 180 × 150. The
 * proportion is `bibProfilePictureRatio`'s, to within the rounding.
 */
export function bibProfilePictureExample(figuresShown: boolean): { width: number; height: number } {
  const pixels = (points: number) => Math.round(((points / 72) * BIB_PICTURE_PRINT_DPI) / 10) * 10;
  return { width: pixels(bibProfileChartWidth(figuresShown)), height: pixels(BIB_LAYOUT.profilePictureHeight) };
}

/**
 * What a place does with a picture that has no crop — every design saved before crops existed, and
 * the sponsors' «Toată imaginea»: the header covers its strip from the middle, as it always did;
 * the sponsors' strip fits the whole picture inside itself, undistorted, as it always did.
 */
export const BIB_PICTURE_UNCROPPED: Record<BibPictureSlot, "cover" | "fit"> = { header: "cover", sponsors: "fit", memberCard: "cover", profile: "fit" };

/**
 * How a renderer draws a place's picture inside a box of the place's shape (in the renderer's own
 * units — points on the sheet, pixels in the picture):
 *
 * - `crop`: the picture scaled to `width` × `height` and placed at `left`, `top` (both zero or
 *   less) inside the box, which clips it — so exactly the cropped part fills the box;
 * - `cover` / `fit`: no crop, `BIB_PICTURE_UNCROPPED`'s behaviour.
 *
 * The part drawn is the largest rectangle of the place's shape inside the crop, centred on it
 * (`frameCrop`, the listing card's own rule): a crop the box drew is already that shape and is
 * drawn exactly; a crop stored with a slightly different shape — rounding, a hand-made query — is
 * trimmed to it rather than squashed. Without the photograph's size the crop is taken as it is.
 */
export type BibPictureDrawing =
  | { kind: "crop"; left: number; top: number; width: number; height: number }
  | { kind: "cover" | "fit" };

export function bibPictureDrawing(
  slot: BibPictureSlot,
  crop: ImageCrop | null,
  intrinsic: Intrinsic | null,
  box: { width: number; height: number } = BIB_PICTURE_BOX[slot],
): BibPictureDrawing {
  return pictureDrawingIn(box, BIB_PICTURE_RATIO[slot], BIB_PICTURE_UNCROPPED[slot], crop, intrinsic);
}

/**
 * The same rule for a place whose shape is not one of the bib's — a volunteer badge's header (§764),
 * whose shape follows the size the club chose: `ratio` is the place's width over its height, `uncropped`
 * what it does with no crop. A crop drawn at another size is trimmed to this one, centred, never squashed.
 */
export function pictureDrawingIn(
  box: { width: number; height: number },
  ratio: number,
  uncropped: "cover" | "fit",
  crop: ImageCrop | null,
  intrinsic: Intrinsic | null,
): BibPictureDrawing {
  if (!crop) return { kind: uncropped };
  const frame = intrinsic && intrinsic.width > 0 && intrinsic.height > 0 ? frameCrop(crop, null, intrinsic, ratio) : crop;
  if (frame.w <= 0 || frame.h <= 0) return { kind: uncropped };
  const width = box.width / frame.w;
  const height = box.height / frame.h;
  return { kind: "crop", left: -frame.x * width, top: -frame.y * height, width, height };
}
