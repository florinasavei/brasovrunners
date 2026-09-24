import type { BibDesign } from "./bib-design";
import { BIB_FOOTER_LINE } from "./bib-geometry";

/**
 * The small print at the foot of a race number, composed by the club and laid out once for both
 * renderers (§317; the owner: "on the bid I have some email, I wanna be able to control and
 * toggle that! Also to add some more info in the footer").
 *
 * Until now the footer was one fixed sentence — the partners' names, then the mailbox every email
 * says to reply to (§168, §180). It is now the club's to compose per event, in the same designer
 * and the same JSON column as the rest of the bib (§249): each piece is a switch, and one is a
 * short line of the club's own.
 *
 * ## One layout, decided here, drawn twice
 *
 * `bibs-pdf.ts` prints the A5 bibs two to an A4 page with pdfkit and `bib-image.tsx` draws the
 * 990×700 picture of one with `next/og`, and the picture is the club's preview of the paper (§180,
 * §NNN). A footer that wraps in
 * one and not in the other is a preview of a different bib, so neither renderer wraps anything:
 * both ask `bibFooterLines` which lines to draw and draw exactly those, each on its own line
 * with wrapping off — the sheet hands pdfkit no width at all, because pdfkit wraps any text it
 * is given a width for, whatever `lineBreak` says.
 *
 * What makes that possible is measuring in **ems of the footer's own type** rather than in points
 * or pixels. The sheet's footer is 523.28 points of line set at 8 points — 65.41 ems — and the
 * picture draws the same line and the same size multiplied by one factor (`bib-geometry.ts`), so
 * its 870 pixels of line are the same 65.41 ems. The
 * widths come from the font both renderers embed, `src/theme/pdf/Roboto-Regular.ttf`, read out
 * of it once and kept below as two tables: each character's advance width, and every pair of
 * characters the font kerns *apart*. Roboto does both — it sets some 6,250 pairs of these
 * characters closer than their advances and 627 wider, "rt" by 50/2048 of an em, "’l" by 32,
 * "FT" by 20 — so a sum of advances alone under-measures a line rich in those, and pdfkit then
 * finds it a point too wide for its box. The measure adds every widening pair and leaves the
 * tightening ones out: a line may break a hair earlier than it had to, and is never wider on the
 * paper than it was measured. `tests/unit/registrations/bib-footer.test.ts` holds both tables to
 * the font, glyph by glyph and pair by pair, and holds random lines rich in the widening pairs to
 * pdfkit's own measurement — measured, not guessed.
 *
 * Pure, and importing nothing but a type and the geometry beside it (`bib-geometry.ts`, which
 * imports nothing): the same discipline as `bib-design.ts`.
 */

/** Between two pieces of the footer: two spaces, a middle dot, two spaces — today's separator. */
export const BIB_FOOTER_SEPARATOR = "  ·  ";

/** The club's own line: short enough to sit beside the rest on two lines at 8 points. */
export const BIB_FOOTER_TEXT_MAX = 120;

/** Never more than this: a third line of small print is a paragraph nobody reads on a runner. */
export const BIB_FOOTER_MAX_LINES = 2;

/**
 * How wide one footer line is, in ems of the footer's type: the A5 bib's 523.28 points of line
 * (the paper less its 18-point margin and the card's 18-point inset, each side) at 8 points —
 * 65.41 (§NNN; 62.91 while the bib was a 539-point card inside the A4 page's margins, §317). The
 * picture's footer size is derived from this, which is what makes its lines the paper's lines.
 */
export const BIB_FOOTER_EMS = BIB_FOOTER_LINE.width / BIB_FOOTER_LINE.size;

/** What the facts of a footer are made from. Nothing about a participant is among them. */
export type BibFooterFacts = {
  /** The partners' names, as `readCoHosts` gives them (§168). */
  partners: readonly string[];
  /** `EMAIL_REPLY_TO`, the mailbox every email already says to write to. */
  replyTo?: string | null;
  /** `APP_BASE_URL`, for the website: only its bare host is ever printed. */
  siteUrl?: string | null;
  /** The event's title and date as the header would print them, for a header that does not. */
  eventTitle?: string;
  eventDate?: string;
  /**
   * Whether this bib's header really is the club's picture rather than the coloured band — the
   * renderer's to say, not the stored design's: a sheet whose route could not fetch the picture
   * prints the band, title and date and all, and its footer must not print them a second time.
   */
  headerPicture: boolean;
};

/**
 * The pieces of the footer, in the order they print: the event (only what the header does not
 * already say), the partners, the club's own line, the website, the mailbox.
 *
 * The defaults are exactly the footer every bib printed before this: the partners, then the
 * mailbox. Everything else is off until the club turns it on.
 *
 * **No participant data, ever** — there is no parameter for it. Above all no telephone number:
 * not the runner's, and not their emergency contact, which is called in an emergency and for
 * nothing else, as the privacy notice says (`AGENTS.md` §19.2); printing it on a garment worn
 * through a town centre publishes it to everyone who passes. The club's own line is the club's
 * text and the club's responsibility, and the designer says so beside the box.
 *
 * *The event in the footer* is not a duplicate by construction: a piece is added only when the
 * header does not show it — the header is the club's picture instead of the band (the picture
 * replaces the band's title and date, §249), or the club switched the title or the date off.
 * With the band showing both, the switch adds nothing. Which header a bib has is
 * `facts.headerPicture`, what the renderer is about to draw, rather than whether the design
 * names a picture: a picture that could not be fetched prints the band.
 */
export function bibFooterParts(design: BibDesign, facts: BibFooterFacts): string[] {
  const band = !facts.headerPicture;
  const parts: Array<string | null | undefined> = [];
  if (design.showEventInFooter) {
    if (!(band && design.showEventTitle)) parts.push(facts.eventTitle);
    if (!(band && design.showDate)) parts.push(facts.eventDate);
  }
  if (design.showPartners) parts.push(...facts.partners);
  parts.push(design.footerText);
  if (design.showWebsite) parts.push(bibWebsiteHost(facts.siteUrl));
  if (design.showEmail) parts.push(facts.replyTo);
  return parts.map((part) => part?.trim() ?? "").filter(Boolean);
}

/**
 * The club's website as a runner would type it: the bare host of `APP_BASE_URL`, without the
 * scheme, a trailing slash or a leading `www.`. Never a hostname literal (`AGENTS.md` §8): the
 * address is whichever environment is printing, which on production is the club's own domain.
 */
export function bibWebsiteHost(siteUrl: string | null | undefined): string | null {
  if (!siteUrl) return null;
  try {
    return new URL(siteUrl).host.toLowerCase().replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

/**
 * The club's own line, as it may be stored and printed: plain text on one line.
 *
 * Normalised to composed characters (so an "ș" typed as an "s" and a comma below is the "ș" the
 * font has), every run of whitespace a single space, anything the bib's font cannot draw left
 * out — an emoji would be a box on the paper and a request to an emoji service in the preview,
 * which is the preview and the paper disagreeing — then trimmed and cut at
 * `BIB_FOOTER_TEXT_MAX` characters. Never HTML and never a template: both renderers draw it as
 * text, and nothing in it is substituted.
 */
export function bibFooterText(raw: string): string {
  const drawable = Array.from(raw.normalize("NFC").replace(/\s+/g, " "))
    .filter((character) => character === " " || BIB_FOOTER_ADVANCES.has(character))
    .join("")
    .replace(/ {2,}/g, " ")
    .trim();
  return Array.from(drawable).slice(0, BIB_FOOTER_TEXT_MAX).join("").trimEnd();
}

/**
 * How wide a piece of text is in the footer's type, in ems, never less than the renderers set
 * it: the sum of Roboto Regular's advance widths, plus every pair of neighbours the font kerns
 * apart. The pairs it kerns together are left out, so the measure errs wide by a hair and never
 * narrow.
 *
 * A character outside the table — which the club's own line can never contain, but a partner's
 * name could — counts as `UNKNOWN_UNITS`, wider than any glyph the font file has with room for
 * a kern on either side, so an unknown character can make a line wrap early but never overflow.
 */
export function bibFooterWidth(text: string): number {
  let units = 0;
  let previous = "";
  for (const character of text) {
    units += (BIB_FOOTER_ADVANCES.get(character) ?? UNKNOWN_UNITS) + (BIB_FOOTER_KERNING.get(previous + character) ?? 0);
    previous = character;
  }
  return units / UNITS_PER_EM;
}

/**
 * The footer as the lines both renderers draw: one line when it fits, two when it does not, and
 * the second cut with an ellipsis when even two are not enough.
 *
 * The first line takes as many whole pieces as fit, so a partner's name or the mailbox is never
 * split between two lines; only a single piece wider than a line by itself is broken, between
 * words (or, for a word wider than a line, between characters). The second line takes the rest,
 * and when the rest is too long it keeps as much as fits with "…" after it — a footer never
 * overflows the bib and is never shrunk until it cannot be read.
 *
 * `measure` and `budget` are the tests' doors: the renderers call this with the table and
 * `BIB_FOOTER_EMS`, which is what makes them agree.
 */
export function bibFooterLines(
  parts: readonly string[],
  measure: (text: string) => number = bibFooterWidth,
  budget: number = BIB_FOOTER_EMS,
): string[] {
  const pieces = parts.map((part) => part.trim()).filter(Boolean);
  if (pieces.length === 0) return [];
  const fits = (text: string) => measure(text) <= budget;
  const whole = pieces.join(BIB_FOOTER_SEPARATOR);
  if (fits(whole)) return [whole];

  let taken = 0;
  while (taken < pieces.length && fits(pieces.slice(0, taken + 1).join(BIB_FOOTER_SEPARATOR))) taken += 1;

  let first: string;
  let rest: string[];
  if (taken > 0) {
    first = pieces.slice(0, taken).join(BIB_FOOTER_SEPARATOR);
    rest = pieces.slice(taken);
  } else {
    const [head, tail] = breakPiece(pieces[0], fits);
    first = head;
    rest = tail ? [tail, ...pieces.slice(1)] : pieces.slice(1);
  }
  if (rest.length === 0) return [first];

  const second = rest.join(BIB_FOOTER_SEPARATOR);
  return [first, fits(second) ? second : withEllipsis(second, fits)];
}

/** A piece wider than a line, split where it fits: between words, or between characters. */
function breakPiece(piece: string, fits: (text: string) => boolean): [string, string] {
  const words = piece.split(" ");
  let count = 0;
  while (count < words.length && fits(words.slice(0, count + 1).join(" "))) count += 1;
  if (count > 0) return [words.slice(0, count).join(" ").trimEnd(), words.slice(count).join(" ").trim()];
  const characters = Array.from(piece);
  const cut = longestPrefix(characters.length, (length) => fits(characters.slice(0, length).join("")));
  // Always at least one character on the line, so a footer can never loop without progress.
  const at = Math.max(cut, 1);
  return [characters.slice(0, at).join(""), characters.slice(at).join("").trim()];
}

const ELLIPSIS = "…";

/** As much of `text` as fits with an ellipsis after it, without a dangling separator. */
function withEllipsis(text: string, fits: (text: string) => boolean): string {
  const characters = Array.from(text);
  const shortened = (length: number) => `${characters.slice(0, length).join("").replace(/[\s·]+$/u, "")}${ELLIPSIS}`;
  return shortened(longestPrefix(characters.length, (length) => fits(shortened(length))));
}

/** The largest length in 0…`max` for which `ok` holds, by halving: `ok` shrinks as length grows. */
function longestPrefix(max: number, ok: (length: number) => boolean): number {
  let low = 0;
  let high = max;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (ok(middle)) low = middle;
    else high = middle - 1;
  }
  return low;
}

/** Roboto's design grid: its advance widths below are in 2048ths of an em. */
const UNITS_PER_EM = 2048;

/**
 * What a character outside the table counts as: 1.125 em. The widest glyph anywhere in the font
 * file is the rupee sign at 2166, and no pair of its characters is kerned apart by more than 50,
 * so this covers any glyph pdfkit could draw with the kerns on both its sides.
 */
const UNKNOWN_UNITS = 2304;

/**
 * Roboto Regular's advance widths — `src/theme/pdf/Roboto-Regular.ttf`, the file both renderers
 * embed — for the characters a footer is made of: ASCII, Latin-1, Latin Extended-A (every
 * Romanian letter, both the comma and the cedilla forms, and the neighbours' names), and the
 * typographic punctuation a club types (dashes, quotes, the ellipsis, the euro). Grouped by
 * width, so it reads as the font's own proportions. The soft hyphen is deliberately absent: it
 * is invisible in a browser and a hyphen on the paper.
 *
 * Read out of the font with fontkit, never typed by hand; `bib-footer.test.ts` checks every
 * entry against the file, so a new font is a failing test rather than a footer that overflows.
 */
const ROBOTO_REGULAR_ADVANCES: Readonly<Record<number, string>> = {
  358: "'", 403: ",", 408: "‚", 410: "‘’", 433: ";", 490: "j", 492: "¦", 496: ":", 498: "ilįĺļ",
  500: "|¡", 507: "ìíîïĩīĭı", 508: "  ¸ſ", 516: "ĵ", 528: "!", 535: "·", 540: ".", 543: "[]",
  554: "ł", 557: "IÌÍÎÏĨĪĬĮİ", 566: "-", 615: "‹›", 633: "`", 642: "´", 648: "ľ", 656: "\"",
  670: "tţŧț", 691: "•", 693: "{}", 694: "rŕŗř", 701: "(", 706: "„", 710: "ť", 712: "f", 713: ")",
  718: "ŀ", 724: "“", 732: "”", 751: "²³¹", 765: "°", 841: "\\", 845: "/", 856: "^", 857: "¨",
  882: "*", 916: "ª", 924: "_", 932: "º", 939: "¯", 960: "»", 961: "«", 968: "?", 969: "yýÿŷ",
  970: "¿", 988: "ĳ", 992: "v", 1002: "¶", 1016: "xzźżž", 1038: "kķ", 1041: "<", 1057: "sśŝşšș",
  1071: ">", 1072: "cçćĉċč", 1076: "¥", 1086: "eèéêëēĕėęě", 1093: "×", 1095: "±", 1103: "LĹĻĽĿŁ",
  1114: "aàáâãäåāăą", 1121: "¢", 1124: "=", 1128: "hĥ", 1129: "uùúûüũūŭůűų", 1130: "JĴ†",
  1131: "nñńņňŉ", 1132: "F", 1134: "¬", 1140: "ĸ", 1150: "bgpĝğġģ", 1151: "$0123456789€", 1155: "d",
  1158: "ħ", 1161: "µøŋ", 1162: "+", 1164: "EqÈÉÊËĒĔĖĘĚ", 1168: "oòóôõöōŏő", 1170: "÷", 1180: "þ",
  1191: "£", 1201: "ð", 1210: "Þ", 1216: "SŚŜŞŠȘ", 1218: "ß", 1222: "TŢŤŦȚ", 1224: "đ", 1227: "ZŹŻŽ",
  1230: "YÝŶŸ", 1256: "§", 1261: "#", 1262: "RŔŖŘ", 1274: "&", 1276: "B", 1281: "™", 1284: "X",
  1285: "KĶ", 1292: "P", 1304: "V", 1305: "ď", 1328: "UÙÚÛÜŨŪŬŮŰŲ", 1333: "CÇĆĈĊČ",
  1336: "AÀÁÂÃÄÅĀĂĄ", 1344: "DĎ–", 1370: "…", 1374: "ÐĐ", 1393: "~", 1395: "GĜĞĠĢ",
  1409: "OQÒÓÔÕÖØŌŎŐ", 1419: "Ŋ", 1435: "Ħ", 1461: "HN¤ÑĤŃŅŇ", 1500: "%¼", 1539: "wŵ", 1589: "½",
  1593: "¾", 1599: "—", 1609: "©", 1610: "®", 1687: "Ĳ", 1730: "æ", 1788: "M", 1796: "m", 1817: "WŴ",
  1839: "@", 1860: "œ", 1914: "Æ", 1953: "Œ",
};

/**
 * The table, turned round: a character to its width. Also the set the club's own line may use,
 * and what `bib-footer.test.ts` holds to the font file.
 */
export const BIB_FOOTER_ADVANCES: ReadonlyMap<string, number> = new Map(
  Object.entries(ROBOTO_REGULAR_ADVANCES).flatMap(([units, characters]) =>
    Array.from(characters, (character) => [character, Number(units)] as const),
  ),
);

/**
 * Every pair of the table's characters that Roboto Regular sets *wider* than its two advance
 * widths, in 2048ths of an em: each row is `[units, firsts, seconds]`, meaning every character of
 * `firsts` followed by every character of `seconds` — the font's own kerning classes, which is
 * why they read as families of one letter. 627 pairs in all, out of the 113,569 the table's 337
 * characters make.
 *
 * Only the widening pairs are here. The font also kerns some 6,250 pairs *together* (and joins
 * "fi" and "fl" into ligatures narrower than their letters); leaving those out makes the measure
 * err wide, which can move a word to the second line a hair early and can never make a line run
 * past its box. Read out of the font with fontkit by laying out every pair, never typed by hand;
 * `bib-footer.test.ts` lays out every pair again with pdfkit and checks this against it.
 */
const ROBOTO_REGULAR_KERNING: ReadonlyArray<readonly [units: number, firsts: string, seconds: string]> = [
  [50, "rŕŗř", "t"],
  [32, "’", "lkh"],
  [22, "(", "YÝŶŸ"],
  [20, "(", "V"],
  [20, "fYÝŶŸV", ")"],
  [20, "FEÈÉÊËĒĔĖĘĚ", "TŢŤȚ"],
  [19, "fYÝŶŸV", "}"],
  [19, "LĹĻĽĿ", "AÀÁÂÃÄÅĀĂĄ"],
  [18, "IÌÍÎÏĨĪĬĮİHNÑĤŃŅŇM", "AÀÁÂÃÄÅĀĂĄ"],
  [18, "rŕŗř", "yýÿŷv"],
  [18, "(", "WŴ"],
  [18, "f", "]"],
  [18, "YÝŶŸ", "]YÝŶŸV"],
  [17, "IÌÍÎÏĨĪĬĮİHNÑĤŃŅŇM", "X"],
  [17, "rŕŗř", "w"],
  [17, "YÝŶŸ", "TŢŤȚWŴ"],
  [17, "V", "]"],
  [16, "rŕŗřf", "'‘’\"“”"],
  [16, "TŢŤŦȚ", "TŢŤȚYÝŶŸV"],
  [15, "rŕŗř", "f"],
  [15, "yýÿŷv", "'‘’\"“”"],
  [15, "TŢŤŦȚ", "WŴ"],
  [15, "P", "yýÿŷv"],
  [15, "WŴ", ")"],
  [14, "X", "V"],
  [14, "P", "t"],
  [14, "WŴ", "}TŢŤȚ"],
  [13, "yýÿŷv", "f"],
  [13, "ZŹŻŽ", "AÀÁÂÃÄÅĀĂĄ"],
  [13, "YÝŶŸ", "X"],
  [12, "AÀÁÂÃÄÅĀĂĄ", "zźżž"],
  [12, "WŴ", "]"],
  [11, "'‘’\"“”", "w"],
];

/** The widening pairs, turned round: two characters to the units the font adds between them. */
export const BIB_FOOTER_KERNING: ReadonlyMap<string, number> = new Map(
  ROBOTO_REGULAR_KERNING.flatMap(([units, firsts, seconds]) =>
    Array.from(firsts).flatMap((first) => Array.from(seconds, (second) => [`${first}${second}`, units] as const)),
  ),
);
