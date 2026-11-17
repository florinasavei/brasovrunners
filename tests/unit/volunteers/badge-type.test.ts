import PDFDocument from "pdfkit";
import { isValidElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { bibFooterWidth } from "@/modules/registrations/bib-footer";
import { bibTitleWidth } from "@/modules/registrations/bib-header";
import { type BadgeDesign, type BadgeFaceRole, badgeLayoutWords, badgeRoleText, badgeWords, DEFAULT_BADGE_DESIGN } from "@/modules/volunteers/badges/badge-design";
import {
  BADGE_CATEGORY_SEPARATOR,
  BADGE_CUSTOM_BOUNDS,
  BADGE_LAYOUT,
  type BadgeLayout,
  type BadgeLayoutWords,
  type BadgeSizeChoice,
  type BadgeTextLine,
  badgeFitWhole,
  badgeImageSize,
  badgeLayout,
  badgeLineHeight,
  badgeSizeRefusal,
} from "@/modules/volunteers/badges/badge-geometry";
import { badgeImageLayout, badgeMarkup } from "@/modules/volunteers/badges/badge-image";
import { type BadgeRole, badgePrintEntries, badgeRoleCategory, badgeRoleFace } from "@/modules/volunteers/badges/badges";
import { renderBadgeSheet } from "@/modules/volunteers/badges/badges-pdf";

/**
 * §962 — the volunteer's type on a role's badge (BR-REQ-050-02; the owner, 2026-11-17: «Practic voluntarii sunt de 2 tipuri: start-finish
 * și pe traseu», then «și pe ecuson vreau»): the name of the role's category, in the badge's language and in the small line's capitals,
 * after «VOLUNTAR» on the small line above the role's name («VOLUNTAR · PE TRASEU») when that line holds both at its least size, else on a
 * small line of its own under the role's name — never cut, never over another line, inside the role's band at every size the designer
 * accepts and every size a stored design may draw; the sheet and the picture from the same words and the same layout. What does not
 * change — a role under none, a badge «fără rol», the one badge — is held to the drawing of before in `badge-type-unchanged.test.ts`.
 */

const MEASURE = { bold: bibTitleWidth, regular: bibFooterWidth };
const RO = { label: "VOLUNTAR", name: "Nume:", phoneLabel: "Coordonator" };
const EN = { label: "VOLUNTEER", name: "Name:", phoneLabel: "Coordinator" };
const wordsOf = (design: BadgeDesign, locale: "ro" | "en") => badgeWords(design, locale, "Brașov Trail Race", locale === "ro" ? RO : EN);
const AT = new Date("2026-11-17T08:00:00.000Z");
const PER_ROLE: BadgeDesign = { ...DEFAULT_BADGE_DESIGN, mode: "perRole" };
const custom = (width: number, height: number): BadgeSizeChoice => ({ size: "custom", customWidthMm: width, customHeightMm: height });

/** A role of the print's list as `listBadgeRoles` reads it, under a category or none. */
const role = (id: string, names: [string, string], category: [string, string] | null, colour: string | null = null): BadgeRole => ({
  id,
  nameRo: names[0],
  nameEn: names[1],
  needed: 1,
  assigned: 0,
  colour,
  position: 0,
  createdAt: AT,
  categoryId: category ? `cat-${category[1]}` : null,
  categoryRo: category?.[0] ?? null,
  categoryEn: category?.[1] ?? null,
  categoryPhone: null,
});
const PHOTO_ON_ROUTE = role("00000000-0000-4000-8000-00000000000a", ["Foto/Video", "Photo/Video"], ["Pe Traseu", "On the route"], "#c62828");
const GUIDE_AT_START = role("00000000-0000-4000-8000-00000000000b", ["Direcționare", "Guidance"], ["Activități start/finish", "Start/finish activities"]);
const GUIDE_ON_ROUTE = role("00000000-0000-4000-8000-00000000000c", ["Direcționare", "Guidance"], ["Pe Traseu", "On the route"]);

/**
 * The longest category the event's editor keeps: 80 characters (`event_volunteer_categories_name_length`). A Romanian one, the widest capital
 * eighty times, and «ß» eighty times, which the badge's capitals turn into 160 letters.
 */
const LONGEST = {
  romanian: "Activități de start și sosire, punctele de hidratare și de control de pe traseul",
  wide: "W".repeat(80),
  doubled: "ß".repeat(80),
} as const;

/** One badge's layout from a role, through the words the two renderers take (`badgeLayoutWords`). */
const layoutOf = (design: BadgeDesign, locale: "ro" | "en", face: BadgeFaceRole | null, size: Partial<BadgeSizeChoice> = {}) =>
  badgeLayout({ ...design, ...size, showPhone: design.showPhone, headerPicture: false }, badgeLayoutWords(design, wordsOf(design, locale), locale, face), MEASURE);

/** The lines a role's band holds, top to bottom. */
const bandLines = (layout: BadgeLayout): BadgeTextLine[] => [layout.label, layout.roleLine, layout.categoryLine].filter((line): line is BadgeTextLine => Boolean(line));
const bandWidthOf = (layout: BadgeLayout) => layout.content.width - 2 * layout.pad;

afterEach(() => vi.restoreAllMocks());

describe("§962 the category on a role's badge, in the badge's language", () => {
  it("prints «VOLUNTAR · PE TRASEU» on the small line above the role's name in Romanian, «VOLUNTEER · ON THE ROUTE» in English", () => {
    const ro = layoutOf(PER_ROLE, "ro", badgeRoleFace(PHOTO_ON_ROUTE, "ro"));
    expect(ro.label!.text).toBe("VOLUNTAR · PE TRASEU");
    expect(ro.roleLine.text).toBe("FOTO/VIDEO");
    expect(ro.categoryLine).toBeUndefined();
    const en = layoutOf(PER_ROLE, "en", badgeRoleFace(PHOTO_ON_ROUTE, "en"));
    expect(en.label!.text).toBe("VOLUNTEER · ON THE ROUTE");
    expect(en.roleLine.text).toBe("PHOTO/VIDEO");
    // In the language's own capitals, ș and ț kept; the platform adds no word of its own, only the separator.
    expect(layoutOf(PER_ROLE, "ro", badgeRoleFace(GUIDE_AT_START, "ro")).label!.text).toBe("VOLUNTAR · ACTIVITĂȚI START/FINISH");
    expect(BADGE_CATEGORY_SEPARATOR).toBe(" · ");
    // The club's own word for «VOLUNTAR» comes first, as it does alone.
    const staff = { ...PER_ROLE, labelRo: "Staff", labelEn: "Staff" };
    expect(layoutOf(staff, "ro", badgeRoleFace(PHOTO_ON_ROUTE, "ro")).label!.text).toBe("STAFF · PE TRASEU");
  });

  it("keeps the small line's size on the default strip, and the role's name its own", () => {
    const plain = layoutOf(PER_ROLE, "ro", { name: "Foto/Video", colour: null, category: null });
    for (const face of [badgeRoleFace(PHOTO_ON_ROUTE, "ro"), badgeRoleFace(GUIDE_AT_START, "ro")]) {
      const typed = layoutOf(PER_ROLE, "ro", face);
      expect(typed.label!.size, face.category ?? "").toBe(plain.label!.size);
      expect(typed.label!.cut).toBe(false);
      expect(typed.roleLine.size).toBe(plain.roleLine.size);
      // The rows are the badge's of before: the category takes no height.
      expect([typed.header, typed.role, typed.free, typed.writing, typed.phone]).toEqual([plain.header, plain.role, plain.free, plain.writing, plain.phone]);
    }
  });

  it("puts a category too long for the small line on a small line of its own under the role's name, whole, «VOLUNTAR» alone above", () => {
    const face = { name: "Foto/Video", colour: null, category: LONGEST.romanian };
    const layout = layoutOf(PER_ROLE, "ro", face);
    // Measured: «VOLUNTAR · » and the 80 characters are wider than the band at the small line's least size.
    const labelMin = Math.min(BADGE_LAYOUT.roleMinSize, layout.role.height * BADGE_LAYOUT.labelShare);
    expect(MEASURE.bold(`VOLUNTAR${BADGE_CATEGORY_SEPARATOR}${badgeRoleText(LONGEST.romanian, "ro")}`) * labelMin).toBeGreaterThan(bandWidthOf(layout));
    expect(layout.label!.text).toBe("VOLUNTAR");
    expect(layout.categoryLine).toBeDefined();
    expect(layout.categoryLine!.text).toBe(badgeRoleText(LONGEST.romanian, "ro"));
    expect(layout.categoryLine!.cut).toBe(false);
    // A small line: never larger than «VOLUNTAR» above it, under the role's name.
    expect(layout.categoryLine!.size).toBeLessThanOrEqual(layout.label!.size);
    expect(layout.categoryLine!.top).toBeCloseTo(layout.roleLine.top + badgeLineHeight(layout.roleLine.size), 9);
  });

  it("names the category of each pile — the same role under two categories is two badges, never the first one's twice", async () => {
    const counts = { roles: new Map([GUIDE_AT_START, GUIDE_ON_ROUTE, PHOTO_ON_ROUTE].map((one) => [one.id, { count: 2, spares: 0 }] as const)), none: 1 };
    const entries = badgePrintEntries([GUIDE_AT_START, GUIDE_ON_ROUTE, PHOTO_ON_ROUTE], counts, "ro");
    expect(entries.map((entry) => entry.role?.category ?? null)).toEqual(["Activități start/finish", "Pe Traseu", "Pe Traseu", null]);
    expect(entries.map((entry) => entry.role?.name ?? null)).toEqual(["Direcționare", "Direcționare", "Foto/Video", null]);
    // The sheet lays out each pile with its own words: «Direcționare» twice, under its two categories, and «VOLUNTAR» alone «fără rol».
    const runs = (await sheetRuns(() => renderBadgeSheet({ design: PER_ROLE, locale: "ro", words: wordsOf(PER_ROLE, "ro"), entries, eventTitle: "Brașov Trail Race", generatedAt: AT }))).map(([text]) => text);
    expect(runs.filter((text) => text === "VOLUNTAR · ACTIVITĂȚI START/FINISH")).toHaveLength(2);
    expect(runs.filter((text) => text === "VOLUNTAR · PE TRASEU")).toHaveLength(4);
    expect(runs.filter((text) => text === "DIRECȚIONARE")).toHaveLength(4);
    expect(runs.filter((text) => text === "VOLUNTAR")).toHaveLength(1);
  });

  it("reads the category in the badge's language, and none for a role under none — «Alte activități» is no type", () => {
    expect(badgeRoleCategory(GUIDE_AT_START, "ro")).toBe("Activități start/finish");
    expect(badgeRoleCategory(GUIDE_AT_START, "en")).toBe("Start/finish activities");
    expect(badgeRoleCategory(role("00000000-0000-4000-8000-00000000000d", ["Masă", "Desk"], null), "ro")).toBeNull();
    expect(badgeRoleCategory({ categoryRo: "", categoryEn: "" }, "en")).toBeNull();
    expect(badgeRoleFace(PHOTO_ON_ROUTE, "en")).toEqual({ name: "Photo/Video", colour: "#c62828", phone: null, category: "On the route" });
  });
});

/** Every text the sheet draws for its badges, with the size it is set at, in order. */
async function sheetRuns(render: () => Promise<Buffer>): Promise<Array<[string, number]>> {
  const runs: Array<[string, number]> = [];
  const text = PDFDocument.prototype.text;
  vi.spyOn(PDFDocument.prototype, "text").mockImplementation(function (this: PDFKit.PDFDocument, ...args: unknown[]) {
    if (typeof args[0] === "string") runs.push([args[0], (this as unknown as { _fontSize: number })._fontSize]);
    return (text as (...a: unknown[]) => PDFKit.PDFDocument).apply(this, args);
  });
  await render();
  vi.restoreAllMocks();
  return runs;
}

/** Every line the picture draws, by its test id, with its words and its size in points (the picture's pixels over its scale). */
function pictureRuns(node: ReactNode, scale: number, found: Array<[string, string, number]> = []): Array<[string, string, number]> {
  if (Array.isArray(node)) {
    for (const child of node) pictureRuns(child, scale, found);
    return found;
  }
  if (!isValidElement(node)) return found;
  const props = node.props as { children?: ReactNode; style?: { fontSize?: number }; "data-testid"?: string };
  if (typeof props.children === "string" && props.style?.fontSize !== undefined) found.push([props["data-testid"] ?? "", props.children, props.style.fontSize / scale]);
  else pictureRuns(props.children, scale, found);
  return found;
}

/** The lines a layout prints, in the order both renderers draw them, with their sizes. */
const layoutRuns = (layout: BadgeLayout): Array<[string, number]> =>
  [layout.title, layout.label, layout.roleLine, layout.categoryLine, layout.freeLine, layout.name, layout.marker?.label, layout.phoneLine]
    .filter((line): line is BadgeTextLine => Boolean(line))
    .map((line) => [line.text, line.size]);

describe("§962 the sheet and the picture draw the same badge", () => {
  const cases: Array<[string, BadgeDesign, "ro" | "en", BadgeFaceRole]> = [
    ["the category beside «VOLUNTAR», in Romanian", PER_ROLE, "ro", badgeRoleFace(PHOTO_ON_ROUTE, "ro")],
    ["the category beside «VOLUNTEER», in English, every row ticked", { ...PER_ROLE, showPhone: true, phone: "0712 345 678", showFreeText: true, freeTextRo: "Bea apă", freeTextEn: "Drink water", showMarker: true, markerLabelRo: "Tură", markerLabelEn: "Shift" }, "en", badgeRoleFace(GUIDE_AT_START, "en")],
    ["the longest category under the role's name, on the smallest badge", { ...PER_ROLE, size: "custom", customWidthMm: 60, customHeightMm: 30 }, "ro", { name: "Direcționare", colour: null, category: LONGEST.romanian }],
    ["the longest category under the role's name, in English, on the larger strip", { ...PER_ROLE, size: "strip100" }, "en", { name: "Guidance", colour: "#6a1b9a", category: LONGEST.wide }],
  ];

  it.each(cases)("%s: the same words at the same sizes, from the one layout", async (_name, design, locale, face) => {
    const words = wordsOf(design, locale);
    const layout = badgeImageLayout({ design, locale, words, role: face });
    const expected = layoutRuns(layout);
    // The category is printed, whole, once.
    const category = badgeRoleText(face.category!, locale);
    expect(expected.filter(([text]) => text.endsWith(category))).toHaveLength(1);
    const sheet = await sheetRuns(() => renderBadgeSheet({ design, locale, words, entries: [{ role: face, count: 1 }], eventTitle: "Brașov Trail Race", generatedAt: AT }));
    expect(sheet).toEqual(expected);
    const picture = pictureRuns(badgeMarkup({ design, locale, words, role: face }, "logo"), badgeImageSize(design).scale);
    expect(picture.map(([, text, size]) => [text, size])).toEqual(expected.map(([text, size]) => [text, expect.closeTo(size, 9)]));
    expect(picture.some(([id]) => id === (layout.categoryLine ? "badge-category" : "badge-label"))).toBe(true);
  }, 60_000);
});

describe("§962 the longest category at every size", () => {
  /** Every width the custom size's bounds allow at a few steps, the two presets' among them; every height the bounds allow. */
  const widths = [BADGE_CUSTOM_BOUNDS.width.min, 61, 75, 90, 100, 133, 160, BADGE_CUSTOM_BOUNDS.width.max];
  const heights = Array.from({ length: BADGE_CUSTOM_BOUNDS.height.max - BADGE_CUSTOM_BOUNDS.height.min + 1 }, (_, index) => BADGE_CUSTOM_BOUNDS.height.min + index);
  const ticks = [
    { freeText: false, phone: false },
    { freeText: true, phone: false },
    { freeText: false, phone: true },
    { freeText: true, phone: true },
  ];

  /** The words of a badge with every ticked row and a role, with or without a category. */
  const wordsFor = (tick: { freeText: boolean; phone: boolean }, category: string | null): BadgeLayoutWords => ({
    title: "Brașov Trail Race",
    label: "VOLUNTAR",
    role: "PUNCT DE HIDRATARE",
    ...(category === null ? {} : { category }),
    name: "Nume:",
    phone: tick.phone ? "Coordonator: 0712 345 678" : null,
    free: tick.freeText ? "Hidratează-te la fiecare punct" : null,
    markerLabel: null,
  });
  const at = (size: BadgeSizeChoice, tick: { freeText: boolean; phone: boolean }, category: string | null) =>
    badgeLayout({ ...size, headerPicture: false, showLogo: true, writingLine: true, showMarker: false, showPhone: tick.phone }, wordsFor(tick, category), MEASURE);

  /** Whole, inside the band, nothing over anything: what every badge with a category must be. */
  function holds(size: BadgeSizeChoice, tick: { freeText: boolean; phone: boolean }, name: string, text: string) {
    const where = `${name} at ${size.customWidthMm} × ${size.customHeightMm} ${JSON.stringify(tick)}`;
    const category = badgeRoleText(text, "ro");
    const typed = at(size, tick, category);
    const plain = at(size, tick, null);
    // The category is printed whole: on the small line or on its own.
    const printed = typed.categoryLine ? typed.categoryLine.text : typed.label!.text;
    expect(printed, where).toBe(typed.categoryLine ? category : `VOLUNTAR${BADGE_CATEGORY_SEPARATOR}${category}`);
    for (const line of bandLines(typed)) {
      if (line !== typed.roleLine) expect(line.cut, where).toBe(false);
      // Inside the band's width, and inside its height.
      expect(MEASURE.bold(line.text) * line.size, where).toBeLessThanOrEqual(bandWidthOf(typed) + 1e-9);
      expect(line.size, where).toBeGreaterThan(0);
    }
    const lines = bandLines(typed);
    expect(lines[0].top, where).toBeGreaterThanOrEqual(typed.role.top - 1e-9);
    for (let index = 1; index < lines.length; index++) expect(lines[index].top, where).toBeGreaterThanOrEqual(lines[index - 1].top + badgeLineHeight(lines[index - 1].size) - 1e-9);
    const last = lines[lines.length - 1];
    expect(last.top + badgeLineHeight(last.size), where).toBeLessThanOrEqual(typed.role.top + typed.role.height + 1e-9);
    // The role's name: never under its least size, and cut only where it was cut without the category.
    expect(typed.roleLine.size, where).toBeGreaterThanOrEqual(BADGE_LAYOUT.roleMinSize - 1e-9);
    expect(typed.roleLine.cut, where).toBe(plain.roleLine.cut);
    expect(typed.roleLine.text, where).toBe(plain.roleLine.text);
    // The rows are the same as without the category, so the save's fit check — which reads the rows alone — answers the same.
    expect([typed.header, typed.role, typed.free, typed.writing, typed.phone], where).toEqual([plain.header, plain.role, plain.free, plain.writing, plain.phone]);
  }

  it("is 80 characters, as the event's editor keeps it, and longer still once the badge's capitals double a letter", () => {
    for (const text of Object.values(LONGEST)) expect(text.length).toBe(80);
    expect(badgeRoleText(LONGEST.doubled, "ro")).toBe("SS".repeat(80));
  });

  it("fits whole, inside the band, at the smallest size the designer accepts — with no row ticked and with both", () => {
    // 60 × 30 mm is the smallest size accepted; with the free-text line and the telephone, 60 × 34 mm is (`badgeSizeRefusal`).
    expect(badgeSizeRefusal(custom(60, 30), { freeText: false, phone: false })).toBeNull();
    expect(badgeSizeRefusal(custom(60, 33), { freeText: true, phone: true })).not.toBeNull();
    expect(badgeSizeRefusal(custom(60, 34), { freeText: true, phone: true })).toBeNull();
    for (const [name, text] of Object.entries(LONGEST)) {
      holds(custom(60, 30), ticks[0], name, text);
      holds(custom(60, 34), ticks[3], name, text);
    }
    // There, the 80 characters never fit beside «VOLUNTAR»: they take the line under the role's name.
    expect(at(custom(60, 30), ticks[0], badgeRoleText(LONGEST.romanian, "ro")).categoryLine).toBeDefined();
  });

  it("fits whole, inside the band, at every size and tick the designer accepts, and at every one a stored design may still draw", () => {
    let accepted = 0;
    for (const width of widths) {
      for (const height of heights) {
        for (const tick of ticks) {
          if (badgeSizeRefusal(custom(width, height), tick) === null) accepted += 1;
          for (const [name, text] of Object.entries(LONGEST)) holds(custom(width, height), tick, name, text);
        }
      }
    }
    expect(accepted).toBeGreaterThan(1000);
  });

  it("keeps a race's own short categories beside «VOLUNTAR» at every size and tick the designer accepts", () => {
    for (const width of widths) {
      for (const height of heights) {
        for (const tick of ticks) {
          if (badgeSizeRefusal(custom(width, height), tick) !== null) continue;
          for (const name of ["Activități start/finish", "Pe Traseu"]) {
            const layout = at(custom(width, height), tick, badgeRoleText(name, "ro"));
            expect(layout.categoryLine, `${name} at ${width} × ${height} ${JSON.stringify(tick)}`).toBeUndefined();
            expect(layout.label!.text).toBe(`VOLUNTAR${BADGE_CATEGORY_SEPARATOR}${badgeRoleText(name, "ro")}`);
            expect(layout.label!.cut).toBe(false);
          }
        }
      }
    }
  });

  it("asks the save's fit check for nothing new: the same sizes are refused, with or without categories", () => {
    // The fit check reads the size and the ticked rows; the category's line takes no row (the test above), so the answer cannot move.
    expect(badgeSizeRefusal(custom(60, 30), { freeText: true, phone: true })).toEqual({ what: ["freeText", "phone"], minHeightMm: 34 });
    expect(badgeSizeRefusal({ size: "strip90", customWidthMm: 0, customHeightMm: 0 }, { freeText: true, phone: true })).toBeNull();
  });
});

describe("§962 what does not print a category", () => {
  it("is a role under no category: the words carry none, the small line is «VOLUNTAR» alone, no line is added", () => {
    const words = badgeLayoutWords(PER_ROLE, wordsOf(PER_ROLE, "ro"), "ro", { name: "Masă", colour: null, phone: null, category: null });
    expect("category" in words).toBe(false);
    const layout = layoutOf(PER_ROLE, "ro", { name: "Masă", colour: null, category: null });
    expect(layout.label!.text).toBe("VOLUNTAR");
    expect("categoryLine" in layout).toBe(false);
  });

  it("is a badge «fără rol», whatever it is handed, and the one badge for everyone, whose pile has no role", () => {
    const none = badgeLayout({ ...PER_ROLE, headerPicture: false }, { ...badgeLayoutWords(PER_ROLE, wordsOf(PER_ROLE, "ro"), "ro", null), category: "TRASEU" }, MEASURE);
    expect(none.label).toBeNull();
    expect(none.roleLine.text).toBe("VOLUNTAR");
    expect("categoryLine" in none).toBe(false);
    expect("category" in badgeLayoutWords(PER_ROLE, wordsOf(PER_ROLE, "ro"), "ro", null)).toBe(false);
    const single = badgePrintEntries([PHOTO_ON_ROUTE], { roles: new Map(), none: 0, single: { count: 3, spares: 1 } }, "ro");
    expect(single).toEqual([{ role: null, count: 4 }]);
  });
});

describe("§962 a line printed whole (`badgeFitWhole`)", () => {
  it("keeps its largest size when it fits, steps down by half a point before that, and below the steps fills the width exactly — never cut", () => {
    expect(badgeFitWhole("PE TRASEU", MEASURE.bold, 500, 7)).toEqual({ text: "PE TRASEU", size: 7, cut: false });
    const ems = MEASURE.bold("PE TRASEU");
    expect(badgeFitWhole("PE TRASEU", MEASURE.bold, ems * 6.2, 7)).toEqual({ text: "PE TRASEU", size: 6, cut: false });
    const tiny = badgeFitWhole("PE TRASEU", MEASURE.bold, ems * 0.3, 7);
    expect(tiny.cut).toBe(false);
    expect(tiny.text).toBe("PE TRASEU");
    expect(tiny.size).toBeCloseTo(0.3, 9);
    expect(ems * tiny.size).toBeLessThanOrEqual(ems * 0.3 + 1e-9);
  });
});
