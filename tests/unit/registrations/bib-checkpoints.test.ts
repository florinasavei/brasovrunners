import PDFDocument from "pdfkit";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const stored = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/modules/media/storage", () => ({ getStorage: () => ({ get: stored.get }) }));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string, values?: { km?: string; m?: string }) => `${key}${values?.km ?? values?.m ?? ""}`,
}));

import { type BibDesign, DEFAULT_BIB_DESIGN } from "@/modules/registrations/bib-design";
import { bibCheckpointMarks, profileHeightAt } from "@/modules/registrations/bib-checkpoints";
import { bibNeedsCheckpoints, clearBibProfileCache, loadBibExtras } from "@/modules/registrations/bib-extras";
import { BIB_LAYOUT } from "@/modules/registrations/bib-geometry";
import { renderBibImage } from "@/modules/registrations/bib-image";
import { type BibProfileDrawing, bibProfileDrawing, parseGpxProfile } from "@/modules/registrations/bib-profile";
import { renderBibSheet } from "@/modules/registrations/bibs-pdf";
import { drawnRuns } from "../../helpers/pdf-drawn";

/**
 * §NNN, BR-REQ-011-01 — the route's checkpoints on the bib's profile strip: where each mark stands,
 * which cut-offs are written, and the crowding rule (the times go first, all of them, before a mark
 * does; a mark too close to the one before it is not drawn). The sheet through what pdfkit is asked to
 * draw, the picture through its pixels; both from the one answer `bibCheckpointMarks` gives.
 */

/** A flat-ish profile: 64 points rising and falling, so a mark's height is easy to check. */
const POINTS = Array.from({ length: 64 }, (_, i) => [i / 63, i <= 31 ? i / 31 : 1 - (i - 31) / 32] as const);

const base = { routeKm: 21.1, points: POINTS, startWord: "Start", finishWord: "Sosire" };
const at = (km: number, cutoff: string | null = null) => ({ km, cutoff });

describe("§NNN the marks on the strip", () => {
  it("places each point by its share of the route's distance, on the profile's own line", () => {
    const drawing = bibCheckpointMarks({ ...base, checkpoints: [at(5, "09:45"), at(10.55, "10:30")] })!;
    expect(drawing.marks).toHaveLength(2);
    expect(drawing.marks[0].x).toBeCloseTo(5 / 21.1, 3);
    expect(drawing.marks[1].x).toBeCloseTo(0.5, 3);
    // The line's height at that share, from the points the strip draws.
    expect(drawing.marks[1].y).toBeCloseTo(profileHeightAt(POINTS, 0.5), 3);
    expect(drawing.marks.map((m) => m.time)).toEqual(["09:45", "10:30"]);
    expect(drawing.timesShown).toBe(true);
  });

  it("draws nothing without a route to place them by, or when none is within it", () => {
    expect(bibCheckpointMarks({ ...base, checkpoints: [] })).toBeNull();
    expect(bibCheckpointMarks({ ...base, routeKm: 0, checkpoints: [at(5)] })).toBeNull();
    expect(bibCheckpointMarks({ ...base, checkpoints: [at(30), at(-1)] })).toBeNull();
    expect(bibCheckpointMarks({ ...base, points: [[0, 0]], checkpoints: [at(5)] })).toBeNull();
  });

  it("drops a point beyond the printed distance and keeps the rest", () => {
    const drawing = bibCheckpointMarks({ ...base, checkpoints: [at(5), at(22)] })!;
    expect(drawing.marks).toHaveLength(1);
  });

  it("reads the points in distance order whatever order they come in", () => {
    const drawing = bibCheckpointMarks({ ...base, checkpoints: [at(15, "11:00"), at(5, "09:45")] })!;
    expect(drawing.marks.map((m) => m.time)).toEqual(["09:45", "11:00"]);
  });

  it("writes no time for a point that has no cut-off, and the others' times still fit", () => {
    const drawing = bibCheckpointMarks({ ...base, checkpoints: [at(5), at(12, "10:30")] })!;
    expect(drawing.marks.map((m) => m.time)).toEqual([null, "10:30"]);
    expect(drawing.timesShown).toBe(true);
  });

  it("has no times at all while no point has a cut-off, and keeps the marks", () => {
    const drawing = bibCheckpointMarks({ ...base, checkpoints: [at(5), at(12)] })!;
    expect(drawing.timesShown).toBe(false);
    expect(drawing.marks).toHaveLength(2);
  });
});

describe("§NNN the crowding rule", () => {
  const width = BIB_LAYOUT.profileChartWidth;

  it("drops every time, not one, when one cut-off has no room next to the next — the marks stay", () => {
    // Two points 8 points apart on the strip: marks 4 or more apart stay, their times (about 20 wide) collide.
    const km = (points: number) => (points / width) * 21.1;
    const drawing = bibCheckpointMarks({ ...base, checkpoints: [at(5, "09:45"), at(5 + km(8), "09:50"), at(15, "11:00")] })!;
    expect(drawing.marks).toHaveLength(3);
    expect(drawing.timesShown).toBe(false);
    expect(drawing.marks.every((m) => m.time === null)).toBe(true);
  });

  it("keeps the first of two marks closer than the minimum gap, with its time, and draws the second not at all", () => {
    const km = (points: number) => (points / width) * 21.1;
    const drawing = bibCheckpointMarks({ ...base, checkpoints: [at(5, "09:45"), at(5 + km(BIB_LAYOUT.checkpointMinGap - 1), "09:46")] })!;
    expect(drawing.marks).toHaveLength(1);
    expect(drawing.marks[0].time).toBe("09:45");
  });

  it("takes the times away when one would sit over «Start» or «Sosire»", () => {
    // Kilometre 0 is the strip's left end, where «Start» is; the last kilometre is where «Sosire» is.
    expect(bibCheckpointMarks({ ...base, checkpoints: [at(0, "09:00"), at(10, "10:00")] })!.timesShown).toBe(false);
    expect(bibCheckpointMarks({ ...base, checkpoints: [at(10, "10:00"), at(21, "12:00")] })!.timesShown).toBe(false);
    expect(bibCheckpointMarks({ ...base, checkpoints: [at(10, "10:00")] })!.timesShown).toBe(true);
  });

  it("fits the times of a dozen evenly spread points and none of thirty", () => {
    // From kilometre 3 to 18 of 21.1, clear of the words at the two ends: 12 points are about 25 points apart, 30 about 10.
    const spread = (count: number) => Array.from({ length: count }, (_, i) => at(3 + (i * 15) / (count - 1), "10:00"));
    expect(bibCheckpointMarks({ ...base, checkpoints: spread(12) })!.timesShown).toBe(true);
    const crowded = bibCheckpointMarks({ ...base, checkpoints: spread(30) })!;
    expect(crowded.timesShown).toBe(false);
    // The times went before the marks did: thirty points about ten points apart all stay.
    expect(crowded.marks).toHaveLength(30);
  });

  it("drops marks only when they stand closer together than the minimum gap", () => {
    const dense = Array.from({ length: 200 }, (_, i) => at((i * 21) / 199, "10:00"));
    const drawing = bibCheckpointMarks({ ...base, checkpoints: dense })!;
    expect(drawing.marks.length).toBeLessThan(200);
    for (let i = 1; i < drawing.marks.length; i++) {
      expect((drawing.marks[i].x - drawing.marks[i - 1].x) * width).toBeGreaterThanOrEqual(BIB_LAYOUT.checkpointMinGap - 1e-6);
    }
  });
});

describe("§NNN the profile's height at a distance", () => {
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
  eventTitle: "Crosul Brașov Runners",
  eventDate: "21 noiembrie 2026",
  generatedAt: new Date("2026-10-10T12:00:00Z"),
  replyTo: "club@example.test",
};

const withMarks = (checkpoints: BibProfileDrawing["checkpoints"]): BibProfileDrawing => ({ ...PROFILE, checkpoints });
const MARKS = bibCheckpointMarks({ routeKm: 3.1, points: PROFILE.points, startWord: "Start", finishWord: "Sosire", checkpoints: [at(1, "09:45"), at(2, "10:30")] });

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

describe("§NNN the sheet draws the marks and the times", () => {
  it("writes the cut-offs under the ticks, and draws a ring and a tick for each mark", async () => {
    expect(MARKS?.timesShown).toBe(true);
    const plain = await sheet(PROFILE);
    const marked = await sheet(withMarks(MARKS));
    expect(plain.runs).not.toContain("09:45");
    expect(marked.runs).toEqual(expect.arrayContaining(["09:45", "10:30"]));
    // A ring is a circle, a tick a line: one of each more per mark.
    expect(marked.circles - plain.circles).toBe(2);
    expect(marked.lines - plain.lines).toBe(2);
  });

  it("draws the marks and no time when the times did not fit", async () => {
    const crowded = bibCheckpointMarks({ routeKm: 3.1, points: PROFILE.points, startWord: "Start", finishWord: "Sosire", checkpoints: [at(0, "09:00"), at(2, "10:30")] })!;
    expect(crowded.timesShown).toBe(false);
    const drawn = await sheet(withMarks(crowded));
    expect(drawn.runs).not.toContain("09:00");
    expect(drawn.runs).not.toContain("10:30");
    expect(drawn.circles - (await sheet(PROFILE)).circles).toBe(2);
  });

  it("draws none of it without the profile: the marks live on the strip", async () => {
    const off = await sheet(withMarks(MARKS), { showProfile: false });
    expect(off.runs).not.toContain("09:45");
  });
});

describe("§NNN the picture draws them too", () => {
  it("is a different picture with the marks, and the same with the marks empty", async () => {
    const plain = await picture(PROFILE);
    expect((await picture(withMarks(MARKS))).equals(plain)).toBe(false);
    expect((await picture(withMarks(null))).equals(plain)).toBe(true);
    expect((await picture(withMarks({ marks: [], timesShown: false }))).equals(plain)).toBe(true);
  });

  it("is a different picture with the times than with the marks alone", async () => {
    const aloneMarks = { marks: MARKS!.marks.map((mark) => ({ ...mark, time: null })), timesShown: false };
    expect((await picture(withMarks(MARKS))).equals(await picture(withMarks(aloneMarks)))).toBe(false);
  });

  it("changes a different amount of the card for a mark: only the strip's row", async () => {
    const [plain, marked] = [await picture(PROFILE), await picture(withMarks(MARKS))];
    const a = await sharp(plain).raw().toBuffer({ resolveWithObject: true });
    const b = await sharp(marked).raw().toBuffer({ resolveWithObject: true });
    expect(a.info.width).toBe(b.info.width);
    // Rows that differ lie inside one band of the card: the profile's row, never the header or the number's middle.
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

describe("§NNN the extras read the checkpoints only where the design asks", () => {
  beforeEach(() => {
    clearBibProfileCache();
    stored.get.mockReset();
    stored.get.mockResolvedValue(new TextEncoder().encode(track()));
  });

  const event = { routeGpx: { key: "route/a.gpx" } as never, distanceMeters: 3100, elevationGainMeters: null, checkpoints: [at(1, "09:45"), at(2, "10:30")] };

  it("puts the marks on the profile by the printed distance", async () => {
    const extras = await loadBibExtras(event, { showProfile: true, showCheckpoints: true, showEmergency: false, showDistance: false }, "ro");
    expect(extras.profile?.checkpoints?.marks).toHaveLength(2);
    expect(extras.profile?.checkpoints?.marks[0].x).toBeCloseTo(1 / 3.1, 3);
    expect(extras.profile?.checkpoints?.marks.map((m) => m.time)).toEqual(["09:45", "10:30"]);
  });

  it("puts none when the tick is off, with no checkpoints, or without the profile", async () => {
    const off = await loadBibExtras(event, { showProfile: true, showCheckpoints: false, showEmergency: false, showDistance: false }, "ro");
    expect(off.profile?.checkpoints ?? null).toBeNull();
    const none = await loadBibExtras({ ...event, checkpoints: [] }, { showProfile: true, showCheckpoints: true, showEmergency: false, showDistance: false }, "ro");
    expect(none.profile?.checkpoints ?? null).toBeNull();
    const noProfile = await loadBibExtras(event, { showProfile: false, showCheckpoints: true, showEmergency: false, showDistance: false }, "ro");
    expect(noProfile.profile).toBeNull();
  });

  it("reads the tick as on when the design says nothing: the default", async () => {
    const extras = await loadBibExtras(event, { showProfile: true, showEmergency: false, showDistance: false }, "ro");
    expect(extras.profile?.checkpoints?.marks).toHaveLength(2);
  });

  it("asks the database for the checkpoints only when the strip carries them", () => {
    expect(bibNeedsCheckpoints({ showProfile: true, showCheckpoints: true })).toBe(true);
    expect(bibNeedsCheckpoints({ showProfile: true, showCheckpoints: false })).toBe(false);
    expect(bibNeedsCheckpoints({ showProfile: false, showCheckpoints: true })).toBe(false);
  });

  it("is on by default in the design, and a design saved before the key reads on", () => {
    expect(DEFAULT_BIB_DESIGN.showCheckpoints).toBe(true);
  });
});
