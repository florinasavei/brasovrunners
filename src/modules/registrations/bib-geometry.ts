/**
 * The race number's geometry, in points, decided once for both renderers (§NNN; the owner,
 * 2026-09-23: "they will be printed on an A4 page so we gonna have 2 per page, basically their
 * format is A5").
 *
 * **A bib is an A5 sheet lying on its side**: half of an A4 portrait page, 595.28 × 420.945
 * points (210 × 148.5 mm, 1:√2). The sheet (`bibs-pdf.ts`) lays two of them on each A4 page, one
 * above the other, and the cut is exactly between them. The picture (`bib-image.tsx`) is the same
 * paper at a screen's size: every box below, multiplied by `BIB_IMAGE_SCALE`. That is the factor
 * §249 promised, taken the whole way — before this the picture was 900×600 (1.5:1) over a card of
 * 1.40:1, so it was squashed, and every size in it had been chosen by eye to make up for that.
 *
 * Pure and importing nothing, like `bib-design.ts` and for the same reason: `bib-footer.ts` takes
 * its measure from here, and so do the pages that show the picture, whose `<img>` declares its
 * size so the box does not jump while the picture loads.
 */

/** An A4 page, portrait, in points: what the club prints on. */
export const A4_PAGE = { width: 595.28, height: 841.89 } as const;

/** One bib: the upper or the lower half of the page, A5 landscape. */
export const BIB_PAPER = { width: A4_PAGE.width, height: A4_PAGE.height / 2 } as const;

/**
 * The white margin inside the paper's edge, the same on all four sides: 18 points (6.35 mm), the
 * inset the design already kept its text at.
 *
 * Wider than an office printer's unprintable edge (about 4 mm) with room for scissors that miss
 * the line by two millimetres, and the same on both bibs of a page — the upper bib's margin at the
 * cut is the lower bib's margin at its top — so every bib of the sheet is the same bib, whichever
 * half it was printed on and however the printer treats the edge of the paper. The band does not
 * bleed to the edge for the same reason: a home printer cannot print there, and a band that
 * reached the cut on one bib and stopped short of the edge on the other would be two designs.
 */
export const BIB_MARGIN = 18;

/** What is printed inside that margin: the band's width, and all the height the number shares. */
export const BIB_CARD = {
  width: BIB_PAPER.width - 2 * BIB_MARGIN,
  height: BIB_PAPER.height - 2 * BIB_MARGIN,
} as const;

/**
 * The card's own layout, in points (§180, §249). The sheet draws these numbers as they are; the
 * picture multiplies each by `BIB_IMAGE_SCALE`. The sizes are the ones the sheet has printed since
 * §180 — the card is as tall as it was, and 20 points wider — so a design the club saved keeps its
 * meaning: the same number, the same name, the same band.
 */
export const BIB_LAYOUT = {
  /** The coloured band across the top of the card, or the club's picture that replaces it. */
  bandHeight: 62,
  /** How far text sits in from the card's sides: the lockup, the race, the name, the small print. */
  inset: 18,
  /** The white lockup at the left of the band, at its own proportion. */
  logoWidth: 122,
  logoRatio: 2.424,
  /** The race and its date at the right of the band. */
  titleSize: 13,
  dateSize: 10.5,
  /** The name: its size, the strip it takes above or below the number, and its offset in the strip. */
  nameSize: 24,
  nameBlock: 44,
  nameTop: 10,
  /** The sponsors' strip above the small print, and the picture fitted inside it. */
  sponsorHeight: 30,
  sponsorTop: 2,
  sponsorPicture: 24,
  /** The small print's strip for one line; every further line adds `BIB_FOOTER_LINE.lineHeight`. */
  footerHeight: 22,
} as const;

/**
 * The small print's line (§317): across the card less the inset on each side — 595.28 − 2 × 18 −
 * 2 × 18 = 523.28 points — set at 8 points, 10 points apart, the last line's top 16 points above
 * the card's foot. `width / size` is the footer's measure in ems, `BIB_FOOTER_EMS` (65.41), which
 * both renderers break the footer against.
 */
export const BIB_FOOTER_LINE = {
  width: BIB_CARD.width - 2 * BIB_LAYOUT.inset,
  size: 8,
  lineHeight: 10,
  lastLineTop: 16,
} as const;

/**
 * The number's size in points before the club's scale (§249): as large as three digits allow,
 * smaller for four and five so they still fit across the card.
 */
export function bibNumberPoints(digits: string, scale: number): number {
  return Math.round((digits.length >= 5 ? 140 : digits.length === 4 ? 175 : 200) * scale);
}

/**
 * The picture's size in pixels: the paper at 990 pixels across. 420.945 × 990 / 595.28 is
 * 700.07, so 990 × 700 is A5 to within a tenth of a pixel — the proportion √2, which is what makes
 * the preview the paper rather than a card of its own.
 */
export const BIB_IMAGE = { width: 990, height: 700 } as const;

/** Pixels per point: what the picture multiplies every length above by. */
export const BIB_IMAGE_SCALE = BIB_IMAGE.width / BIB_PAPER.width;
