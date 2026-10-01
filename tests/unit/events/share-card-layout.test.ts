import { describe, expect, it } from "vitest";
import { clampTitle } from "@/modules/events/share-card-design";
import {
  chipRows,
  lineCount,
  placeOnOneLine,
  SHARE_LAYOUT,
  SHARE_TITLE_LINES,
  type ShareCardContent,
  shareTitleSize,
  textWidth,
  titleHeight,
  titleRoom,
} from "@/modules/events/share-card-layout";

/**
 * BR-REQ-052-02 criterion 8 (`DECISIONS.md` §NNN) — the shared card's layout budget: the title is
 * sized by the room the rest of the card leaves it, three lines at most, so the facts and the band
 * stay on the card. `share-image.test.ts` proves the same on drawn PNGs; this pins the arithmetic.
 */

const SHAPES = ["square", "og"] as const;
const inner = (shape: (typeof SHAPES)[number]) => SHARE_LAYOUT[shape].width - 2 * SHARE_LAYOUT[shape].pad;

/** The card as the platform draws it today: the logo, a type pill, the date and time, a place, both chips, the band. */
const PLAIN: ShareCardContent = {
  logo: true,
  pill: "Concurs",
  tagline: null,
  heldBack: null,
  place: "Piața Sfatului",
  chips: ["circa 10 km", "350 m diferență de nivel"],
  band: true,
};

/** A title of about `length` characters, made of whole words. */
function titleOf(length: number): string {
  const words = "Crosul de toamnă al Brașovului pe Tâmpa și pe aleile de sub Tâmpa cu start și sosire în Piața Sfatului ediția a doua pentru toți".split(" ");
  let title = "";
  for (const word of words) if (Array.from(`${title} ${word}`.trim()).length <= length) title = `${title} ${word}`.trim();
  return title;
}

const LONG_TITLE = clampTitle(titleOf(200));
const LONG_PLACE = "Parcarea de lângă baza pârtiei Bradu din Poiana Brașov, la intrarea dinspre Drumul Poienii 21";
const TAGLINE = "Alergăm împreună pe Tâmpa, prin Șchei și pe aleile din parc";

describe("textWidth and lineCount — Roboto's measured widths, broken at the spaces", () => {
  it("measures a letter at its advance and a letter it does not know as wider than any Latin one but M and W", () => {
    expect(textWidth("a", 100)).toBeCloseTo(55);
    expect(textWidth("M", 100)).toBeCloseTo(88);
    expect(textWidth("ș", 100)).toBe(textWidth("s", 100));
    // The decomposed «ș» (s + comma below) is measured as the composed letter.
    expect(textWidth("ș", 100)).toBe(textWidth("ș", 100));
    expect(textWidth("ж", 100)).toBeCloseTo(80);
  });

  it("counts the lines a greedy wrap takes, and breaks a word wider than the box", () => {
    expect(lineCount("", 50, 900)).toBe(1);
    expect(lineCount("Tura de joi", 50, 900)).toBe(1);
    expect(lineCount("aaaa bbbb", 100, 500)).toBe(1);
    expect(lineCount("aaaa bbbb", 100, 460)).toBe(2);
    expect(lineCount("x".repeat(60), 50, 900)).toBe(Math.ceil(textWidth("x".repeat(60), 50) / (900 * 0.98)));
  });

  it("wraps the chips to a second row only when they do not fit beside each other", () => {
    expect(chipRows(PLAIN.chips, "og")).toBe(1);
    expect(chipRows(PLAIN.chips, "square")).toBe(1);
    expect(chipRows(["circa 1.234,5 km (aproximativ)", "circa 2.345 m diferență de nivel (estimativ)"], "square")).toBe(2);
  });
});

describe("shareTitleSize — the largest size whose three lines fit the room the card leaves", () => {
  it("draws a short title large and a long one smaller, never growing with the length", () => {
    for (const shape of SHAPES) {
      const room = titleRoom(shape, PLAIN);
      let previous = Infinity;
      for (let length = 10; length <= 110; length += 5) {
        const size = shareTitleSize(titleOf(length), shape, room);
        expect(size, `${shape} ${length}`).toBeLessThanOrEqual(previous);
        previous = size;
      }
    }
    expect(shareTitleSize("Trail to Road cu Brașov Running Festival", "square", titleRoom("square", PLAIN))).toBe(92);
    expect(shareTitleSize("Trail to Road cu Brașov Running Festival", "og", titleRoom("og", PLAIN))).toBe(64);
  });

  it("uses the square's real free height: a sentence-case title of 85, 100 and 110 characters stays at 50 px or more", () => {
    const room = titleRoom("square", PLAIN);
    expect(room).toBeGreaterThan(350);
    for (const length of [85, 100, 110]) expect(shareTitleSize(titleOf(length), "square", room), String(length)).toBeGreaterThanOrEqual(50);
    expect(shareTitleSize(LONG_TITLE, "square", room)).toBe(50);
  });

  it("gives an all-capitals long title a size at which it still takes three lines", () => {
    const caps = LONG_TITLE.toUpperCase();
    for (const shape of SHAPES) {
      const size = shareTitleSize(caps, shape, titleRoom(shape, PLAIN));
      expect(lineCount(caps, size, inner(shape))).toBeLessThanOrEqual(SHARE_TITLE_LINES);
    }
  });

  it("steps the wide card's title down when a tagline takes a line beside the rule", () => {
    const title = titleOf(85);
    const without = shareTitleSize(title, "og", titleRoom("og", PLAIN));
    const withTagline = shareTitleSize(title, "og", titleRoom("og", { ...PLAIN, tagline: TAGLINE, place: placeOnOneLine(LONG_PLACE, "og") }));
    expect(withTagline).toBeLessThanOrEqual(without);
  });

  /*
    The review's cases on the wide card, and the same on the square: whatever the title, the place
    and the tagline, the title's lines at its size fit the room, so nothing pushes the band.
  */
  it.each(
    SHAPES.flatMap((shape) =>
      [
        ["a 110-character title and a 93-character place", { place: LONG_PLACE }],
        ["a long title with a sixty-character tagline", { tagline: TAGLINE }],
        ["a long title, a long place and a tagline", { place: LONG_PLACE, tagline: TAGLINE }],
        ["the date held back, a long place and a tagline", { heldBack: "Sâmbătă, 21 noiembrie 2026 · Ora se anunță în curând", place: LONG_PLACE, tagline: TAGLINE }],
        ["no logo, no pill and no band", { logo: false, pill: null, band: false }],
      ].map(([name, content]) => [shape, name, content] as const),
    ),
  )("%s, %s: the title fits in three lines and in the room", (shape, _name, overrides) => {
    const content: ShareCardContent = { ...PLAIN, ...(overrides as Partial<ShareCardContent>) };
    if (content.place) content.place = placeOnOneLine(content.place, shape);
    for (const title of [LONG_TITLE, LONG_TITLE.toUpperCase(), titleOf(40)]) {
      const room = titleRoom(shape, content);
      const size = shareTitleSize(title, shape, room);
      expect(lineCount(title, size, inner(shape)), title).toBeLessThanOrEqual(SHARE_TITLE_LINES);
      expect(titleHeight(title, size, shape), `${title} at ${size}`).toBeLessThanOrEqual(room);
    }
  });
});

describe("placeOnOneLine — the meeting point on one line beside its pin", () => {
  it("leaves a short place untouched", () => {
    for (const shape of SHAPES) expect(placeOnOneLine("Piața Sfatului", shape)).toBe("Piața Sfatului");
  });

  it("cuts a long place at a word, with «…», to what the line holds — fewer letters on the square's larger type", () => {
    for (const shape of SHAPES) {
      const place = placeOnOneLine(LONG_PLACE, shape);
      expect(place.endsWith("…"), place).toBe(true);
      expect(LONG_PLACE.startsWith(place.slice(0, -1))).toBe(true);
      expect(Array.from(place).length).toBeLessThanOrEqual(61);
      expect(textWidth(place, SHARE_LAYOUT[shape].place)).toBeLessThanOrEqual(inner(shape) - SHARE_LAYOUT[shape].glyph - 12);
    }
    expect(Array.from(placeOnOneLine(LONG_PLACE, "square")).length).toBeLessThan(Array.from(placeOnOneLine(LONG_PLACE, "og")).length);
  });
});
