import PDFDocument from "pdfkit";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const stored = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/modules/media/storage", () => ({ getStorage: () => ({ get: stored.get }) }));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string, values?: { km?: string; m?: string; time?: string }) =>
    key === "bibs.checkpointKm" ? `km ${values?.km}` : key === "bibs.checkpointKmTime" ? `km ${values?.km} · ${values?.time}` : `${key}${values?.km ?? values?.m ?? ""}`,
}));

import { type BibDesign, bibDesignSchema, DEFAULT_BIB_DESIGN } from "@/modules/registrations/bib-design";
import {
  type BibCheckpointSource,
  bibCheckpointMarks,
  bibLabelWidth,
  checkpointGlyph,
  checkpointGlyphLines,
  profileHeightAt,
} from "@/modules/registrations/bib-checkpoints";
import { bibNeedsCheckpoints, clearBibProfileCache, loadBibExtras } from "@/modules/registrations/bib-extras";
import { BIB_LAYOUT } from "@/modules/registrations/bib-geometry";
import { renderBibImage } from "@/modules/registrations/bib-image";
import { type BibProfileDrawing, bibProfileDrawing, parseGpxProfile } from "@/modules/registrations/bib-profile";
import { renderBibSheet } from "@/modules/registrations/bibs-pdf";
import { drawnRuns } from "../../helpers/pdf-drawn";

/**
 * §757 (amending §750), BR-REQ-011-01 — the route's checkpoints on the bib's profile strip: where each
 * mark stands, an aid station's glyph (a cup for water, a fork for food) and every other point's dot,
 * the words under the ticks («km 12», «km 12 · 11:30» with the second tick), and the crowding rule —
 * the times go first, all of them; then the kilometres that do not fit; the marks stay (a mark too
 * close to the one before it gives way, to an aid station first). The sheet through what pdfkit is
 * asked to draw, the picture through its pixels; both from the one answer `bibCheckpointMarks` gives.
 */

/** A profile rising to the middle and falling, so a mark's height is easy to check. */
const POINTS = Array.from({ length: 64 }, (_, i) => [i / 63, i <= 31 ? i / 31 : 1 - (i - 31) / 32] as const);

const label = (row: BibCheckpointSource, withTime: boolean) => (withTime && row.cutoff ? `km ${row.km} · ${row.cutoff}` : `km ${row.km}`);
const base = { routeKm: 21.1, points: POINTS, startWord: "Start", finishWord: "Sosire", showTimes: false, label };
const at = (km: number, cutoff: string | null = null, kinds: readonly string[] = []): BibCheckpointSource => ({ km, cutoff, kinds });
const width = BIB_LAYOUT.profileChartWidth;
/** The kilometre `points` points along the strip of a 21.1 km route. */
const kmAt = (points: number) => (points / width) * 21.1;

describe("§757 the marks on the strip", () => {
  it("places each point by its share of the route's distance, on the profile's own line", () => {
    const drawing = bibCheckpointMarks({ ...base, checkpoints: [at(5), at(10.55)] })!;
    expect(drawing.marks).toHaveLength(2);
    expect(drawing.marks[0].x).toBeCloseTo(5 / 21.1, 3);
    expect(drawing.marks[1].x).toBeCloseTo(0.5, 3);
    expect(drawing.marks[1].y).toBeCloseTo(profileHeightAt(POINTS, 0.5), 3);
  });

  it("draws nothing without a route to place them by, or when none is within it", () => {
    expect(bibCheckpointMarks({ ...base, checkpoints: [] })).toBeNull();
    expect(bibCheckpointMarks({ ...base, routeKm: 0, checkpoints: [at(5)] })).toBeNull();
    expect(bibCheckpointMarks({ ...base, checkpoints: [at(30), at(-1)] })).toBeNull();
    expect(bibCheckpointMarks({ ...base, points: [[0, 0]], checkpoints: [at(5)] })).toBeNull();
  });

  it("drops a point beyond the printed distance and keeps the rest", () => {
    expect(bibCheckpointMarks({ ...base, checkpoints: [at(5), at(22)] })!.marks).toHaveLength(1);
  });

  it("reads the points in distance order whatever order they come in", () => {
    const drawing = bibCheckpointMarks({ ...base, checkpoints: [at(15), at(5)] })!;
    expect(drawing.marks.map((m) => m.label)).toEqual(["km 5", "km 15"]);
  });
});

describe("§757 an aid station is a glyph, every other point a dot", () => {
  it("gives water a cup, food alone a fork, and first aid, timing or nothing a dot", () => {
    expect(checkpointGlyph(["WATER"])).toBe("water");
    expect(checkpointGlyph(["WATER", "FOOD"])).toBe("water");
    expect(checkpointGlyph(["FOOD"])).toBe("food");
    expect(checkpointGlyph(["FOOD", "FIRST_AID"])).toBe("food");
    expect(checkpointGlyph(["FIRST_AID", "TIMING"])).toBeNull();
    expect(checkpointGlyph([])).toBeNull();
  });

  it("draws the glyphs inside their box", () => {
    for (const glyph of ["water", "food"] as const) {
      for (const stroke of checkpointGlyphLines(glyph)) {
        for (const [x, y] of stroke) {
          expect(Math.abs(x)).toBeLessThanOrEqual(BIB_LAYOUT.checkpointGlyphWidth / 2 + 1e-9);
          expect(Math.abs(y)).toBeLessThanOrEqual(BIB_LAYOUT.checkpointGlyphHeight / 2 + 1e-9);
        }
      }
    }
  });

  it("stands the glyph above the line, and under it where the line runs too high — never out of the chart", () => {
    const drawing = bibCheckpointMarks({ ...base, checkpoints: [at(1, null, ["WATER"]), at(10.55, null, ["FOOD"]), at(15, null, ["TIMING"])] })!;
    const [low, top, dot] = drawing.marks;
    const lineY = (y: number) => (1 - y) * BIB_LAYOUT.profileChartHeight;
    // Low on the profile: the cup stands above the line.
    expect(low.glyph).toBe("water");
    expect(low.glyphY!).toBeLessThan(lineY(low.y));
    // At the profile's top: the fork goes under the line, and the tick starts under the fork.
    expect(top.glyph).toBe("food");
    expect(top.glyphY!).toBeGreaterThan(lineY(top.y));
    expect(top.tickFrom).toBeGreaterThan(top.glyphY!);
    for (const mark of [low, top]) {
      expect(mark.glyphY! - BIB_LAYOUT.checkpointGlyphHeight / 2).toBeGreaterThanOrEqual(-1e-9);
      expect(mark.glyphY! + BIB_LAYOUT.checkpointGlyphHeight / 2).toBeLessThanOrEqual(BIB_LAYOUT.profileChartHeight + 1e-9);
    }
    // Timing: a dot, no glyph, its tick from the line.
    expect(dot.glyph).toBeNull();
    expect(dot.glyphY).toBeNull();
    expect(dot.tickFrom).toBeCloseTo(lineY(dot.y) + BIB_LAYOUT.checkpointDot, 2);
  });

  it("keeps the aid station when two marks stand too close, whichever comes first", () => {
    const close = kmAt(BIB_LAYOUT.checkpointMinGap - 1);
    const timingFirst = bibCheckpointMarks({ ...base, checkpoints: [at(5, null, ["TIMING"]), at(5 + close, null, ["WATER"])] })!;
    expect(timingFirst.marks).toHaveLength(1);
    expect(timingFirst.marks[0].glyph).toBe("water");
    const waterFirst = bibCheckpointMarks({ ...base, checkpoints: [at(5, null, ["WATER"]), at(5 + close, null, ["TIMING"])] })!;
    expect(waterFirst.marks).toHaveLength(1);
    expect(waterFirst.marks[0].glyph).toBe("water");
  });
});

describe("§757 the words under the ticks, and the crowding rule", () => {
  it("says «km» under each point, and the cut-off beside it only with the second tick", () => {
    const checkpoints = [at(5, "09:45"), at(12, "10:30"), at(16)];
    expect(bibCheckpointMarks({ ...base, checkpoints })!.marks.map((m) => m.label)).toEqual(["km 5", "km 12", "km 16"]);
    const timed = bibCheckpointMarks({ ...base, showTimes: true, checkpoints })!;
    expect(timed.timesShown).toBe(true);
    expect(timed.marks.map((m) => m.label)).toEqual(["km 5 · 09:45", "km 12 · 10:30", "km 16"]);
  });

  it("has no times while no point has a cut-off, even with the tick", () => {
    const drawing = bibCheckpointMarks({ ...base, showTimes: true, checkpoints: [at(5), at(12)] })!;
    expect(drawing.timesShown).toBe(false);
    expect(drawing.marks.map((m) => m.label)).toEqual(["km 5", "km 12"]);
  });

  it("drops every time, not one, when one label with its time has no room — and keeps the kilometres that fit", () => {
    // About 40 points apart: «km 5 · 09:45» (about 47 points wide) collides with the next; «km 5» (about 16) does not.
    const checkpoints = [at(5, "09:45"), at(7.25, "09:55"), at(15, "11:00")];
    const drawing = bibCheckpointMarks({ ...base, showTimes: true, checkpoints })!;
    expect(drawing.timesShown).toBe(false);
    expect(drawing.marks).toHaveLength(3);
    expect(drawing.marks.every((m) => m.label === null || !m.label.includes("·"))).toBe(true);
    expect(drawing.marks.map((m) => m.label)).toEqual(["km 5", "km 7.25", "km 15"]);
  });

  it("then leaves out a kilometre that would touch the one kept before it, and keeps the mark", () => {
    // 15 points apart: both marks stay (more than the minimum gap), the second's «km» would touch the first's.
    const near = Math.round((5 + kmAt(15)) * 100) / 100;
    const drawing = bibCheckpointMarks({ ...base, checkpoints: [at(5), at(near), at(15)] })!;
    expect(drawing.marks).toHaveLength(3);
    expect(drawing.marks.map((m) => m.label)).toEqual(["km 5", null, "km 15"]);
  });

  it("never prints a label over «Start» or «Sosire»", () => {
    const drawing = bibCheckpointMarks({ ...base, showTimes: true, checkpoints: [at(0, "09:00"), at(10, "10:00"), at(21, "12:00")] })!;
    expect(drawing.timesShown).toBe(false);
    expect(drawing.marks.map((m) => m.label)).toEqual([null, "km 10", null]);
  });

  it("keeps every label clear of the next and of the end words, whatever the crowd", () => {
    const startEnds = bibLabelWidth("Start") + BIB_LAYOUT.checkpointTimeGap;
    const finishFrom = width - bibLabelWidth("Sosire") - BIB_LAYOUT.checkpointTimeGap;
    for (const count of [3, 8, 12, 30]) {
      const checkpoints = Array.from({ length: count }, (_, i) => at(Math.round((1 + (i * 19) / (count - 1)) * 100) / 100, "10:00", i % 2 ? ["WATER"] : []));
      for (const showTimes of [false, true]) {
        const drawing = bibCheckpointMarks({ ...base, showTimes, checkpoints })!;
        const boxes = drawing.marks
          .filter((m) => m.label)
          .map((m) => ({ from: m.x * width - bibLabelWidth(m.label!) / 2, to: m.x * width + bibLabelWidth(m.label!) / 2 }));
        boxes.forEach((box, i) => {
          expect(box.from).toBeGreaterThanOrEqual(startEnds - 0.01);
          expect(box.to).toBeLessThanOrEqual(finishFrom + 0.01);
          if (i > 0) expect(box.from - boxes[i - 1].to).toBeGreaterThanOrEqual(BIB_LAYOUT.checkpointTimeGap - 0.01);
        });
      }
    }
  });

  it("drops marks only when they stand closer together than the minimum gap", () => {
    const dense = Array.from({ length: 200 }, (_, i) => at((i * 21) / 199));
    const drawing = bibCheckpointMarks({ ...base, checkpoints: dense })!;
    expect(drawing.marks.length).toBeLessThan(200);
    for (let i = 1; i < drawing.marks.length; i++) {
      expect((drawing.marks[i].x - drawing.marks[i - 1].x) * width).toBeGreaterThanOrEqual(BIB_LAYOUT.checkpointMinGap - 1e-3);
    }
  });
});

describe("§757 the profile's height at a distance", () => {
  it("interpolates between the points, and holds the ends", () => {
    const points = [
      [0, 0],
      [0.5, 1],
      [1, 0.5],
    ] as const;
    expect(profileHeightAt(points, 0)).toBe(0);
    expect(profileHeightAt(points, 0.25)).toBeCloseTo(0.5);
    expect(profileHeightAt(points, 0.75)).toBeCloseTo(0.75);
    expect(profileHeightAt(points, 1)).toBe(0.5);
    expect(profileHeightAt(points, -3)).toBe(0);
    expect(profileHeightAt(points, 9)).toBe(0.5);
  });
});

// ---------------------------------------------------------------------------------------------
// The two renderers draw what that gives them
// ---------------------------------------------------------------------------------------------

const design = (overrides: Partial<BibDesign>): BibDesign => ({ ...DEFAULT_BIB_DESIGN, showProfile: true, ...overrides });

function track(): string {
  const body = Array.from({ length: 41 }, (_, i) => {
    const ele = i <= 20 ? 600 + 10 * i : 800 - 5 * (i - 20);
    return `<trkpt lat="45.6000" lon="${(25.5 + i * 0.001).toFixed(5)}"><ele>${ele.toFixed(1)}</ele></trkpt>`;
  }).join("");
  return `<?xml version="1.0"?><gpx version="1.1" creator="test"><trk><trkseg>${body}</trkseg></trk></gpx>`;
}

const PROFILE: BibProfileDrawing = bibProfileDrawing(
  parseGpxProfile(track())!,
  {},
  "ro",
  (key, values) => ({ start: "Start", finish: "Sosire", distance: `Distanță: ${values?.km} km`, gain: `Diferență de nivel: +${values?.m} m` })[key],
);

const SHEET = {
  eventTitle: "Crosul de toamnă",
  eventDate: "21 noiembrie 2026",
  generatedAt: new Date("2026-10-10T12:00:00Z"),
  replyTo: "club@example.test",
};

const withMarks = (checkpoints: BibProfileDrawing["checkpoints"]): BibProfileDrawing => ({ ...PROFILE, checkpoints });
const marksOf = (checkpoints: BibCheckpointSource[], showTimes: boolean) =>
  bibCheckpointMarks({ routeKm: 3.1, points: PROFILE.points, startWord: "Start", finishWord: "Sosire", showTimes, label, checkpoints });
/** A water station at km 1 and a timing mat at km 2, both with a cut-off. */
const AID_AND_MAT = [at(1, "09:45", ["WATER"]), at(2, "10:30", ["TIMING"])];

async function sheet(profile: BibProfileDrawing, overrides: Partial<BibDesign> = {}) {
  let circles = 0;
  let lines = 0;
  const circle = PDFDocument.prototype.circle;
  const lineTo = PDFDocument.prototype.lineTo;
  vi.spyOn(PDFDocument.prototype, "circle").mockImplementation(function (this: PDFKit.PDFDocument, ...args: unknown[]) {
    circles += 1;
    return (circle as (...a: unknown[]) => PDFKit.PDFDocument).apply(this, args);
  });
  vi.spyOn(PDFDocument.prototype, "lineTo").mockImplementation(function (this: PDFKit.PDFDocument, ...args: unknown[]) {
    lines += 1;
    return (lineTo as (...a: unknown[]) => PDFKit.PDFDocument).apply(this, args);
  });
  const runs = await drawnRuns(() =>
    renderBibSheet({
      ...SHEET,
      rows: [{ bibNumber: 101, registeredName: "Alergător Unu" }],
      design: design(overrides),
      profile,
    }),
  );
  vi.restoreAllMocks();
  return { runs: runs.map((run) => run.text), circles, lines };
}

const picture = async (profile: BibProfileDrawing, overrides: Partial<BibDesign> = {}) =>
  Buffer.from(await (await renderBibImage({ bibNumber: 101, registeredName: "A", ...SHEET, bandColour: null, design: design(overrides), profile })).arrayBuffer());

afterEach(() => vi.restoreAllMocks());

describe("§757 the sheet draws the marks and their words", () => {
  it("draws a cup for the water and a dot for the mat, a tick under each, and «km» under the ticks", async () => {
    const marks = marksOf(AID_AND_MAT, false)!;
    const plain = await sheet(PROFILE);
    const marked = await sheet(withMarks(marks));
    expect(plain.runs).not.toContain("km 1");
    expect(marked.runs).toEqual(expect.arrayContaining(["km 1", "km 2"]));
    expect(marked.runs.join(" ")).not.toContain("09:45");
    // One dot (a circle) for the mat; the cup is three segments and each tick one.
    expect(marked.circles - plain.circles).toBe(1);
    expect(marked.lines - plain.lines).toBe(2 + checkpointGlyphLines("water")[0].length - 1);
  });

  it("prints the cut-offs beside the points with the second tick", async () => {
    const marked = await sheet(withMarks(marksOf(AID_AND_MAT, true)));
    expect(marked.runs).toEqual(expect.arrayContaining(["km 1 · 09:45", "km 2 · 10:30"]));
  });

  it("draws none of it without the profile: the marks live on the strip", async () => {
    const off = await sheet(withMarks(marksOf(AID_AND_MAT, true)), { showProfile: false });
    expect(off.runs.join(" ")).not.toContain("km 1");
  });
});

describe("§757 the picture draws them too", () => {
  it("is a different picture with the marks, and the same with the marks empty", async () => {
    const plain = await picture(PROFILE);
    expect((await picture(withMarks(marksOf(AID_AND_MAT, false)))).equals(plain)).toBe(false);
    expect((await picture(withMarks(null))).equals(plain)).toBe(true);
    expect((await picture(withMarks({ marks: [], timesShown: false }))).equals(plain)).toBe(true);
  });

  it("is a different picture with the times than without, and with a cup than with a dot", async () => {
    expect((await picture(withMarks(marksOf(AID_AND_MAT, true)))).equals(await picture(withMarks(marksOf(AID_AND_MAT, false))))).toBe(false);
    const dots = marksOf([at(1, null, ["TIMING"]), at(2, null, ["TIMING"])], false);
    const cups = marksOf([at(1, null, ["WATER"]), at(2, null, ["TIMING"])], false);
    expect((await picture(withMarks(dots))).equals(await picture(withMarks(cups)))).toBe(false);
  });

  it("changes only the strip's row of the card: never the number, the name or the header", async () => {
    const [plain, marked] = [await picture(PROFILE), await picture(withMarks(marksOf(AID_AND_MAT, true)))];
    const a = await sharp(plain).raw().toBuffer({ resolveWithObject: true });
    const b = await sharp(marked).raw().toBuffer({ resolveWithObject: true });
    expect(a.info.width).toBe(b.info.width);
    const rows = new Set<number>();
    for (let y = 0; y < a.info.height; y++) {
      const from = y * a.info.width * a.info.channels;
      if (!a.data.subarray(from, from + a.info.width * a.info.channels).equals(b.data.subarray(from, from + a.info.width * a.info.channels))) rows.add(y);
    }
    expect(rows.size).toBeGreaterThan(0);
    const spread = Math.max(...rows) - Math.min(...rows);
    expect(spread).toBeLessThan(BIB_LAYOUT.profileHeight * (a.info.width / 595.28) + 2);
  });
});

describe("§757 the extras read the checkpoints only where the design asks", () => {
  beforeEach(() => {
    clearBibProfileCache();
    stored.get.mockReset();
    stored.get.mockResolvedValue(new TextEncoder().encode(track()));
  });

  const event = { routeGpx: { key: "route/a.gpx" } as never, distanceMeters: 3100, elevationGainMeters: null, checkpoints: AID_AND_MAT };
  const ticks = { showProfile: true, showEmergency: false, showDistance: false } as const;

  it("puts the marks on the profile by the printed distance, with «km» in the sheet's words", async () => {
    const extras = await loadBibExtras(event, { ...ticks, showCheckpoints: true }, "ro");
    const marks = extras.profile?.checkpoints?.marks ?? [];
    expect(marks).toHaveLength(2);
    expect(marks[0].x).toBeCloseTo(1 / 3.1, 3);
    expect(marks.map((m) => m.glyph)).toEqual(["water", null]);
    expect(marks.map((m) => m.label)).toEqual(["km 1", "km 2"]);
  });

  it("adds the cut-offs only with «…cu timpii limită»", async () => {
    const extras = await loadBibExtras(event, { ...ticks, showCheckpoints: true, showCheckpointTimes: true }, "ro");
    expect(extras.profile?.checkpoints?.marks.map((m) => m.label)).toEqual(["km 1 · 09:45", "km 2 · 10:30"]);
  });

  it("puts none when the tick is off, with no checkpoints, or without the profile", async () => {
    const off = await loadBibExtras(event, { ...ticks, showCheckpoints: false }, "ro");
    expect(off.profile?.checkpoints ?? null).toBeNull();
    const none = await loadBibExtras({ ...event, checkpoints: [] }, { ...ticks, showCheckpoints: true }, "ro");
    expect(none.profile?.checkpoints ?? null).toBeNull();
    const noProfile = await loadBibExtras(event, { ...ticks, showProfile: false, showCheckpoints: true }, "ro");
    expect(noProfile.profile).toBeNull();
  });

  it("reads the first tick as on when the design says nothing: the default", async () => {
    const extras = await loadBibExtras(event, ticks, "ro");
    expect(extras.profile?.checkpoints?.marks).toHaveLength(2);
  });

  it("asks the database for the checkpoints only when the strip carries them", () => {
    expect(bibNeedsCheckpoints({ showProfile: true, showCheckpoints: true })).toBe(true);
    expect(bibNeedsCheckpoints({ showProfile: true, showCheckpoints: false })).toBe(false);
    expect(bibNeedsCheckpoints({ showProfile: false, showCheckpoints: true })).toBe(false);
  });

  it("has the marks on and the times off by default, and a design saved before the keys reads the same", () => {
    expect(DEFAULT_BIB_DESIGN.showCheckpoints).toBe(true);
    expect(DEFAULT_BIB_DESIGN.showCheckpointTimes).toBe(false);
    const old = bibDesignSchema.parse({});
    expect(old.showCheckpoints).toBe(true);
    expect(old.showCheckpointTimes).toBe(false);
  });
});
