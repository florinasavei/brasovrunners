/**
 * The shared card's geometry, and the arithmetic that keeps every fact on it (`DECISIONS.md` §609).
 *
 * Satori draws every line it is given and never shrinks a text to fit, so a title, a place or a
 * tagline that runs longer than the card pushes the facts under it — and the band with the site's
 * address — off the bottom edge. The layout therefore decides before it draws: `titleRoom` adds up
 * the height of everything on the card but the title, from the same numbers the drawing uses
 * (`SHARE_LAYOUT`), and `shareTitleSize` picks the largest size whose lines — three at most — fit
 * what is left. The drawing (`share-image.tsx`) clips what would still overflow rather than let the
 * band move, but on a card this arithmetic sized, nothing does.
 *
 * Pure: no `node:` builtin, no React, no font file read — the widths below were measured once from
 * the bundled Roboto, so the arithmetic costs nothing on a render.
 */
import { clampPlace, SHARE_CARD_PLACE_MAX } from "./share-card-design";

/** Every size of the layout, per shape — one layout, two sets of numbers. */
export const SHARE_LAYOUT = {
  /** Instagram's feed: a square, downloaded and posted by hand. */
  square: {
    width: 1080,
    height: 1080,
    pad: 72,
    padTop: 72,
    /** The lockup's height: its wordmark must read on a phone, where the card is ~400 pixels wide. */
    logo: 150,
    pill: 30,
    pillPadY: 12,
    pillPadX: 26,
    gap: 30,
    /** Between the title and its rule, and between the rule and the tagline under it. */
    titleGap: 26,
    taglineGap: 22,
    tagline: 48,
    date: 40,
    time: 60,
    factsGap: 18,
    place: 36,
    chip: 32,
    chipPadY: 10,
    chipPadLeft: 16,
    chipPadRight: 22,
    chipsTop: 8,
    glyph: 34,
    band: 104,
    host: 34,
    mark: 44,
    /** The title's sizes, largest first; a sentence-case title of 110 characters lands on 50. */
    steps: [92, 80, 72, 64, 56, 50, 44, 40],
  },
  /** Open Graph: what Facebook, WhatsApp, LinkedIn and X show under a link. */
  og: {
    width: 1200,
    height: 630,
    pad: 56,
    padTop: 46,
    logo: 100,
    pill: 24,
    pillPadY: 9,
    pillPadX: 18,
    gap: 18,
    titleGap: 16,
    /** The tagline sits beside the rule on the wide card, this far from it. */
    taglineGap: 24,
    tagline: 38,
    date: 32,
    time: 46,
    factsGap: 10,
    place: 30,
    chip: 26,
    chipPadY: 7,
    chipPadLeft: 13,
    chipPadRight: 18,
    chipsTop: 4,
    glyph: 28,
    band: 80,
    host: 28,
    mark: 36,
    steps: [72, 64, 56, 50, 46, 42, 38, 34],
  },
} as const;

export type ShareLayoutShape = keyof typeof SHARE_LAYOUT;

/** The line heights the drawing sets, so a text's height is its lines times these. */
export const SHARE_LINE = { title: 1.05, text: 1.2, tagline: 1 } as const;
/** The title's lines, at most. */
export const SHARE_TITLE_LINES = 3;
/** The rule under the title, and the gap between the chips. */
export const SHARE_RULE = { width: 120, height: 6 } as const;
export const SHARE_CHIP_GAP = 14;
/** What the wrap may use of a line: Satori kerns a little tighter than the advance widths add up. */
const WRAP_SLACK = 0.98;

/*
  Each letter's width in ems, the wider of Roboto Regular's and Roboto Bold's advance, rounded up
  to the hundredth (measured from `src/theme/pdf/*.ttf`). One table for both weights: the title
  is bold, the facts regular, and neither is ever narrower than this says. A letter not listed —
  another script, an emoji — counts as 0.8 em, wider than any Latin letter but M and W.
*/
const WIDTHS: ReadonlyArray<readonly [number, string]> = [
  [0.18, "'"],
  [0.23, "’"],
  [0.24, "‘"],
  [0.25, " ,"],
  [0.26, "|"],
  [0.27, ";ijl"],
  [0.28, "![]îíìï"],
  [0.29, ":"],
  [0.3, ".IÎÍ"],
  [0.31, "·"],
  [0.33, '"'],
  [0.34, "`t{}țţ"],
  [0.35, "("],
  [0.36, ")f"],
  [0.37, "r"],
  [0.4, "-"],
  [0.41, "„”“"],
  [0.42, "/"],
  [0.43, "\\"],
  [0.44, "^"],
  [0.46, "*_"],
  [0.5, "?«»"],
  [0.51, "<vxyz"],
  [0.52, "sșş"],
  [0.53, ">cç"],
  [0.54, "k"],
  [0.55, "Laeăâéèêëáàä"],
  [0.56, "FJ"],
  [0.57, "+EbdhnpquüúùñÉÈ"],
  [0.58, "$0123456789=goöóòô"],
  [0.61, "Z"],
  [0.62, "#STYȘȚŞŢ"],
  [0.64, "BKXß"],
  [0.65, "PR"],
  [0.66, "&CDUVÜÚ–"],
  [0.68, "AĂÂÁ"],
  [0.69, "GOQ~ÖÓ"],
  [0.72, "HN"],
  [0.74, "%"],
  [0.75, "…"],
  [0.76, "w"],
  [0.79, "—"],
  [0.88, "Mm"],
  [0.89, "W"],
  [0.9, "@"],
];
const EM = new Map<string, number>(WIDTHS.flatMap(([em, letters]) => Array.from(letters, (letter) => [letter, em] as const)));
const UNKNOWN_EM = 0.8;
/**
 * Caveat, the tagline's face, runs narrower than Roboto: about 0.33 em a letter in a sentence and
 * 0.44 in capitals (measured), so 0.4 for a lower-case letter and 0.55 for any other covers both.
 */
const CAVEAT_EM = { lower: 0.4, other: 0.55 } as const;

/** A text's width in pixels at a size, in Roboto (either weight). */
export function textWidth(text: string, size: number): number {
  let ems = 0;
  for (const letter of text.normalize("NFC")) ems += EM.get(letter) ?? UNKNOWN_EM;
  return ems * size;
}

/**
 * How many lines a text takes in a box `width` pixels wide: broken at its spaces, each line filled
 * before the next begins — the count Satori arrives at, since `textWrap: balance` evens the lines
 * out without adding one. A word wider than the box is broken inside it (`wordBreak: break-word`).
 */
export function lineCount(text: string, size: number, width: number): number {
  const room = width * WRAP_SLACK;
  const space = textWidth(" ", size);
  let lines = 0;
  let line = 0;
  for (const word of text.normalize("NFC").split(/\s+/).filter(Boolean)) {
    const wide = textWidth(word, size);
    if (line > 0 && line + space + wide <= room) {
      line += space + wide;
      continue;
    }
    // A new line, and as many more as a word wider than the box needs.
    const taken = Math.max(1, Math.ceil(wide / room));
    lines += taken;
    line = wide - (taken - 1) * room;
  }
  return Math.max(1, lines);
}

/**
 * The meeting point as it fits one line beside its pin: cut at sixty characters (`clampPlace`), and
 * shorter still, at a word, while it is wider than the line — the square's larger letters fit
 * fewer. The drawing's ellipsis stays as the last guard.
 */
export function placeOnOneLine(place: string, shape: ShareLayoutShape): string {
  const size = SHARE_LAYOUT[shape];
  const room = (size.width - 2 * size.pad - size.glyph - 12) * WRAP_SLACK;
  let max = SHARE_CARD_PLACE_MAX;
  let cut = clampPlace(place, max);
  while (max > 12 && textWidth(cut, size.place) > room) {
    max -= 1;
    cut = clampPlace(place, max);
  }
  return cut;
}

/** What is drawn on the card besides the title — each element switched off or absent takes no room. */
export type ShareCardContent = {
  logo: boolean;
  /** The type's or the cancelled pill's words, or null for no pill. */
  pill: string | null;
  tagline: string | null;
  /** Whether the tagline is drawn in Caveat; false when that file could not be read and Roboto, wider, stands in. Default true. */
  handwriting?: boolean;
  /** The one held-back sentence where the day and the time would be, or null when both are drawn. */
  heldBack: string | null;
  place: string | null;
  /** The distance's and the climb's words. */
  chips: readonly string[];
  /** The paper band at the foot. */
  band: boolean;
};

/** The pill's height: one line of its letters and its padding, with the line round it. */
function pillHeight(shape: ShareLayoutShape): number {
  const size = SHARE_LAYOUT[shape];
  return size.pill * SHARE_LINE.text + 2 * size.pillPadY + 3;
}

/** A chip's height and width, its glyph, its words and its padding, with the line round it. */
function chipHeight(shape: ShareLayoutShape): number {
  const size = SHARE_LAYOUT[shape];
  return Math.max(size.chip * SHARE_LINE.text, size.glyph) + 2 * size.chipPadY + 3;
}
function chipWidth(words: string, shape: ShareLayoutShape): number {
  const size = SHARE_LAYOUT[shape];
  return size.chipPadLeft + size.glyph + 10 + textWidth(words, size.chip) + size.chipPadRight + 3;
}

/** How many rows the chips wrap to across the card's inner width. */
export function chipRows(chips: readonly string[], shape: ShareLayoutShape): number {
  const inner = SHARE_LAYOUT[shape].width - 2 * SHARE_LAYOUT[shape].pad;
  let rows = 0;
  let row = 0;
  for (const chip of chips) {
    const wide = chipWidth(chip, shape);
    if (row > 0 && row + SHARE_CHIP_GAP + wide <= inner) row += SHARE_CHIP_GAP + wide;
    else {
      rows += 1;
      row = wide;
    }
  }
  return rows;
}

/** The tagline's lines: under the rule on the square, beside it on the wide card. */
function taglineLines(tagline: string, shape: ShareLayoutShape, handwriting: boolean): number {
  const size = SHARE_LAYOUT[shape];
  const inner = size.width - 2 * size.pad;
  const room = shape === "square" ? inner : inner - SHARE_RULE.width - size.taglineGap;
  if (!handwriting) return Math.max(1, Math.ceil(textWidth(tagline, size.tagline) / room));
  let ems = 0;
  for (const letter of tagline) ems += letter !== letter.toUpperCase() || letter === " " ? CAVEAT_EM.lower : CAVEAT_EM.other;
  return Math.max(1, Math.ceil((ems * size.tagline) / room));
}

/**
 * The height left for the title: the card, less its paddings, the band, the logo's row, the rule
 * (and the tagline), and the facts — each counted only when it is drawn. The date and time row is
 * counted at 1.1 times the time's size (its baseline alignment draws it at about 1.02).
 */
export function titleRoom(shape: ShareLayoutShape, content: ShareCardContent): number {
  const size = SHARE_LAYOUT[shape];
  const inner = size.width - 2 * size.pad;
  const head = content.logo || content.pill ? Math.max(content.logo ? size.logo : 0, content.pill ? pillHeight(shape) : 0) + size.gap : 0;
  const tagline = content.tagline ? taglineLines(content.tagline, shape, content.handwriting ?? true) * size.tagline * SHARE_LINE.tagline : 0;
  const rule =
    size.titleGap +
    (shape === "square" ? SHARE_RULE.height + (tagline > 0 ? size.taglineGap + tagline : 0) : Math.max(SHARE_RULE.height, tagline));
  const facts = [
    content.heldBack !== null ? lineCount(content.heldBack, size.date, inner) * size.date * SHARE_LINE.text : size.time * 1.1,
    content.place ? size.place * SHARE_LINE.text : null,
    content.chips.length > 0
      ? size.chipsTop + chipRows(content.chips, shape) * (chipHeight(shape) + SHARE_CHIP_GAP) - SHARE_CHIP_GAP
      : null,
  ].filter((height): height is number => height !== null);
  const factsHeight = facts.reduce((sum, height) => sum + height, 0) + (facts.length - 1) * size.factsGap;
  return size.height - (content.band ? size.band : 0) - 2 * size.padTop - head - rule - size.gap - factsHeight;
}

/** The title's height at a size: its lines at the title's line height. */
export function titleHeight(title: string, size: number, shape: ShareLayoutShape): number {
  const inner = SHARE_LAYOUT[shape].width - 2 * SHARE_LAYOUT[shape].pad;
  return lineCount(title, size, inner) * size * SHARE_LINE.title;
}

/**
 * The title's size: the largest step at which it takes three lines at most and those lines fit the
 * room the rest of the card leaves (`titleRoom`). A title that fits no step is drawn at the
 * smallest, where the clamp's 110 characters always fit three lines of sentence case.
 */
export function shareTitleSize(title: string, shape: ShareLayoutShape, room: number): number {
  const { steps, width, pad } = SHARE_LAYOUT[shape];
  const inner = width - 2 * pad;
  const fits = (size: number) => {
    const lines = lineCount(title, size, inner);
    return lines <= SHARE_TITLE_LINES && lines * size * SHARE_LINE.title <= room;
  };
  return steps.find(fits) ?? steps[steps.length - 1];
}
