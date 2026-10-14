import { describe, expect, it } from "vitest";
import { contrastRatio, MIN_TEXT_CONTRAST } from "@/modules/appearance/domain/tint-contrast";
import { BIB_COLOURS } from "@/modules/content/events/ui/bib-colours";
import { bibFooterWidth } from "@/modules/registrations/bib-footer";
import { A4_PAGE } from "@/modules/registrations/bib-geometry";
import { bibTitleWidth } from "@/modules/registrations/bib-header";
import {
  BADGE_BAND_FALLBACK,
  BADGE_DRAWING_VERSION,
  BADGE_ROLE_FALLBACK,
  type BadgeDesign,
  badgeBandColour,
  badgeColourReadable,
  badgeDesignSchema,
  badgeDesignFromQuery,
  badgeLabelText,
  badgePictureStamp,
  badgeRoleColour,
  badgeRoleText,
  badgeTextOn,
  badgeWords,
  DEFAULT_BADGE_DESIGN,
  readBadgeDesign,
} from "@/modules/volunteers/badges/badge-design";
import {
  BADGE_CUSTOM_BOUNDS,
  BADGE_INSET,
  BADGE_LAYOUT,
  BADGE_PAGE_MARGIN,
  BADGE_WRITING_MIN,
  type BadgeLayoutWords,
  type BadgeSizeChoice,
  badgeFit,
  badgeImageSize,
  badgeLayout,
  badgeLineHeight,
  badgePaper,
  badgeRows,
  badgeSheetGrid,
  badgeSheetPages,
  badgeSheetSlots,
  MM,
} from "@/modules/volunteers/badges/badge-geometry";
import { badgeDesignQuery, readBadgeDesignForm } from "@/modules/volunteers/badges/badge-query";
import { fnv1a } from "@/shared/hash";
import { COLOR } from "@/theme/brand";

/**
 * §NNN — the volunteer badge's one geometry (BR-REQ-050-02): a small, long strip with no printed name;
 * the role's name fits its band, shrinking before it is cut; the writing area keeps the height a name in
 * marker needs at every size; the packing on A4 for each size; the colours read at AA; the stamp follows
 * what the picture is drawn from. Pure, no database, no renderer.
 */

const MEASURE = { bold: bibTitleWidth, regular: bibFooterWidth };
const STRIP90: BadgeSizeChoice = { size: "strip90", customWidthMm: 0, customHeightMm: 0 };
const STRIP100: BadgeSizeChoice = { size: "strip100", customWidthMm: 0, customHeightMm: 0 };
const custom = (width: number, height: number): BadgeSizeChoice => ({ size: "custom", customWidthMm: width, customHeightMm: height });
const WORDS: BadgeLayoutWords = { title: "Brașov Trail Race", label: "VOLUNTAR", role: "PUNCT DE APĂ", name: "Nume:", phone: null };
const layoutOf = (size: BadgeSizeChoice, words: Partial<BadgeLayoutWords> = {}) =>
  badgeLayout({ ...size, headerPicture: false, showLogo: true, writingLine: true }, { ...WORDS, ...words }, MEASURE);

describe("§NNN the badge's size", () => {
  it("is 90 × 35 mm by default and 100 × 40 mm as the second preset, in points", () => {
    expect(badgePaper(STRIP90).width).toBeCloseTo(90 * MM, 6);
    expect(badgePaper(STRIP90).height).toBeCloseTo(35 * MM, 6);
    expect(badgePaper(STRIP100).width).toBeCloseTo(100 * MM, 6);
    expect(badgePaper(STRIP100).height).toBeCloseTo(40 * MM, 6);
    expect(badgePaper(custom(120, 50)).width).toBeCloseTo(120 * MM, 6);
  });

  it("draws its picture at 960 pixels across, in the paper's own proportion", () => {
    for (const size of [STRIP90, STRIP100, custom(60, 100), custom(200, 30)]) {
      const image = badgeImageSize(size);
      const paper = badgePaper(size);
      expect(image.width).toBe(960);
      expect(Math.abs(image.height - (paper.height * 960) / paper.width)).toBeLessThanOrEqual(0.5);
    }
  });
});

describe("§NNN the rows of a badge", () => {
  const heights = [];
  for (let height = BADGE_CUSTOM_BOUNDS.height.min; height <= BADGE_CUSTOM_BOUNDS.height.max; height += 5) heights.push(height);

  it.each(heights)("keep the writing area's least height at %i mm, with or without the telephone", (height) => {
    for (const phone of [false, true]) {
      const paper = badgePaper(custom(90, height));
      const rows = badgeRows(paper, phone);
      expect(rows.writing.height).toBeGreaterThanOrEqual(BADGE_WRITING_MIN - 1e-9);
      // Edge to edge inside the border, top to bottom, nothing lost and nothing overlapping.
      const total = rows.header.height + rows.role.height + rows.writing.height + (rows.phone?.height ?? 0);
      expect(total).toBeCloseTo(paper.height - 2 * BADGE_INSET, 6);
      expect(rows.role.top).toBeCloseTo(rows.header.top + rows.header.height, 6);
      expect(rows.writing.top).toBeCloseTo(rows.role.top + rows.role.height, 6);
      if (rows.phone) expect(rows.phone.top).toBeCloseTo(rows.writing.top + rows.writing.height, 6);
      expect(rows.header.height).toBeGreaterThan(0);
      expect(rows.role.height).toBeGreaterThan(0);
    }
  });

  it("gives the bands their share when the size has room, and takes from them, never from the writing area, when it has not", () => {
    const roomy = badgeRows(badgePaper(STRIP100), false);
    const content = badgePaper(STRIP100).height - 2 * BADGE_INSET;
    expect(roomy.header.height).toBeCloseTo(content * BADGE_LAYOUT.headerShare, 6);
    const tight = badgeRows(badgePaper(custom(90, BADGE_CUSTOM_BOUNDS.height.min)), true);
    expect(tight.writing.height).toBeCloseTo(BADGE_WRITING_MIN, 6);
    const tightContent = badgePaper(custom(90, BADGE_CUSTOM_BOUNDS.height.min)).height - 2 * BADGE_INSET;
    expect(tight.header.height).toBeLessThan(tightContent * BADGE_LAYOUT.headerShare);
    // The two bands keep their proportion as they give up room.
    expect(tight.header.height / tight.role.height).toBeCloseTo(BADGE_LAYOUT.headerShare / BADGE_LAYOUT.roleShare, 6);
  });
});

describe("§NNN a line fitted to its room", () => {
  it("keeps its largest size when it fits", () => {
    const fitted = badgeFit("APĂ", MEASURE.bold, 200, 12, 6);
    expect(fitted).toEqual({ text: "APĂ", size: 12, cut: false });
  });

  it("shrinks by half a point before anything is cut, and is cut with «…» only past the least size", () => {
    const text = "COORDONATOR PUNCT DE ALIMENTARE";
    const width = MEASURE.bold(text) * 9;
    const shrunk = badgeFit(text, MEASURE.bold, width, 12, 6);
    expect(shrunk.cut).toBe(false);
    expect(shrunk.size).toBe(9);
    const cut = badgeFit(text, MEASURE.bold, MEASURE.bold(text) * 4, 12, 6);
    expect(cut.cut).toBe(true);
    expect(cut.size).toBe(6);
    expect(cut.text.endsWith("…")).toBe(true);
    expect(MEASURE.bold(cut.text) * 6).toBeLessThanOrEqual(MEASURE.bold(text) * 4 + 1e-9);
  });

  it("never ends a cut on a space or a dash before the «…»", () => {
    const cut = badgeFit("ALFA - BETA GAMMA DELTA", MEASURE.bold, MEASURE.bold("ALFA - ") * 6 + 1, 6, 6);
    expect(cut.text).not.toMatch(/[\s-]…$/u);
  });
});

describe("§NNN the role's name on its band", () => {
  const sizes = [STRIP90, STRIP100, custom(60, 30), custom(200, 100)];

  it.each(sizes.map((size) => [`${size.size} ${size.customWidthMm}×${size.customHeightMm}`, size] as const))("fits the band's width and height at %s", (_name, size) => {
    for (const role of ["APĂ", "PUNCT DE ALIMENTARE KM 12", "COORDONATORUL GENERAL AL TUTUROR PUNCTELOR DE CONTROL ȘI AL VOLUNTARILOR"]) {
      const layout = layoutOf(size, { role });
      const room = layout.content.width - 2 * layout.pad;
      expect(MEASURE.bold(layout.roleLine.text) * layout.roleLine.size).toBeLessThanOrEqual(room + 1e-9);
      expect(layout.roleLine.size).toBeGreaterThanOrEqual(BADGE_LAYOUT.roleMinSize);
      // «VOLUNTAR» above it and the name both inside the band.
      expect(layout.label).not.toBeNull();
      expect(layout.label!.top).toBeGreaterThanOrEqual(layout.role.top - 1e-9);
      expect(layout.roleLine.top + badgeLineHeight(layout.roleLine.size)).toBeLessThanOrEqual(layout.role.top + layout.role.height + 1e-9);
    }
  });

  it("shrinks a long name before it cuts it, and cuts only a name too long for the least size", () => {
    const short = layoutOf(STRIP90, { role: "APĂ" });
    // A name a little too wide for the largest size and narrow enough for the least: words added until it is.
    const room = short.content.width - 2 * short.pad;
    let middle = "PUNCT";
    while (MEASURE.bold(middle) * short.roleLine.size <= room) middle += " DE APĂ";
    expect(MEASURE.bold(middle) * BADGE_LAYOUT.roleMinSize).toBeLessThanOrEqual(room);
    const longer = layoutOf(STRIP90, { role: middle });
    const longest = layoutOf(STRIP90, { role: "COORDONATORUL GENERAL AL TUTUROR PUNCTELOR DE CONTROL ȘI AL VOLUNTARILOR" });
    expect(short.roleLine.cut).toBe(false);
    expect(longer.roleLine.size).toBeLessThan(short.roleLine.size);
    expect(longer.roleLine.cut).toBe(false);
    expect(longest.roleLine.cut).toBe(true);
    expect(longest.roleLine.size).toBe(BADGE_LAYOUT.roleMinSize);
    expect(longest.roleLine.text.endsWith("…")).toBe(true);
  });

  it("prints «VOLUNTAR» alone and large on a badge «fără rol»", () => {
    const none = layoutOf(STRIP90, { role: null });
    expect(none.label).toBeNull();
    expect(none.roleLine.text).toBe("VOLUNTAR");
    expect(none.roleLine.size).toBeGreaterThan(layoutOf(STRIP90).label!.size);
  });

  it("writes the role's name and the word in capitals in the badge's language, ș staying ș", () => {
    expect(badgeRoleText("Punct de apă", "ro")).toBe("PUNCT DE APĂ");
    expect(badgeRoleText("Marshal  on   the course", "en")).toBe("MARSHAL ON THE COURSE");
    expect(badgeLabelText("voluntar și prieten", "ro")).toBe("VOLUNTAR ȘI PRIETEN");
  });
});

describe("§NNN the header and the writing area", () => {
  it("keeps the title clear of the logo and inside the band", () => {
    const layout = layoutOf(STRIP90, { title: "Maratonul Internațional al Munților Bucegi — ediția a XX-a" });
    expect(layout.logo).not.toBeNull();
    const titleLeft = layout.title!.right - MEASURE.bold(layout.title!.text) * layout.title!.size;
    expect(titleLeft).toBeGreaterThanOrEqual(layout.logo!.left + layout.logo!.width + layout.pad - 1e-9);
    expect(layout.title!.top).toBeGreaterThanOrEqual(layout.header.top - 1e-9);
    expect(layout.title!.top + badgeLineHeight(layout.title!.size)).toBeLessThanOrEqual(layout.header.top + layout.header.height + 1e-9);
  });

  it("draws neither logo nor title over the club's picture (the bib's rule)", () => {
    const layout = badgeLayout({ ...STRIP90, headerPicture: true, showLogo: true, writingLine: true }, WORDS, MEASURE);
    expect(layout.logo).toBeNull();
    expect(layout.title).toBeNull();
  });

  it("puts «Nume:» and the faint line inside the writing area, and no line when the club wants none", () => {
    const layout = layoutOf(STRIP90);
    expect(layout.name.top).toBeGreaterThanOrEqual(layout.writing.top);
    expect(layout.line!.y).toBeGreaterThan(layout.name.top + badgeLineHeight(layout.name.size));
    expect(layout.line!.y).toBeLessThan(layout.writing.top + layout.writing.height);
    const plain = badgeLayout({ ...STRIP90, headerPicture: false, showLogo: true, writingLine: false }, WORDS, MEASURE);
    expect(plain.line).toBeNull();
  });

  it("sets the coordinator's telephone in its own row, under the writing area", () => {
    const layout = layoutOf(STRIP90, { phone: "Coordonator: 0712 345 678" });
    expect(layout.phone).not.toBeNull();
    expect(layout.phoneLine!.top).toBeGreaterThanOrEqual(layout.phone!.top - 1e-9);
    expect(MEASURE.regular(layout.phoneLine!.text) * layout.phoneLine!.size).toBeLessThanOrEqual(layout.content.width - 2 * layout.pad + 1e-9);
  });
});

describe("§NNN the sheet: badges packed on A4", () => {
  it("fits 16 strips of 90 × 35 mm and 14 of 100 × 40 mm on a sheet", () => {
    expect(badgeSheetGrid(badgePaper(STRIP90))).toMatchObject({ columns: 2, rows: 8, perSheet: 16 });
    expect(badgeSheetGrid(badgePaper(STRIP100))).toMatchObject({ columns: 2, rows: 7, perSheet: 14 });
    expect(badgeSheetGrid(badgePaper(custom(200, 100)))).toMatchObject({ columns: 1, rows: 2, perSheet: 2 });
    expect(badgeSheetGrid(badgePaper(custom(60, 30)))).toMatchObject({ columns: 3, rows: 9, perSheet: 27 });
  });

  it.each([STRIP90, STRIP100, custom(60, 30), custom(200, 100), custom(133, 47)])("keeps every badge inside the margins, none overlapping (%o)", (size) => {
    const paper = badgePaper(size);
    const grid = badgeSheetGrid(paper);
    const slots = badgeSheetSlots(grid.perSheet * 2 + 1, paper);
    expect(badgeSheetPages(slots.length, paper)).toBe(3);
    expect(slots.at(-1)!.page).toBe(2);
    for (const slot of slots) {
      expect(slot.x).toBeGreaterThanOrEqual(BADGE_PAGE_MARGIN - 1e-6);
      expect(slot.y).toBeGreaterThanOrEqual(BADGE_PAGE_MARGIN - 1e-6);
      expect(slot.x + paper.width).toBeLessThanOrEqual(A4_PAGE.width - BADGE_PAGE_MARGIN + 1e-6);
      expect(slot.y + paper.height).toBeLessThanOrEqual(A4_PAGE.height - BADGE_PAGE_MARGIN + 1e-6);
    }
    const first = slots.filter((slot) => slot.page === 0);
    expect(new Set(first.map((slot) => `${slot.x.toFixed(3)}:${slot.y.toFixed(3)}`)).size).toBe(first.length);
  });

  it("takes no page for no badge", () => {
    expect(badgeSheetPages(0, badgePaper(STRIP90))).toBe(0);
    expect(badgeSheetSlots(0, badgePaper(STRIP90))).toEqual([]);
  });
});

describe("§NNN the colours", () => {
  it("read every band of the palette offered at AA, the words white or ink as reads better", () => {
    for (const choice of BIB_COLOURS.filter((option) => badgeColourReadable(option.hex))) {
      expect(contrastRatio(badgeTextOn(choice.hex), choice.hex)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
    }
    expect(badgeColourReadable(BADGE_ROLE_FALLBACK)).toBe(true);
    expect(badgeTextOn(COLOR.blueInk)).toBe(COLOR.surface);
  });

  it("refuses a colour no word reads on, and a stored one falls back to the theme's", () => {
    const grey = "#808080";
    expect(badgeColourReadable(grey)).toBe(false);
    expect(badgeRoleColour(grey)).toBe(BADGE_ROLE_FALLBACK);
    expect(badgeRoleColour(null)).toBe(BADGE_ROLE_FALLBACK);
    expect(badgeRoleColour("not a colour")).toBe(BADGE_ROLE_FALLBACK);
    expect(badgeRoleColour("#C62828")).toBe("#c62828");
    // The bib palette's green carries neither white nor ink at AA: never offered for a band, never printed.
    expect(badgeColourReadable("#1b8a3a")).toBe(false);
  });

  it("never prints a header band no word reads on, from an imported file or a column written by hand", () => {
    // White on #777777 is 4.48 : 1, ink less: under AA.
    expect(badgeColourReadable("#777777")).toBe(false);
    expect(badgeBandColour({ bandColour: "#777777" })).toBe(BADGE_BAND_FALLBACK);
    // The reader turns it into the club's blue, so the designer shows that and a save changes nothing.
    expect(readBadgeDesign({ bandColour: "#777777" }).bandColour).toBeNull();
    expect(badgeDesignSchema.parse({ ...DEFAULT_BADGE_DESIGN, bandColour: "#777777" }).bandColour).toBeNull();
    // A readable colour from outside the palette is kept as it is.
    expect(readBadgeDesign({ bandColour: "#0D47A1" }).bandColour).toBe("#0d47a1");
    expect(badgeBandColour({ bandColour: "#0d47a1" })).toBe("#0d47a1");
    expect(badgeBandColour({ bandColour: null })).toBe(BADGE_BAND_FALLBACK);
  });
});

describe("§NNN the design as stored, posted and carried", () => {
  it("reads anything as a design, never a throw — a key it does not know is ignored, a crop without its picture dropped", () => {
    expect(readBadgeDesign(null)).toEqual(DEFAULT_BADGE_DESIGN);
    expect(readBadgeDesign("nonsense")).toEqual(DEFAULT_BADGE_DESIGN);
    const read = readBadgeDesign({ size: "huge", customWidthMm: 900, later: true, headerImageCrop: { x: 0, y: 0, w: 0.5, h: 0.5 }, labelRo: "  VOLUNTAR\nBVR  " });
    expect(read.size).toBe("strip90");
    expect(read.customWidthMm).toBe(90);
    expect(read.headerImageCrop).toBeNull();
    expect(read.labelRo).toBe("VOLUNTAR BVR");
    expect("later" in read).toBe(false);
  });

  it("goes from the form to the preview's address and back as the save reads it", () => {
    const posted: Record<string, string> = {
      "badge.design.size": "custom",
      "badge.design.customWidthMm": "120",
      "badge.design.customHeightMm": "45",
      "badge.design.bandColour": "#c62828",
      "badge.design.showLogo": "on",
      "badge.design.titleRo": "Crosul",
      "badge.design.titleEn": "The cross",
      "badge.design.labelRo": "",
      "badge.design.labelEn": "",
      "badge.design.showPhone": "on",
      "badge.design.phone": "0712 345 678",
      "badge.design.phoneLabelRo": "",
      "badge.design.phoneLabelEn": "",
    };
    const values = readBadgeDesignForm((name) => posted[name] ?? null);
    const design = badgeDesignFromQuery(badgeDesignQuery(values));
    expect(design).toMatchObject({ size: "custom", customWidthMm: 120, customHeightMm: 45, bandColour: "#c62828", showLogo: true, showTitle: false, writingLine: false, showPhone: true, phone: "0712 345 678", cutMarks: false });
  });

  it("speaks the badge's language: the club's short title, else the event's; the platform's word, else the club's", () => {
    const defaults = { label: "VOLUNTAR", name: "Nume:", phoneLabel: "Coordonator" };
    const design: BadgeDesign = { ...DEFAULT_BADGE_DESIGN, titleRo: "Crosul", titleEn: "The cross", showPhone: true, phone: "0712 345 678" };
    expect(badgeWords(design, "en", "Crosul toamnei", { label: "VOLUNTEER", name: "Name:", phoneLabel: "Coordinator" })).toEqual({
      title: "The cross",
      label: "VOLUNTEER",
      name: "Name:",
      phone: "Coordinator: 0712 345 678",
    });
    expect(badgeWords(DEFAULT_BADGE_DESIGN, "ro", "Crosul toamnei", defaults)).toEqual({ title: "Crosul toamnei", label: "VOLUNTAR", name: "Nume:", phone: null });
    expect(badgeWords({ ...DEFAULT_BADGE_DESIGN, showTitle: false }, "ro", "Crosul toamnei", defaults).title).toBeNull();
  });
});

describe("§NNN the picture's stamp", () => {
  it("is stable for the same design and changes with the design, the role or the drawing", () => {
    const parts = [DEFAULT_BADGE_DESIGN, "Crosul", ["Apă", "Water", null]];
    expect(badgePictureStamp(parts)).toBe(badgePictureStamp(structuredClone(parts)));
    expect(badgePictureStamp(parts)).not.toBe(badgePictureStamp([{ ...DEFAULT_BADGE_DESIGN, size: "strip100" }, "Crosul", ["Apă", "Water", null]]));
    expect(badgePictureStamp(parts)).not.toBe(badgePictureStamp([DEFAULT_BADGE_DESIGN, "Crosul", ["Apă", "Water", "#c62828"]]));
    expect(badgePictureStamp(parts)).toMatch(/^[0-9a-f]{8}$/);
    // The drawing's version is part of what is stamped: raising it changes every address.
    expect(badgePictureStamp(parts)).toBe(fnv1a(JSON.stringify([BADGE_DRAWING_VERSION, parts])));
    expect(badgePictureStamp(parts)).not.toBe(fnv1a(JSON.stringify([BADGE_DRAWING_VERSION + 1, parts])));
    expect(badgePictureStamp(parts)).not.toBe(fnv1a(JSON.stringify(parts)));
  });
});
