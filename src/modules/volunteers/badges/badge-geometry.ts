/**
 * The volunteer badge's geometry, in points, decided once for both renderers (§764) — the bib's
 * discipline (§338, §755): the sheet (`badges-pdf.ts`, pdfkit) draws these numbers as they are, the
 * picture (`badge-image.tsx`, Satori) multiplies each by its own scale, and neither wraps a word by
 * itself: every line of text is fitted here, shrunk step by step and only then cut with «…», measured
 * by the font tables the bib's header and small print are measured by (`bib-header.ts`,
 * `bib-footer.ts`), which are never narrower than either renderer sets a line.
 *
 * **A badge is a small, long strip** (the owner, 2026-10-14: «Badge-urile sunt de obicei mai mici și
 * mai lungi și fără nume, numele îl scriem manual cu markerul»): 90 × 35 mm by default, 100 × 40 mm,
 * or the club's own size within `BADGE_CUSTOM_BOUNDS`. Inside a white border of `BADGE_INSET` — the
 * room scissors that miss the line by a millimetre need, as the bib's margin is (§338) — up to five rows, top
 * to bottom:
 *
 * 1. **the header band**: the band's colour (or the club's picture across it), the club's logo at its
 *    left on its own white ground, the event's short title at its right;
 * 2. **the role's band**, in the role's colour: «VOLUNTAR» small above the role's name, large — or, on a
 *    badge «fără rol», «VOLUNTAR» alone, large;
 * 3. **the free-text line** (§NNN), small and centred on the white under the role's band, when the club
 *    writes one: its own words, in the badge's language;
 * 4. **the writing area**, white: «Nume:» at its top left and, when the club wants it, one faint line
 *    for the marker. With «Spațiu pentru marker» (§NNN) the area is shared beside the name — a faint
 *    divider, then the club's label («Tură:») and one faint line at the same height, for a word in
 *    marker; beside, not under, because a strip is short and wide. It never has less than
 *    `BADGE_WRITING_MIN` of height: when the size leaves less, the two bands above give up their share
 *    (`badgeRows`) — and a size where they would keep less than `BADGE_BANDS_MIN_SHARE` of it is
 *    refused at the save (`badgeSizeRefusal`);
 * 5. **the coordinator's telephone**, one small line, when the club ticks it.
 *
 * Every height is a share of the badge's content (`BADGE_LAYOUT`), so a larger badge is the same badge,
 * larger. Pure: imports the bib's pure measure and A4 only.
 */

import { A4_PAGE, BIB_TEXT_LINE } from "@/modules/registrations/bib-geometry";
import { withEllipsis } from "@/modules/registrations/bib-type";

/** Points in a millimetre. */
export const MM = 72 / 25.4;

/** The sizes a badge comes in (§764): the default strip, a larger one, and the club's own. */
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
 * The least of its natural height the header and the role's band keep when the rows under them take
 * theirs (§NNN): four fifths. A design whose ticked rows (the free-text line, the telephone) would
 * squeeze the bands further is refused at the save (`badgeSizeRefusal`), never drawn crushed.
 */
export const BADGE_BANDS_MIN_SHARE = 0.8;

/**
 * The widths the two writing areas keep when «Spațiu pentru marker» is ticked (§NNN): 16 mm for a word in
 * marker, 24 mm for a name, and 2 mm between them for the divider. `BADGE_CUSTOM_BOUNDS` leaves room for
 * both at every height — the tallest badge has the widest pad — which a test keeps true.
 */
export const BADGE_MARKER_MIN_WIDTH = 16 * MM;
export const BADGE_NAME_MIN_WIDTH = 24 * MM;
export const BADGE_MARKER_GAP = 2 * MM;

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
  /** The free-text line's row, of the content's height (§NNN): the telephone's own measure, under the role's band. */
  freeShare: 0.1,
  /** Its size, of its row, and the least it shrinks to before it is cut. */
  freeSizeShare: 0.62,
  freeMinSize: 4.5,
  /** The marker's area (§NNN) beside «Nume:»: its share of the writing area's width, never less than the width below. */
  markerShare: 0.38,
  /** The divider between the two areas: its inset from the writing area's top and foot, of the pad. */
  dividerInsetShare: 0.5,
  /** Every shrink goes down by this many points. */
  sizeStep: 0.5,
} as const;

/** A row of the badge: its top from the paper's top, and its height, in points. */
export type BadgeRow = { top: number; height: number };

/**
 * The rows of a badge, top to bottom (`BADGE_LAYOUT`'s shares of the content): the header, the role's band,
 * the free-text line when the club writes one (§NNN), the writing area and the telephone. The bands take
 * their share and the writing area what is left — never less than `BADGE_WRITING_MIN`. When a small size
 * leaves it less, the header and the role's band shrink together, in proportion, until it has it, and
 * `squeeze` says how much of their natural height they kept (1 when none was lost); the free-text and
 * telephone rows keep their own. With no free text or telephone the area takes that row too.
 */
export function badgeRows(paper: { width: number; height: number }, phoneShown: boolean, freeShown = false): {
  content: { left: number; top: number; width: number; height: number };
  header: BadgeRow;
  role: BadgeRow;
  free: BadgeRow | null;
  writing: BadgeRow;
  phone: BadgeRow | null;
  squeeze: number;
} {
  const L = BADGE_LAYOUT;
  const content = { left: BADGE_INSET, top: BADGE_INSET, width: paper.width - 2 * BADGE_INSET, height: paper.height - 2 * BADGE_INSET };
  const phoneHeight = phoneShown ? content.height * L.phoneShare : 0;
  const freeHeight = freeShown ? content.height * L.freeShare : 0;
  let headerHeight = content.height * L.headerShare;
  let roleHeight = content.height * L.roleShare;
  let squeeze = 1;
  const left = content.height - headerHeight - roleHeight - phoneHeight - freeHeight;
  if (left < BADGE_WRITING_MIN) {
    const room = Math.max(0, content.height - phoneHeight - freeHeight - BADGE_WRITING_MIN);
    squeeze = room / (headerHeight + roleHeight);
    headerHeight *= squeeze;
    roleHeight *= squeeze;
  }
  const writingHeight = content.height - headerHeight - roleHeight - phoneHeight - freeHeight;
  const header = { top: content.top, height: headerHeight };
  const role = { top: header.top + headerHeight, height: roleHeight };
  const free = freeShown ? { top: role.top + roleHeight, height: freeHeight } : null;
  const writing = { top: role.top + roleHeight + freeHeight, height: writingHeight };
  const phone = phoneShown ? { top: writing.top + writingHeight, height: phoneHeight } : null;
  return { content, header, role, free, writing, phone, squeeze };
}

/** The rows a ticked extra takes height for: the free-text line and the coordinator's telephone. */
export type BadgeExtra = "freeText" | "phone";

/**
 * Whether a size has room for everything ticked (§NNN), or what does not fit: the ticked rows that take
 * height, when the bands would keep less than `BADGE_BANDS_MIN_SHARE` of theirs, and the least height
 * (whole millimetres, at the same width) at which they all do — what the save's refusal says in words. Null
 * when everything fits. «Spațiu pentru marker» takes width, not height, and is never refused here: the
 * custom bounds keep both areas their minimum width (`BADGE_MARKER_MIN_WIDTH`, `BADGE_NAME_MIN_WIDTH`).
 */
export function badgeSizeRefusal(
  choice: BadgeSizeChoice,
  ticked: { freeText: boolean; phone: boolean },
): { what: BadgeExtra[]; minHeightMm: number } | null {
  const { widthMm, heightMm } = badgeSizeMm(choice);
  const fits = (height: number) =>
    badgeRows(badgePaper({ size: "custom", customWidthMm: widthMm, customHeightMm: height }), ticked.phone, ticked.freeText).squeeze + 1e-9 >= BADGE_BANDS_MIN_SHARE;
  if (fits(heightMm)) return null;
  let minHeightMm = heightMm + 1;
  while (minHeightMm < BADGE_CUSTOM_BOUNDS.height.max && !fits(minHeightMm)) minHeightMm += 1;
  return { what: [...(ticked.freeText ? (["freeText"] as const) : []), ...(ticked.phone ? (["phone"] as const) : [])], minHeightMm };
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
  /** The club's free-text line in the badge's language (§NNN), or null for no row. */
  free: string | null;
  /** The marker area's label («Tură:»), or null for an area with a line and no label. */
  markerLabel: string | null;
};

/** What decides the look of a badge's rows, besides its words. */
export type BadgeLayoutChoice = BadgeSizeChoice & {
  /** The header is the club's picture: no logo and no title on it (the bib's §249 rule). */
  headerPicture: boolean;
  showLogo: boolean;
  writingLine: boolean;
  /** «Spațiu pentru marker»: a second writing area beside «Nume:» (§NNN). */
  showMarker: boolean;
  /**
   * «Telefonul coordonatorului» is ticked (§774): the telephone's row is kept on every badge, blank on a role whose category has no
   * number, so every badge of a sheet is cut the same and the designer's crop box (`badgeRows(paper, design.showPhone)`) is true.
   */
  showPhone?: boolean;
};

/** Everything both renderers draw, in points from the paper's top left corner. */
export type BadgeLayout = {
  paper: { width: number; height: number };
  content: { left: number; top: number; width: number; height: number };
  header: BadgeRow;
  role: BadgeRow;
  free: BadgeRow | null;
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
  /** The free-text line, small and centred under the role's band (§NNN), or null. */
  freeLine: BadgeTextLine | null;
  /** «Nume:» at the writing area's top left. */
  name: BadgeTextLine & { left: number };
  /** The faint line across the name's area (the writing area's whole width, or what the marker's area leaves it), or null. */
  line: { left: number; right: number; y: number } | null;
  /**
   * «Spațiu pentru marker» (§NNN), beside the name's area: a faint divider, the club's label at its top left
   * when it typed one, and one faint line at the name's own height; null when the tick is off.
   */
  marker: {
    left: number;
    width: number;
    divider: { x: number; top: number; bottom: number };
    label: (BadgeTextLine & { left: number }) | null;
    line: { left: number; right: number; y: number };
  } | null;
  /** The telephone, centred in its row. */
  phoneLine: BadgeTextLine | null;
};

/**
 * One badge, laid out (§764). The header's column runs from the logo's right plus the pad (or the pad
 * alone) to the content's right less the pad, and the title is fitted to it at up to `titleShare` of the
 * band, down to `titleMinSize`, then cut. The role's name is fitted to the band's width less the pad on
 * each side at up to `roleNameShare` of the band, down to `roleMinSize`, then cut; «VOLUNTAR» above it is
 * fitted the same way. Every line is centred on its row's height.
 */
export function badgeLayout(choice: BadgeLayoutChoice, words: BadgeLayoutWords, measure: BadgeMeasure): BadgeLayout {
  const L = BADGE_LAYOUT;
  const paper = badgePaper(choice);
  const rows = badgeRows(paper, words.phone !== null || choice.showPhone === true, words.free !== null);
  const { content, header, role, free, writing, phone } = rows;
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

  const freeLine =
    free && words.free
      ? (() => {
          const fitted = badgeFit(words.free, measure.regular, bandWidth, free.height * L.freeSizeShare, L.freeMinSize);
          return { ...fitted, top: centred(free, fitted.size) };
        })()
      : null;

  // The writing area: the name's area at the left and, with the marker's tick, the marker's at its right.
  const areaLeft = content.left + pad;
  const areaRight = content.left + content.width - pad;
  const markerWidth = choice.showMarker ? Math.max(BADGE_MARKER_MIN_WIDTH, bandWidth * L.markerShare) : 0;
  const nameWidth = choice.showMarker ? Math.max(0, bandWidth - markerWidth - BADGE_MARKER_GAP) : bandWidth;
  const lineY = writing.top + writing.height * (1 - L.lineFromFootShare);
  const nameSize = content.height * L.nameShare;
  const nameFitted = badgeFit(words.name, measure.regular, nameWidth, nameSize, Math.min(nameSize, L.phoneMinSize));
  const nameTop = writing.top + pad * L.nameTopShare;
  const name = { ...nameFitted, top: nameTop, left: areaLeft };
  const line = choice.writingLine ? { left: areaLeft, right: areaLeft + nameWidth, y: lineY } : null;
  const marker = choice.showMarker
    ? (() => {
        const left = areaRight - markerWidth;
        const label = words.markerLabel
          ? { ...badgeFit(words.markerLabel, measure.regular, markerWidth, nameSize, Math.min(nameSize, L.phoneMinSize)), top: nameTop, left }
          : null;
        const inset = pad * L.dividerInsetShare;
        return {
          left,
          width: markerWidth,
          divider: { x: areaLeft + nameWidth + BADGE_MARKER_GAP / 2, top: writing.top + inset, bottom: writing.top + writing.height - inset },
          label,
          line: { left, right: areaRight, y: lineY },
        };
      })()
    : null;

  const phoneLine =
    phone && words.phone
      ? (() => {
          const fitted = badgeFit(words.phone, measure.regular, bandWidth, phone.height * L.phoneSizeShare, L.phoneMinSize);
          return { ...fitted, top: centred(phone, fitted.size) };
        })()
      : null;

  return { paper, content, header, role, free, writing, phone, pad, logo, title, label, roleLine, freeLine, name, line, marker, phoneLine };
}

// --- The sheet -------------------------------------------------------------------------------

/** The page's white margin round the badges: 5 mm, wider than an office printer's unprintable edge. */
export const BADGE_PAGE_MARGIN = 5 * MM;

/** A hair of tolerance, so two 100 mm badges fill the 200 mm between the margins exactly. */
const EPSILON = 1e-6;

/**
 * How badges of one size are packed on an A4 portrait page (§764): as many columns and rows as fit
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
