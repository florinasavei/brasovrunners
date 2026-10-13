import { bibFooterWidth } from "./bib-footer";
import { type BibHeaderLayout, type BibHeaderText, bibHeaderLayout } from "./bib-geometry";

/**
 * The bib's header as both renderers draw it (§NNN): `bibHeaderLayout`'s lines, measured with the
 * fonts the sheet and the picture embed — the title in `src/theme/pdf/Roboto-Bold.ttf` (the table
 * below), the date in Roboto Regular (`bib-footer.ts#bibFooterWidth`, the small print's table).
 *
 * The same discipline as the small print (§317): neither renderer wraps the header's words, so a
 * line that fits here fits on the paper and in the picture, and breaks in the same place in both.
 * The measure is the advances plus every pair the font kerns *apart*, so it errs wide by a hair and
 * is never narrower than pdfkit or Satori sets a line: a title may take its second line a hair
 * early, never run into the badge or the lockup. `tests/unit/registrations/bib-header.test.ts`
 * holds both tables to the font file, glyph by glyph and pair by pair.
 */
export function bibHeader(text: BibHeaderText): BibHeaderLayout {
  return bibHeaderLayout(text, { title: bibTitleWidth, date: bibFooterWidth });
}

/** Roboto's design grid: its advance widths below are in 2048ths of an em. */
const UNITS_PER_EM = 2048;

/**
 * What a character outside the table counts as: 1.15625 em. The widest glyph in Roboto Bold is
 * 2223 units, and no pair of the table's characters is kerned apart by more than 50, so this covers
 * any glyph pdfkit could draw with a kern on both its sides.
 */
const UNKNOWN_UNITS = 2368;

/**
 * How wide a title is in ems of its bold type, never less than the renderers set it: the sum of
 * Roboto Bold's advance widths, plus every pair of neighbours the font kerns apart.
 */
export function bibTitleWidth(text: string): number {
  let units = 0;
  let previous = "";
  for (const character of text) {
    units += (BIB_TITLE_ADVANCES.get(character) ?? UNKNOWN_UNITS) + (BIB_TITLE_KERNING.get(previous + character) ?? 0);
    previous = character;
  }
  return units / UNITS_PER_EM;
}

/**
 * Roboto Bold's advance widths — `src/theme/pdf/Roboto-Bold.ttf`, the file both renderers embed —
 * for the characters of the small print's table (ASCII, Latin-1, Latin Extended-A, every Romanian
 * letter in both forms, the typographic punctuation a club types). Grouped by width. Read out of
 * the font with pdfkit, never typed by hand; the test checks every entry against the file.
 */
const ROBOTO_BOLD_ADVANCES: Readonly<Record<number, string>> = {
  330: "'", 470: "’", 478: "‘", 504: ",", 508: "‚", 509: "  ",514: "¦", 516: "|", 529: "ſ", 533: "j",
  539: ";", 542: "ilįĺļ", 550: "¸", 554: "!", 559: "ìíîïĩīĭı", 567: "[]", 576: "ĵ", 577: ":", 579: "¡",
  594: ".", 599: "IÌÍÎÏĨĪĬĮİ", 618: "·", 619: "›", 628: "ł", 639: "‹", 652: "\"", 675: "{}", 676: "`´",
  692: "ľ", 693: "tţŧț", 716: "(", 719: ")", 733: "ťf", 736: "•", 750: "rŕŗř", 760: "/", 762: "ŀ",
  763: "²³¹", 798: "°", 807: "-", 821: "„", 826: "“", 833: "”", 863: "\\", 897: "^", 909: "ª",
  911: "_", 930: "*", 937: "º", 963: "¨", 1001: "¶", 1019: "?", 1020: "¿", 1024: "»«", 1025: "¯",
  1031: "yýÿŷ", 1037: "v", 1042: "xzźżž", 1044: "<", 1052: "sśŝşšș", 1057: ">", 1067: "cçćĉċč",
  1075: "ĳ", 1087: "×", 1094: "kķ", 1096: "aàáâãäåāăą", 1098: "¥", 1100: "±", 1102: "†",
  1106: "eèéêëēĕėęě", 1108: "LĹĻĽĿ", 1116: "+", 1124: "F", 1128: "¬", 1142: "Ł", 1144: "JĴ",
  1147: "hĥuùúûüũūŭůűų", 1148: "nñńņňŉ", 1152: "bpEÈÉÊËĒĔĖĘĚ", 1153: "d", 1155: "øŋq",
  1156: "oòóôõöōŏő", 1159: "þ", 1168: "÷", 1170: "gĝğġģ", 1175: "=$0123456789€", 1177: "ħð", 1181: "¢",
  1210: "ĸ", 1213: "#", 1217: "£", 1243: "ZŹŻŽ", 1248: "Þ", 1261: "SŚŜŞŠȘ", 1265: "µ", 1268: "YÝŶŸ",
  1269: "TŢŤŦȚ", 1287: "§", 1290: "đ", 1291: "–", 1293: "™", 1294: "ß", 1300: "X", 1302: "KĶ",
  1303: "ď", 1307: "B", 1312: "RŔŖŘ", 1320: "P", 1327: "~", 1331: "DĎ", 1338: "V", 1340: "CÇĆĈĊČ",
  1347: "&", 1350: "UÙÚÛÜŨŪŬŮŰŲ", 1361: "ÐĐ", 1376: "AÀÁÂÃÄÅĀĂĄ", 1396: "GĜĞĠĢ", 1410: "Ø",
  1412: "OQÒÓÔÕÖŌŎŐ", 1418: "¤", 1442: "Ŋ", 1445: "NÑŃŅŇ", 1446: "HĤ", 1467: "¼", 1474: "Ħ",
  1504: "wŵ", 1514: "%", 1517: "…", 1554: "½", 1560: "—", 1609: "©®", 1658: "¾", 1730: "æ", 1743: "Ĳ",
  1774: "m", 1792: "WŴ", 1793: "M", 1836: "@", 1850: "œ", 1922: "Æ", 1981: "Œ",
};

/** The table, turned round: a character to its width in Roboto Bold. */
export const BIB_TITLE_ADVANCES: ReadonlyMap<string, number> = new Map(
  Object.entries(ROBOTO_BOLD_ADVANCES).flatMap(([units, characters]) =>
    Array.from(characters, (character) => [character, Number(units)] as const),
  ),
);

/**
 * Every pair of the table's characters that Roboto Bold sets *wider* than its two advance widths, in
 * 2048ths of an em: `[units, firsts, seconds]` — every character of `firsts` followed by every
 * character of `seconds`. 628 pairs. The pairs it sets closer are left out, on purpose: the measure
 * errs wide. Read out of the font with pdfkit by laying out every pair; the test does it again.
 */
const ROBOTO_BOLD_KERNING: ReadonlyArray<readonly [units: number, firsts: string, seconds: string]> = [
  [50, "rŕŗř", "t"],
  [32, "(", "WŴ"],
  [22, "(", "YÝŶŸ"],
  [20, "(", "V"],
  [20, "fYÝŶŸV", ")"],
  [20, "FEÈÉÊËĒĔĖĘĚ", "TŢŤȚ"],
  [19, "fYÝŶŸV", "}"],
  [19, "LĹĻĽĿ", "AÀÁÂÃÄÅĀĂĄ"],
  [18, "IÌÍÎÏĨĪĬĮİHNÑĤŃŅŇM", "AÀÁÂÃÄÅĀĂĄ"],
  [18, "rŕŗř", "fyýÿŷv"],
  [18, "f", "]"],
  [18, "YÝŶŸ", "]YÝŶŸV"],
  [17, "IÌÍÎÏĨĪĬĮİHNÑĤŃŅŇM", "X"],
  [17, "rŕŗř", "w"],
  [17, "YÝŶŸ", "TŢŤȚWŴ"],
  [17, "V", "]"],
  [16, "t", "’"],
  [16, "rŕŗřf", "'‘’\"“”"],
  [16, "TŢŤŦȚ", "TŢŤȚYÝŶŸV"],
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
  [10, "’", "lkh"],
];

/** The widening pairs, turned round: two characters to the units the font adds between them. */
export const BIB_TITLE_KERNING: ReadonlyMap<string, number> = new Map(
  ROBOTO_BOLD_KERNING.flatMap(([units, firsts, seconds]) =>
    Array.from(firsts).flatMap((first) => Array.from(seconds, (second) => [`${first}${second}`, units] as const)),
  ),
);
