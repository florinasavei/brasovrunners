import path from "node:path";
import { PgDialect } from "drizzle-orm/pg-core";
import PDFDocument from "pdfkit";
import type { ReactElement } from "react";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BIB_STAMP } from "@/modules/events/repository";
import { type BibDesign, DEFAULT_BIB_DESIGN, DEFAULT_BIB_MEMBER_DESIGN } from "@/modules/registrations/bib-design";
import { BIB_FOOTER_ADVANCES, bibFooterWidth } from "@/modules/registrations/bib-footer";
import {
  BIB_CARD,
  BIB_IMAGE_SCALE,
  BIB_LAYOUT,
  BIB_MARGIN,
  BIB_MEMBER_LABEL_LINE,
  BIB_TEXT_LINE,
  BIB_TITLE_DATE_GAP,
  type BibHeaderLayout,
  type BibHeaderText,
  bibHeaderLayout,
} from "@/modules/registrations/bib-geometry";
import { BIB_TITLE_ADVANCES, BIB_TITLE_KERNING, bibHeader, bibTitleWidth } from "@/modules/registrations/bib-header";
import { bibHeaderLines, renderBibImage } from "@/modules/registrations/bib-image";
import { renderBibSheet } from "@/modules/registrations/bibs-pdf";
import { BIB_DRAWING_VERSION, bibPictureStamp } from "@/modules/registrations/domain/bib-stamp";
import { fnv1a } from "@/shared/hash";
import { drawnRuns } from "../../helpers/pdf-drawn";

/**
 * §755, BR-REQ-038-01 — the owner, on a printed number of a race with a long name: «când bifez distanța
 * pe număr am overlap». The header's words are laid out once (`bibHeaderLayout`) and both renderers draw
 * exactly those lines: a long title fits beside the lockup and the badge in at most two lines, never
 * broken inside a word, and never covers the date. The titles are made up, and so are the names.
 */

const L = BIB_LAYOUT;

/** 54 characters of capitals with a hyphenated word and a lone dash — the shape of the race that showed the fault. */
const LONG = "CROSUL DE TOAMNĂ AL ALERGĂTORILOR – EDIȚIA A II-A 2026";
const DATE = "Sâmbătă, 21 nov 2026";
const SHORT = "Crosul de toamnă";
/** Far past what two lines can hold at the minimum size. */
const ENDLESS = Array.from({ length: 14 }, (_, i) => `ALERGAREA${i + 1} PE-DEAL`).join(" ");

const text = (overrides: Partial<BibHeaderText>): BibHeaderText => ({ title: LONG, date: DATE, logo: true, badge: true, label: false, ...overrides });

/** Every combination of the header's parts, the long title, the short and the endless. */
const CASES: BibHeaderText[] = [LONG, SHORT, ENDLESS].flatMap((title) =>
  [true, false].flatMap((logo) =>
    [true, false].flatMap((badge) =>
      [true, false].flatMap((label) => [DATE, null].map((date) => text({ title, date, logo, badge, label }))),
    ),
  ),
);

/** The title's words: what a line may be made of. */
const words = (title: string) => title.split(" ");

/** What a renderer may draw at most: the column, the band's pad, and — with a label on the band — the label's line. */
function checkLayout(input: BibHeaderText, layout: BibHeaderLayout) {
  const width = layout.right - layout.left;
  const foot = input.label ? BIB_MEMBER_LABEL_LINE : L.bandHeight - L.headerPad;
  // The column: the badge and its gap on the right, the lockup and the inset on the left.
  expect(layout.right).toBeLessThanOrEqual(BIB_CARD.width - L.inset - (input.badge ? L.badgeWidth + L.badgeGap : 0) + 1e-9);
  expect(layout.left).toBeGreaterThanOrEqual(input.logo ? L.inset + L.logoWidth + L.inset : L.inset);
  const title = layout.title;
  if (title) {
    expect(title.lines.length).toBeGreaterThanOrEqual(1);
    expect(title.lines.length).toBeLessThanOrEqual(2);
    expect(title.size).toBeLessThanOrEqual(L.titleSize);
    expect(title.size).toBeGreaterThanOrEqual(L.titleMinSize);
    for (const line of title.lines) {
      expect(bibTitleWidth(line.text) * title.size, line.text).toBeLessThanOrEqual(width + 1e-9);
      expect(line.top).toBeGreaterThanOrEqual(L.headerPad);
      // Never a line that starts with a dash or a piece of a word.
      expect(line.text).not.toMatch(/^[-–—\s]/u);
      expect(words(input.title!.trim()).some((word) => line.text.startsWith(word))).toBe(true);
    }
    // The lines follow each other at the font's own line.
    if (title.lines.length === 2) expect(title.lines[1].top - title.lines[0].top).toBeCloseTo(BIB_TEXT_LINE * title.size, 9);
    const titleBottom = title.lines[title.lines.length - 1].top + BIB_TEXT_LINE * title.size;
    expect(titleBottom).toBeLessThanOrEqual(foot + 1e-9);
    if (layout.date) expect(titleBottom).toBeLessThanOrEqual(layout.date.top + 1e-9);
    // «…» only past the minimum size.
    const drawn = title.lines.map((line) => line.text).join(" ");
    if (title.cut) {
      expect(title.size).toBe(L.titleMinSize);
      expect(title.lines.some((line) => line.text.endsWith("…"))).toBe(true);
    } else {
      expect(drawn).toBe(input.title!.trim());
      expect(drawn).not.toContain("…");
    }
  }
  if (layout.date) {
    expect(bibFooterWidth(layout.date.text) * L.dateSize).toBeLessThanOrEqual(width + 1e-9);
    expect(layout.date.top + BIB_TEXT_LINE * L.dateSize).toBeLessThanOrEqual(foot + 1e-9);
  }
  // The badge: inside the band, centred on it — or on the band above the label's tag — clear of the tag.
  const room = input.label ? L.memberTagTop : L.bandHeight;
  expect(layout.badgeTop + L.badgeHeight / 2).toBeCloseTo(room / 2, 9);
  expect(layout.badgeTop + L.badgeHeight).toBeLessThanOrEqual(L.memberTagTop);
}

describe("§755 the header's layout", () => {
  it("fits every combination of title, lockup, badge, label and date inside the column and the band", () => {
    for (const input of CASES) checkLayout(input, bibHeader(input));
  });

  it("puts the long title in two lines beside the lockup and the badge, at the full size, the date under them", () => {
    const layout = bibHeader(text({}));
    expect(layout.title!.lines.map((line) => line.text)).toHaveLength(2);
    expect(layout.title!.size).toBe(L.titleSize);
    expect(layout.title!.cut).toBe(false);
    // The date is under the title's real height, not at a fixed offset.
    expect(layout.date!.top).toBeCloseTo(layout.title!.lines[1].top + BIB_TEXT_LINE * L.titleSize + BIB_TITLE_DATE_GAP, 9);
    expect(layout.date!.top).not.toBe(L.dateTop);
  });

  it("never breaks a hyphenated word, and keeps a lone dash at the end of the line before it", () => {
    for (const input of CASES.filter((candidate) => candidate.title === LONG)) {
      const lines = bibHeader(input).title!.lines.map((line) => line.text);
      expect(lines.some((line) => line.includes("II-A"))).toBe(true);
      expect(lines.some((line) => line.endsWith("II-"))).toBe(false);
      expect(lines.some((line) => line.startsWith("–"))).toBe(false);
    }
    const endless = bibHeader(text({ title: ENDLESS })).title!.lines.map((line) => line.text);
    for (const line of endless) expect(line.replace(/…$/u, "").split(" ").every((word) => words(ENDLESS).includes(word))).toBe(true);
  });

  it("balances two lines: the longer is as short as a break between whole words can make it", () => {
    // A measure of one em per character, so the arithmetic reads plainly.
    const measure = { title: (value: string) => value.length, date: (value: string) => value.length };
    const width = BIB_CARD.width - 2 * L.inset;
    const title = `${"AAAA ".repeat(Math.ceil(width / L.titleSize / 5) + 2).trim()}`;
    const layout = bibHeaderLayout({ title, date: null, logo: false, badge: false, label: false }, measure);
    const [first, second] = layout.title!.lines.map((line) => line.text.length);
    expect(Math.abs(first - second)).toBeLessThanOrEqual(5);
  });

  it("breaks right after a lone dash the club typed when that break fits, and balances only when it does not", () => {
    // The race's own shape: the break falls after «–», where the club's name ends, not inside it.
    expect(bibHeader(text({})).title!.lines.map((line) => line.text)).toEqual(["CROSUL DE TOAMNĂ AL ALERGĂTORILOR –", "EDIȚIA A II-A 2026"]);
    // A measure of one em per character, so the arithmetic reads plainly: «A B C – D E», the dash break lopsided.
    const measure = { title: (value: string) => value.length, date: (value: string) => value.length };
    const budget = Math.floor((BIB_CARD.width - 2 * L.inset) / L.titleSize);
    const word = "AAAA";
    const count = Math.floor((budget - 2) / (word.length + 1));
    const head = Array.from({ length: count }, () => word).join(" ");
    const lay = (title: string) => bibHeaderLayout({ title, date: null, logo: false, badge: false, label: false }, measure).title!;
    const dashed = lay(`${head} – DD EE`);
    expect(dashed.size).toBe(L.titleSize);
    expect(dashed.lines.map((line) => line.text)).toEqual([`${head} –`, "DD EE"]);
    // Two dashes whose breaks both fit: the more balanced of the two (26 against 33 ems on the longer line).
    const twiceTitle = "AAAA AAAA AAAA AAAA – BBBB BBBB – CCCC CCCC CCCC";
    expect(twiceTitle.length).toBeGreaterThan(budget);
    expect(twiceTitle.indexOf(" CCCC")).toBeLessThanOrEqual(budget);
    expect(lay(twiceTitle).lines.map((line) => line.text)).toEqual(["AAAA AAAA AAAA AAAA –", "BBBB BBBB – CCCC CCCC CCCC"]);
    // A dash whose break does not fit: the balanced break, whole words on each side.
    const tooLong = lay(`${head} ${word} ${word} – DD`);
    const [first, second] = tooLong.lines.map((line) => line.text);
    expect(first.endsWith("–")).toBe(false);
    expect(Math.abs(first.length - second.length)).toBeLessThanOrEqual(word.length + 2);
  });

  it("keeps words joined by a no-break space together, and draws a narrow or figure space as a no-break space", () => {
    const glued = "CROSUL DE TOAMNĂ AL ALERGĂTORILOR EDIȚIA A II-A 2026";
    expect(bibHeader(text({ title: glued })).title!.lines.map((line) => line.text)).toEqual([
      "CROSUL DE TOAMNĂ",
      "AL ALERGĂTORILOR EDIȚIA A II-A 2026",
    ]);
    const narrow = bibHeader(text({ title: "CROS DE 10 KM" })).title!.lines.map((line) => line.text);
    expect(narrow).toEqual(["CROS DE 10 KM"]);
    expect(BIB_TITLE_ADVANCES.has(" ")).toBe(true);
  });

  it("cuts a first word wider than the column by its characters and goes on with the words after it", () => {
    const giant = "B".repeat(60);
    const short = bibHeader(text({ title: `${giant} CROS DE TOAMNĂ` }));
    expect(short.title!.cut).toBe(true);
    expect(short.title!.size).toBe(L.titleMinSize);
    const [first, second] = short.title!.lines.map((line) => line.text);
    expect(first).toMatch(/^B+…$/u);
    expect(second).toBe("CROS DE TOAMNĂ");
    // And when the words after it do not fit either, the second line keeps what fits with «…».
    const long = bibHeader(text({ title: `${giant} ${ENDLESS}` })).title!.lines.map((line) => line.text);
    expect(long).toHaveLength(2);
    expect(long[0]).toMatch(/^B+…$/u);
    expect(long[1].startsWith("ALERGAREA1 PE-DEAL")).toBe(true);
    expect(long[1].endsWith("…")).toBe(true);
    const layout = bibHeader(text({ title: `${giant} ${ENDLESS}` }));
    for (const line of layout.title!.lines) expect(bibTitleWidth(line.text) * L.titleMinSize).toBeLessThanOrEqual(layout.right - layout.left + 1e-9);
  });

  it("draws a title that fits on one line exactly where every bib printed it before", () => {
    for (const label of [false, true]) {
      const layout = bibHeader(text({ title: SHORT, label }));
      expect(layout.title!.lines).toEqual([{ text: SHORT, top: L.titleTop }]);
      expect(layout.title!.size).toBe(L.titleSize);
      expect(layout.date!.top).toBe(L.dateTop);
    }
    expect(bibHeader(text({ title: null })).date!.top).toBe(L.dateTopAlone);
  });

  it("shrinks before it cuts, and cuts only past the minimum size, with «…» at the end of the second line", () => {
    const endless = bibHeader(text({ title: ENDLESS }));
    expect(endless.title!.cut).toBe(true);
    expect(endless.title!.size).toBe(L.titleMinSize);
    expect(endless.title!.lines).toHaveLength(2);
    expect(endless.title!.lines[1].text.endsWith("…")).toBe(true);
    // A title a little too long for 13 points on the members' band, under the label, shrinks and stays whole.
    const member = bibHeader(text({ label: true }));
    expect(member.title!.cut).toBe(false);
    expect(member.title!.size).toBeLessThan(L.titleSize);
  });

  it("always has room for two lines and the date at the minimum size, even above the members' label", () => {
    expect(2 * BIB_TEXT_LINE * L.titleMinSize + BIB_TITLE_DATE_GAP + BIB_TEXT_LINE * L.dateSize).toBeLessThanOrEqual(BIB_MEMBER_LABEL_LINE - L.headerPad);
  });

  it("cuts a date wider than the column with «…» and never changes the stored title", () => {
    const long = `${DATE}, ${"și încă o zi ".repeat(12)}`;
    const layout = bibHeader(text({ date: long }));
    expect(layout.date!.text.endsWith("…")).toBe(true);
    expect(bibFooterWidth(layout.date!.text) * L.dateSize).toBeLessThanOrEqual(layout.right - layout.left);
    const input = text({});
    bibHeader(input);
    expect(input.title).toBe(LONG);
  });
});

describe("§755 the title's widths are Roboto Bold's", () => {
  const doc = new PDFDocument({ autoFirstPage: false });
  doc.registerFont("title", path.join(process.cwd(), "src", "theme", "pdf", "Roboto-Bold.ttf"));

  it("holds every width in the table to the font file, for every character the small print's table has", () => {
    doc.font("title").fontSize(2048);
    const wrong: string[] = [];
    for (const [character, units] of BIB_TITLE_ADVANCES) {
      if (Math.abs(doc.widthOfString(character) - units) > 0.001) wrong.push(`${character} ${units}`);
    }
    expect(wrong).toEqual([]);
    expect([...BIB_FOOTER_ADVANCES.keys()].filter((character) => !BIB_TITLE_ADVANCES.has(character))).toEqual([]);
  });

  it("holds the kerning table to the font file, pair by pair", () => {
    doc.font("title").fontSize(2048);
    const characters = [...BIB_TITLE_ADVANCES.keys()];
    const wrong: string[] = [];
    for (const first of characters) {
      for (const second of characters) {
        const kern = Math.round(doc.widthOfString(`${first}${second}`, { features: [] }) - BIB_TITLE_ADVANCES.get(first)! - BIB_TITLE_ADVANCES.get(second)!);
        if ((BIB_TITLE_KERNING.get(`${first}${second}`) ?? 0) !== Math.max(kern, 0)) wrong.push(`${first}${second} ${kern}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("never measures a title narrower than pdfkit sets it, and counts an unknown character wider than any", () => {
    doc.font("title").fontSize(L.titleSize);
    for (const title of [LONG, SHORT, ENDLESS, "TEST (V) – WAY’S “FT” RT", "Ştafeta Ţării – ŞŢ șț"]) {
      expect(doc.widthOfString(title), title).toBeLessThanOrEqual(bibTitleWidth(title) * L.titleSize + 1e-9);
      expect(doc.widthOfString(title, { features: [] }), title).toBeLessThanOrEqual(bibTitleWidth(title) * L.titleSize + 1e-9);
    }
    doc.font("title").fontSize(2048);
    let widest = 0;
    for (let code = 0x20; code <= 0xffff; code++) {
      if (code >= 0xd800 && code <= 0xdfff) continue;
      widest = Math.max(widest, doc.widthOfString(String.fromCharCode(code)));
    }
    expect(bibTitleWidth("\u{1F3C3}") * 2048).toBeGreaterThanOrEqual(widest + 2 * Math.max(...BIB_TITLE_KERNING.values()));
  });

  it("has no non-breaking hyphen to draw, which is why the words are wrapped at spaces only", () => {
    const font = (doc.font("title") as unknown as { _font: { font: { hasGlyphForCodePoint: (code: number) => boolean } } })._font.font;
    expect(font.hasGlyphForCodePoint(0x2011)).toBe(false);
    expect(font.hasGlyphForCodePoint(0x2d)).toBe(true);
  });
});

const design = (overrides: Partial<BibDesign>): BibDesign => ({ ...DEFAULT_BIB_DESIGN, ...overrides });
const withMembers = (overrides: Partial<BibDesign["member"]> = {}): BibDesign =>
  design({ showDistance: true, member: { ...DEFAULT_BIB_MEMBER_DESIGN, enabled: true, ...overrides } });

afterEach(() => vi.restoreAllMocks());

/** What the sheet draws for one number: every run, with its size. */
const sheetRuns = (bibDesign: BibDesign, member: boolean, title = LONG) =>
  drawnRuns(() =>
    renderBibSheet({
      rows: [{ bibNumber: 7, registeredName: "Alergător Unu", member }],
      eventTitle: title,
      eventDate: DATE,
      generatedAt: new Date("2026-10-13T12:00:00Z"),
      design: bibDesign,
      distanceBadge: "9K",
      memberLabelDefault: "Membru de test",
    }),
  );

describe("§755 the sheet draws the layout's lines", () => {
  const measure = new PDFDocument({ autoFirstPage: false });
  measure.registerFont("bold", path.join(process.cwd(), "src", "theme", "pdf", "Roboto-Bold.ttf"));
  measure.registerFont("body", path.join(process.cwd(), "src", "theme", "pdf", "Roboto-Regular.ttf"));
  const widthOf = (font: string, size: number, value: string) => measure.font(font).fontSize(size).widthOfString(value);

  for (const [name, bibDesign, member, label] of [
    ["the race's band", design({ showDistance: true }), false, false],
    ["the members' band, its label under the badge", withMembers(), true, true],
    ["a member's whole card", withMembers({ style: "card" }), true, false],
  ] as const) {
    it(`${name}: every line at the layout's point, right of the lockup, short of the badge, the date clear of the title`, async () => {
      const runs = await sheetRuns(bibDesign, member);
      const layout = bibHeader({ title: LONG, date: DATE, logo: true, badge: true, label });
      const columnRight = BIB_MARGIN + layout.right;
      const titleRuns = layout.title!.lines.map((line) => runs.find((run) => run.text === line.text)!);
      expect(titleRuns.every(Boolean)).toBe(true);
      layout.title!.lines.forEach((line, index) => {
        const run = titleRuns[index];
        expect(run.y).toBeCloseTo(BIB_MARGIN + line.top, 9);
        expect(run.size).toBe(layout.title!.size);
        // No width handed to pdfkit: it cannot wrap the line again.
        expect(run.width).toBeUndefined();
        expect(run.x! + widthOf("bold", run.size!, run.text)).toBeCloseTo(columnRight, 6);
        expect(run.x!).toBeGreaterThanOrEqual(BIB_MARGIN + L.inset + L.logoWidth + L.inset);
        expect(run.x! + widthOf("bold", run.size!, run.text)).toBeLessThanOrEqual(BIB_MARGIN + BIB_CARD.width - L.inset - L.badgeWidth - L.badgeGap + 1e-6);
      });
      // The whole title is drawn, in no other run: nothing pdfkit wrapped by itself.
      expect(runs.filter((run) => run.text.includes("II-")).map((run) => run.text)).toEqual(layout.title!.lines.filter((line) => line.text.includes("II-")).map((line) => line.text));
      const date = runs.find((run) => run.text === DATE)!;
      expect(date.y).toBeCloseTo(BIB_MARGIN + layout.date!.top, 9);
      expect(date.width).toBeUndefined();
      const lastTitle = titleRuns[titleRuns.length - 1];
      expect(lastTitle.y! + BIB_TEXT_LINE * lastTitle.size!).toBeLessThanOrEqual(date.y! + 1e-9);
      expect(date.x! + widthOf("body", L.dateSize, DATE)).toBeCloseTo(columnRight, 6);
      if (label) {
        const tag = runs.find((run) => run.text === "Membru de test")!;
        expect(date.y! + BIB_TEXT_LINE * L.dateSize).toBeLessThanOrEqual(tag.y! + 1e-9);
      }
      // The badge's words, centred in the badge the layout placed.
      const badge = runs.find((run) => run.text === "9K")!;
      expect(badge.y! + (BIB_TEXT_LINE * L.badgeSize) / 2).toBeCloseTo(BIB_MARGIN + layout.badgeTop + L.badgeHeight / 2, 6);
    });
  }

  it("draws no header words over the club's header picture", async () => {
    const picture = await sharp({ create: { width: 900, height: 100, channels: 3, background: "#808080" } }).png().toBuffer();
    const runs = await drawnRuns(() =>
      renderBibSheet({
        rows: [{ bibNumber: 7, registeredName: "Alergător Unu" }],
        eventTitle: LONG,
        eventDate: DATE,
        generatedAt: new Date("2026-10-13T12:00:00Z"),
        design: design({ showDistance: true, headerImageSrc: "/media/header.webp" }),
        distanceBadge: "9K",
        pictures: { header: picture },
      }),
    );
    expect(runs.some((run) => run.text === "9K")).toBe(false);
    expect(runs.some((run) => run.text.startsWith("CROSUL DE TOAMNĂ") && run.y! < BIB_MARGIN + L.bandHeight)).toBe(false);
  });
});

describe("§755 the picture draws the layout's lines", () => {
  const px = (points: number) => points * BIB_IMAGE_SCALE;

  it("puts each line in its own one-line box at the layout's points", () => {
    const layout = bibHeader(text({}));
    const elements = bibHeaderLines(layout, "white") as Array<ReactElement<{ style: Record<string, unknown>; children: string }>>;
    expect(elements.map((element) => element.props.children)).toEqual([...layout.title!.lines.map((line) => line.text), layout.date!.text]);
    layout.title!.lines.forEach((line, index) => {
      const style = elements[index].props.style;
      expect(style.top).toBeCloseTo(px(line.top), 9);
      expect(style.right).toBeCloseTo(px(BIB_CARD.width - layout.right), 9);
      expect(style.fontSize).toBeCloseTo(px(layout.title!.size), 9);
      expect(style.whiteSpace).toBe("nowrap");
    });
    expect(elements[2].props.style.top).toBeCloseTo(px(layout.date!.top), 9);
  });

  /**
   * The pixels: in the column between the lockup and the badge, the band's rows with white ink in them
   * come in exactly three runs — two lines of title and the date — each separated by rows of the band
   * alone, so no line touches another; and nothing white lies between the column and the badge.
   */
  it("draws the long title in two lines and the date under them, none touching another, none in the badge's gap", async () => {
    const title = "CROSUL DE TOAMNA AL ALERGATORILOR – EDITIA A II-A 2026";
    const date = "Sambata 21 nov 2026";
    const response = await renderBibImage({ bibNumber: 7, registeredName: "Alergator Unu", eventTitle: title, eventDate: date, bandColour: null, design: design({ showDistance: true }), distanceBadge: "9K" });
    const { data, info } = await sharp(Buffer.from(await response.arrayBuffer())).raw().toBuffer({ resolveWithObject: true });
    const layout = bibHeader({ title, date, logo: true, badge: true, label: false });
    expect(layout.title!.lines).toHaveLength(2);
    const white = (x: number, y: number) => data[(y * info.width + x) * info.channels] > 150;
    const columnLeft = Math.ceil(px(BIB_MARGIN + layout.left));
    const columnRight = Math.floor(px(BIB_MARGIN + layout.right));
    const bandTop = Math.ceil(px(BIB_MARGIN)) + 1;
    const bandFoot = Math.floor(px(BIB_MARGIN + L.bandHeight)) - 1;
    const inkRows: boolean[] = [];
    for (let y = bandTop; y <= bandFoot; y++) {
      let ink = false;
      for (let x = columnLeft; x <= columnRight && !ink; x++) ink = white(x, y);
      inkRows.push(ink);
    }
    const runs = inkRows.reduce((count, ink, index) => count + (ink && !inkRows[index - 1] ? 1 : 0), 0);
    expect(runs).toBe(3);
    // The gap between the column and the badge holds nothing but the band.
    const gapLeft = Math.ceil(px(BIB_MARGIN + layout.right)) + 1;
    const gapRight = Math.floor(px(BIB_MARGIN + BIB_CARD.width - L.inset - L.badgeWidth)) - 1;
    for (let y = bandTop; y <= bandFoot; y++) for (let x = gapLeft; x <= gapRight; x++) expect(white(x, y)).toBe(false);
  });

  /**
   * The members' band and a member's card, from the same layout: the ink in the column comes in one run
   * per line of title and one for the date, separated by the band alone. On the band the scan stops a
   * pixel above the label's line — the label reaches into the column's width — so the last run ending
   * there is the date clear of the label; and the badge stands at its centred top above the label's tag.
   */
  const PICTURE_TITLE = "CROSUL DE TOAMNA AL ALERGATORILOR DIN TARA BARSEI – EDITIA A II-A 2026";
  const PICTURE_DATE = "Sambata 21 nov 2026";
  for (const [name, bibDesign, label] of [
    ["the members' band, its label under the badge", withMembers(), true],
    ["a member's whole card", withMembers({ style: "card" }), false],
  ] as const) {
    it(`${name}: the title's lines and the date in their own runs of ink, the badge at the layout's top`, async () => {
      const response = await renderBibImage({
        bibNumber: 7,
        registeredName: "Alergator Unu",
        eventTitle: PICTURE_TITLE,
        eventDate: PICTURE_DATE,
        bandColour: null,
        design: bibDesign,
        distanceBadge: "9K",
        member: true,
        memberLabelDefault: "Membru de test",
      });
      const { data, info } = await sharp(Buffer.from(await response.arrayBuffer())).raw().toBuffer({ resolveWithObject: true });
      const layout = bibHeader({ title: PICTURE_TITLE, date: PICTURE_DATE, logo: true, badge: true, label });
      expect(layout.title!.lines).toHaveLength(2);
      const colour = (x: number, y: number) => Array.from(data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3));
      const apart = (a: number[], b: number[]) => a.reduce((sum, value, index) => sum + Math.abs(value - b[index]), 0) > 150;
      const columnLeft = Math.ceil(px(BIB_MARGIN + layout.left));
      const columnRight = Math.floor(px(BIB_MARGIN + layout.right));
      const bandTop = Math.ceil(px(BIB_MARGIN)) + 1;
      // The band's own colour, in the column above every line (`headerPad` keeps the top clear).
      const ground = colour(columnLeft, bandTop);
      const scanFoot = label ? Math.ceil(px(BIB_MARGIN + BIB_MEMBER_LABEL_LINE)) - 1 : Math.floor(px(BIB_MARGIN + L.bandHeight)) - 1;
      const inkRows: boolean[] = [];
      for (let y = bandTop; y <= scanFoot; y++) {
        let ink = false;
        for (let x = columnLeft; x <= columnRight && !ink; x++) ink = apart(colour(x, y), ground);
        inkRows.push(ink);
      }
      const runs = inkRows.reduce((count, ink, index) => count + (ink && !inkRows[index - 1] ? 1 : 0), 0);
      expect(runs).toBe(layout.title!.lines.length + 1);
      // The last run — the date — ends before the scan's last row: clear of the label's line on the band.
      expect(inkRows[inkRows.length - 1]).toBe(false);
      // The badge: its colour a point under its top, in its middle, where the race's band top would show the band.
      const badgeMiddle = Math.round(px(BIB_MARGIN + BIB_CARD.width - L.inset - L.badgeWidth / 2));
      const badgeRow = Math.round(px(BIB_MARGIN + layout.badgeTop + 1));
      const badgeFoot = Math.round(px(BIB_MARGIN + layout.badgeTop + L.badgeHeight - 1));
      const beside = colour(Math.round(px(BIB_MARGIN + layout.right)) + 2, badgeRow);
      expect(apart(colour(badgeMiddle, badgeRow), beside)).toBe(true);
      expect(apart(colour(badgeMiddle, badgeFoot), beside)).toBe(true);
      if (label) {
        expect(layout.badgeTop).toBeCloseTo((L.memberTagTop - L.badgeHeight) / 2, 9);
        // Under the badge's foot and above the tag: the band again, the two never touching.
        expect(apart(colour(badgeMiddle, Math.round(px(BIB_MARGIN + layout.badgeTop + L.badgeHeight)) + 2), beside)).toBe(false);
      }
    });
  }
});

describe("§755 the pictures' addresses change with the drawing", () => {
  it("stamps every bibs page picture with the drawing's version", () => {
    const parts = [DEFAULT_BIB_DESIGN, "#112233", LONG, DATE];
    expect(BIB_DRAWING_VERSION).toBe(2);
    expect(bibPictureStamp(parts)).toBe(fnv1a(JSON.stringify([BIB_DRAWING_VERSION, parts])));
    // The same design under the drawing before this one: another address.
    expect(bibPictureStamp(parts)).not.toBe(fnv1a(JSON.stringify([BIB_DRAWING_VERSION - 1, parts])));
    expect(bibPictureStamp(parts)).not.toBe(fnv1a(JSON.stringify(parts)));
  });

  it("starts the desk's stamp with the drawing's version too", () => {
    const query = new PgDialect().sqlToQuery(BIB_STAMP);
    expect(query.sql).toMatch(/^md5\(concat_ws\('\|', \$1::text, /u);
    expect(query.params[0]).toBe(String(BIB_DRAWING_VERSION));
  });
});
