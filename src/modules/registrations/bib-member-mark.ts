import { BIB_LAYOUT } from "./bib-geometry";

/**
 * «Semnul de membru» (§759, amending §750; the owner, 2026-10-13: «semnul BVR de pe număr trebuie să
 * fie altceva, nu doar o bifă, o steluță, sau să aleg eu o iconiță»): the shape a member's number
 * carries under its header, chosen by the club.
 *
 * - `star` — «Steluță», the default: a five-pointed star.
 * - `logo` — «Sigla clubului»: the club's lockup, small, in its own blue (`src/theme/pdf/logo.png`,
 *   the same file both renderers read). The logo is never recoloured (the owner's rule, §711): on a
 *   member's card drawn «Tot numărul» the raster's own white ground is the plate it stands on.
 * - `heart`, `bolt`, `runner`, `check` — «Inimă», «Fulger», «Alergător», «Bifă»: four glyphs of the
 *   Material icon registry the backoffice already draws (Apache 2.0, the `@mui/icons-material` files
 *   `Favorite`, `Bolt`, `DirectionsRun`, `CheckCircle`), copied here as their path data so a printer's
 *   sheet needs no React.
 *
 * **One source for both renderers.** Every vector mark is one SVG path in a 24 × 24 box
 * (`BIB_MEMBER_MARK_VIEWBOX`): the sheet hands it to pdfkit's own SVG path reader (`doc.path(d)`),
 * scaled into the mark's box and filled in the number's ink; the picture draws the same string in an
 * inline `<svg>`. Neither renderer has a drawing of its own, so the paper and the preview cannot differ.
 *
 * Pure, importing only the geometry: the editor's radio list draws each mark from these paths too.
 */
export const BIB_MEMBER_MARKS = ["star", "logo", "heart", "bolt", "runner", "check"] as const;
export type BibMemberMark = (typeof BIB_MEMBER_MARKS)[number];

/** The marks drawn from a path: every one but the club's logo, which is a picture. */
export type BibMemberVectorMark = Exclude<BibMemberMark, "logo">;

/** The box every path below is drawn in, in its own units. */
export const BIB_MEMBER_MARK_VIEWBOX = 24;

/** Each vector mark's path in the 24-unit box, filled (nonzero) — what both renderers draw. */
export const BIB_MEMBER_MARK_PATHS: Readonly<Record<BibMemberVectorMark, string>> = {
  // Material «Star».
  star: "M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z",
  // Material «Favorite».
  heart:
    "m12 21.35-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54z",
  // Material «Bolt».
  bolt: "M11 21h-1l1-7H7.5c-.58 0-.57-.32-.38-.66s.05-.08.07-.12C8.48 10.94 10.42 7.54 13 3h1l-1 7h3.5c.49 0 .56.33.47.51l-.07.15C12.96 17.55 11 21 11 21",
  // Material «DirectionsRun».
  runner:
    "M13.49 5.48c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2m-3.6 13.9 1-4.4 2.1 2v6h2v-7.5l-2.1-2 .6-3c1.3 1.5 3.3 2.5 5.5 2.5v-2c-1.9 0-3.5-1-4.3-2.4l-1-1.6c-.4-.6-1-1-1.7-1-.3 0-.5.1-.8.1l-5.2 2.2v4.7h2v-3.4l1.8-.7-1.6 8.1-4.9-1-.4 2z",
  // Material «CheckCircle».
  check: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2m-2 15-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8z",
};

/** Whether a mark is drawn from a path (every one but the logo). */
export function isVectorMark(mark: BibMemberMark): mark is BibMemberVectorMark {
  return mark !== "logo";
}

/**
 * The mark's box on the card, in points (§750's place): `memberMarkSize` tall at the card's left inset,
 * `memberMarkTop` under the header. A vector mark is that square; the logo keeps its own proportion
 * (`logoRatio`, the lockup's 2.424 : 1), so it is as tall as a star and wider — `bibNameReserve` steps
 * a name set above the number aside by this width.
 */
export function bibMemberMarkBox(mark: BibMemberMark): { width: number; height: number } {
  const size = BIB_LAYOUT.memberMarkSize;
  return mark === "logo" ? { width: Math.round(size * BIB_LAYOUT.logoRatio * 100) / 100, height: size } : { width: size, height: size };
}
