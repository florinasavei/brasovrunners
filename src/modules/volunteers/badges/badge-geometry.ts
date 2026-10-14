/**
 * The volunteer badge's geometry, in points, decided once for both renderers (§NNN) — the bib's
 * discipline (§338, §755): the sheet (`badges-pdf.ts`, pdfkit) draws these numbers as they are, the
 * picture (`badge-image.tsx`, Satori) multiplies each by its own scale, and neither wraps a word by
 * itself: every line of text is fitted here, shrunk step by step and only then cut with «…», measured
 * by the font tables the bib's header and small print are measured by (`bib-header.ts`,
 * `bib-footer.ts`), which are never narrower than either renderer sets a line.
 *
 * **A badge is a small, long strip** (the owner, 2026-10-14: «Badge-urile sunt de obicei mai mici și
 * mai lungi și fără nume, numele îl scriem manual cu markerul»): 90 × 35 mm by default, 100 × 40 mm,
 * or the club's own size within `BADGE_CUSTOM_BOUNDS`. Inside a white border of `BADGE_INSET` — the
 * room scissors that miss the line by a millimetre need, as the bib's margin is (§338) — four rows, top
 * to bottom:
 *
 * 1. **the header band**: the band's colour (or the club's picture across it), the club's logo at its
 *    left on its own white ground, the event's short title at its right;
 * 2. **the role's band**, in the role's colour: «VOLUNTAR» small above the role's name, large — or, on a
 *    badge «fără rol», «VOLUNTAR» alone, large;
 * 3. **the writing area**, white: «Nume:» at its top left and, when the club wants it, one faint line
 *    for the marker. It never has less than `BADGE_WRITING_MIN` of height: when the size leaves less,
 *    the two bands above give up their share (`badgeRows`);
 * 4. **the coordinator's telephone**, one small line, when the club ticks it.
 *
 * Every height is a share of the badge's content (`BADGE_LAYOUT`), so a larger badge is the same badge,
 * larger. Pure: imports the bib's pure measure and A4 only.
 */

import { A4_PAGE, BIB_TEXT_LINE } from "@/modules/registrations/bib-geometry";
import { withEllipsis } from "@/modules/registrations/bib-type";

/** Points in a millimetre. */
export const MM = 72 / 25.4;

/** The sizes a badge comes in (§NNN): the default strip, a larger one, and the club's own. */
export const BADGE_SIZES = ["strip90", "strip100", "custom"] as const;
export type BadgeSize = (typeof BADGE_SIZES)[number];

/** The two presets, in millimetres: small and long, the owner's word for a badge. */
export const BADGE_SIZE_PRESETS = {
  strip90: { widthMm: 90, heightMm: 35 },
  strip100: { widthMm: 100, heightMm: 40 },
} as const;

/**
 * «Altă dimensiune»'s bounds, in whole millimetres: no narrower than a role's name reads on, no wider
 * than an A4 page less its margins (one column), and tall enough that the writing area keeps the height
 * a name in marker needs — at the smallest height the bands above already give up a little of theirs.
 */
export const BADGE_CUSTOM_BOUNDS = {
  width: { min: 60, max: 200 },
  height: { min: 30, max: 100 },
} as const;

/** What a size is read from: the design's three fields. */
export type BadgeSizeChoice = { size: BadgeSize; customWidthMm: number; customHeightMm: number };

/** The badge's paper in millimetres: the preset's, or the club's own. */
export function badgeSizeMm(choice: BadgeSizeChoice): { widthMm: number; heightMm: number } {
  if (choice.size === "custom") return { widthMm: choice.customWidthMm, heightMm: choice.customHeightMm };
  return BADGE_SIZE_PRESETS[choice.size];
}

/** The badge's paper in points. */
export function badgePaper(choice: BadgeSizeChoice): { width: number; height: number } {
  const { widthMm, heightMm } = badgeSizeMm(choice);
  return { width: widthMm * MM, height: heightMm * MM };
}

/** The white border inside each badge's cut, on all four sides: 2 mm. */
export const BADGE_INSET = 2 * MM;

/** The least height the writing area has, whatever the size: 10 mm, a name written in marker. */
export const BADGE_WRITING_MIN = 10 * MM;

/**
 * The badge's proportions, as shares of the content's height (the paper less its border), and the
 * least size any line is set at. Both renderers read them through `badgeLayout`, never directly.
 */
export const BADGE_LAYOUT = {
  /** The header band, the role's band and the telephone's row. */
  headerShare: 0.27,
  roleShare: 0.3,
  phoneShare: 0.1,
  /** The logo's height, of the header's; its width at the lockup's own proportion. */
  logoShare: 0.68,
  logoRatio: 2.424,
  /** The room inside the content's sides and between the logo and the title, of the header's height. */
  padShare: 0.18,
  /** The title's largest size, of the header's height, and the least it shrinks to before it is cut. */
  titleShare: 0.4,
  titleMinSize: 6,
  /** «VOLUNTAR» small on a role's band, of the band's height, with the role's name under it. */
  labelShare: 0.24,
  /** The role's name, of the band's height, and the least it shrinks to before it is cut. */
  roleNameShare: 0.46,
  roleMinSize: 6,
  /** «VOLUNTAR» alone on a badge «fără rol», of the band's height. */
  aloneShare: 0.5,
  /** «Nume:», of the content's height, and its top inside the writing area, of the pad. */
  nameShare: 0.075,
  nameTopShare: 0.6,
  /** The faint line: its height above the writing area's foot, of the area, and its weight and ink. */
  lineFromFootShare: 0.24,
  lineWeight: 0.6,
  lineOpacity: 0.5,
  /** The telephone's size, of its row, and the least it shrinks to before it is cut. */
  phoneSizeShare: 0.62,
  phoneMinSize: 4.5,
  /** Every shrink goes down by this many points. */
  sizeStep: 0.5,
} as const;

/** A row of the badge: its top from the paper's top, and its height, in points. */
export type BadgeRow = { top: number; height: number };

/**
 * The four rows of a badge (`BADGE_LAYOUT`'s shares of the content): the bands take their share and the
 * writing area what is left — never less than `BADGE_WRITING_MIN`. When a small size leaves it less, the
 * header and the role's band shrink together, in proportion, until it has it; the telephone's row keeps
 * its own. With no telephone the area takes that row too.
 */
export function badgeRows(paper: { width: number; height: number }, phoneShown: boolean): {
  content: { left: number; top: number; width: number; height: number };
  header: BadgeRow;
  role: BadgeRow;
  writing: BadgeRow;
  phone: BadgeRow | null;
} {
  const L = BADGE_LAYOUT;
  const content = { left: BADGE_INSET, top: BADGE_INSET, width: paper.width - 2 * BADGE_INSET, height: paper.height - 2 * BADGE_INSET };
  const phoneHeight = phoneShown ? content.height * L.phoneShare : 0;
  let headerHeight = content.height * L.headerShare;
  let roleHeight = content.height * L.roleShare;
  const left = content.height - headerHeight - roleHeight - phoneHeight;
  if (left < BADGE_WRITING_MIN) {
    const room = Math.max(0, content.height - phoneHeight - BADGE_WRITING_MIN);
    const factor = room / (headerHeight + roleHeight);
    headerHeight *= factor;
    roleHeight *= factor;
  }
  const writingHeight = content.height - headerHeight - roleHeight - phoneHeight;
  const header = { top: content.top, height: headerHeight };
  const role = { top: header.top + headerHeight, height: roleHeight };
  const writing = { top: role.top + roleHeight, height: writingHeight };
  const phone = phoneShown ? { top: writing.top + writingHeight, height: phoneHeight } : null;
  return { content, header, role, writing, phone };
}

/** How wide a text is in ems of its own type: the bold (title, «VOLUNTAR», the role) and the regular (the rest). */
export type BadgeMeasure = { bold: (text: string) => number; regular: (text: string) => number };

/** A line fitted to its room: its words (cut with «…» only past the least size), the size it is set at, and whether it was cut. */
export type BadgeFittedLine = { text: string; size: number; cut: boolean };

/** What a trailing separator before a «…» is: spaces and punctuation, never kept. */
const TRAILING = /[\s,;:·\-‐‒–—―]+$/u;

/**
 * One line in `width` points: at `maxSize` when it fits, else the first size down to `minSize`, by
 * `BADGE_LAYOUT.sizeStep`, at which it fits — and past that `minSize`, cut with «…» (the bib's
 * `bibEmergencyFit` rule). `measure` answers ems.
 */
export function badgeFit(text: string, measure: (text: string) => number, width: number, maxSize: number, minSize: number): BadgeFittedLine {
  const top = Math.max(maxSize, minSize);
  const steps = Math.max(0, Math.floor((top - minSize) / BADGE_LAYOUT.sizeStep + 1e-9));
  for (let step = 0; step <= steps; step++) {
    const size = top - step * BADGE_LAYOUT.sizeStep;
    if (measure(text) * size <= width) return { text, size, cut: false };
  }
  if (measure(text) * minSize <= width) return { text, size: minSize, cut: false };
  return { text: withEllipsis(text, (line) => measure(line) * minSize <= width, TRAILING), size: minSize, cut: true };
}

/** One line of text as a renderer places it: its fitted words, its size, and its box's top, from the paper's top. */
export type BadgeTextLine = BadgeFittedLine & { top: number };

/** The height of a line of Roboto at `size`: what pdfkit gives a line and Satori sets (§755). */
export const badgeLineHeight = (size: number) => BIB_TEXT_LINE * size;

/** The words one badge prints, already in its language — the role's name and «VOLUNTAR» in capitals. */
export type BadgeLayoutWords = {
  title: string | null;
  label: string;
  /** The role's name, or null on a badge «fără rol». */
  role: string | null;
  name: string;
  phone: string | null;
};

/** What decides the look of a badge's rows, besides its words. */
export type BadgeLayoutChoice = BadgeSizeChoice & {
  /** The header is the club's picture: no logo and no title on it (the bib's §249 rule). */
  headerPicture: boolean;
  showLogo: boolean;
  writingLine: boolean;
};

/** Everything both renderers draw, in points from the paper's top left corner. */
export type BadgeLayout = {
  paper: { width: number; height: number };
  content: { left: number; top: number; width: number; height: number };
  header: BadgeRow;
  role: BadgeRow;
  writing: BadgeRow;
  phone: BadgeRow | null;
  /** The room inside the content's sides. */
  pad: number;
  logo: { left: number; top: number; width: number; height: number } | null;
  /** The title, right-aligned on `right`. */
  title: (BadgeTextLine & { right: number }) | null;
  /** «VOLUNTAR» small above the role's name, centred; null on a badge «fără rol». */
  label: BadgeTextLine | null;
  /** The band's large line, centred: the role's name, or «VOLUNTAR» alone. */
  roleLine: BadgeTextLine;
  /** «Nume:» at the writing area's top left. */
  name: BadgeTextLine & { left: number };
  /** The faint line across the writing area, or null. */
  line: { left: number; right: number; y: number } | null;
  /** The telephone, centred in its row. */
  phoneLine: BadgeTextLine | null;
};

/**
 * One badge, laid out (§NNN). The header's column runs from the logo's right plus the pad (or the pad
 * alone) to the content's right less the pad, and the title is fitted to it at up to `titleShare` of the
 * band, down to `titleMinSize`, then cut. The role's name is fitted to the band's width less the pad on
 * each side at up to `roleNameShare` of the band, down to `roleMinSize`, then cut; «VOLUNTAR» above it is
 * fitted the same way. Every line is centred on its row's height.
 */
export function badgeLayout(choice: BadgeLayoutChoice, words: BadgeLayoutWords, measure: BadgeMeasure): BadgeLayout {
  const L = BADGE_LAYOUT;
  const paper = badgePaper(choice);
  const rows = badgeRows(paper, words.phone !== null);
  const { content, header, role, writing, phone } = rows;
  const pad = header.height * L.padShare;
  const centred = (row: BadgeRow, size: number) => row.top + (row.height - badgeLineHeight(size)) / 2;

  const logoShown = choice.showLogo && !choice.headerPicture;
  const logoHeight = header.height * L.logoShare;
  const logo = logoShown
    ? { left: content.left + pad, top: header.top + (header.height - logoHeight) / 2, width: logoHeight * L.logoRatio, height: logoHeight }
    : null;
  const titleLeft = logo ? logo.left + logo.width + pad : content.left + pad;
  const titleRight = content.left + content.width - pad;
  const titleFitted =
    words.title && !choice.headerPicture
      ? badgeFit(words.title, measure.bold, Math.max(0, titleRight - titleLeft), header.height * L.titleShare, L.titleMinSize)
      : null;
  const title = titleFitted ? { ...titleFitted, top: centred(header, titleFitted.size), right: titleRight } : null;

  const bandWidth = Math.max(0, content.width - 2 * pad);
  let label: BadgeTextLine | null = null;
  let roleLine: BadgeTextLine;
  if (words.role) {
    const labelFitted = badgeFit(words.label, measure.bold, bandWidth, role.height * L.labelShare, Math.min(L.roleMinSize, role.height * L.labelShare));
    const nameFitted = badgeFit(words.role, measure.bold, bandWidth, role.height * L.roleNameShare, L.roleMinSize);
    const block = badgeLineHeight(labelFitted.size) + badgeLineHeight(nameFitted.size);
    const top = role.top + (role.height - block) / 2;
    label = { ...labelFitted, top };
    roleLine = { ...nameFitted, top: top + badgeLineHeight(labelFitted.size) };
  } else {
    const alone = badgeFit(words.label, measure.bold, bandWidth, role.height * L.aloneShare, L.roleMinSize);
    roleLine = { ...alone, top: centred(role, alone.size) };
  }

  const nameSize = content.height * L.nameShare;
  const nameFitted = badgeFit(words.name, measure.regular, bandWidth, nameSize, Math.min(nameSize, L.phoneMinSize));
  const name = { ...nameFitted, top: writing.top + pad * L.nameTopShare, left: content.left + pad };
  const line = choice.writingLine
    ? { left: content.left + pad, right: content.left + content.width - pad, y: writing.top + writing.height * (1 - L.lineFromFootShare) }
    : null;

  const phoneLine =
    phone && words.phone
      ? (() => {
          const fitted = badgeFit(words.phone, measure.regular, bandWidth, phone.height * L.phoneSizeShare, L.phoneMinSize);
          return { ...fitted, top: centred(phone, fitted.size) };
        })()
      : null;

  return { paper, content, header, role, writing, phone, pad, logo, title, label, roleLine, name, line, phoneLine };
}

// --- The sheet -------------------------------------------------------------------------------

/** The page's white margin round the badges: 5 mm, wider than an office printer's unprintable edge. */
export const BADGE_PAGE_MARGIN = 5 * MM;

/** A hair of tolerance, so two 100 mm badges fill the 200 mm between the margins exactly. */
const EPSILON = 1e-6;

/**
 * How badges of one size are packed on an A4 portrait page (§NNN): as many columns and rows as fit
 * inside the margin, butted edge to edge so one cut separates two (each keeps its own white border),
 * the grid centred on the page. 90 × 35 mm: 2 × 8 = 16 a sheet; 100 × 40 mm: 2 × 7 = 14.
 */
export function badgeSheetGrid(paper: { width: number; height: number }): {
  columns: number;
  rows: number;
  perSheet: number;
  left: number;
  top: number;
} {
  const columns = Math.max(1, Math.floor((A4_PAGE.width - 2 * BADGE_PAGE_MARGIN + EPSILON) / paper.width));
  const rows = Math.max(1, Math.floor((A4_PAGE.height - 2 * BADGE_PAGE_MARGIN + EPSILON) / paper.height));
  return {
    columns,
    rows,
    perSheet: columns * rows,
    left: (A4_PAGE.width - columns * paper.width) / 2,
    top: (A4_PAGE.height - rows * paper.height) / 2,
  };
}

/** One badge's place: its page, from 0, and its top left corner on it, in points. */
export type BadgeSlot = { page: number; x: number; y: number };

/** Where each of `count` badges prints, in order: row by row, left to right, page after page. */
export function badgeSheetSlots(count: number, paper: { width: number; height: number }): BadgeSlot[] {
  const grid = badgeSheetGrid(paper);
  return Array.from({ length: count }, (_, index) => {
    const onPage = index % grid.perSheet;
    return {
      page: Math.floor(index / grid.perSheet),
      x: grid.left + (onPage % grid.columns) * paper.width,
      y: grid.top + Math.floor(onPage / grid.columns) * paper.height,
    };
  });
}

/** How many A4 pages `count` badges take. */
export function badgeSheetPages(count: number, paper: { width: number; height: number }): number {
  return count <= 0 ? 0 : Math.ceil(count / badgeSheetGrid(paper).perSheet);
}

// --- The picture -----------------------------------------------------------------------------

/** The picture's width in pixels, whatever the size: the paper at 960 pixels across. */
export const BADGE_IMAGE_WIDTH = 960;

/** The picture of one badge: its pixels, and the pixels per point it multiplies every length by. */
export function badgeImageSize(choice: BadgeSizeChoice): { width: number; height: number; scale: number } {
  const paper = badgePaper(choice);
  const scale = BADGE_IMAGE_WIDTH / paper.width;
  return { width: BADGE_IMAGE_WIDTH, height: Math.round(paper.height * scale), scale };
}
