import { describe, expect, it } from "vitest";
import { BADGE_ROLE_FALLBACK, badgeColourReadable, badgeRoleColour } from "@/modules/volunteers/badges/badge-design";
import {
  badgeFirstName,
  NAMED_BADGE_NAME_MAX,
  NAMED_BADGES_MAX,
  NAMED_COLOUR_WORDS,
  namedBadgeColour,
  namedBadgeLinesText,
  parseNamedBadgeLines,
} from "@/modules/volunteers/badges/badge-named";
import { BIB_COLOURS, COLOR } from "@/theme/brand";

/**
 * §NNN — «Ecusoane cu nume», the hotfix of 2026-11-19 (BR-REQ-050-02, amending §764's «no name is printed»; the owner: «pune-mi și
 * numele lor pe ele», «Vreau doar prenume pe ele», «Vreau să pot customiza textele de pe fiecare ecuson în parte», «Culoarea benzii, pe
 * fiecare»). The list the badges page posts, one line a badge — «the word on the band; the first name; the band's colour» — as
 * `parseNamedBadgeLines` reads it; the colour names it knows (`namedBadgeColour`), every one readable at AA; the first-name rule
 * (`badgeFirstName`) and the text the box starts with (`namedBadgeLinesText`). Pure: no database, no renderer.
 */

const DEFAULT = "VOLUNTAR";
const hexOf = (key: (typeof BIB_COLOURS)[number]["key"]) => BIB_COLOURS.find((colour) => colour.key === key)!.hex;
/** Every colour word the help line lists, in both languages, and «violet», which the reader knows besides. */
const COLOUR_WORDS = [...NAMED_COLOUR_WORDS.ro.split(", "), ...NAMED_COLOUR_WORDS.en.split(", "), "violet"];

describe("§NNN parseNamedBadgeLines — one line a badge", () => {
  it("reads each line as one badge, in its order: the word on the band, «;», the first name and, if typed, «;» and the colour", () => {
    expect(parseNamedBadgeLines("Fotograf; Amalia\nOrganizator; Dany; albastru\nVoluntar; Ion; #C62828", DEFAULT)).toEqual([
      { label: "Fotograf", name: "Amalia", colour: null },
      { label: "Organizator", name: "Dany", colour: COLOR.blue },
      { label: "Voluntar", name: "Ion", colour: "#c62828" },
    ]);
  });

  it("skips blank lines and lines of spaces, and reads the line ends of Windows as well", () => {
    const badges = parseNamedBadgeLines("\r\n   \nFotograf; Amalia\r\n\t\r\n\nDany\n\n", DEFAULT);
    expect(badges).toEqual([
      { label: "Fotograf", name: "Amalia", colour: null },
      { label: DEFAULT, name: "Dany", colour: null },
    ]);
    expect(parseNamedBadgeLines("", DEFAULT)).toEqual([]);
    expect(parseNamedBadgeLines(" \n\t\n", DEFAULT)).toEqual([]);
  });

  it("trims every part and folds the spaces inside it, and prints a name typed with two words as typed", () => {
    expect(parseNamedBadgeLines("  Punct   de apă ;   Ana    Maria  ;  verde  ", DEFAULT)).toEqual([{ label: "Punct de apă", name: "Ana Maria", colour: COLOR.kindSpecialInk }]);
  });

  it("reads a line without «;» as a first name under the design's own word — and «; Ana» too", () => {
    expect(parseNamedBadgeLines("Ana", DEFAULT)).toEqual([{ label: DEFAULT, name: "Ana", colour: null }]);
    expect(parseNamedBadgeLines("; Ana", DEFAULT)).toEqual([{ label: DEFAULT, name: "Ana", colour: null }]);
    expect(parseNamedBadgeLines(" ;Ana; mov", "STAFF")).toEqual([{ label: "STAFF", name: "Ana", colour: hexOf("purple") }]);
    // The word is the design's as the caller hands it: the band prints it in capitals.
    expect(parseNamedBadgeLines("Ana", "Staff")[0].label).toBe("Staff");
  });

  it("prints a word with no name as the word alone, and leaves out a line with neither", () => {
    expect(parseNamedBadgeLines("Fotograf;", DEFAULT)).toEqual([{ label: "Fotograf", name: "", colour: null }]);
    expect(parseNamedBadgeLines("Fotograf; ; verde", DEFAULT)).toEqual([{ label: "Fotograf", name: "", colour: COLOR.kindSpecialInk }]);
    // No word and no name: nothing to print, whatever colour the line names.
    expect(parseNamedBadgeLines(";\n ; ; \n; ; verde", DEFAULT)).toEqual([]);
  });

  it("gives a colour it does not know the design's own band, never a refusal", () => {
    for (const typed of ["roz", "#abc", "c62828", "verde; albastru", "verde închis"]) {
      expect(parseNamedBadgeLines(`Ana; Ion; ${typed}`, DEFAULT), typed).toEqual([{ label: "Ana", name: "Ion", colour: null }]);
    }
  });

  it("cuts a first name at 40 characters by code points — an emoji is never split — and never refuses it", () => {
    expect(NAMED_BADGE_NAME_MAX).toBe(40);
    const forty = "A".repeat(40);
    expect(parseNamedBadgeLines(`X; ${forty}`, DEFAULT)[0].name).toBe(forty);
    expect(parseNamedBadgeLines(`X; ${forty}B`, DEFAULT)[0].name).toBe(forty);
    // 39 letters, an emoji (two UTF-16 units, one code point) and a letter: the emoji is the 40th character and stays whole.
    const [cut] = parseNamedBadgeLines(`X; ${"A".repeat(39)}😀B`, DEFAULT);
    expect(cut.name).toBe(`${"A".repeat(39)}😀`);
    expect([...cut.name]).toHaveLength(NAMED_BADGE_NAME_MAX);
    expect(cut.name.length).toBe(NAMED_BADGE_NAME_MAX + 1);
    // Forty letters and an emoji: the emoji is the 41st character and is left out whole, never half of it.
    const [whole] = parseNamedBadgeLines(`X; ${"A".repeat(40)}😀`, DEFAULT);
    expect(whole.name).toBe("A".repeat(40));
    expect(whole.name).not.toMatch(/[\uD800-\uDFFF]/);
  });

  it("prints at most 300 badges and leaves the lines after out; a blank line is no badge and does not count", () => {
    expect(NAMED_BADGES_MAX).toBe(300);
    const lines = Array.from({ length: 305 }, (_, index) => `Voluntar; P${index + 1}`);
    const badges = parseNamedBadgeLines(lines.join("\n"), DEFAULT);
    expect(badges).toHaveLength(NAMED_BADGES_MAX);
    expect(badges.at(-1)!.name).toBe("P300");
    expect(parseNamedBadgeLines(lines.slice(0, 300).join("\n\n \n"), DEFAULT)).toHaveLength(300);
  });
});

describe("§NNN namedBadgeColour — the band's colour by its name", () => {
  it("reads a name in Romanian or in English, with or without diacritics, in any case", () => {
    const cases: Array<[string[], string]> = [
      [["Roșu", "rosu", "ROȘU", "roşu", "red", "RED", "Red", "  Roșu  "], hexOf("red")],
      [["portocaliu", "Portocaliu", "PORTOCALIU", "orange", "Orange"], COLOR.orange],
      [["albastru", "Albastru", "blue", "BLUE"], COLOR.blue],
      [["verde", "Verde", "VERDE", "green", "GREEN"], COLOR.kindSpecialInk],
      [["mov", "Mov", "violet", "purple", "Purple"], hexOf("purple")],
      [["turcoaz", "Turcoaz", "teal", "TEAL"], hexOf("teal")],
      [["negru", "NEGRU", "black", "Black"], hexOf("black")],
    ];
    for (const [words, hex] of cases) for (const word of words) expect(namedBadgeColour(word), word).toBe(hex);
  });

  it("reads a #rrggbb code in lower case, whatever case it was typed in", () => {
    expect(namedBadgeColour("#C62828")).toBe("#c62828");
    expect(namedBadgeColour("#AbCdEf")).toBe("#abcdef");
    expect(namedBadgeColour("  #0D47A1 ")).toBe("#0d47a1");
  });

  it("is no colour — the design's band — for anything else", () => {
    for (const typed of ["", " ", "roz", "gri", "ro su", "#abc", "c62828", "#c6282", "#c628289", "#ggg000", "rgb(198, 40, 40)", "verde închis"]) {
      expect(namedBadgeColour(typed), typed).toBeNull();
    }
  });

  it("names only colours that carry their words at AA (4.5 : 1), so the renderer prints every one of them as named", () => {
    for (const word of [...COLOUR_WORDS, ...BIB_COLOURS.map((colour) => colour.key)]) {
      const hex = namedBadgeColour(word);
      expect(hex, word).not.toBeNull();
      expect(badgeColourReadable(hex!), `${word} ${hex}`).toBe(true);
      // `badgeRoleColour` checks a colour again before it prints: a named one is never swapped for the club's orange.
      expect(badgeRoleColour(hex), word).toBe(hex);
    }
  });

  it("makes green the deep green the site writes green words in, on purpose: the bibs' green reads at 4.4 : 1, under AA", () => {
    const bibGreen = hexOf("green");
    expect(badgeColourReadable(bibGreen)).toBe(false);
    expect(namedBadgeColour("verde")).toBe(COLOR.kindSpecialInk);
    expect(namedBadgeColour("green")).toBe(COLOR.kindSpecialInk);
    expect(namedBadgeColour("green")).not.toBe(bibGreen);
  });

  it("makes «orange» and «portocaliu» the same club orange — the band of a badge with no colour of its own", () => {
    expect(namedBadgeColour("orange")).toBe(COLOR.orange);
    expect(namedBadgeColour("portocaliu")).toBe(namedBadgeColour("orange"));
    expect(namedBadgeColour("orange")).toBe(BADGE_ROLE_FALLBACK);
  });

  it("lists the same seven colours in the same order in both languages of the help line", () => {
    const ro = NAMED_COLOUR_WORDS.ro.split(", ");
    const en = NAMED_COLOUR_WORDS.en.split(", ");
    expect(ro).toHaveLength(7);
    expect(ro.map(namedBadgeColour)).toEqual(en.map(namedBadgeColour));
    expect(new Set(ro.map(namedBadgeColour)).size).toBe(7);
  });
});

describe("§NNN the first name and the box's first text", () => {
  it("takes the first word of a name as typed, as the elite bib's line does", () => {
    expect(badgeFirstName("Ana Maria Pop")).toBe("Ana");
    expect(badgeFirstName("  Dany   Ionescu ")).toBe("Dany");
    expect(badgeFirstName("Ion")).toBe("Ion");
    expect(badgeFirstName("Ana-Maria Pop")).toBe("Ana-Maria");
    expect(badgeFirstName("Ana\tPop")).toBe("Ana");
    expect(badgeFirstName("")).toBe("");
    expect(badgeFirstName("   ")).toBe("");
  });

  it("starts the box with one «WORD; First name» line a person, in the order given, and skips a person with no name to print", () => {
    expect(namedBadgeLinesText("VOLUNTAR", ["Ana Maria Pop", "Dan Ene", "Ion"])).toBe("VOLUNTAR; Ana\nVOLUNTAR; Dan\nVOLUNTAR; Ion");
    expect(namedBadgeLinesText("VOLUNTAR", ["Ana Pop", "", "   ", "Dan Ene"])).toBe("VOLUNTAR; Ana\nVOLUNTAR; Dan");
    expect(namedBadgeLinesText("Staff", ["Ana Pop"])).toBe("Staff; Ana");
    expect(namedBadgeLinesText("VOLUNTAR", [])).toBe("");
  });

  it("reads back as the badges it says: the design's word and each first name, on the design's band", () => {
    const text = namedBadgeLinesText(DEFAULT, ["Ana Maria Pop", "Dan Ene"]);
    expect(parseNamedBadgeLines(text, DEFAULT)).toEqual([
      { label: DEFAULT, name: "Ana", colour: null },
      { label: DEFAULT, name: "Dan", colour: null },
    ]);
  });
});
