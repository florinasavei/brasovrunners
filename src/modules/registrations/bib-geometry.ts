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
 * Pure and importing nothing but `bib-type.ts` (the cut the header shares with the small print, which
 * imports nothing at all), like `bib-design.ts` and for the same reason: `bib-footer.ts` takes its
 * measure from here, and so do the pages that show the picture, whose `<img>` declares its size so the
 * box does not jump while the picture loads.
 */

import { ELLIPSIS, withEllipsis } from "./bib-type";

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
   * The race and its date at the right of the band, laid out once by `bibHeaderLayout` (§755) and
   * drawn at its points by both renderers, which is what keeps the preview the paper rather than a
   * card sized by eye. A title that fits on one line at `titleSize` sits at `titleTop` with the date
   * at `dateTop`, as every bib printed before; the date on its own sits at `dateTopAlone`. A longer
   * title takes two lines, shrinking by `titleSizeStep` down to `titleMinSize` until two lines fit the
   * column and the band; the date goes under the title's real height. Nothing of the column comes
   * nearer the band's top or foot than `headerPad`.
   */
  titleSize: 13,
  titleMinSize: 9,
  titleSizeStep: 0.5,
  dateSize: 10.5,
  titleTop: 15,
  dateTop: 34,
  dateTopAlone: 22,
  headerPad: 4,
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
   * The member mark (§750; its shape the club's choice since §759, `bib-member-mark.ts`): a box
   * `memberMarkSize` points tall — square for a star or another glyph, the lockup's proportion for the
   * club's logo — at the card's left inset, `memberMarkTop` under the header's foot, clear of the number
   * below it (a number of up to five digits at the largest size still reaches about 44 points from the
   * card's edge, 26 from the inset, so the number sits lower than the mark only by its own centring,
   * never by width) and of the name set above the number, whose box is narrowed on both sides by the
   * mark's width plus `memberMarkGap` while the mark is drawn (`bibNameReserve`). Large enough to read
   * at A5 and at a half of it.
   */
  memberMarkSize: 26,
  memberMarkGap: 10,
  memberMarkTop: 12,
  /**
   * The route's profile (§750, amended §757 and §NNN): a full-width strip `profileHeight` points tall across the card less its
   * inset, between the name under the number and the small print — a row of its own, so it can never
   * cover the number (which keeps the area that is left) or the name; the chart takes the strip's width
   * but for the figures' room at its right (the owner's trail example, §750). The strip is **one box**,
   * `chartWidth` × `profileHeight`, whose insides the shared elevation core lays out (`bib-profile-strip.ts`):
   * the pins' band above the plot (`profileTopRoom`, or `profileTopBare` with nothing to say there), the plot,
   * and the foot row under it (`profileFootRoom`) that holds «Start» and «Sosire», the kilometres and the
   * points' words at `profileLabelSize` points. The line is stroked `profileLineWeight` thick over a faint
   * area. At the box's right, `profileTextGap` away, the distance and the elevation gain in two lines of
   * `profileTextSize` points, their tops `profileDistanceTop` and `profileGainTop` into the row. Both
   * renderers place everything at the points the core gives.
   */
  profileHeight: 38,
  profileChartWidth: 380,
  profileLineWeight: 1.2,
  profileAreaOpacity: 0.14,
  profileLabelSize: 6.5,
  profileTopRoom: 9,
  profileTopBare: 3,
  profileFootRoom: 9,
  profileTextSize: 8,
  profileTextGap: 12,
  profileDistanceTop: 9,
  profileGainTop: 20,
  /**
   * The kilometre scale and the altitudes on the strip (§NNN): a tick `profileKmTick` points long under the
   * plot at each kilometre of the step the core chooses (1, 2 or 5), stroked `profileKmTickWeight`, a foot
   * rule of the same weight under the plot, all at `profileScaleOpacity` of the ink so the scale never
   * outweighs the line; the highest and the lowest altitude in the labels' size.
   */
  profileKmTick: 1.6,
  profileKmTickWeight: 0.4,
  profileScaleOpacity: 0.6,
  /**
   * «O poză încărcată» (§759): the club's own picture of the profile, fitted whole (never cropped) in a
   * box `profilePictureHeight` points tall, `profilePictureTop` into the row, as wide as the chart would
   * be (`bibProfileChartWidth`) — so the figures beside it stand where they stand beside a drawn chart.
   */
  profilePictureTop: 1,
  profilePictureHeight: 36,
  /**
   * The checkpoints on the profile (§757, amended §NNN; `bib-profile-strip.ts`): a pin for each — a ring
   * `profilePinRadius` points in radius stroked `profilePinWeight`, in the band above the plot, with the
   * kind's glyph from the elevation core inside it (a drop, a fork, a cross, a stopwatch, an arrow, a dot) —
   * a stem from the pin down to the plot's foot stroked `checkpointTickWeight`, and a dot
   * `checkpointDot` points in radius on the line; «km 12» (and «· 11:30») in the foot row under the
   * stem. Two pins that would touch keep one; two labels closer than `checkpointTimeGap` points, or one
   * over «Start» or «Sosire», are the core's to settle. Both renderers place them at these points.
   */
  profilePinRadius: 3.2,
  profilePinWeight: 0.6,
  checkpointDot: 1.3,
  checkpointTickWeight: 0.6,
  checkpointTimeGap: 3,
  /**
   * The emergency phone (§750): one centred line `emergencyHeight` points tall under the profile's
   * row (or where it would be), `emergencySize` points — a fixed place on every number, never over
   * the number or the name, which keep the area that is left. With its label and two numbers (§759)
   * a line may be long: it shrinks by `emergencySizeStep` down to `emergencyMinSize` until it fits the
   * card less its inset, and only past that is it cut with «…» (`bibEmergencyFit`).
   */
  emergencyHeight: 14,
  emergencySize: 9,
  emergencyMinSize: 6.5,
  emergencySizeStep: 0.5,
  /**
   * The distance badge (§750), in the header's right corner like the owner's marathon example: a
   * rounded tag `badgeWidth` × `badgeHeight` at the card's right inset, centred on the band — or, while
   * the members' label sits under it, on the band above the label's tag (`bibHeaderLayout`, §755) — in
   * the header's own text colour with the distance — «21K» — in the band's colour on it, `badgeSize`
   * points bold. The race and its date give up its width plus `badgeGap` on their right
   * (`bibHeaderReserve`).
   */
  badgeWidth: 46,
  badgeHeight: 28,
  badgeGap: 10,
  badgeSize: 15,
  badgeRadius: 6,
  /**
   * The number repeated on the footer's two ends (§750), the owner's tear-off stubs: `stubSize` points
   * bold at each end of the sponsors' row, inside the card's inset, in a `stubWidth` of room. While
   * they show, the sponsors' picture is scaled to what is left between them (`bibStubScale`), whole.
   */
  stubWidth: 40,
  stubSize: 11,
} as const;

/**
 * What the profile's row and the emergency line take from the number's area (§750): their heights
 * when drawn, nothing when not — so a design with neither keeps every number as it was.
 */
export function bibExtrasHeight(profileDrawn: boolean, emergencyDrawn: boolean): number {
  return (profileDrawn ? BIB_LAYOUT.profileHeight : 0) + (emergencyDrawn ? BIB_LAYOUT.emergencyHeight : 0);
}

/**
 * How wide the profile's chart — or the club's picture of it — is (§759): beside the figures, the
 * chart's own `profileChartWidth`; with «Arată distanța și diferența de nivel lângă profil» off, or
 * nothing to say there, the strip's whole width, the card less its inset on each side.
 */
export function bibProfileChartWidth(figuresShown: boolean): number {
  return figuresShown ? BIB_LAYOUT.profileChartWidth : BIB_CARD.width - 2 * BIB_LAYOUT.inset;
}

/**
 * What is turned half a circle under the number (§759, amending §750; the owner's trail example, «I should
 * also be able to rotate the race profile»): the runner reads what is turned by looking down at the chest.
 *
 * - `block` — the profile and the phone are both drawn and both turned: **one** block, the two rows
 *   turned together about the block's centre, so the phone line comes out above the profile on the paper
 *   and, read from above, right under it — the two read together, as in the owner's example.
 * - `profile` / `phone` — only that row, about its own centre; the other reads the right way up.
 *
 * Whatever is not drawn is never turned.
 */
export function bibExtrasTurn(rows: { profile: boolean; profileTurned: boolean; phone: boolean; phoneTurned: boolean }): {
  block: boolean;
  profile: boolean;
  phone: boolean;
} {
  const block = rows.profile && rows.phone && rows.profileTurned && rows.phoneTurned;
  return { block, profile: !block && rows.profile && rows.profileTurned, phone: !block && rows.phone && rows.phoneTurned };
}

/** The room the emergency line may take: the card less its inset on each side. */
export const BIB_EMERGENCY_WIDTH = BIB_CARD.width - 2 * BIB_LAYOUT.inset;

/**
 * The emergency line as both renderers set it (§759): its own `emergencySize` when it fits the card less
 * its inset, else the first size down to `emergencyMinSize`, by `emergencySizeStep`, at which it fits —
 * and past that the minimum, cut with «…». `measure` is the line's width in ems of its type (Roboto
 * Regular's table, `bib-footer.ts#bibFooterWidth`), never narrower than either renderer sets it.
 */
export function bibEmergencyFit(text: string, measure: (text: string) => number): { text: string; size: number } {
  const L = BIB_LAYOUT;
  const steps = Math.round((L.emergencySize - L.emergencyMinSize) / L.emergencySizeStep);
  for (let step = 0; step <= steps; step++) {
    const size = L.emergencySize - step * L.emergencySizeStep;
    if (measure(text) * size <= BIB_EMERGENCY_WIDTH) return { text, size };
  }
  return { text: oneLine(text, measure, BIB_EMERGENCY_WIDTH / L.emergencyMinSize), size: L.emergencyMinSize };
}

/** What the header's race and date give up on their right while the distance badge is drawn (§750). */
export function bibHeaderReserve(badgeDrawn: boolean): number {
  return badgeDrawn ? BIB_LAYOUT.badgeWidth + BIB_LAYOUT.badgeGap : 0;
}

/**
 * One line of Roboto, as a fraction of its size: the font's ascender and descender, 1900 + 500 of its
 * 2048 units, the same in both faces — the height pdfkit gives a line (`heightOfString`) and the one the
 * picture sets (`lineHeight`). What a line of the header takes.
 */
export const BIB_TEXT_LINE = 2400 / 2048;

/**
 * Where Roboto's baseline stands inside a line, as a fraction of its size: the ascender, 1900 of 2048
 * units. A line drawn at `top` (pdfkit's `text` y; the picture's `top` with a `BIB_TEXT_LINE` line height)
 * has its baseline `BIB_TEXT_ASCENT × size` below it — so a text the core placed by its baseline (§NNN)
 * is drawn at `baseline − BIB_TEXT_ASCENT × size`, in both renderers.
 */
export const BIB_TEXT_ASCENT = 1900 / 2048;

/**
 * The room between the title's last line and the date: what a 13-point title at `titleTop` always left
 * above `dateTop` (3.77 points), so a title that fits on one line draws exactly where it did (§755).
 */
export const BIB_TITLE_DATE_GAP = BIB_LAYOUT.dateTop - BIB_LAYOUT.titleTop - BIB_TEXT_LINE * BIB_LAYOUT.titleSize;

/**
 * Where the members' label's own line begins inside its tag (§664): the tag's top plus half of what its
 * line leaves of it — 46.8 points. While the label is drawn on the band, under the badge or at the
 * column's right, no line of the race or its date reaches below this.
 */
export const BIB_MEMBER_LABEL_LINE = BIB_LAYOUT.memberTagTop + (BIB_LAYOUT.memberTagHeight - BIB_TEXT_LINE * BIB_LAYOUT.memberLabelSize) / 2;

/** What the header draws its words from (§755): a part switched off, or with nothing to say, is `null`. */
export type BibHeaderText = {
  /** The race's title, as typed — never changed, only laid out. */
  title: string | null;
  /** The date as the bib prints it. */
  date: string | null;
  /** The lockup at the band's left. */
  logo: boolean;
  /** The distance badge at the band's right (§750). */
  badge: boolean;
  /** The members' label on the band itself, under the badge (§664); never on a picture or a card's stripe. */
  label: boolean;
};

/** How wide a text is in ems of its own type: the title's bold, the date's regular — the font tables both renderers' text is measured by. */
export type BibHeaderMeasure = { title: (text: string) => number; date: (text: string) => number };

/** One line of the header: its words, and its top from the card's top, in points. */
export type BibHeaderLine = { text: string; top: number };

/**
 * The header's words, laid out (§755). `left` and `right` are the column's edges from the card's left,
 * in points: every line is right-aligned on `right`, and none is wider than the column. The title's
 * lines share one `size`; `cut` says a line ends in «…», something of the title left out. The date is
 * set at `dateSize`.
 */
export type BibHeaderLayout = {
  left: number;
  right: number;
  title: { size: number; lines: BibHeaderLine[]; cut: boolean } | null;
  date: BibHeaderLine | null;
  /** The badge's top from the card's top, whether or not one is drawn. */
  badgeTop: number;
};

/** A dash on its own between words — «Cros – ediția a II-a» — stays at the end of the line before it, never starts one. */
const LONE_DASH = /^[-‐‒–—―]+$/u;

/** A title's unit that ends in a lone dash (`titleUnits` joined it to the word before): the break the club typed. */
const ENDS_IN_LONE_DASH = / [-‐‒–—―]+$/u;

/** What a cut header line never ends in before its «…»: spaces, punctuation, a dash. */
const HEADER_TRAILING = /[\s,;:·\-‐‒–—―]+$/u;

/**
 * The race and its date on the band, laid out once for both renderers (§755, amending §750's header).
 *
 * The owner, on a printed bib of a race with a long name and the distance badge on: «când bifez distanța
 * pe număr am overlap» — the sheet handed pdfkit the title with a width, pdfkit wrapped it onto a second
 * line at its own leading, broke it after the hyphen of «II-A», and the second line fell on the date set
 * at a fixed offset. Now neither renderer wraps: this decides the lines and both draw exactly those.
 *
 * - **The column** runs from the lockup's right plus the inset (or the card's inset with no lockup) to the
 *   card's right inset less the badge and its gap (`bibHeaderReserve`), so no line can touch either.
 * - **The title** is split at spaces only: a word is never broken, so «II-A» or «Cros-Country» is one
 *   word, and a dash standing alone stays at the end of the line before it. (A non-breaking hyphen would
 *   not do: Roboto has no U+2011, so it would print a box.) From `titleSize` down to `titleMinSize`, by
 *   `titleSizeStep`, the first size at which the title fits the column on one line or on two — on two,
 *   right after a lone dash the club typed when that break fits (where the club's own name ends), else
 *   the break that makes the longer line shortest — and the whole block, the date included, fits between
 *   `headerPad` and the foot. **Past the minimum** (9 points: about 130 characters of capitals beside the
 *   lockup and the badge), the first line takes as many words as fit and the second as many as fit with
 *   «…» after them — only then is anything left out. A first word wider than the column by itself is cut
 *   by its characters with «…» on the first line, and the second goes on with the words after it.
 * - **The foot** is the band's foot less `headerPad`, or the top of the members' label's line while the
 *   label is on the band (`BIB_MEMBER_LABEL_LINE`).
 * - **The place:** a block that fits from `titleTop` stays there — so a title on one line at 13 points
 *   and its date print exactly as before — and a taller one is centred between `headerPad` and the foot.
 *   The date goes under the title's real height plus `BIB_TITLE_DATE_GAP`; alone, at `dateTopAlone`. A
 *   date wider than the column is cut with «…».
 * - **The badge** is centred on the band, or on the band above the members' label's tag while one is
 *   under it, so it never touches the label.
 *
 * Pure: the widths come from `measure`, which the renderers pass as the tables of the font they embed
 * (`bib-header.ts`), measured never narrower than either sets the text.
 */
export function bibHeaderLayout(text: BibHeaderText, measure: BibHeaderMeasure): BibHeaderLayout {
  const L = BIB_LAYOUT;
  const left = text.logo ? L.inset + L.logoWidth + L.inset : L.inset;
  const right = BIB_CARD.width - L.inset - bibHeaderReserve(text.badge);
  const width = right - left;
  const foot = text.label ? BIB_MEMBER_LABEL_LINE : L.bandHeight - L.headerPad;
  const badgeTop = ((text.label ? L.memberTagTop : L.bandHeight) - L.badgeHeight) / 2;
  const dateText = text.date?.trim() ? oneLine(text.date.trim(), measure.date, width / L.dateSize) : null;
  const units = titleUnits(text.title ?? "");
  if (units.length === 0) {
    return { left, right, title: null, date: dateText ? { text: dateText, top: L.dateTopAlone } : null, badgeTop };
  }
  const dateRoom = dateText ? BIB_TITLE_DATE_GAP + BIB_TEXT_LINE * L.dateSize : 0;
  const blockHeight = (lines: number, size: number) => lines * BIB_TEXT_LINE * size + dateRoom;
  let chosen: { size: number; lines: string[]; cut: boolean } | null = null;
  const steps = Math.round((L.titleSize - L.titleMinSize) / L.titleSizeStep);
  for (let step = 0; step <= steps && chosen === null; step++) {
    const size = L.titleSize - step * L.titleSizeStep;
    const lines = titleLines(units, measure.title, width / size);
    if (lines && blockHeight(lines.length, size) <= foot - L.headerPad) chosen = { size, lines, cut: false };
  }
  chosen ??= { size: L.titleMinSize, lines: cutTitle(units, measure.title, width / L.titleMinSize), cut: true };
  const height = blockHeight(chosen.lines.length, chosen.size);
  const top = L.titleTop + height <= foot ? L.titleTop : Math.max(L.headerPad, L.headerPad + (foot - L.headerPad - height) / 2);
  const lineHeight = BIB_TEXT_LINE * chosen.size;
  return {
    left,
    right,
    title: { size: chosen.size, cut: chosen.cut, lines: chosen.lines.map((line, index) => ({ text: line, top: top + index * lineHeight })) },
    date: dateText ? { text: dateText, top: top + chosen.lines.length * lineHeight + BIB_TITLE_DATE_GAP } : null,
    badgeTop,
  };
}

/**
 * The title's words, the units a line is made of: split at every white space but the no-break space
 * (U+00A0), which the club typed to keep two words together and stays inside its word; a hyphen kept
 * inside its word; a lone dash joined to the word before it. The narrow no-break space (U+202F) and the
 * figure space (U+2007) become U+00A0 first: Roboto Bold has no glyph for either, so drawn as typed they
 * would print a box.
 */
function titleUnits(title: string): string[] {
  const units: string[] = [];
  for (const word of title.replace(/[\u202F\u2007]/gu, "\u00A0").split(/[^\S\u00A0]+/u)) {
    if (!word) continue;
    if (LONE_DASH.test(word) && units.length > 0) units[units.length - 1] += ` ${word}`;
    else units.push(word);
  }
  return units;
}

/**
 * One line when it fits; else two that fit — right after a lone dash the club typed when one fits, the
 * longer line as short as it can be among the breaks of that standing; `null` when two will not do.
 */
function titleLines(units: readonly string[], measure: (text: string) => number, budget: number): string[] | null {
  const whole = units.join(" ");
  if (measure(whole) <= budget) return [whole];
  let best: string[] | null = null;
  let bestRank = Infinity;
  let bestWidth = Infinity;
  for (let split = 1; split < units.length; split++) {
    const first = units.slice(0, split).join(" ");
    const second = units.slice(split).join(" ");
    const longer = Math.max(measure(first), measure(second));
    if (longer > budget) continue;
    const rank = ENDS_IN_LONE_DASH.test(units[split - 1]) ? 0 : 1;
    if (rank < bestRank || (rank === bestRank && longer < bestWidth)) {
      best = [first, second];
      bestRank = rank;
      bestWidth = longer;
    }
  }
  return best;
}

/**
 * Past the minimum size: as many words as fit, then as many as fit with «…». A first word wider than a
 * line is cut by its characters with «…», and the second line goes on with the words after it; a second
 * line whose first word alone is too wide is cut by its characters too.
 */
function cutTitle(units: readonly string[], measure: (text: string) => number, budget: number): string[] {
  let taken = 0;
  while (taken < units.length && measure(units.slice(0, taken + 1).join(" ")) <= budget) taken += 1;
  const first = taken > 0 ? units.slice(0, taken).join(" ") : oneLine(units[0], measure, budget);
  const rest = units.slice(Math.max(taken, 1));
  if (rest.length === 0) return [first];
  const whole = rest.join(" ");
  if (measure(whole) <= budget) return [first, whole];
  const closed = (count: number) => `${rest.slice(0, count).join(" ").replace(HEADER_TRAILING, "")}${ELLIPSIS}`;
  let kept = rest.length;
  while (kept > 0 && measure(closed(kept)) > budget) kept -= 1;
  return [first, kept > 0 ? closed(kept) : oneLine(whole, measure, budget)];
}

/** The text when it fits, else its longest beginning that fits with «…» after it — the small print's cut (`bib-type.ts`). */
function oneLine(text: string, measure: (text: string) => number, budget: number): string {
  if (measure(text) <= budget) return text;
  return withEllipsis(text, (line) => measure(line) <= budget, HEADER_TRAILING);
}

/**
 * How much the sponsors' picture shrinks, about its centre, so it stays clear of the two stubs (§750):
 * the strip's width less a stub's room at each end, over the strip's width — 1 with no stubs. The
 * picture is scaled whole, so its crop and its proportion stay exact in both renderers.
 */
export function bibStubScale(stubsDrawn: boolean): number {
  if (!stubsDrawn) return 1;
  const strip = BIB_CARD.width - 2 * BIB_LAYOUT.inset;
  return (strip - 2 * BIB_LAYOUT.stubWidth) / strip;
}

/**
 * The room the number has (§750): the card less the band and every row under it — the small print, the
 * name's strip, the sponsors' row, the members' stripe, the profile and the phone.
 */
export function bibNumberArea(rows: { footer: number; name: number; sponsors: number; stripe: number; extras: number }): number {
  return BIB_CARD.height - BIB_LAYOUT.bandHeight - rows.footer - rows.name - rows.sponsors - rows.stripe - rows.extras;
}

/**
 * Roboto Bold's digits, as fractions of the size (read from the font: 2048 units to the em): the
 * tallest ink of any digit, from the lowest descent of a round one to the highest top, and the one
 * advance every digit has. What the number's size is capped by (`bibNumberFit`).
 */
export const BIB_DIGIT = { height: 1497 / 2048, advance: 1175 / 2048 } as const;

/**
 * What the digits of a number are drawn at (§750): the club's size (`bibNumberPoints`), but never taller
 * than the area the rows under the band leave it, nor wider than the card less its inset — so the
 * profile, the phone and a stripe, which take their height from that area, make the number smaller
 * rather than spilling it over the name or the foot. In points; the picture multiplies it.
 */
export function bibNumberFit(digits: string, scale: number, areaHeight: number): number {
  const byHeight = areaHeight / BIB_DIGIT.height;
  const byWidth = (BIB_CARD.width - 2 * BIB_LAYOUT.inset) / (Math.max(1, digits.length) * BIB_DIGIT.advance);
  return Math.max(12, Math.floor(Math.min(bibNumberPoints(digits, scale), byHeight, byWidth)));
}

/**
 * What the name set above the number gives up on each side while the member mark is drawn (§750):
 * the mark's width (`bib-member-mark.ts#bibMemberMarkBox`: a star's square, the logo's wider box) and
 * a gap, so a long name is cut (ellipsis) at the mark's right edge plus the gap rather than running
 * over it. 0 when no mark is drawn (`null`); the name below the number is nowhere near the mark and
 * keeps the whole inset-to-inset box.
 */
export function bibNameReserve(markWidth: number | null, nameAbove: boolean): number {
  return markWidth !== null && nameAbove ? markWidth + BIB_LAYOUT.memberMarkGap : 0;
}

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
