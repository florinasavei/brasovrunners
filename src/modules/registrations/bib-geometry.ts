/**
 * The race number's geometry, in points, decided once for both renderers (§338; the owner,
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
  /**
   * The race and its date at the right of the band, each at a fixed offset from the card's top
   * rather than centred on the band as a group — `titleTop` when both show, `dateTop` for the
   * date under a title, `dateTopAlone` for the date on its own. Both renderers place them at
   * these same points, which is what keeps the preview the paper rather than a card sized by eye.
   */
  titleSize: 13,
  dateSize: 10.5,
  titleTop: 15,
  dateTop: 34,
  dateTopAlone: 22,
  /** The name: its size, the strip it takes above or below the number, and its offset in the strip. */
  nameSize: 24,
  nameBlock: 44,
  nameTop: 10,
  /**
   * A spare bib's empty name line (§444): a rule centred in the name's strip, where the name's
   * baseline would sit, long enough for a name written in marker and short of the card's edges.
   * Under it, centred, the small mark that says what the bib is — «înscris la fața locului» —
   * `blankMarkSize` points, its top `blankMarkTop` into the strip, inside the strip's 44.
   */
  blankLineWidth: 300,
  blankLineTop: 29,
  blankLineWeight: 1,
  blankMarkTop: 32,
  blankMarkSize: 9,
  /** The sponsors' strip above the small print, and the picture fitted inside it. */
  sponsorHeight: 30,
  sponsorTop: 2,
  sponsorPicture: 24,
  /** The small print's strip for one line; every further line adds `BIB_FOOTER_LINE.lineHeight`. */
  footerHeight: 22,
  /**
   * The members' label (§664) — «Membru {club}» — on a member's header, at its right, under the race
   * and its date: `memberLabelSize` points, centred in a tag `memberTagHeight` tall whose top is
   * `memberTagTop` from the card's top, the text's right edge at the card's inset. On the members'
   * picture the tag is filled (the members' colour, else the event's band) so the words read on any
   * photograph, reaching `memberTagPad` past the text on each side; on a band it is the band itself.
   * Both renderers place it at these points; the number and the name do not move.
   */
  memberLabelSize: 8,
  memberTagTop: 45,
  memberTagHeight: 13,
  memberTagPad: 5,
  /**
   * A member's bib drawn «Tot numărul» (§NNN): the whole card above the small print is the members'
   * background, and the label is a stripe across it, `memberStripeHeight` points tall, its foot on
   * the background's foot — just above the sponsors' strip or the small print, which stay on white.
   * The words are bold, `memberStripeSize` points, `memberStripeSpacing` apart, centred. The stripe's
   * height comes out of the number's area; the name below the number moves up by it, nothing else.
   */
  memberStripeHeight: 20,
  memberStripeSize: 10,
  memberStripeSpacing: 1.2,
  /**
   * The member mark (§NNN): a ring `memberMarkSize` points across with a check mark in it, stroked
   * `memberMarkWeight` thick, at the card's left inset, `memberMarkTop` under the header's foot —
   * clear of the number below it (a number of up to five digits at the largest size still reaches
   * about 44 points from the card's edge, 26 from the inset, so the number sits lower than the mark
   * only by its own centring, never by width) and of the name set above the number, whose box is
   * narrowed on both sides by `memberMarkSize + memberMarkGap` while the mark is drawn
   * (`bibNameReserve`). Large enough to read at A5 and at a half of it.
   */
  memberMarkSize: 26,
  memberMarkGap: 10,
  memberMarkTop: 12,
  memberMarkWeight: 2.4,
  /**
   * The route's profile (§NNN): a row `profileHeight` points tall across the card less its inset,
   * between the name under the number and the small print — a row of its own, so it can never cover
   * the number (which keeps the area that is left) or the name. At the left, the chart: a box
   * `profileChartWidth` × `profileChartHeight`, `profileChartTop` into the row, the line stroked
   * `profileLineWeight` thick over a faint area, with «Start» and «Sosire» under its two ends at
   * `profileLabelSize` points, `profileLabelTop` into the row. At its right, `profileTextGap` away,
   * the distance and the elevation gain in two lines of `profileTextSize` points, their tops
   * `profileDistanceTop` and `profileGainTop` into the row. Both renderers place them at these points.
   */
  profileHeight: 38,
  profileChartWidth: 250,
  profileChartHeight: 24,
  profileChartTop: 3,
  profileLineWeight: 1.2,
  profileAreaOpacity: 0.14,
  profileLabelSize: 6.5,
  profileLabelTop: 28.5,
  profileTextSize: 8,
  profileTextGap: 18,
  profileDistanceTop: 9,
  profileGainTop: 20,
  /**
   * The emergency phone (§NNN): one centred line `emergencyHeight` points tall under the profile's
   * row (or where it would be), `emergencySize` points — a fixed place on every number, never over
   * the number or the name, which keep the area that is left.
   */
  emergencyHeight: 14,
  emergencySize: 9,
} as const;

/**
 * What the profile's row and the emergency line take from the number's area (§NNN): their heights
 * when drawn, nothing when not — so a design with neither keeps every number as it was.
 */
export function bibExtrasHeight(profileDrawn: boolean, emergencyDrawn: boolean): number {
  return (profileDrawn ? BIB_LAYOUT.profileHeight : 0) + (emergencyDrawn ? BIB_LAYOUT.emergencyHeight : 0);
}

/**
 * What the name set above the number gives up on each side while the member mark is drawn (§NNN):
 * the mark's width and a gap, so a long name is cut (ellipsis) at the mark's right edge plus the
 * gap rather than running over the ring. 0 when no mark is drawn; the name below the number is
 * nowhere near the mark and keeps the whole inset-to-inset box.
 */
export function bibNameReserve(markDrawn: boolean, nameAbove: boolean): number {
  return markDrawn && nameAbove ? BIB_LAYOUT.memberMarkSize + BIB_LAYOUT.memberMarkGap : 0;
}

/**
 * The check inside the member mark, as fractions of the mark's box: three points of one stroke,
 * drawn by the sheet with lines and by the picture with an SVG path, so the two cannot differ.
 */
export const MEMBER_MARK_CHECK = [
  [0.27, 0.53],
  [0.43, 0.69],
  [0.74, 0.33],
] as const;

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
