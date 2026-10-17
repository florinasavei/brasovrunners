import { createHash } from "node:crypto";
import PDFDocument from "pdfkit";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/modules/media/storage", () => ({ getStorage: () => ({ get: vi.fn() }), isStorageConfigured: () => true }));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
}));

import {
  BIB_PROFILE_FIGURES_PLACES,
  type BibDesign,
  DEFAULT_BIB_DESIGN,
  DEFAULT_BIB_MEMBER_DESIGN,
  bibDesignSchema,
  readBibDesign,
} from "@/modules/registrations/bib-design";
import {
  BIB_CARD,
  BIB_IMAGE_SCALE,
  BIB_LAYOUT,
  BIB_MARGIN,
  BIB_MEMBER_LABEL_LINE,
  BIB_TEXT_LINE,
  BIB_TITLE_DATE_GAP,
  bibExtrasHeight,
  bibProfileChartWidth,
  bibProfileRowHeight,
} from "@/modules/registrations/bib-geometry";
import { bibHeader } from "@/modules/registrations/bib-header";
import { bibExtrasBlock, bibHeaderLines, renderBibImage } from "@/modules/registrations/bib-image";
import { type BibProfileDrawing, bibProfileDrawing } from "@/modules/registrations/bib-profile";
import { bibFiguresBeside, bibHeaderCarriesWords, bibHeaderFiguresLine, bibProfileFiguresLine, bibProfileRow } from "@/modules/registrations/bib-profile-row";
import { parseGpxElevation } from "@/modules/routes/elevation/parse";
import { BIB_DRAWING_VERSION, bibPictureStamp } from "@/modules/registrations/domain/bib-stamp";
import { renderBibSheet } from "@/modules/registrations/bibs-pdf";
import { drawnRuns } from "../../helpers/pdf-drawn";

/**
 * §804 (amended), BR-REQ-038-01 — the owner, 2026-10-17, on the 21 November race's number: «Pe BIB vreau să
 * controlez unde apare asta, pentru că arată ciudat așa». The distance and the gain of the profile stand where
 * the club chooses (`profileFiguresPlace`): at the strip's right (what every number printed so far has),
 * under the strip in one centred line, or in the header under the date. Decided once by `bibProfileRow`
 * and drawn by both renderers at the same points. The track is made up, and so are the names.
 */

const design = (overrides: Partial<BibDesign>): BibDesign => ({ ...DEFAULT_BIB_DESIGN, ...overrides });

function track(): string {
  const body = Array.from({ length: 41 }, (_, i) => {
    const ele = i <= 20 ? 600 + 10 * i : 800 - 5 * (i - 20);
    return `<trkpt lat="45.6000" lon="${(25.5 + i * 0.001).toFixed(5)}"><ele>${ele.toFixed(1)}</ele></trkpt>`;
  }).join("");
  return `<?xml version="1.0"?><gpx version="1.1" creator="test"><trk><trkseg>${body}</trkseg></trk></gpx>`;
}

const DISTANCE = "Distanță: 9,0 km";
const GAIN = "Diferență de nivel: +400 m";
const LINE = `${DISTANCE} · ${GAIN}`;

const DRAWING: BibProfileDrawing = {
  ...bibProfileDrawing(parseGpxElevation(track())!, {}, "ro", (key, values) =>
    ({ start: "Start", finish: "Sosire", kmUnit: "km", altitudeUnit: "m", distance: `Distanță: ${values?.km} km`, gain: `Diferență de nivel: +${values?.m} m` })[key],
  ),
  distance: DISTANCE,
  gain: GAIN,
};

const SHEET = { eventTitle: "Crosul de toamnă", eventDate: "21 noiembrie 2026", generatedAt: new Date("2026-10-10T12:00:00Z") };
const ROWS = [{ bibNumber: 7, registeredName: "Alergător Unu" }];
const PHONE = "0700 000 001";

afterEach(() => vi.restoreAllMocks());

const withPlace = (place: (typeof BIB_PROFILE_FIGURES_PLACES)[number], overrides: Partial<BibDesign> = {}) =>
  design({ showProfile: true, showProfileFigures: true, profileFiguresPlace: place, ...overrides });

describe("§804 «Unde stau cifrele»: the design's field", () => {
  it("has three places, and the strip's right is what a design that does not say has", () => {
    expect(BIB_PROFILE_FIGURES_PLACES).toEqual(["right", "below", "header"]);
    expect(DEFAULT_BIB_DESIGN.profileFiguresPlace).toBe("right");
    // A design stored before the choice existed: every other key, none of this one.
    const stored: Record<string, unknown> = { ...DEFAULT_BIB_DESIGN };
    delete stored.profileFiguresPlace;
    expect(readBibDesign(stored).profileFiguresPlace).toBe("right");
    expect(readBibDesign({}).profileFiguresPlace).toBe("right");
  });

  it("keeps a known place and reads anything else as the strip's right", () => {
    for (const place of BIB_PROFILE_FIGURES_PLACES) expect(readBibDesign({ profileFiguresPlace: place }).profileFiguresPlace).toBe(place);
    for (const bad of ["left", "", null, 3, "HEADER"]) expect(readBibDesign({ profileFiguresPlace: bad }).profileFiguresPlace, String(bad)).toBe("right");
    expect(bibDesignSchema.parse({ ...DEFAULT_BIB_DESIGN, profileFiguresPlace: "below" }).profileFiguresPlace).toBe("below");
  });
});

describe("§804 the profile's row decides the place once", () => {
  const extras = { profile: DRAWING, profileFigures: { distance: DISTANCE, gain: GAIN } };
  const full = BIB_CARD.width - 2 * BIB_LAYOUT.inset;

  it("keeps the figures at the strip's right, the strip narrowed for them — the same row as before the choice", () => {
    const row = bibProfileRow(withPlace("right"), extras, false)!;
    expect(row).toMatchObject({ kind: "gpx", chartWidth: BIB_LAYOUT.profileChartWidth, figures: { distance: DISTANCE, gain: GAIN, place: "right" } });
    expect(bibHeaderFiguresLine(row)).toBeNull();
    expect(bibProfileRowHeight(false)).toBe(BIB_LAYOUT.profileHeight);
  });

  it("puts them under the profile in one line, the strip across the whole width", () => {
    const row = bibProfileRow(withPlace("below"), extras, false)!;
    expect(row).toMatchObject({ kind: "gpx", chartWidth: full, figures: { place: "below" } });
    expect(bibProfileFiguresLine(row.figures!)).toBe(LINE);
    expect(bibHeaderFiguresLine(row)).toBeNull();
  });

  it("puts them in the header, the row itself holding none and the strip across the whole width", () => {
    const row = bibProfileRow(withPlace("header"), extras, false)!;
    expect(row).toMatchObject({ kind: "gpx", chartWidth: full, figures: { place: "header" } });
    expect(bibHeaderFiguresLine(row)).toBe(LINE);
  });

  it("does the same for the club's picture, and says only what is known", () => {
    const picture = { profile: null, profileFigures: { distance: DISTANCE, gain: null } };
    expect(bibProfileRow(withPlace("right", { profileSource: "picture" }), picture, true)).toMatchObject({ kind: "picture", chartWidth: BIB_LAYOUT.profileChartWidth });
    const below = bibProfileRow(withPlace("below", { profileSource: "picture" }), picture, true)!;
    expect(below).toMatchObject({ kind: "picture", chartWidth: full, figures: { place: "below" } });
    expect(bibProfileFiguresLine(below.figures!)).toBe(DISTANCE);
    expect(bibHeaderFiguresLine(bibProfileRow(withPlace("header", { profileSource: "picture" }), picture, true))).toBe(DISTANCE);
  });

  it("has no figures with the tick off or nothing to say, wherever they would stand", () => {
    for (const place of BIB_PROFILE_FIGURES_PLACES) {
      expect(bibProfileRow(withPlace(place, { showProfileFigures: false }), extras, false)).toMatchObject({ chartWidth: full, figures: null });
      const nothing = bibProfileRow(withPlace(place, { profileSource: "picture" }), { profile: null, profileFigures: null }, true);
      expect(nothing).toMatchObject({ chartWidth: full, figures: null });
    }
    // Two empty words stand nowhere but the strip's right, which has always made room for them.
    const empty = { profile: { ...DRAWING, distance: "", gain: "" }, profileFigures: null };
    expect(bibProfileRow(withPlace("below"), empty, false)).toMatchObject({ chartWidth: full, figures: null });
    expect(bibProfileRow(withPlace("header"), empty, false)).toMatchObject({ chartWidth: full, figures: null });
    expect(bibProfileRow(withPlace("right"), empty, false)).toMatchObject({ chartWidth: BIB_LAYOUT.profileChartWidth, figures: { place: "right" } });
  });

  it("says whether they stand at the right — what the shape recommended for the club's picture follows", () => {
    expect(bibFiguresBeside(withPlace("right"))).toBe(true);
    expect(bibFiguresBeside(withPlace("below"))).toBe(false);
    expect(bibFiguresBeside(withPlace("header"))).toBe(false);
    expect(bibFiguresBeside(withPlace("right", { showProfileFigures: false }))).toBe(false);
  });

  it("falls back to under the profile where the header has no words to ride with: the club's picture, the members' too", () => {
    const row = (overrides: Partial<BibDesign>) => bibProfileRow(withPlace("header", overrides), extras, false)!.figures!.place;
    expect(row({})).toBe("header");
    expect(row({ headerImageSrc: "/api/media/x/web.webp" })).toBe("below");
    const member = (overrides: Partial<BibDesign["member"]>) => ({ member: { ...DEFAULT_BIB_MEMBER_DESIGN, enabled: true, ...overrides } });
    expect(row(member({ headerImageSrc: "/api/media/m/web.webp" }))).toBe("below");
    // A members' picture while their bib is off is not drawn; their whole card carries the words itself.
    expect(row({ member: { ...DEFAULT_BIB_MEMBER_DESIGN, enabled: false, headerImageSrc: "/api/media/m/web.webp" } })).toBe("header");
    expect(row(member({ style: "card", headerImageSrc: "/api/media/m/web.webp" }))).toBe("header");
    expect(bibHeaderCarriesWords({})).toBe(true);
    expect(bibHeaderCarriesWords({ headerImageSrc: "/a" })).toBe(false);
  });

  it("takes one line more of height only under the profile", () => {
    expect(bibProfileRowHeight(true)).toBe(BIB_LAYOUT.profileHeight + BIB_LAYOUT.profileFiguresRoom);
    expect(bibExtrasHeight(true, false)).toBe(BIB_LAYOUT.profileHeight);
    expect(bibExtrasHeight(true, false, true)).toBe(BIB_LAYOUT.profileHeight + BIB_LAYOUT.profileFiguresRoom);
    expect(bibExtrasHeight(true, true, true)).toBe(BIB_LAYOUT.profileHeight + BIB_LAYOUT.profileFiguresRoom + BIB_LAYOUT.emergencyHeight);
    // No profile drawn: the figures' room is not asked for.
    expect(bibExtrasHeight(false, true, true)).toBe(BIB_LAYOUT.emergencyHeight);
    expect(bibProfileChartWidth(false)).toBe(full);
  });
});

describe("§804 the header's figures line", () => {
  const input = { title: "Crosul de toamnă", date: "21 noiembrie 2026", logo: true, badge: true, label: false };
  const L = BIB_LAYOUT;

  it("changes nothing without it: the layout is the one every number had", () => {
    const without = bibHeader(input);
    expect(without.figures).toBeNull();
    expect(without.date!.top).toBeCloseTo(L.dateTop, 1);
    expect(bibHeader({ ...input, figures: null })).toEqual(without);
    expect(bibHeader({ ...input, figures: "   " })).toEqual(without);
  });

  it("sets it under the date in the date's own size, the band not growing: the title and the date make room", () => {
    const layout = bibHeader({ ...input, figures: LINE });
    expect(layout.figures!.text).toBe(LINE);
    expect(layout.figures!.top).toBeCloseTo(layout.date!.top + BIB_TEXT_LINE * L.dateSize + L.headerFiguresGap, 9);
    const title = layout.title!;
    expect(title.lines[0].top).toBeGreaterThanOrEqual(L.headerPad);
    expect(title.lines[0].top + BIB_TEXT_LINE * title.size + BIB_TITLE_DATE_GAP).toBeCloseTo(layout.date!.top, 9);
    // Inside the band, short of its foot pad.
    expect(layout.figures!.top + BIB_TEXT_LINE * L.dateSize).toBeLessThanOrEqual(L.bandHeight - L.headerPad + 1e-9);
    // The column is the date's: nothing wider than it.
    expect(layout.right).toBe(bibHeader(input).right);
  });

  it("takes the date's line when the date is off", () => {
    const withDate = bibHeader({ ...input, figures: LINE });
    const dateOff = bibHeader({ ...input, date: null, figures: LINE });
    expect(dateOff.date).toBeNull();
    // The title stands where it stood with the date alone under it, the figures at the date's place.
    const dateAlone = bibHeader({ ...input, figures: null });
    expect(dateOff.figures!.top).toBeCloseTo(dateAlone.date!.top, 9);
    expect(dateOff.title!.lines[0].top).toBeCloseTo(dateAlone.title!.lines[0].top, 9);
    expect(withDate.figures!.top).toBeGreaterThan(dateOff.figures!.top);
    // Alone under no title: the date's own place.
    expect(bibHeader({ title: null, date: null, logo: true, badge: true, label: false, figures: LINE }).figures!.top).toBe(L.dateTopAlone);
    expect(bibHeader({ title: null, date: "21 noiembrie 2026", logo: true, badge: true, label: false }).date!.top).toBe(L.dateTopAlone);
  });

  it("stands beside the date when neither title nor logo is there, both lines about the one line's place", () => {
    const both = bibHeader({ title: null, date: "21 noiembrie 2026", logo: false, badge: false, label: false, figures: LINE });
    expect(both.date!.top).toBeLessThan(L.dateTopAlone);
    expect(both.figures!.top).toBeGreaterThan(L.dateTopAlone);
    expect(both.figures!.top - both.date!.top).toBeCloseTo(BIB_TEXT_LINE * L.dateSize + L.headerFiguresGap, 9);
  });

  it("is cut with «…» when the column is too narrow, never wider than the date may be", () => {
    const narrow = bibHeader({ ...input, figures: `${LINE} · ${"x".repeat(200)}` });
    expect(narrow.figures!.text.endsWith("…")).toBe(true);
  });

  it("stays above the members' label's line, the title shrinking for it", () => {
    const long = "CROSUL DE TOAMNĂ AL ALERGĂTORILOR – EDIȚIA A II-A 2026";
    const asked = bibHeader({ title: long, date: "Sâmbătă, 21 nov 2026", logo: true, badge: true, label: true, figures: LINE });
    expect(asked.figures).not.toBeNull();
    expect(asked.figures!.top + BIB_TEXT_LINE * L.dateSize).toBeLessThanOrEqual(BIB_MEMBER_LABEL_LINE + 1e-9);
    expect(asked.title!.size).toBeLessThan(bibHeader({ title: long, date: "Sâmbătă, 21 nov 2026", logo: true, badge: true, label: true }).title!.size + 1e-9);
  });

  it("gives way where no size of the title leaves it room, the title keeping the place it has without", () => {
    const endless = Array.from({ length: 14 }, (_, i) => `ALERGAREA${i + 1} PE-DEAL`).join(" ");
    const crowded = { title: endless, date: "Sâmbătă, 21 nov 2026", logo: true, badge: true, label: true };
    const asked = bibHeader({ ...crowded, figures: LINE });
    expect(asked.figures).toBeNull();
    expect(asked).toEqual(bibHeader(crowded));
  });
});

/** The upper bib's block under the name starts here: the card's foot less the small print and the rows. */
const blockTop = (extras: number) => BIB_MARGIN + BIB_CARD.height - BIB_LAYOUT.footerHeight - extras;

describe("§804 the sheet draws the figures where the row says", () => {
  const sheet = (overrides: Partial<BibDesign>, more: Record<string, unknown> = {}) =>
    drawnRuns(() => renderBibSheet({ rows: ROWS, ...SHEET, profile: DRAWING, emergencyLabel: "Urgențe", ...more, design: withPlace("right", { showEmergency: true, emergencyPhone: PHONE, ...overrides }) }));
  const widthOf = (font: string, size: number, value: string) => {
    const doc = new PDFDocument({ autoFirstPage: false });
    doc.registerFont("body", `${process.cwd()}/src/theme/pdf/Roboto-Regular.ttf`);
    doc.registerFont("bold", `${process.cwd()}/src/theme/pdf/Roboto-Bold.ttf`);
    return doc.font(font).fontSize(size).widthOfString(value);
  };

  it("right: two lines at the strip's right, as before", async () => {
    const runs = await sheet({});
    const top = blockTop(bibExtrasHeight(true, true));
    const left = BIB_MARGIN + BIB_LAYOUT.inset + BIB_LAYOUT.profileChartWidth + BIB_LAYOUT.profileTextGap;
    expect(runs.find((run) => run.text === DISTANCE)).toMatchObject({ x: left, size: BIB_LAYOUT.profileTextSize });
    expect(runs.find((run) => run.text === DISTANCE)!.y).toBeCloseTo(top + BIB_LAYOUT.profileDistanceTop, 5);
    expect(runs.find((run) => run.text === GAIN)!.y).toBeCloseTo(top + BIB_LAYOUT.profileGainTop, 5);
    expect(runs.some((run) => run.text === LINE)).toBe(false);
  });

  it("below: one centred line under the strip, which takes the whole width; the row a line taller, the phone where it was", async () => {
    const right = await sheet({});
    const runs = await sheet({ profileFiguresPlace: "below" });
    const line = runs.find((run) => run.text === LINE)!;
    expect(line).toBeDefined();
    expect(line.size).toBe(BIB_LAYOUT.profileTextSize);
    // One line, centred on the card; the two separate lines are gone.
    expect(line.x! + widthOf("body", BIB_LAYOUT.profileTextSize, LINE) / 2).toBeCloseTo(BIB_MARGIN + BIB_CARD.width / 2, 5);
    const top = blockTop(bibExtrasHeight(true, true, true));
    expect(line.y).toBeCloseTo(top + BIB_LAYOUT.profileFiguresTop, 5);
    expect(runs.some((run) => run.text === DISTANCE || run.text === GAIN)).toBe(false);
    // The strip's «Sosire» is at the whole width's right end now.
    const finish = runs.find((run) => run.text === "Sosire")!;
    expect(finish.x! + widthOf("body", BIB_LAYOUT.profileLabelSize, "Sosire")).toBeCloseTo(BIB_MARGIN + BIB_LAYOUT.inset + bibProfileChartWidth(false), 1);
    // The row grew by one line upward: «Start» (the row's own text) is that much higher, the phone's line unmoved ("after the figures' line").
    const startRight = right.find((run) => run.text === "Start")!;
    expect(startRight.y! - runs.find((run) => run.text === "Start")!.y!).toBeCloseTo(BIB_LAYOUT.profileFiguresRoom, 5);
    const phone = `Urgențe: ${PHONE}`;
    expect(runs.find((run) => run.text === phone)!.y).toBeCloseTo(right.find((run) => run.text === phone)!.y!, 5);
    expect(line.y! + BIB_TEXT_LINE * BIB_LAYOUT.profileTextSize).toBeLessThanOrEqual(runs.find((run) => run.text === phone)!.y! + 1e-9);
  });

  it("header: the line under the date in the date's size, right-aligned on the column; the row is as tall as ever", async () => {
    const right = await sheet({});
    const runs = await sheet({ profileFiguresPlace: "header" });
    const layout = bibHeader({ title: SHEET.eventTitle, date: SHEET.eventDate, logo: true, badge: false, label: false, figures: LINE });
    const line = runs.find((run) => run.text === LINE)!;
    expect(line.size).toBe(BIB_LAYOUT.dateSize);
    expect(line.y).toBeCloseTo(BIB_MARGIN + layout.figures!.top, 5);
    expect(line.x! + widthOf("body", BIB_LAYOUT.dateSize, LINE)).toBeCloseTo(BIB_MARGIN + layout.right, 5);
    const date = runs.find((run) => run.text === SHEET.eventDate)!;
    expect(date.y).toBeCloseTo(BIB_MARGIN + layout.date!.top, 5);
    expect(line.y!).toBeGreaterThan(date.y! + BIB_TEXT_LINE * BIB_LAYOUT.dateSize - 1e-9);
    expect(line.y! + BIB_TEXT_LINE * BIB_LAYOUT.dateSize).toBeLessThanOrEqual(BIB_MARGIN + BIB_LAYOUT.bandHeight);
    // Not in the row, nor beside it; the row keeps its height, so the strip's own text stands where it stood but for the chart's width.
    expect(runs.some((run) => run.text === DISTANCE || run.text === GAIN)).toBe(false);
    expect(runs.find((run) => run.text === "Start")!.y).toBeCloseTo(right.find((run) => run.text === "Start")!.y!, 5);
  });

  it("header with the date off: the figures take the date's line", async () => {
    const runs = await sheet({ profileFiguresPlace: "header", showDate: false });
    const layout = bibHeader({ title: SHEET.eventTitle, date: null, logo: true, badge: false, label: false, figures: LINE });
    expect(runs.some((run) => run.text === SHEET.eventDate)).toBe(false);
    expect(runs.find((run) => run.text === LINE)!.y).toBeCloseTo(BIB_MARGIN + layout.figures!.top, 5);
  });

  it("header over the club's header picture: no words there, so the figures stand under the profile", async () => {
    const runs = await sheet({ profileFiguresPlace: "header", headerImageSrc: "/api/media/h/web.webp" });
    const line = runs.find((run) => run.text === LINE)!;
    expect(line.size).toBe(BIB_LAYOUT.profileTextSize);
    expect(line.y).toBeCloseTo(blockTop(bibExtrasHeight(true, true, true)) + BIB_LAYOUT.profileFiguresTop, 5);
  });

  it("turns the row with its figures line when the profile is turned", async () => {
    const calls: Array<{ angle: number; origin: [number, number] }> = [];
    const original = PDFDocument.prototype.rotate;
    vi.spyOn(PDFDocument.prototype, "rotate").mockImplementation(function (this: PDFKit.PDFDocument, ...args: unknown[]) {
      calls.push({ angle: args[0] as number, origin: (args[1] as { origin: [number, number] }).origin });
      return (original as (...a: unknown[]) => PDFKit.PDFDocument).apply(this, args);
    });
    await sheet({ profileFiguresPlace: "below", profileOrientation: "turned", emergencyUpsideDown: false });
    vi.restoreAllMocks();
    expect(calls).toHaveLength(1);
    // About the centre of the taller row, line included.
    expect(calls[0].origin[1]).toBeCloseTo(blockTop(bibExtrasHeight(true, true, true)) + bibProfileRowHeight(true) / 2, 5);
  });
});

describe("§804 the picture draws the figures where the row says", () => {
  const markup = (value: unknown) => JSON.stringify(value, (key, found) => (key === "_owner" || key === "_store" ? undefined : found));
  const block = (place: (typeof BIB_PROFILE_FIGURES_PLACES)[number]) => {
    const d = withPlace(place);
    const row = bibProfileRow(d, { profile: DRAWING, profileFigures: null }, false);
    return bibExtrasBlock({ row, picture: null, emergency: { text: `Urgențe: ${PHONE}`, size: 9 }, turn: { block: false, profile: false, phone: false }, ink: "#000001" }) as ReactElement<{
      children: Array<ReactElement<{ style: Record<string, unknown> }>>;
    }>;
  };
  const px = (points: number) => points * BIB_IMAGE_SCALE;

  it("right: two boxes at the strip's right", () => {
    const text = markup(block("right"));
    expect(text).toContain(DISTANCE);
    expect(text).toContain(GAIN);
    expect(text).not.toContain("bib-profile-figures");
    expect(text).not.toContain(LINE);
    expect((block("right").props.children[0].props.style as { height: number }).height).toBeCloseTo(px(BIB_LAYOUT.profileHeight), 9);
  });

  it("below: one centred box under the strip, in a row a line taller", () => {
    const element = block("below");
    const row = element.props.children[0];
    expect((row.props.style as { height: number }).height).toBeCloseTo(px(bibProfileRowHeight(true)), 9);
    const text = markup(element);
    expect(text.split(LINE)).toHaveLength(2);
    expect(text).toContain('"data-testid":"bib-profile-figures"');
    expect(text).toContain('"justifyContent":"center"');
    expect(text).toContain(`"top":${px(BIB_LAYOUT.profileFiguresTop)}`);
    expect(text).not.toContain(`"children":"${DISTANCE}"`);
  });

  it("header: the row holds none, and the header's lines carry one under the date", () => {
    const text = markup(block("header"));
    expect(text).not.toContain(DISTANCE);
    expect(text).not.toContain("bib-profile-figures");
    expect((block("header").props.children[0].props.style as { height: number }).height).toBeCloseTo(px(BIB_LAYOUT.profileHeight), 9);
    const layout = bibHeader({ title: SHEET.eventTitle, date: SHEET.eventDate, logo: true, badge: false, label: false, figures: LINE });
    const lines = bibHeaderLines(layout, "white") as Array<ReactElement<{ style: Record<string, unknown>; children: string; "data-testid": string }>>;
    const figures = lines.find((line) => line.props["data-testid"] === "bib-header-figures")!;
    expect(figures.props.children).toBe(LINE);
    expect(figures.props.style.top).toBeCloseTo(px(layout.figures!.top), 9);
    expect(figures.props.style.fontSize).toBeCloseTo(px(BIB_LAYOUT.dateSize), 9);
    const date = lines.find((line) => line.props["data-testid"] === "bib-header-date")!;
    expect(figures.props.style.color).toBe(date.props.style.color);
    // Absent without the line.
    expect(bibHeaderLines(bibHeader({ title: SHEET.eventTitle, date: SHEET.eventDate, logo: true, badge: false, label: false }), "white")).toHaveLength(2);
  });

  it("draws a different picture for each place, and never fails", async () => {
    const draw = (place: (typeof BIB_PROFILE_FIGURES_PLACES)[number]) =>
      renderBibImage({ bibNumber: 7, registeredName: "Alergător Unu", ...SHEET, design: withPlace(place), profile: DRAWING }).then(async (response) => Buffer.from(await response.arrayBuffer()));
    const [right, below, header] = await Promise.all(BIB_PROFILE_FIGURES_PLACES.map(draw));
    expect(right.equals(below)).toBe(false);
    expect(right.equals(header)).toBe(false);
    expect(below.equals(header)).toBe(false);
  });
});

describe("§804 the drawing version, and the numbers printed so far", () => {
  it("keeps the drawing's version: every number already printed is drawn as it was, and the stamp reads the whole design", () => {
    // The default place draws what the drawing always drew (below, byte for byte), so nothing is raised.
    expect(BIB_DRAWING_VERSION).toBe(4);
    const stamp = (place: (typeof BIB_PROFILE_FIGURES_PLACES)[number]) => bibPictureStamp([withPlace(place)]);
    expect(new Set(BIB_PROFILE_FIGURES_PLACES.map(stamp)).size).toBe(3);
  });

  /** What the trail example's two renderers are asked to draw, as one hash: the sheet's runs, rotations and images, the picture's extras block and header lines. */
  async function fingerprint(): Promise<string> {
    const rotations: number[] = [];
    const rotate = PDFDocument.prototype.rotate;
    vi.spyOn(PDFDocument.prototype, "rotate").mockImplementation(function (this: PDFKit.PDFDocument, ...args: unknown[]) {
      rotations.push(args[0] as number);
      return (rotate as (...a: unknown[]) => PDFKit.PDFDocument).apply(this, args);
    });
    const trail = design({ showProfile: true, showEmergency: true, emergencyPhone: PHONE, showDistance: true, numberStubs: true, numberScale: "large" });
    const runs = await drawnRuns(() => renderBibSheet({ rows: ROWS, ...SHEET, profile: DRAWING, emergencyLabel: "Urgențe", distanceBadge: "9K", design: trail }));
    const noDate = await drawnRuns(() => renderBibSheet({ rows: ROWS, ...SHEET, profile: DRAWING, design: design({ showProfile: true, showDate: false }) }));
    vi.restoreAllMocks();
    const row = bibProfileRow(trail, { profile: DRAWING, profileFigures: null }, false);
    const extras = bibExtrasBlock({ row, picture: null, emergency: { text: `Urgențe: ${PHONE}`, size: 9 }, turn: { block: false, profile: false, phone: false }, ink: "#000001" });
    const header = bibHeaderLines(bibHeader({ title: SHEET.eventTitle, date: SHEET.eventDate, logo: true, badge: true, label: false }), "white");
    const replacer = (key: string, value: unknown) => (key === "_owner" || key === "_store" ? undefined : value);
    return createHash("sha256").update(JSON.stringify({ runs, noDate, rotations, extras, header }, replacer)).digest("hex");
  }

  it("draws a design that does not say where the figures stand exactly as it was drawn before the choice existed", async () => {
    // Captured from the release before the choice (BR-V3.53) with the same call: a change here is a change in every printed number.
    expect(await fingerprint()).toBe(GOLDEN_RIGHT);
  });
});

const GOLDEN_RIGHT = "9c92ff5a184e4dd96706768cf138dfc6031e5ea7b388a2db3c8780308c02b6b7";
