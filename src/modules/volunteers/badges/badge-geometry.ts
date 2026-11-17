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
 *    badge «fără rol», «VOLUNTAR» alone, large. A role under a category also prints the category's name, the
 *    volunteer's type (§962): after «VOLUNTAR» on the small line, «VOLUNTAR · PE TRASEU», when that line holds
 *    both at its least size, else on a small line of its own under the role's name — inside the band either
 *    way, so it takes no height and is never cut (`badgeFitWhole`);
 * 3. **the free-text line** (§776), small and centred on the white under the role's band, when the club
 *    writes one: its own words, in the badge's language;
 * 4. **the writing area**, white: «Nume:» at its top left and, when the club wants it, one faint line
 *    for the marker. With «Spațiu pentru marker» (§776) the area is shared beside the name — a faint
 *    divider, then the club's label («Tură:») and one faint line at the same height, for a word in
 *    marker; beside, not under, because a strip is short and wide. It never has less than
 *    `BADGE_WRITING_MIN` of height: when the size leaves less, the two bands above give up their share
 *    (`badgeRows`) — and a size where they would keep less than `BADGE_BANDS_MIN_SHARE` of it is
 *    refused at the save (`badgeSizeRefusal`);
 * 5. **the coordinator's telephone**, one small line, when the club ticks it.
 *
 * With «Logo-ul clubului jos, ca filigran» (§965) the club's lockup is drawn large and pale at the foot of the
 * writing area, under everything written there (`badgeFooterLogoBox`); it takes no height, so no row moves. Its
 * size, the space round it and where it stands are the club's to set (§969), always inside the writing area — a
 * size the club types may rise over «Nume:», which is written over it.
 *
 * Every height is a share of the badge's content (`BADGE_LAYOUT`), so a larger badge is the same badge,
 * larger. Pure: imports the bib's pure measure and A4 only.
 *
 * **The space for the name** (§972; the owner, 2026-11-17, at 90 × 100 mm: «vreau un spațiu mai mare pt nume aici»): the share of the
 * content the writing area takes before the free-text line and the telephone take theirs — 43 % by default, the badge as it always was,
 * up to 80 % (`BADGE_NAME_SPACE`). The header and the role's band share what it leaves in their own 27 : 30 (`badgeRows`), and their words
 * shrink with them (`badgeLayout`), so a taller badge can give its height to the name instead of to the bands.
 */

import { A4_PAGE, BIB_TEXT_LINE } from "@/modules/registrations/bib-geometry";
import { withEllipsis } from "@/modules/registrations/bib-type";
import { LOGO_RATIO } from "@/theme/brand";

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
 * No taller than an A4 page less its margins either, one badge to a page (§967; the owner, 2026-11-17:
 * «lasă-mă să fac ecusoanele mai mari pt voluntari, adică mai înalte!», then, at 100 mm: «tot văd
 * limitări aici»). The rows keep their shares at every height, so a taller badge is the same badge,
 * larger; only the pad stops growing at the 100 mm badge's (`BADGE_PAD_MAX`).
 */
export const BADGE_CUSTOM_BOUNDS = {
  width: { min: 60, max: 200 },
  height: { min: 30, max: 287 },
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
 * The least of its natural height — at the design's space for the name (§972) — the header and the role's band keep when the rows
 * under them take theirs (§776): four fifths. A design whose ticked rows (the free-text line, the telephone) would
 * squeeze the bands further is refused at the save (`badgeSizeRefusal`). That is a save-time rule: an imported event file or a copy of the event is read forgivingly and
 * may draw with the bands under four fifths of their height, which the drawing survives (`badgeRows` clamps).
 */
export const BADGE_BANDS_MIN_SHARE = 0.8;

/**
 * The widths the two writing areas keep when «Spațiu pentru marker» is ticked (§776): 16 mm for a word in
 * marker, 24 mm for a name, and 2 mm between them for the divider. `BADGE_CUSTOM_BOUNDS` leaves room for
 * both at every height — the pad grows with the badge up to 100 mm and no further (`BADGE_PAD_MAX`, §967) —
 * which a test keeps true.
 */
export const BADGE_MARKER_MIN_WIDTH = 16 * MM;
export const BADGE_NAME_MIN_WIDTH = 24 * MM;
export const BADGE_MARKER_GAP = 2 * MM;

/**
 * «Logo-ul clubului jos, ca filigran» (§965; the owner, 2026-11-17: «vreau ca la voluntari să pot pune logo-ul clubului în footer, dar
 * transparent»): how visible the club's lockup is at the foot of every badge — «Fără», «Puțin vizibil», «Mediu», «Bine vizibil». `off`
 * draws nothing, and is what a design that never chose reads as.
 */
export const BADGE_FOOTER_LOGOS = ["off", "faint", "medium", "strong"] as const;
export type BadgeFooterLogo = (typeof BADGE_FOOTER_LOGOS)[number];
export const DEFAULT_BADGE_FOOTER_LOGO: BadgeFooterLogo = "off";

/**
 * The lockup's opacity at each level, the paper showing through it: pale enough at every level that a name written over it in marker
 * reads first. The one table both renderers read, through `badgeFooterLogoBox`.
 */
export const BADGE_FOOTER_LOGO_OPACITY: Readonly<Record<Exclude<BadgeFooterLogo, "off">, number>> = { faint: 0.12, medium: 0.22, strong: 0.35 };

/**
 * The watermark's size, room and place (§969; the owner, 2026-11-17: «și practic trebuie să pot seta dimensiunea logo-ului, padding și
 * offset»): four whole numbers of the design, each with its bounds and its default — the defaults draw §965's box exactly.
 *
 * - `footerLogoSizePct`, «Mărimea logo-ului»: the logo's widest width, as a share of the badge's paper width, 10–100 %. The default, 67,
 *   is §965's two thirds and §965's room — as large as the room under «Nume:» allows; any other number is that share, as large as the
 *   whole writing area allows, over «Nume:» if it must (`badgeFooterLogoBox`).
 * - `footerLogoPaddingMm`, «Spațiu în jurul logo-ului»: millimetres kept clear on every side of the room it is fitted in, and of the
 *   writing area it is kept inside, 0–20; 0 is §965's room.
 * - `footerLogoOffsetXMm` and `footerLogoOffsetYMm`, «Deplasare stânga–dreapta» and «Deplasare sus–jos»: how far it is moved from
 *   §965's place, −100…100 mm — right and down are positive. A move never changes the size.
 */
export const BADGE_FOOTER_LOGO_SETTINGS = {
  footerLogoSizePct: { min: 10, max: 100, default: 67 },
  footerLogoPaddingMm: { min: 0, max: 20, default: 0 },
  footerLogoOffsetXMm: { min: -100, max: 100, default: 0 },
  footerLogoOffsetYMm: { min: -100, max: 100, default: 0 },
} as const;
export type BadgeFooterLogoSetting = keyof typeof BADGE_FOOTER_LOGO_SETTINGS;
export const BADGE_FOOTER_LOGO_SETTING_KEYS = Object.keys(BADGE_FOOTER_LOGO_SETTINGS) as BadgeFooterLogoSetting[];

/** The four settings as a layout reads them: any of them absent is its default. */
export type BadgeFooterLogoPlacement = Partial<Record<BadgeFooterLogoSetting, number>>;

/**
 * One of the four settings as drawn: a whole number within its bounds, else its default — the rule the design's reader keeps
 * (`badge-design.ts`), held here too, so whatever a caller hands the geometry it never draws a logo outside its room.
 */
export function badgeFooterLogoSetting(key: BadgeFooterLogoSetting, value: number | undefined): number {
  const { min, max, default: fallback } = BADGE_FOOTER_LOGO_SETTINGS[key];
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}

/**
 * The logo's widest width as a share of the badge's paper width, from «Mărimea logo-ului» (§969): the percent typed — and for the default
 * 67, §965's two thirds, which no whole percent says exactly: so a design that never moved the box draws every badge as it drew.
 */
export function badgeFooterLogoWidthShare(sizePct: number | undefined): number {
  const pct = badgeFooterLogoSetting("footerLogoSizePct", sizePct);
  return pct === BADGE_FOOTER_LOGO_SETTINGS.footerLogoSizePct.default ? BADGE_LAYOUT.footerLogoWidthShare : pct / 100;
}

/**
 * The least width the watermark is drawn at (§969): 5 mm. A space, or a room, that leaves the logo narrower draws none — a speck reads as a
 * stain on the paper, not as the club — and the designer's closed line says it does not fit. Under every box §965 draws, so the defaults
 * never meet it; and under «Mărimea logo-ului»'s least, 10 % of the narrowest badge, 6 mm.
 */
export const BADGE_FOOTER_LOGO_MIN_WIDTH = 5 * MM;

/**
 * The badge's proportions, as shares of the content's height (the paper less its border), and the
 * least size any line is set at. Both renderers read them through `badgeLayout`, never directly.
 */
export const BADGE_LAYOUT = {
  /** The header band, the role's band and the telephone's row — the two bands' at the default space for the name (§972, `badgeRows`). */
  headerShare: 0.27,
  roleShare: 0.3,
  phoneShare: 0.1,
  /** The logo's height, of the header's; its width at the lockup's own proportion (`LOGO_RATIO`, §885). */
  logoShare: 0.68,
  logoRatio: LOGO_RATIO,
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
  /** The free-text line's row, of the content's height (§776): the telephone's own measure, under the role's band. */
  freeShare: 0.1,
  /** Its size, of its row, and the least it shrinks to before it is cut. */
  freeSizeShare: 0.62,
  freeMinSize: 4.5,
  /** The marker's area (§776) beside «Nume:»: its share of the writing area's width, never less than the width below. */
  markerShare: 0.38,
  /** The divider between the two areas: its inset from the writing area's top and foot, of the pad. */
  dividerInsetShare: 0.5,
  /**
   * The club's logo as a watermark (§965): at most this share of the badge's width, and its room from the writing area's foot, of
   * the pad. Its top is never above the foot of «Nume:»'s line — until the club moves it, or types a size of its own (§969). The share
   * is the default «Mărimea logo-ului», 67 % (`badgeFooterLogoWidthShare`).
   */
  footerLogoWidthShare: 2 / 3,
  footerLogoFootShare: 0.5,
  /** Every shrink goes down by this many points. */
  sizeStep: 0.5,
} as const;

/**
 * The widest the pad grows (§967): the 100 mm badge's, the tallest there was before badges could be taller —
 * computed as `badgeLayout` computes a pad, so every badge up to 100 mm keeps its pad to the last bit and
 * draws as it drew. Past it the bands keep growing with the badge and the pad does not, so a tall, narrow
 * badge keeps the marker's and the name's least widths (`BADGE_MARKER_MIN_WIDTH`, `BADGE_NAME_MIN_WIDTH`).
 */
export const BADGE_PAD_MAX = (100 * MM - 2 * BADGE_INSET) * BADGE_LAYOUT.headerShare * BADGE_LAYOUT.padShare;

/**
 * «Spațiul pentru nume (% din înălțime)» (§972): the share of the content's height, in whole percents, the writing area — «Nume:», its
 * line, the marker's space, the watermark — takes before the free-text line and the telephone's row take theirs. 43 is the badge as it
 * always was, the header's 27 and the role band's 30 being the rest, and the default of every design that never chose; up to 80, the two
 * bands sharing what is left in their own 27 : 30 (`badgeRows`). Out of these bounds a value is refused at the save and read as the default.
 */
export const BADGE_NAME_SPACE = { min: 43, max: 80 } as const;
export const DEFAULT_BADGE_NAME_SPACE = 43;

/** Whether a value is a space for the name a badge is drawn with (§972): a whole number within `BADGE_NAME_SPACE`. */
export function isBadgeNameSpace(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= BADGE_NAME_SPACE.min && value <= BADGE_NAME_SPACE.max;
}

/**
 * What the header's and the role band's shares are multiplied by at a space for the name (§972), so that together they take
 * (100 − share) % of the content in their own 27 : 30 — or null at the default, where they keep `BADGE_LAYOUT`'s shares as they are:
 * the badge as it always was, to the last bit, never multiplied by a factor that is one only in theory. A share that is not a space for
 * the name (`isBadgeNameSpace`; a caller's — the reader keeps a stored one within the bounds) is the default too.
 */
export function badgeBandsScale(nameSpacePct: number | undefined): number | null {
  if (nameSpacePct === undefined || nameSpacePct === DEFAULT_BADGE_NAME_SPACE || !isBadgeNameSpace(nameSpacePct)) return null;
  return (100 - nameSpacePct) / 100 / (BADGE_LAYOUT.headerShare + BADGE_LAYOUT.roleShare);
}

/** A row of the badge: its top from the paper's top, and its height, in points. */
export type BadgeRow = { top: number; height: number };

/**
 * The rows of a badge, top to bottom (`BADGE_LAYOUT`'s shares of the content): the header, the role's band,
 * the free-text line when the club writes one (§776), the writing area and the telephone. The bands take
 * their share and the writing area what is left — never less than `BADGE_WRITING_MIN`. When a small size
 * leaves it less, the header and the role's band shrink together, in proportion, until it has it, and
 * `squeeze` says how much of their natural height they kept (1 when none was lost); the free-text and
 * telephone rows keep their own. With no free text or telephone the area takes that row too.
 *
 * The bands' natural height is what the space for the name leaves (§972, `nameSpacePct`): their shares as they are at the default,
 * 43, else (100 − share) % of the content in their 27 : 30 (`badgeBandsScale`). The free-text and telephone rows keep their shares
 * whatever it is, and the squeeze — so the save's refusal (`badgeSizeRefusal`) — reads the bands' height at that share.
 */
export function badgeRows(paper: { width: number; height: number }, phoneShown: boolean, freeShown = false, nameSpacePct?: number): {
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
  // §972: at the default the bands take their shares as they are — the badge as it always was; past it, what the name's space leaves.
  const scale = badgeBandsScale(nameSpacePct);
  let headerHeight = scale === null ? content.height * L.headerShare : content.height * L.headerShare * scale;
  let roleHeight = scale === null ? content.height * L.roleShare : content.height * L.roleShare * scale;
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
 * Whether a size has room for everything ticked (§776), or what does not fit: the ticked rows that take
 * height, when the bands would keep less than `BADGE_BANDS_MIN_SHARE` of theirs, and the least height
 * (whole millimetres, at the same width) at which they all do — what the save's refusal says in words. Null
 * when everything fits. «Spațiu pentru marker» takes width, not height, and is never refused here: the
 * custom bounds keep both areas their minimum width (`BADGE_MARKER_MIN_WIDTH`, `BADGE_NAME_MIN_WIDTH`).
 * The bands' height is read at the design's space for the name (§972): the more of it the name takes, the less the bands have to give.
 */
export function badgeSizeRefusal(
  choice: BadgeSizeChoice & { nameSpacePct?: number },
  ticked: { freeText: boolean; phone: boolean },
): { what: BadgeExtra[]; minHeightMm: number } | null {
  const { widthMm, heightMm } = badgeSizeMm(choice);
  const fits = (height: number) => {
    const paper = badgePaper({ size: "custom", customWidthMm: widthMm, customHeightMm: height });
    return badgeRows(paper, ticked.phone, ticked.freeText, choice.nameSpacePct).squeeze + 1e-9 >= BADGE_BANDS_MIN_SHARE;
  };
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

/**
 * One line that is **never cut** (§962, the role's category): at `maxSize` when it fits, else the first size down by
 * `BADGE_LAYOUT.sizeStep` at which it fits, and below the last of those steps the size at which it fills `width` exactly —
 * however long the club's words, they print whole and inside the width. `measure` answers ems.
 */
export function badgeFitWhole(text: string, measure: (text: string) => number, width: number, maxSize: number): BadgeFittedLine {
  const ems = measure(text);
  if (ems <= 0) return { text, size: maxSize, cut: false };
  for (let size = maxSize; size > 0; size -= BADGE_LAYOUT.sizeStep) {
    if (ems * size <= width) return { text, size, cut: false };
  }
  return { text, size: Math.min(maxSize, width / ems), cut: false };
}

/** One line of text as a renderer places it: its fitted words, its size, and its box's top, from the paper's top. */
export type BadgeTextLine = BadgeFittedLine & { top: number };

/** The height of a line of Roboto at `size`: what pdfkit gives a line and Satori sets (§755). */
export const badgeLineHeight = (size: number) => BIB_TEXT_LINE * size;

/** Between «VOLUNTAR» and the role's category on the small line (§962): a middle dot, a space each side — typography, not a word. */
export const BADGE_CATEGORY_SEPARATOR = " · ";

/** The words one badge prints, already in its language — the role's name, its category and «VOLUNTAR» in capitals. */
export type BadgeLayoutWords = {
  title: string | null;
  label: string;
  /** The role's name, or null on a badge «fără rol». */
  role: string | null;
  /**
   * The name of the role's category — the volunteer's type, «PE TRASEU» (§962) — or absent: a role under none, a badge «fără rol» and
   * the one badge for everyone (§783) print none, and a badge with no role never prints one whatever it is handed.
   */
  category?: string | null;
  name: string;
  phone: string | null;
  /** The club's free-text line in the badge's language (§776), or null for no row. */
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
  /** «Spațiu pentru marker»: a second writing area beside «Nume:» (§776). */
  showMarker: boolean;
  /**
   * «Telefonul coordonatorului» is ticked (§774): the telephone's row is kept on every badge, blank on a role whose category has no
   * number, so every badge of a sheet is cut the same and the designer's crop box (`badgeRows(paper, design.showPhone)`) is true.
   */
  showPhone?: boolean;
  /** «Logo-ul clubului jos, ca filigran» (§965): absent or `off` draws none. */
  footerLogo?: BadgeFooterLogo;
  /** «Spațiul pentru nume (% din înălțime)» (§972): absent, or the default, draws the bands as they always were. */
  nameSpacePct?: number;
} & BadgeFooterLogoPlacement;

/** The club's lockup as a watermark (§965): its box, in points from the paper's top left corner, and its opacity. */
export type BadgeFooterLogoBox = { left: number; top: number; width: number; height: number; opacity: number };

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
  /**
   * «VOLUNTAR» small above the role's name, centred — «VOLUNTAR · PE TRASEU» when the role's category stands beside it (§962); null on a
   * badge «fără rol».
   */
  label: BadgeTextLine | null;
  /** The band's large line, centred: the role's name, or «VOLUNTAR» alone. */
  roleLine: BadgeTextLine;
  /**
   * The role's category on a small line of its own under the role's name, centred (§962): only when the small line above cannot hold it
   * beside «VOLUNTAR» at that line's least size. Absent otherwise — the category on the line above, or none — so a badge without it lays
   * out exactly as it did.
   */
  categoryLine?: BadgeTextLine;
  /** The free-text line, small and centred under the role's band (§776), or null. */
  freeLine: BadgeTextLine | null;
  /** «Nume:» at the writing area's top left. */
  name: BadgeTextLine & { left: number };
  /** The faint line across the name's area (the writing area's whole width, or what the marker's area leaves it), or null. */
  line: { left: number; right: number; y: number } | null;
  /**
   * «Spațiu pentru marker» (§776), beside the name's area: a faint divider, the club's label at its top left
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
  /**
   * «Logo-ul clubului jos, ca filigran» (§965): the club's lockup, centred across the badge at the foot of the writing area — or where the
   * club moved it inside that area, at the size it chose (§969) — at its level's opacity, drawn first in that area, so «Nume:», the lines
   * and the marker's area go over it. Absent while the design says `off`, so a badge without it lays out exactly as it did.
   */
  footerLogo?: BadgeFooterLogoBox;
};

/**
 * Where the club's lockup is drawn as a watermark (§965), and how opaque: the one answer the sheet, the picture and so the print panel's
 * pictures draw, through `badgeLayout`. Null while the level is `off` (or absent).
 *
 * **It takes no height.** At the defaults it is fitted inside the writing area's lower part — from the foot of «Nume:»'s line (its top,
 * plus one line at the largest size «Nume:» and the marker's label are set at) down to the writing area's foot less half the pad, between
 * the content's sides — and no row is moved or shrunk for it: `badgeRows`, and so the save's fit check (`badgeSizeRefusal`), never read
 * it. As large as that room allows at the lockup's own proportion (`LOGO_RATIO`), never wider than two thirds of the badge; centred across
 * the badge, standing on the room's foot. The same box on every badge of a design: it reads the rows and the name's line, never a role's
 * words (`badgeFooterLogoOf` draws it with none).
 *
 * **The club's size, room and place (§969)**, `placement` — the design's four settings, each its default when absent. «Spațiu în jurul
 * logo-ului» is taken from every side of the room before the logo is fitted in it, so the space makes it smaller and moves nothing. The
 * widest it may be is «Mărimea logo-ului» of the badge's width (`badgeFooterLogoWidthShare`), and the room it is fitted in is the size's
 * to say: at the default, 67, §965's room under «Nume:», so a badge left at the defaults is §965's; at any other number the whole writing
 * area — the white between the role's band, or the free-text line, and the telephone's row or the badge's foot, between the content's
 * sides — so the size typed is the size drawn wherever the white holds it, standing where §965's does and rising over «Nume:» (drawn over
 * it) as far as it must. Then it is moved by the two offsets (right and down are positive; a move never changes the size) and kept inside
 * the whole writing area less the same space on every side. So it is never over the header, the role's band, the free-text line or the
 * telephone's row, wherever it is asked to go. A logo the room leaves narrower than `BADGE_FOOTER_LOGO_MIN_WIDTH` is none. At the defaults
 * (67 %, 0 mm, no move) the numbers are §965's, to the last bit: no space taken, two thirds of the width, §965's room, no move, and a box
 * that the writing area never has to stop.
 */
export function badgeFooterLogoBox(
  level: BadgeFooterLogo | undefined,
  at: { paper: { width: number }; writing: BadgeRow; pad: number; name: { top: number; size: number } },
  placement: BadgeFooterLogoPlacement = {},
): BadgeFooterLogoBox | null {
  if (level === undefined || level === "off") return null;
  const L = BADGE_LAYOUT;
  const space = badgeFooterLogoSetting("footerLogoPaddingMm", placement.footerLogoPaddingMm) * MM;
  // The whole writing area less the space: its sides are the content's, inside the paper's white border (`badgeRows`).
  const area = {
    left: BADGE_INSET + space,
    right: at.paper.width - BADGE_INSET - space,
    top: at.writing.top + space,
    foot: at.writing.top + at.writing.height - space,
  };
  // §965's room, less the space: the writing area's lower part, under «Nume:»'s line. The logo stands on its foot.
  const top = at.name.top + badgeLineHeight(at.name.size) + space;
  const foot = at.writing.top + at.writing.height - at.pad * L.footerLogoFootShare - space;
  // How tall it may be: §965's room at the default size; the whole writing area less the space at a size the club typed (§969).
  const typed = badgeFooterLogoSetting("footerLogoSizePct", placement.footerLogoSizePct) !== BADGE_FOOTER_LOGO_SETTINGS.footerLogoSizePct.default;
  const room = typed ? area.foot - area.top : foot - top;
  const across = area.right - area.left;
  if (!(room > 0) || !(across > 0)) return null;
  const width = Math.min(at.paper.width * badgeFooterLogoWidthShare(placement.footerLogoSizePct), across, room * L.logoRatio);
  // A speck is no logo: under the least width, none is drawn (`BADGE_FOOTER_LOGO_MIN_WIDTH`).
  if (width < BADGE_FOOTER_LOGO_MIN_WIDTH) return null;
  const height = width / L.logoRatio;
  // §965's place — centred across the badge, standing on the room's foot — then moved, and stopped at the writing area's edges.
  const within = (value: number, least: number, most: number) => Math.min(Math.max(value, least), most);
  const left = within((at.paper.width - width) / 2 + badgeFooterLogoSetting("footerLogoOffsetXMm", placement.footerLogoOffsetXMm) * MM, area.left, area.right - width);
  const placed = within(foot - height + badgeFooterLogoSetting("footerLogoOffsetYMm", placement.footerLogoOffsetYMm) * MM, area.top, area.foot - height);
  return { left, top: placed, width, height, opacity: BADGE_FOOTER_LOGO_OPACITY[level] };
}

/**
 * The pad, «Nume:»'s top and the largest size «Nume:» and the marker's label are set at, on a badge's rows: what `badgeLayout` writes
 * «Nume:» by and what the watermark stands under — one computation for both, so the designer's word for the logo's size
 * (`badgeFooterLogoOf`, §969) is the size drawn.
 */
function badgeNameMarks(rows: { content: { height: number }; header: BadgeRow; writing: BadgeRow }): { pad: number; nameTop: number; nameSize: number } {
  const L = BADGE_LAYOUT;
  const pad = Math.min(rows.header.height * L.padShare, BADGE_PAD_MAX);
  return { pad, nameTop: rows.writing.top + pad * L.nameTopShare, nameSize: rows.content.height * L.nameShare };
}

/**
 * The watermark's box on a design's badges, without their words (§969): the box `badgeLayout` draws on every badge of the design, which
 * reads the rows, the pad and «Nume:»'s line, never a role's words — for the designer's closed line to say the size the logo is drawn at.
 * `shown` says which rows take height, as `badgeRows` reads them; the rows are laid out at the design's space for the name, as the sheet
 * lays them out. Null while off, or when no logo fits.
 */
export function badgeFooterLogoOf(
  choice: BadgeSizeChoice & { footerLogo?: BadgeFooterLogo; nameSpacePct?: number } & BadgeFooterLogoPlacement,
  shown: { phone: boolean; free: boolean },
): BadgeFooterLogoBox | null {
  const paper = badgePaper(choice);
  const rows = badgeRows(paper, shown.phone, shown.free, choice.nameSpacePct);
  const { pad, nameTop, nameSize } = badgeNameMarks(rows);
  return badgeFooterLogoBox(choice.footerLogo, { paper, writing: rows.writing, pad, name: { top: nameTop, size: nameSize } }, choice);
}

/**
 * One badge, laid out (§764). The header's column runs from the logo's right plus the pad (or the pad
 * alone) to the content's right less the pad, and the title is fitted to it at up to `titleShare` of the
 * band, down to `titleMinSize`, then cut. The role's name is fitted to the band's width less the pad on
 * each side at up to `roleNameShare` of the band, down to `roleMinSize`, then cut; «VOLUNTAR» above it is
 * fitted the same way. Every line is centred on its row's height.
 *
 * The role's category (§962), measured, never guessed: when «VOLUNTAR · <CATEGORIE>» fits the band's width at the small line's least
 * size, it is that line, shrunk as «VOLUNTAR» alone would be. When it does not — no 80-character name does on the smallest badge the
 * designer accepts, nor on the default strip — the small line says «VOLUNTAR» alone and the category takes a line of its own under the
 * role's name, at most the small line's size, shrunk until it fits and never cut (`badgeFitWhole`); the role's name gives up what the
 * three lines need of the band's height, never below its own least size. Either way inside the band: the rows, and so the save's fit
 * check (`badgeSizeRefusal`), are what they were.
 *
 * At a space for the name past the default (§972) the bands are lower, and their words shrink with them: their largest sizes are shares
 * of the band's height as they always were, and their least sizes — the title's, «VOLUNTAR»'s, the role's name's — are multiplied by the
 * bands' own factor (`badgeBandsScale`), so no line is ever taller than its band, and none is cut that the default would not cut. At the
 * default they are the constants themselves.
 */
export function badgeLayout(choice: BadgeLayoutChoice, words: BadgeLayoutWords, measure: BadgeMeasure): BadgeLayout {
  const L = BADGE_LAYOUT;
  const paper = badgePaper(choice);
  const rows = badgeRows(paper, words.phone !== null || choice.showPhone === true, words.free !== null, choice.nameSpacePct);
  const { content, header, role, free, writing, phone } = rows;
  // The pad grows with the header up to the 100 mm badge's, no further (`BADGE_PAD_MAX`, §967).
  const { pad, nameTop, nameSize } = badgeNameMarks(rows);
  const centred = (row: BadgeRow, size: number) => row.top + (row.height - badgeLineHeight(size)) / 2;
  // §972: the bands' least sizes, as they are at the default space for the name, and shrunk with the bands past it.
  const scale = badgeBandsScale(choice.nameSpacePct);
  const least = (size: number) => (scale === null ? size : size * scale);
  const roleMin = least(L.roleMinSize);

  const logoShown = choice.showLogo && !choice.headerPicture;
  const logoHeight = header.height * L.logoShare;
  const logo = logoShown
    ? { left: content.left + pad, top: header.top + (header.height - logoHeight) / 2, width: logoHeight * L.logoRatio, height: logoHeight }
    : null;
  const titleLeft = logo ? logo.left + logo.width + pad : content.left + pad;
  const titleRight = content.left + content.width - pad;
  const titleFitted =
    words.title && !choice.headerPicture
      ? badgeFit(words.title, measure.bold, Math.max(0, titleRight - titleLeft), header.height * L.titleShare, least(L.titleMinSize))
      : null;
  const title = titleFitted ? { ...titleFitted, top: centred(header, titleFitted.size), right: titleRight } : null;

  const bandWidth = Math.max(0, content.width - 2 * pad);
  let label: BadgeTextLine | null = null;
  let roleLine: BadgeTextLine;
  let categoryLine: BadgeTextLine | null = null;
  if (words.role) {
    const labelMax = role.height * L.labelShare;
    const labelMin = Math.min(roleMin, labelMax);
    // §962: the category beside «VOLUNTAR» when the small line holds both at its least size, else on a line of its own below.
    const category = words.category || null;
    const beside = category === null ? null : `${words.label}${BADGE_CATEGORY_SEPARATOR}${category}`;
    const smallLine = beside !== null && measure.bold(beside) * labelMin <= bandWidth ? beside : words.label;
    const labelFitted = badgeFit(smallLine, measure.bold, bandWidth, labelMax, labelMin);
    // The band's height in points of type: the sizes of the lines stacked in it add up to no more than this.
    const room = role.height / BIB_TEXT_LINE;
    const below = category !== null && smallLine !== beside ? badgeFitWhole(category, measure.bold, bandWidth, Math.max(0, Math.min(labelFitted.size, room - labelFitted.size - roleMin))) : null;
    const nameMax = below ? Math.min(role.height * L.roleNameShare, room - labelFitted.size - below.size) : role.height * L.roleNameShare;
    const nameFitted = badgeFit(words.role, measure.bold, bandWidth, nameMax, roleMin);
    const block = below
      ? badgeLineHeight(labelFitted.size) + badgeLineHeight(nameFitted.size) + badgeLineHeight(below.size)
      : badgeLineHeight(labelFitted.size) + badgeLineHeight(nameFitted.size);
    const top = role.top + (role.height - block) / 2;
    label = { ...labelFitted, top };
    roleLine = { ...nameFitted, top: top + badgeLineHeight(labelFitted.size) };
    if (below) categoryLine = { ...below, top: roleLine.top + badgeLineHeight(nameFitted.size) };
  } else {
    const alone = badgeFit(words.label, measure.bold, bandWidth, role.height * L.aloneShare, roleMin);
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
  const nameFitted = badgeFit(words.name, measure.regular, nameWidth, nameSize, Math.min(nameSize, L.phoneMinSize));
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

  // The club's logo as a watermark (§965), in the writing area's lower part under «Nume:»'s line — at the club's size, space and place
  // inside the writing area (§969): it moves no row. The designer names its size from the same box (`badgeFooterLogoOf`).
  const footerLogo = badgeFooterLogoBox(choice.footerLogo, { paper, writing, pad, name: { top: nameTop, size: nameSize } }, choice);

  // The category's own line is a key only when there is one: a badge without it is the very object it was (§962).
  // So is the watermark, which is absent while the design says `off` (§965).
  return { paper, content, header, role, free, writing, phone, pad, logo, title, label, roleLine, ...(categoryLine ? { categoryLine } : {}), freeLine, name, line, marker, phoneLine, ...(footerLogo ? { footerLogo } : {}) };
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
