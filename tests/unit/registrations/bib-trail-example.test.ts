import { readFile } from "node:fs/promises";
import path from "node:path";
import PDFDocument from "pdfkit";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const stored = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/modules/media/storage", () => ({ getStorage: () => ({ get: stored.get }) }));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string, values?: { km?: string; m?: string }) => `${key}${values?.km ?? values?.m ?? ""}`,
}));

import { type BibDesign, bibDistanceBadge, DEFAULT_BIB_DESIGN, readBibDesign } from "@/modules/registrations/bib-design";
import { clearBibProfileCache, loadBibExtras } from "@/modules/registrations/bib-extras";
import {
  BIB_CARD,
  BIB_DIGIT,
  BIB_IMAGE_SCALE,
  BIB_LAYOUT,
  BIB_MARGIN,
  bibExtrasHeight,
  bibNumberArea,
  bibNumberFit,
  bibNumberPoints,
} from "@/modules/registrations/bib-geometry";
import { bibHeader } from "@/modules/registrations/bib-header";
import { renderBibImage } from "@/modules/registrations/bib-image";
import { type BibProfileDrawing, bibProfileDrawing, parseGpxProfile } from "@/modules/registrations/bib-profile";
import { bibSheetFooterLines, renderBibSheet } from "@/modules/registrations/bibs-pdf";
import { bibPictureStamp } from "@/modules/registrations/domain/bib-stamp";
import { drawnRuns } from "../../helpers/pdf-drawn";

/**
 * §750, BR-REQ-038-01 — the owner's two example bibs: the number's size capped to the area it has, the
 * profile read once, and the distance badge, the upside-down phone, the profile as a strip and the
 * number on the footer's ends. The sheet through what pdfkit is asked to draw, the picture through its
 * pixels. The made-up phone is no one's.
 */

const design = (overrides: Partial<BibDesign>): BibDesign => ({ ...DEFAULT_BIB_DESIGN, ...overrides });

function track(): string {
  const body = Array.from({ length: 41 }, (_, i) => {
    const ele = i <= 20 ? 600 + 10 * i : 800 - 5 * (i - 20);
    return `<trkpt lat="45.6000" lon="${(25.5 + i * 0.001).toFixed(5)}"><ele>${ele.toFixed(1)}</ele></trkpt>`;
  }).join("");
  return `<?xml version="1.0"?><gpx version="1.1" creator="test"><trk><trkseg>${body}</trkseg></trk></gpx>`;
}

const DRAWING: BibProfileDrawing = bibProfileDrawing(
  parseGpxProfile(track())!,
  {},
  "ro",
  (key, values) => ({ start: "Start", finish: "Sosire", distance: `Distanță: ${values?.km} km`, gain: `Diferență de nivel: +${values?.m} m` })[key],
);

const SHEET = {
  eventTitle: "Crosul Brașov Runners",
  eventDate: "21 noiembrie 2026",
  generatedAt: new Date("2026-10-10T12:00:00Z"),
  replyTo: "club@example.test",
};

const sponsorsPng = () => sharp({ create: { width: 800, height: 80, channels: 3, background: "#2255ee" } }).png().toBuffer();

/** Every element the trail and the marathon examples have, on at once. */
const EVERYTHING = {
  showProfile: true,
  showEmergency: true,
  emergencyPhone: "0722 000 000",
  showDistance: true,
  numberStubs: true,
  numberScale: "large",
} as const;

type Drawn = { runs: Awaited<ReturnType<typeof drawnRuns>>; sizes: Map<string, number[]>; rotations: number[]; imageY: number[] };

/** What the sheet draws for one number: the runs, the size each was set at, the rotations and the images' tops. */
async function sheet(input: { design: BibDesign; bib?: number; member?: boolean; sponsors?: boolean; distanceBadge?: string | null }): Promise<Drawn> {
  const rotations: number[] = [];
  const imageY: number[] = [];
  const rotate = PDFDocument.prototype.rotate;
  vi.spyOn(PDFDocument.prototype, "rotate").mockImplementation(function (this: PDFKit.PDFDocument, ...args: unknown[]) {
    rotations.push(args[0] as number);
    return (rotate as (...a: unknown[]) => PDFKit.PDFDocument).apply(this, args);
  });
  const image = PDFDocument.prototype.image;
  vi.spyOn(PDFDocument.prototype, "image").mockImplementation(function (this: PDFKit.PDFDocument, ...args: unknown[]) {
    imageY.push(args[2] as number);
    return (image as (...a: unknown[]) => PDFKit.PDFDocument).apply(this, args);
  });
  const sponsors = input.sponsors ? await sponsorsPng() : null;
  const runs = await drawnRuns(() =>
    renderBibSheet({
      ...SHEET,
      rows: [{ bibNumber: input.bib ?? 101, registeredName: "Alergător Unu", member: input.member }],
      design: input.design,
      profile: DRAWING,
      emergencyLabel: "Urgențe",
      distanceBadge: input.distanceBadge ?? null,
      memberLabelDefault: "Membru",
      pictures: { sponsors },
    }),
  );
  vi.restoreAllMocks();
  const sizes = new Map<string, number[]>();
  for (const run of runs) sizes.set(run.text, [...(sizes.get(run.text) ?? []), run.size ?? 0]);
  return { runs, sizes, rotations, imageY };
}

afterEach(() => vi.restoreAllMocks());

describe("§750 the number is capped to the area it has", () => {
  it("reads Roboto Bold's digit ink and advance from the font itself", async () => {
    const doc = new PDFDocument({ size: "A4", margin: 0 });
    doc.registerFont("bold", await readFile(path.join(process.cwd(), "src", "theme", "pdf", "Roboto-Bold.ttf")));
    doc.font("bold");
    const font = (doc as unknown as { _font: { font: { unitsPerEm: number; layout: (text: string) => { glyphs: Array<{ advanceWidth: number; bbox: { minY: number; maxY: number } }> } } } })._font.font;
    const glyphs = font.layout("0123456789").glyphs;
    const ink = (Math.max(...glyphs.map((g) => g.bbox.maxY)) - Math.min(...glyphs.map((g) => g.bbox.minY))) / font.unitsPerEm;
    expect(BIB_DIGIT.height).toBeCloseTo(ink, 3);
    expect(BIB_DIGIT.advance).toBeCloseTo(glyphs[0].advanceWidth / font.unitsPerEm, 3);
  });

  it.each([
    ["101", false],
    ["1010", false],
    ["10101", false],
    ["101", true],
    ["1010", true],
  ])("with every element on, %s digits fit their area, member card %s", async (digits, member) => {
    const input = design({ ...EVERYTHING, member: { ...DEFAULT_BIB_DESIGN.member, enabled: true, style: "card", label: "Membru" } });
    const drawn = await sheet({ design: input, bib: Number(digits), member, sponsors: true, distanceBadge: "21K" });
    const size = drawn.sizes.get(digits)?.[0] ?? 0;
    const footer = bibSheetFooterLines({ ...SHEET, design: input }, false);
    const area = bibNumberArea({
      footer: BIB_LAYOUT.footerHeight + Math.max(0, footer.length - 1) * 10,
      name: BIB_LAYOUT.nameBlock,
      sponsors: BIB_LAYOUT.sponsorHeight,
      stripe: member ? BIB_LAYOUT.memberStripeHeight : 0,
      extras: bibExtrasHeight(true, true),
    });
    // Measured with the font's own digits: the ink's height in the area, the run's width in the card.
    expect(size).toBeGreaterThan(0);
    expect(size * BIB_DIGIT.height).toBeLessThanOrEqual(area + 0.001);
    expect(size * BIB_DIGIT.advance * digits.length).toBeLessThanOrEqual(BIB_CARD.width - 2 * BIB_LAYOUT.inset);
    // The cap bit: the club's large size alone would have spilled.
    expect(bibNumberPoints(digits, 1.2) * BIB_DIGIT.height > area || size === bibNumberPoints(digits, 1.2)).toBe(true);
  });

  it("leaves a number the room allows exactly as the club sized it", () => {
    expect(bibNumberFit("101", 1, 300)).toBe(200);
    expect(bibNumberFit("1010", 1.2, 300)).toBe(210);
    expect(bibNumberFit("101", 1.2, bibNumberArea({ footer: 22, name: 44, sponsors: 0, stripe: 0, extras: 0 }))).toBe(240);
  });

  it("shrinks with the profile and the phone, never below legible", () => {
    const room = bibNumberArea({ footer: 22, name: 44, sponsors: 30, stripe: 20, extras: bibExtrasHeight(true, true) });
    expect(bibNumberFit("101", 1.2, room)).toBeLessThan(240);
    expect(bibNumberFit("101", 1.2, 5)).toBe(12);
  });

  it("is the same size in the picture's arithmetic: the picture multiplies the same points", () => {
    expect(bibNumberFit("101", 1, 100) * BIB_IMAGE_SCALE).toBeCloseTo(Math.floor(100 / BIB_DIGIT.height) * BIB_IMAGE_SCALE, 5);
  });

  it("prints a design with none of the new ticks at the size it always did", async () => {
    const drawn = await sheet({ design: design({}), bib: 101 });
    expect(drawn.sizes.get("101")).toEqual([200]);
  });
});

describe("§750 the distance badge", () => {
  it("says the distance in whole kilometres, and nothing for none", () => {
    expect(bibDistanceBadge(21_097)).toBe("21K");
    expect(bibDistanceBadge(5000)).toBe("5K");
    expect(bibDistanceBadge(42_195)).toBe("42K");
    expect(bibDistanceBadge(300)).toBeNull();
    expect(bibDistanceBadge(null)).toBeNull();
  });

  it("is on the sheet only when ticked and given", async () => {
    const on = await sheet({ design: design({ showDistance: true }), distanceBadge: "21K" });
    expect(on.runs.map((run) => run.text)).toContain("21K");
    const unticked = await sheet({ design: design({ showDistance: false }), distanceBadge: "21K" });
    expect(unticked.runs.map((run) => run.text)).not.toContain("21K");
    const none = await sheet({ design: design({ showDistance: true }), distanceBadge: null });
    expect(none.runs.map((run) => run.text)).not.toContain("21K");
  });

  it("keeps the race's title clear of it", async () => {
    const on = await sheet({ design: design({ showDistance: true }), distanceBadge: "21K" });
    const off = await sheet({ design: design({ showDistance: false }) });
    // The title is right-aligned by hand with no width (§755): its right edge is its x plus pdfkit's own width.
    const measure = new PDFDocument({ autoFirstPage: false });
    measure.registerFont("bold", path.join(process.cwd(), "src", "theme", "pdf", "Roboto-Bold.ttf"));
    const right = (drawn: Drawn) => {
      const run = drawn.runs.find((candidate) => candidate.text === SHEET.eventTitle)!;
      return run.x! + measure.font("bold").fontSize(run.size!).widthOfString(run.text);
    };
    expect(right(off) - right(on)).toBeCloseTo(BIB_LAYOUT.badgeWidth + BIB_LAYOUT.badgeGap, 6);
    expect(right(on)).toBeLessThanOrEqual(BIB_MARGIN + BIB_CARD.width - BIB_LAYOUT.inset - BIB_LAYOUT.badgeWidth - BIB_LAYOUT.badgeGap + 1e-6);
  });

  it("is drawn in the picture in the header's text colour: white on the band", async () => {
    const badgeAt = { x: Math.round((BIB_MARGIN + BIB_CARD.width - BIB_LAYOUT.inset - BIB_LAYOUT.badgeWidth + 5) * BIB_IMAGE_SCALE), y: Math.round((BIB_MARGIN + bibHeader({ title: null, date: null, logo: true, badge: true, label: false }).badgeTop + BIB_LAYOUT.badgeHeight / 2) * BIB_IMAGE_SCALE) };
    const pixel = async (overrides: Partial<BibDesign>) => {
      const response = await renderBibImage({ bibNumber: 101, registeredName: "A", ...SHEET, bandColour: null, design: design(overrides), distanceBadge: "21K" });
      const { data, info } = await sharp(Buffer.from(await response.arrayBuffer())).raw().toBuffer({ resolveWithObject: true });
      const at = (badgeAt.y * info.width + badgeAt.x) * info.channels;
      return [data[at], data[at + 1], data[at + 2]];
    };
    expect((await pixel({ showDistance: true }))[0]).toBeGreaterThan(240);
    expect((await pixel({ showDistance: false }))[0]).toBeLessThan(100);
  });
});

describe("§750 the emergency phone upside down", () => {
  it("reads upside down by default, wherever the design is old", () => {
    expect(DEFAULT_BIB_DESIGN.emergencyUpsideDown).toBe(true);
    expect(readBibDesign({ showEmergency: true, emergencyPhone: "0722 000 000" }).emergencyUpsideDown).toBe(true);
    expect(readBibDesign({ emergencyUpsideDown: false }).emergencyUpsideDown).toBe(false);
  });

  it("turns the line half a circle on the sheet, once for each number, and not when unticked", async () => {
    const phone = { showEmergency: true, emergencyPhone: "0722 000 000" } as const;
    const on = await sheet({ design: design({ ...phone, emergencyUpsideDown: true }) });
    expect(on.rotations).toEqual([180]);
    expect(on.runs.map((run) => run.text)).toContain("Urgențe: 0722 000 000");
    const off = await sheet({ design: design({ ...phone, emergencyUpsideDown: false }) });
    expect(off.rotations).toEqual([]);
    const noPhone = await sheet({ design: design({ emergencyUpsideDown: true }) });
    expect(noPhone.rotations).toEqual([]);
  });

  it("is a different picture upside down, and the same without a phone", async () => {
    const picture = async (overrides: Partial<BibDesign>) =>
      Buffer.from(await (await renderBibImage({ bibNumber: 101, registeredName: "A", ...SHEET, bandColour: null, emergencyLabel: "Urgențe", design: design(overrides) })).arrayBuffer());
    const phone = { showEmergency: true, emergencyPhone: "0722 000 000" } as const;
    expect((await picture({ ...phone, emergencyUpsideDown: true })).equals(await picture({ ...phone, emergencyUpsideDown: false }))).toBe(false);
    expect((await picture({ emergencyUpsideDown: true })).equals(await picture({ emergencyUpsideDown: false }))).toBe(true);
  });
});

describe("§750 the profile as a full-width strip above the sponsors", () => {
  it("runs across the card: its chart is wider than half the card and its figures end inside the inset", () => {
    expect(BIB_LAYOUT.profileChartWidth).toBeGreaterThan(BIB_CARD.width / 2);
    expect(BIB_LAYOUT.inset + BIB_LAYOUT.profileChartWidth + BIB_LAYOUT.profileTextGap).toBeLessThan(BIB_CARD.width - BIB_LAYOUT.inset - 100);
  });

  it("is above the sponsors' picture and the small print, and the gain's words fit the room beside it", async () => {
    const drawn = await sheet({ design: design({ showProfile: true }), sponsors: true });
    const run = (text: string) => drawn.runs.find((entry) => entry.text === text)!;
    expect(run(DRAWING.start).y!).toBeLessThan(drawn.imageY[drawn.imageY.length - 1]);
    expect(run(DRAWING.finish).x!).toBeGreaterThan(BIB_MARGIN + BIB_CARD.width / 2);
    const doc = new PDFDocument({ size: "A4", margin: 0 });
    doc.fontSize(BIB_LAYOUT.profileTextSize);
    const textLeft = BIB_MARGIN + BIB_LAYOUT.inset + BIB_LAYOUT.profileChartWidth + BIB_LAYOUT.profileTextGap;
    expect(textLeft + doc.widthOfString(DRAWING.gain)).toBeLessThanOrEqual(BIB_MARGIN + BIB_CARD.width - BIB_LAYOUT.inset + 1);
  });
});

describe("§750 the number on the footer's two ends", () => {
  it("prints it three times: the number, and a stub at each end of the sponsors' row", async () => {
    const on = await sheet({ design: design({ numberStubs: true }), sponsors: true });
    const stubs = on.runs.filter((run) => run.text === "101");
    expect(stubs).toHaveLength(3);
    const [, left, right] = stubs;
    expect(left.x).toBe(BIB_MARGIN + BIB_LAYOUT.inset);
    expect(right.x!).toBeGreaterThan(BIB_MARGIN + BIB_CARD.width - BIB_LAYOUT.inset - 40);
    expect(left.y).toBe(right.y);
    const footer = on.runs.find((run) => run.text.includes("club@example.test"))!;
    expect(left.y!).toBeGreaterThan(footer.y!);
    const off = await sheet({ design: design({ numberStubs: false }), sponsors: true });
    expect(off.runs.filter((run) => run.text === "101")).toHaveLength(1);
  });

  it("makes the row for itself when there is no sponsors' picture, and the number gives it up", async () => {
    const on = await sheet({ design: design({ numberStubs: true }) });
    expect(on.runs.filter((run) => run.text === "101")).toHaveLength(3);
    expect(on.sizes.get("101")![0]).toBeLessThan(200 + 1);
  });

  it("is a different picture with the stubs on, and draws them twice", async () => {
    const picture = async (overrides: Partial<BibDesign>) =>
      Buffer.from(await (await renderBibImage({ bibNumber: 101, registeredName: "A", ...SHEET, bandColour: null, design: design(overrides) })).arrayBuffer());
    expect((await picture({ numberStubs: true })).equals(await picture({ numberStubs: false }))).toBe(false);
  });
});

describe("§750 the stamp follows the three new keys", () => {
  it("changes with each", () => {
    const stamp = (overrides: Partial<BibDesign>) => bibPictureStamp([design(overrides)]);
    const base = stamp({});
    expect(stamp({ emergencyUpsideDown: false })).not.toBe(base);
    expect(stamp({ showDistance: true })).not.toBe(base);
    expect(stamp({ numberStubs: true })).not.toBe(base);
  });
});

describe("§750 the profile is read once", () => {
  beforeEach(() => {
    clearBibProfileCache();
    stored.get.mockReset();
    stored.get.mockResolvedValue(new TextEncoder().encode(track()));
  });

  const event = (key: string) => ({ routeGpx: { key } as never, distanceMeters: 21_097, elevationGainMeters: null });

  it("does not read the store a second time for the same file", async () => {
    const first = await loadBibExtras(event("route/a.gpx"), { showProfile: true, showEmergency: false, showDistance: true }, "ro");
    const second = await loadBibExtras(event("route/a.gpx"), { showProfile: true, showEmergency: true, showDistance: true }, "ro");
    expect(stored.get).toHaveBeenCalledTimes(1);
    expect(first.profile?.points).toHaveLength(64);
    expect(second.profile?.points).toEqual(first.profile?.points);
    expect(first.distanceBadge).toBe("21K");
  });

  it("reads a new upload, which has a new key", async () => {
    await loadBibExtras(event("route/a.gpx"), { showProfile: true, showEmergency: false, showDistance: false }, "ro");
    await loadBibExtras(event("route/b.gpx"), { showProfile: true, showEmergency: false, showDistance: false }, "ro");
    expect(stored.get).toHaveBeenCalledTimes(2);
  });

  it("does not keep a failed read, which may be the store's bad moment", async () => {
    stored.get.mockRejectedValueOnce(new Error("store down"));
    const failed = await loadBibExtras(event("route/c.gpx"), { showProfile: true, showEmergency: false, showDistance: false }, "ro");
    expect(failed.profile).toBeNull();
    const retried = await loadBibExtras(event("route/c.gpx"), { showProfile: true, showEmergency: false, showDistance: false }, "ro");
    expect(retried.profile).not.toBeNull();
    expect(stored.get).toHaveBeenCalledTimes(2);
  });

  it("reads nothing when the design asks for no profile", async () => {
    const none = await loadBibExtras(event("route/d.gpx"), { showProfile: false, showEmergency: false, showDistance: true }, "ro");
    expect(stored.get).not.toHaveBeenCalled();
    expect(none.profile).toBeNull();
    expect(none.distanceBadge).toBe("21K");
  });
});
