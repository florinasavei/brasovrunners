import { describe, expect, it } from "vitest";
import {
  clampPlace,
  clampTitle,
  DEFAULT_SHARE_CARD_DESIGN,
  readShareCardDesign,
  SHARE_CARD_PALETTES,
  SHARE_CARD_TAGLINE_MAX,
  SHARE_PICTURE_VEIL,
  shareCardColours,
  textOnAccent,
  withAlpha,
} from "@/modules/events/share-card-design";
import { COLOR } from "@/theme/brand";

/**
 * BR-REQ-052-02 criterion 8 (`DECISIONS.md` §NNN) — the shared card is drawn from one design
 * object with the platform's defaults, and whatever is handed to the reader comes back as a
 * design: a card that fails to draw is worse than a plain card, so nothing here throws.
 */
describe("readShareCardDesign — anything stored reads as a design", () => {
  it("answers the platform's design for nothing, garbage and the wrong kind of value", () => {
    for (const value of [undefined, null, "", "brand", 42, [], [1, 2], { nonsense: true }]) {
      expect(readShareCardDesign(value), JSON.stringify(value)).toEqual(DEFAULT_SHARE_CARD_DESIGN);
    }
  });

  it("is the brand palette, the kit's orange, every element shown, no tagline and no picture by default", () => {
    expect(DEFAULT_SHARE_CARD_DESIGN).toEqual({
      palette: "brand",
      accent: COLOR.orange,
      showLogo: true,
      showType: true,
      showPlace: true,
      showRoute: true,
      showHost: true,
      tagline: "",
      backgroundPictureUrl: null,
    });
  });

  it("falls back field by field, keeping every choice that reads", () => {
    const design = readShareCardDesign({ palette: "neon", accent: "#123456", showLogo: "no", showHost: false, future: 1 });
    expect(design).toEqual({ ...DEFAULT_SHARE_CARD_DESIGN, accent: "#123456", showHost: false });
  });

  it("accepts each of the three palettes", () => {
    for (const palette of SHARE_CARD_PALETTES) expect(readShareCardDesign({ palette }).palette).toBe(palette);
  });

  it("refuses an accent that is not a six-digit hex, answering the kit's orange", () => {
    for (const accent of ["orange", "#fff", "#12345g", "rgb(0,0,0)", "", 7, null]) {
      expect(readShareCardDesign({ accent }).accent, String(accent)).toBe(COLOR.orange);
    }
    expect(readShareCardDesign({ accent: "#AbCdEf" }).accent).toBe("#AbCdEf");
  });

  it("keeps an absolute https picture and refuses every other address", () => {
    expect(readShareCardDesign({ backgroundPictureUrl: "https://media.example/abc/web.webp" }).backgroundPictureUrl).toBe(
      "https://media.example/abc/web.webp",
    );
    for (const url of [
      "javascript:alert(1)",
      "http://media.example/abc.png",
      "data:image/png;base64,AAAA",
      "/api/media/abc/web.webp",
      "not a url",
      "",
      42,
    ]) {
      expect(readShareCardDesign({ backgroundPictureUrl: url }).backgroundPictureUrl, String(url)).toBeNull();
    }
  });

  it("keeps the tagline on one line and cuts it at its ceiling rather than refusing it", () => {
    expect(readShareCardDesign({ tagline: "  Alergăm\n  împreună  " }).tagline).toBe("Alergăm împreună");
    const long = "ă".repeat(SHARE_CARD_TAGLINE_MAX + 20);
    expect(Array.from(readShareCardDesign({ tagline: long }).tagline)).toHaveLength(SHARE_CARD_TAGLINE_MAX);
    expect(readShareCardDesign({ tagline: 5 }).tagline).toBe("");
  });
});

describe("shareCardColours — the palette, the accent and a picture, as colours", () => {
  it("draws the brand card white on the blue, with a paper band and the blue mountains", () => {
    const colours = shareCardColours(DEFAULT_SHARE_CARD_DESIGN, false);
    expect(colours).toMatchObject({ palette: "brand", base: COLOR.blueInk, text: COLOR.surface, band: COLOR.paper, bandText: COLOR.blue, logo: "white", mark: "blue" });
    expect(colours.gradient).toContain(COLOR.blue);
    expect(colours.overlay).toBeNull();
    // The type pill is a tint of the words with the words' colour; only the cancelled pill is solid accent.
    expect(colours.pill).toBe(withAlpha(COLOR.surface, 0.14));
    expect(colours.pillText).toBe(COLOR.surface);
    expect(colours.cancelledPill).toBe(COLOR.orange);
    expect(colours.cancelledPillText).toBe(COLOR.ink);
    expect(colours.cancelledPill).not.toBe(colours.pill);
  });

  it("draws the ink card on near-black and the paper card in ink with a blue band", () => {
    expect(shareCardColours({ ...DEFAULT_SHARE_CARD_DESIGN, palette: "ink" }, false)).toMatchObject({ base: COLOR.ink, text: COLOR.surface, logo: "white" });
    expect(shareCardColours({ ...DEFAULT_SHARE_CARD_DESIGN, palette: "paper" }, false)).toMatchObject({
      base: COLOR.paper,
      text: COLOR.ink,
      band: COLOR.blue,
      bandText: COLOR.paper,
      logo: "blue",
      mark: "white",
      gradient: null,
    });
  });

  it("draws a picture under a veil of the palette's colour, and paper under a picture as brand", () => {
    const brand = shareCardColours({ ...DEFAULT_SHARE_CARD_DESIGN }, true);
    expect(brand.overlay).toBe(
      `linear-gradient(180deg, ${withAlpha(COLOR.blueInk, 0.72)} 0%, ${withAlpha(COLOR.blueInk, 0.72)} 25%, ${withAlpha(COLOR.blueInk, 0.6)} 50%, ${withAlpha(COLOR.blueInk, 0.88)} 100%)`,
    );
    // No radial light over a picture, and the pill a shade of the base rather than a tint of white.
    expect(brand.glow).toBe(withAlpha(COLOR.surface, 0));
    expect(brand.pill).toBe(withAlpha(COLOR.blueInk, 0.55));
    const paper = shareCardColours({ ...DEFAULT_SHARE_CARD_DESIGN, palette: "paper" }, true);
    expect(paper).toMatchObject({ palette: "brand", text: COLOR.surface, logo: "white" });
  });

  it("carries the club's accent into the cancelled pill, the rule and the circle", () => {
    const colours = shareCardColours({ ...DEFAULT_SHARE_CARD_DESIGN, accent: "#00aa55" }, false);
    expect(colours.accent).toBe("#00aa55");
    expect(colours.cancelledPill).toBe("#00aa55");
    expect(colours.circle).toBe("rgba(0,170,85,0.14)");
  });
});

describe("SHARE_PICTURE_VEIL — white words read over any photograph (§NNN)", () => {
  /** The base at an opacity over pure white, as the veil draws it over the lightest picture there is. */
  function overWhite(hex: string, alpha: number): number {
    const channel = (at: number) => {
      const value = (255 * (1 - alpha) + Number.parseInt(hex.slice(at, at + 2), 16) * alpha) / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    };
    const luminance = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
    return 1.05 / (luminance + 0.05);
  }

  it("gives white 4.5:1 behind the logo and the pill, and 3:1 behind the title, on the dark palettes over pure white", () => {
    for (const base of [COLOR.blueInk, COLOR.ink]) {
      expect(overWhite(base, SHARE_PICTURE_VEIL.top), base).toBeGreaterThanOrEqual(4.5);
      expect(overWhite(base, SHARE_PICTURE_VEIL.middle), base).toBeGreaterThanOrEqual(3);
      expect(overWhite(base, SHARE_PICTURE_VEIL.foot), base).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("textOnAccent — the pill's letters read on the accent", () => {
  it("is ink on the kit's orange and on a light accent, white on a dark one", () => {
    expect(textOnAccent(COLOR.orange)).toBe(COLOR.ink);
    expect(textOnAccent("#ffe066")).toBe(COLOR.ink);
    expect(textOnAccent("#1a237e")).toBe(COLOR.surface);
  });
});

describe("clampTitle — at most 110 characters, cut at a word", () => {
  it("leaves a title of 110 characters or fewer untouched", () => {
    const exactly = `${"a".repeat(50)} ${"b".repeat(59)}`;
    expect(exactly).toHaveLength(110);
    expect(clampTitle(exactly)).toBe(exactly);
    expect(clampTitle("Trail to Road cu Brașov Running Festival")).toBe("Trail to Road cu Brașov Running Festival");
  });

  it("cuts a longer title at the last word that fits and adds «…»", () => {
    const title =
      "Semimaratonul de toamnă al Brașovului, pe Tâmpa și pe aleile de sub Tâmpa, cu start și sosire în Piața Sfatului, ediția a doua";
    const clamped = clampTitle(title);
    expect(clamped).toBe("Semimaratonul de toamnă al Brașovului, pe Tâmpa și pe aleile de sub Tâmpa, cu start și sosire în Piața…");
    expect(Array.from(clamped).length).toBeLessThanOrEqual(111);
    expect(title.startsWith(clamped.slice(0, -1))).toBe(true);
  });

  it("drops the punctuation the cut leaves behind, and cuts a title with no space mid-word", () => {
    expect(clampTitle("Unu doi, trei patru", 12)).toBe("Unu doi…");
    expect(clampTitle("x".repeat(200))).toBe(`${"x".repeat(109)}…`);
  });
});

describe("clampPlace — at most 60 characters, cut at a word, on one line (§NNN)", () => {
  it("leaves a place of 60 characters or fewer untouched, its whitespace on one line", () => {
    expect(clampPlace("Piața Sfatului")).toBe("Piața Sfatului");
    const exactly = `${"a".repeat(30)} ${"b".repeat(29)}`;
    expect(exactly).toHaveLength(60);
    expect(clampPlace(exactly)).toBe(exactly);
    expect(clampPlace("  Piața\n Sfatului ")).toBe("Piața Sfatului");
  });

  it("cuts a longer place at the last word that fits and adds «…»", () => {
    const place = "Parcarea de lângă baza pârtiei Bradu din Poiana Brașov, la intrarea dinspre Drumul Poienii 21";
    const clamped = clampPlace(place);
    expect(clamped).toBe("Parcarea de lângă baza pârtiei Bradu din Poiana Brașov, la…");
    expect(Array.from(clamped).length).toBeLessThanOrEqual(61);
    expect(place.startsWith(clamped.slice(0, -1))).toBe(true);
  });

  it("drops the punctuation the cut leaves behind, and cuts a place with no space mid-word", () => {
    expect(clampPlace("Strada Lungă, nr. 5", 14)).toBe("Strada Lungă…");
    expect(clampPlace("x".repeat(90))).toBe(`${"x".repeat(59)}…`);
  });
});
