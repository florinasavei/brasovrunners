import { A4_MM, type Box, QUIET_ZONE_MODULES, TEXT_METRICS, fitInside } from "./sheets";

/**
 * The YouTube poster's geometry (§NNN), in millimetres: the owner's approved A4 of 2026-11-20 — the logo; «Suntem pe» over a
 * red rounded play button beside «YouTube»; one line saying what the channel holds; the code in a card framed in the primary,
 * a «SCANEAZĂ-MĂ» tab on its top edge; how to scan it; the address without its scheme; the club's hashtags at the foot; a
 * rounded frame in the primary 7 mm in from the edge.
 *
 * Pure: the renderer (`poster-pdf.ts`) measures the words with the font and hands their widths in; this says where everything
 * goes, top to bottom, and `tests/unit/pr-kit/poster.test.ts` holds it inside the frame, nothing over anything, and the code's
 * quiet zone — four modules on every side — clear of the card's border and its tab.
 *
 * **The code is as large as its quiet zone allows inside the card**: the card's inside is 112 mm wide, the code a square
 * `112 × N / (N + 8)` mm for a code of N modules — about 90 mm for a channel's address — and the card is as much taller as
 * the tab reaches into it, so the zone under the tab is four modules too.
 */

const PAGE = A4_MM;

/** The frame: 7 mm in from the edge, 1.6 mm wide, its outer corner 9 mm round. */
export const POSTER_FRAME = { inset: 7, stroke: 1.6, radius: 9 } as const;

/** The content's column: 16 mm from either edge. */
export const POSTER_COLUMN = { x: 16, width: PAGE.width - 32 } as const;

/** The sizes the words are set in, and the gaps between the rows. */
export const POSTER = {
  logo: { top: 15, width: 66, height: 28 },
  kicker: { gap: 6, size: 18 },
  brand: { gap: 3.5, button: { width: 38, height: 27, radius: 7.5 }, triangle: { width: 13, height: 15, nudge: 1 }, size: 30, spacing: 6 },
  lead: { gap: 6, size: 6, leading: 1.35, width: 160 },
  card: { gap: 9.5, inner: 112, border: 1.4, radius: 7 },
  tab: { size: 5.6, letterSpacing: 0.9, padX: 7, padY: 2.4, radius: 5 },
  scan: { gap: 5, size: 5.4 },
  address: { gap: 2.5, size: 7.8 },
  tags: { size: 5.2, letterSpacing: 0.2, bottom: 15 },
} as const;

export type PosterInput = {
  /** The code's modules on a side. */
  modules: number;
  /** How many lines the lead wraps to in its width. */
  leadLines: number;
  /** The logo's drawing, height over width. */
  logoAspect: number;
  /** «YouTube», measured at its size. */
  brandWordWidth: number;
  /** «SCANEAZĂ-MĂ», measured at its size with its spacing. */
  tabTextWidth: number;
};

export type PosterLayout = {
  frame: Box;
  logo: Box;
  kicker: { baseline: number; size: number; box: Box };
  button: Box;
  triangle: Box;
  word: { x: number; baseline: number; size: number; box: Box };
  lead: { firstBaseline: number; lineHeight: number; size: number; box: Box };
  card: Box;
  tab: { box: Box; baseline: number; size: number };
  code: Box;
  scan: { baseline: number; size: number; box: Box };
  address: { baseline: number; size: number; box: Box };
  tags: { baseline: number; size: number; box: Box };
};

/** A line of words across the column: its box from the cap height to the descent, `top` its cap's top. */
function row(top: number, size: number): { baseline: number; size: number; box: Box } {
  return { baseline: top + size * TEXT_METRICS.cap, size, box: { x: POSTER_COLUMN.x, y: top, width: POSTER_COLUMN.width, height: size * (TEXT_METRICS.cap + TEXT_METRICS.descent) } };
}

const bottomOf = (box: Box) => box.y + box.height;

export function posterLayout(input: PosterInput): PosterLayout {
  const centre = PAGE.width / 2;
  const half = POSTER_FRAME.stroke / 2;
  // The frame's line, drawn along its middle: its outer edge 7 mm in.
  const frame: Box = { x: POSTER_FRAME.inset + half, y: POSTER_FRAME.inset + half, width: PAGE.width - 2 * POSTER_FRAME.inset - POSTER_FRAME.stroke, height: PAGE.height - 2 * POSTER_FRAME.inset - POSTER_FRAME.stroke };

  const fitted = fitInside({ x: 0, y: 0, width: POSTER.logo.width, height: POSTER.logo.height }, input.logoAspect);
  const logo: Box = { x: centre - fitted.width / 2, y: POSTER.logo.top, width: fitted.width, height: fitted.height };

  const kicker = row(bottomOf(logo) + POSTER.kicker.gap, POSTER.kicker.size);

  const { button: buttonSize, triangle: triangleSize } = POSTER.brand;
  const brandTop = bottomOf(kicker.box) + POSTER.brand.gap;
  const brandWidth = buttonSize.width + POSTER.brand.spacing + input.brandWordWidth;
  const button: Box = { x: centre - brandWidth / 2, y: brandTop, width: buttonSize.width, height: buttonSize.height };
  const triangle: Box = {
    x: button.x + (button.width - triangleSize.width) / 2 + triangleSize.nudge,
    y: button.y + (button.height - triangleSize.height) / 2,
    width: triangleSize.width,
    height: triangleSize.height,
  };
  // The word's capitals centred on the button.
  const wordCap = POSTER.brand.size * TEXT_METRICS.cap;
  const wordTop = button.y + (button.height - wordCap) / 2;
  const wordX = button.x + button.width + POSTER.brand.spacing;
  const word = {
    x: wordX,
    baseline: wordTop + wordCap,
    size: POSTER.brand.size,
    box: { x: wordX, y: wordTop, width: input.brandWordWidth, height: POSTER.brand.size * (TEXT_METRICS.cap + TEXT_METRICS.descent) },
  };

  const leadTop = Math.max(bottomOf(button), bottomOf(word.box)) + POSTER.lead.gap;
  const lineHeight = POSTER.lead.size * POSTER.lead.leading;
  const leadHeight = (input.leadLines - 1) * lineHeight + POSTER.lead.size * (TEXT_METRICS.cap + TEXT_METRICS.descent);
  const lead = {
    firstBaseline: leadTop + POSTER.lead.size * TEXT_METRICS.cap,
    lineHeight,
    size: POSTER.lead.size,
    box: { x: centre - POSTER.lead.width / 2, y: leadTop, width: POSTER.lead.width, height: leadHeight },
  };

  // The tab straddles the card's top border, its middle on the border's middle.
  const tabHeight = 2 * POSTER.tab.padY + POSTER.tab.size * (TEXT_METRICS.cap + TEXT_METRICS.descent);
  const tabWidth = 2 * POSTER.tab.padX + input.tabTextWidth;
  const cardTop = bottomOf(lead.box) + POSTER.card.gap;
  const borderMiddle = cardTop + POSTER.card.border / 2;
  const tabBox: Box = { x: centre - tabWidth / 2, y: borderMiddle - tabHeight / 2, width: tabWidth, height: tabHeight };
  const insideTop = cardTop + POSTER.card.border;
  // How far the tab reaches into the card's inside: the code starts its quiet zone below it.
  const intrusion = Math.max(0, bottomOf(tabBox) - insideTop);
  const inner = POSTER.card.inner;
  const side = (inner * input.modules) / (input.modules + 2 * QUIET_ZONE_MODULES);
  const zone = (QUIET_ZONE_MODULES * side) / input.modules;
  const card: Box = { x: centre - inner / 2 - POSTER.card.border, y: cardTop, width: inner + 2 * POSTER.card.border, height: inner + intrusion + 2 * POSTER.card.border };
  const code: Box = { x: centre - side / 2, y: insideTop + intrusion + zone, width: side, height: side };
  // Its capitals centred in it: an upper-case word has nothing below the baseline.
  const tab = { box: tabBox, baseline: tabBox.y + (tabHeight + POSTER.tab.size * TEXT_METRICS.cap) / 2, size: POSTER.tab.size };

  const scan = row(bottomOf(card) + POSTER.scan.gap, POSTER.scan.size);
  const address = row(bottomOf(scan.box) + POSTER.address.gap, POSTER.address.size);
  const tagsBaseline = PAGE.height - POSTER.tags.bottom;
  const tagsTop = tagsBaseline - POSTER.tags.size * TEXT_METRICS.cap;
  const tags = { baseline: tagsBaseline, size: POSTER.tags.size, box: { x: POSTER_COLUMN.x, y: tagsTop, width: POSTER_COLUMN.width, height: POSTER.tags.size * (TEXT_METRICS.cap + TEXT_METRICS.descent) } };

  return { frame, logo, kicker, button, triangle, word, lead, card, tab, code, scan, address, tags };
}
