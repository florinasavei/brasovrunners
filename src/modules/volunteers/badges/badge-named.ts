/**
 * «Ecusoane cu nume» — the hotfix of 2026-11-19 (the owner, forwarding the volunteers' coordinator: «pune-mi și numele lor pe
 * ele, să nu mai scriem cu carioca», then «Vreau doar prenume pe ele» and «Vreau să pot customiza textele de pe fiecare ecuson
 * în parte să pot scrie "Voluntar/Fotograf/Organizator" Dany/Amalia»), amending §764's «no name is printed»: besides the badges
 * printed per role with «Nume:» left blank for the marker, a list of badges, ONE LINE A BADGE — the word on its band, a «;»,
 * then the first name printed where the marker went — prefilled with the event's confirmed volunteers and edited freely on the
 * badges page before printing. Nothing of it is stored: the list is posted with the download (`/badges/named`, a POST, so no
 * name is ever in an address) and read here.
 *
 * Pure: no database, no React.
 */

import { BIB_COLOURS, COLOR } from "@/theme/brand";

/** The most badges one list prints: a pile of the per-role sheet's own bound. */
export const NAMED_BADGES_MAX = 300;
/** The longest first name a badge prints: two words of a long name still fit, shrunk. */
export const NAMED_BADGE_NAME_MAX = 40;

/** One badge of the list: its band's word, its first name and — when the line names one — its band's colour, a hex triplet. */
export type NamedBadgeLine = { label: string; name: string; colour: string | null };

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

/** A word as the colours are looked up: no case, no diacritics. */
const folded = (word: string) => word.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * The colours a line may name (the owner, 2026-11-19: «Toate astea trebuie să fie configurabile» — the band's colour badge by
 * badge): the club's orange and blue and the bibs' six (`BIB_COLOURS`), in Romanian and in English, or a hex triplet typed as such.
 * The renderer checks the colour again (`badgeRoleColour`): one its words would not read on prints the club's orange. The bibs'
 * green carries white words at 4.4 : 1, under the band's AA, so «verde» is the deep green the site writes green text in (7.8 : 1).
 */
const NAMED_COLOURS: Record<string, string> = {
  ...Object.fromEntries(BIB_COLOURS.map((colour) => [colour.key, colour.hex])),
  portocaliu: COLOR.orange,
  orange: COLOR.orange,
  albastru: COLOR.blue,
  blue: COLOR.blue,
  green: COLOR.kindSpecialInk,
  verde: COLOR.kindSpecialInk,
  rosu: BIB_COLOURS.find((colour) => colour.key === "red")?.hex ?? COLOR.orange,
  mov: BIB_COLOURS.find((colour) => colour.key === "purple")?.hex ?? COLOR.orange,
  violet: BIB_COLOURS.find((colour) => colour.key === "purple")?.hex ?? COLOR.orange,
  turcoaz: BIB_COLOURS.find((colour) => colour.key === "teal")?.hex ?? COLOR.orange,
  negru: BIB_COLOURS.find((colour) => colour.key === "black")?.hex ?? COLOR.orange,
};

/** The colour names the help text lists, in the order a person reads them. */
export const NAMED_COLOUR_WORDS = { ro: "portocaliu, albastru, verde, roșu, mov, turcoaz, negru", en: "orange, blue, green, red, purple, teal, black" } as const;

/** A typed colour: a known name or a `#rrggbb`; anything else is no colour (the design's own band). */
export function namedBadgeColour(word: string): string | null {
  const typed = oneLine(word);
  if (/^#[0-9a-f]{6}$/i.test(typed)) return typed.toLowerCase();
  return NAMED_COLOURS[folded(typed)] ?? null;
}

/** The first word of a name as typed — what a badge prints by default (the elite bib's rule, `bib-elite.ts#eliteLineDefaultLabel`). */
export function badgeFirstName(name: string): string {
  return oneLine(name).split(" ")[0] ?? "";
}

/** The list's starting text: one «LABEL; First name» line per person, in the order given. */
export function namedBadgeLinesText(label: string, names: readonly string[]): string {
  return names
    .map((name) => badgeFirstName(name))
    .filter((first) => first !== "")
    .map((first) => `${label}; ${first}`)
    .join("\n");
}

/**
 * The badges a posted list asks for, in its order: each non-empty line is one badge. «Fotograf; Amalia» prints «FOTOGRAF» on the
 * band and «Amalia» below it; «Organizator; Dany; albastru» does so on a blue band (`namedBadgeColour`; a colour it does not know
 * is the design's own band). A line with no «;» is a first name under the design's own word (`defaultLabel`); «; Ana» too. A line
 * with a word and no name prints the word with no name. Longer than the badge holds is cut, never refused: a list that prints
 * plainly beats one that does not print. At most `NAMED_BADGES_MAX` badges; the rest is left out.
 */
export function parseNamedBadgeLines(text: string, defaultLabel: string): NamedBadgeLine[] {
  const badges: NamedBadgeLine[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = oneLine(raw);
    if (line === "") continue;
    const parts = line.split(";").map(oneLine);
    const [typedLabel, typedName, typedColour] = parts.length === 1 ? ["", parts[0], ""] : [parts[0], parts[1] ?? "", parts.slice(2).join(";")];
    if (typedLabel === "" && typedName === "") continue;
    badges.push({
      label: typedLabel === "" ? defaultLabel : typedLabel,
      name: [...typedName].slice(0, NAMED_BADGE_NAME_MAX).join(""),
      colour: typedColour === "" ? null : namedBadgeColour(typedColour),
    });
    if (badges.length === NAMED_BADGES_MAX) break;
  }
  return badges;
}
