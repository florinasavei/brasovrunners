import PDFDocument from "pdfkit";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const stored = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/modules/media/storage", () => ({ getStorage: () => ({ get: stored.get }), isStorageConfigured: () => true }));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string, values?: { km?: string; m?: string; time?: string }) =>
    ({
      "bibs.profileStart": "Start",
      "bibs.profileFinish": "Sosire",
      "bibs.profileKmUnit": "km",
      "bibs.profileAltitudeUnit": "m",
      "bibs.checkpointKm": `km ${values?.km}`,
      "bibs.checkpointKmWater": `km ${values?.km} · apă`,
      "bibs.checkpointKmFood": `km ${values?.km} · hrană`,
      "bibs.checkpointKmBoth": `km ${values?.km} · apă + hrană`,
      "bibs.checkpointKmTime": `km ${values?.km} · ${values?.time}`,
    })[key] ?? `${key}${values?.km ?? values?.m ?? ""}`,
}));
// The geometry the strip asks of the core, spied: the real function still answers.
const spy = vi.hoisted(() => ({ geometry: vi.fn() }));
vi.mock("@/modules/routes/elevation/geometry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/routes/elevation/geometry")>();
  spy.geometry.mockImplementation(actual.elevationGeometry);
  return { ...actual, elevationGeometry: spy.geometry };
});

import { type BibDesign, bibDesignSchema, DEFAULT_BIB_DESIGN } from "@/modules/registrations/bib-design";
import { type BibCheckpointSource, type BibCheckpointWords, bibStripCheckpoints } from "@/modules/registrations/bib-checkpoints";
import { bibNeedsCheckpoints, loadBibExtras } from "@/modules/registrations/bib-extras";
import { BIB_IMAGE_SCALE, BIB_LAYOUT, BIB_MARGIN, BIB_TEXT_ASCENT } from "@/modules/registrations/bib-geometry";
import { bibExtrasBlock, renderBibImage } from "@/modules/registrations/bib-image";
import { type BibProfileDrawing, bibProfileDrawing } from "@/modules/registrations/bib-profile";
import { bibProfileRow } from "@/modules/registrations/bib-profile-row";
import { bibProfileStrip, thinBibCheckpoints } from "@/modules/registrations/bib-profile-strip";
import { renderBibSheet } from "@/modules/registrations/bibs-pdf";
import { elevationGeometry, glyphForKinds, pathOf } from "@/modules/routes/elevation/geometry";
import { clearElevationCache } from "@/modules/routes/elevation/read";
import { parseGpxElevation } from "@/modules/routes/elevation/parse";
import { drawnRuns } from "../../helpers/pdf-drawn";
import { elevationGpx } from "../../helpers/elevation-gpx";

/**
 * §757 (amending §750) and §NNN, BR-REQ-011-01 — the route's checkpoints on the bib's profile strip, which the shared elevation
 * core lays out for both renderers: which checkpoints the strip pins (the ones the club left ticked «Arată pe profilul traseului»,
 * within the printed distance) and what each says («km 5 · apă», «km 9 · hrană», «km 12 · 11:30»), the crowding rule (the times
 * go first, all of them), the pins that would touch, and the two renderers drawing the same points. The sheet through what pdfkit
 * is asked to draw, the picture through its markup.
 */

const words: BibCheckpointWords = {
  km: (km) => `km ${km}`,
  kmWater: (km) => `km ${km} · apă`,
  kmFood: (km) => `km ${km} · hrană`,
  kmBoth: (km) => `km ${km} · apă + hrană`,
  kmTime: (km, clock) => `km ${km} · ${clock}`,
};
const SAY = (key: string, values?: { km?: string; m?: string }) =>
  ({ start: "Start", finish: "Sosire", kmUnit: "km", altitudeUnit: "m", distance: `Distanță: ${values?.km} km`, gain: `Diferență de nivel: +${values?.m} m` })[key] as string;

const PROFILE = parseGpxElevation(elevationGpx())!;
const BASE: BibProfileDrawing = bibProfileDrawing(PROFILE, {}, "ro", SAY);
const at = (km: number, cutoffClock: string | null = null, kinds: readonly string[] = [], onProfile?: boolean): BibCheckpointSource => ({ km, cutoffClock, kinds, onProfile });
const drawingOf = (sources: BibCheckpointSource[], base: BibProfileDrawing = BASE): BibProfileDrawing => ({ ...base, checkpoints: bibStripCheckpoints(sources, base.distanceMeters, words) });
const STRIP = { chartWidth: BIB_LAYOUT.profileChartWidth, showScale: true, showCheckpoints: true, showTimes: false };
const design = (overrides: Partial<BibDesign>): BibDesign => ({ ...DEFAULT_BIB_DESIGN, showProfile: true, ...overrides });

afterEach(() => vi.restoreAllMocks());

describe("§757 which checkpoints the strip pins, and what each says", () => {
  it("keeps the ones within the printed distance, by distance, ties in the order they came", () => {
    const rows = bibStripCheckpoints([at(15), at(5), at(5, null, ["WATER"]), at(30), at(-1)], 21_100, words);
    expect(rows.map((row) => row.km)).toEqual([5, 5, 15]);
    expect(rows[0].kinds).toEqual([]);
    expect(rows[1].kinds).toEqual(["WATER"]);
    // A point exactly at the finish is on the strip, whatever floating point says of 21.1 × 1000.
    expect(bibStripCheckpoints([at(21.1)], 21_100, words)).toHaveLength(1);
    expect(bibStripCheckpoints([at(5)], 0, words)).toEqual([]);
  });

  it("leaves out the points the club unticked «Arată pe profilul traseului»: one meaning on the page and on the number", () => {
    const rows = bibStripCheckpoints([at(3, null, ["WATER"], false), at(5, null, ["FOOD"], true), at(7, null, ["WATER"])], 9_000, words);
    expect(rows.map((row) => row.km)).toEqual([5, 7]);
  });

  it("names an aid station — «km 5 · apă», «km 9 · hrană», both — and any other point by its kilometre only", () => {
    const [water, food, both, firstAid, nothing, direction] = bibStripCheckpoints(
      [at(1, null, ["WATER"]), at(2, null, ["FOOD"]), at(3, null, ["WATER", "FOOD"]), at(4, null, ["FIRST_AID"]), at(5), at(6, null, ["DIRECTION"])],
      9_000,
      words,
    );
    expect(water.label).toBe("km 1 · apă");
    expect(food.label).toBe("km 2 · hrană");
    expect(both.label).toBe("km 3 · apă + hrană");
    expect([firstAid.label, nothing.label, direction.label]).toEqual(["km 4", "km 5", "km 6"]);
    for (const row of [water, food, both, firstAid, nothing, direction]) expect(row.kmLabel).toMatch(/^km \d$/);
  });

  it("carries the cut-off beside the kilometre — «km 12 · 11:30» — only for a point that has one", () => {
    const [timed, plain] = bibStripCheckpoints([at(5, "09:45", ["WATER"]), at(7)], 9_000, words);
    expect(timed.timeLabel).toBe("km 5 · 09:45");
    expect(plain.timeLabel).toBeNull();
  });

  it("gives a point the core's glyph for its kinds: a drop, a fork, a cross, a stopwatch, an arrow, a dot", () => {
    expect(glyphForKinds(["WATER", "FOOD"])).toBe("water");
    expect(glyphForKinds(["FOOD"])).toBe("food");
    expect(glyphForKinds(["FIRST_AID"])).toBe("firstAid");
    expect(glyphForKinds(["TIMING"])).toBe("timing");
    expect(glyphForKinds(["DIRECTION"])).toBe("direction");
    expect(glyphForKinds([])).toBe("none");
  });
});

describe("§NNN the strip's geometry comes from the elevation core", () => {
  it("asks the core once for the strip's own box, with the words, the pins and the options the bib needs", () => {
    spy.geometry.mockClear();
    const drawing = drawingOf([at(3, null, ["WATER"])]);
    const strip = bibProfileStrip(drawing, STRIP);
    expect(spy.geometry).toHaveBeenCalledTimes(1);
    const [profile, markers, options] = spy.geometry.mock.calls[0];
    expect(profile).toBe(PROFILE);
    expect(markers).toEqual([{ km: 3, kinds: ["WATER"], label: "km 3 · apă" }]);
    expect(options).toMatchObject({
      width: BIB_LAYOUT.profileChartWidth,
      height: BIB_LAYOUT.profileHeight,
      textSize: BIB_LAYOUT.profileLabelSize,
      minGap: BIB_LAYOUT.checkpointTimeGap,
      distanceMeters: drawing.distanceMeters,
      endWords: { start: "Start", finish: "Sosire" },
      pinRadius: BIB_LAYOUT.profilePinRadius,
      kmUnit: "km",
      extremes: true,
      clearExtremes: true,
    });
    expect(options.format.altitude(608)).toBe("608 m");
    expect(options.format.km(3)).toBe("3");
    // What is drawn is that answer, not a second layout of the strip's own.
    const direct = elevationGeometry(PROFILE, markers, options);
    expect(strip.geometry.line).toEqual(direct.line);
    expect(strip.geometry.area).toEqual(direct.area);
    expect(strip.geometry.markers).toEqual(direct.markers);
    expect(strip.geometry.kmTicks).toEqual(direct.kmTicks);
  });

  it("draws the line as one point per profile point, spanning the strip's whole width and ending at its own height", () => {
    const strip = bibProfileStrip(BASE, STRIP);
    expect(strip.geometry.line).toHaveLength(PROFILE.points.length);
    expect(strip.geometry.line[0][0]).toBe(0);
    expect(strip.geometry.line[strip.geometry.line.length - 1][0]).toBe(BIB_LAYOUT.profileChartWidth);
    for (const [x, y] of [...strip.geometry.line, ...strip.geometry.area]) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(BIB_LAYOUT.profileChartWidth);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(BIB_LAYOUT.profileHeight);
    }
  });

  it("spans the printed distance — the club's own figure first — so a checkpoint's kilometre and the strip's end agree", () => {
    const typed = bibProfileDrawing(PROFILE, { distanceMeters: 10_000 }, "ro", SAY);
    const strip = bibProfileStrip(drawingOf([at(5, null, ["WATER"])], typed), STRIP);
    expect(strip.geometry.distanceMeters).toBe(10_000);
    expect(strip.geometry.markers[0].x).toBeCloseTo(BIB_LAYOUT.profileChartWidth / 2, 1);
  });

  it("is the whole strip's width with the figures off", () => {
    const wide = bibProfileStrip(BASE, { ...STRIP, chartWidth: 523.28 });
    expect(wide.geometry.width).toBe(523.28);
    expect(wide.geometry.line[wide.geometry.line.length - 1][0]).toBe(523.28);
  });
});

describe("§NNN the kilometres and the altitudes on the strip", () => {
  it("draws ticks and numbers at the foot, the unit once after the last number, and the highest altitude above the line", () => {
    const strip = bibProfileStrip(BASE, STRIP);
    const g = strip.geometry;
    expect(strip.scale).toBe(true);
    expect(g.kmTicks.map((tick) => tick.km)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(g.kmLabels.length).toBeGreaterThan(2);
    expect(g.kmUnit?.text).toBe("km");
    const max = g.extremes.find((extreme) => extreme.kind === "max")!;
    expect(max.label.text).toMatch(/^8\d\d m$/);
    expect(max.label.y).toBeLessThan(max.y);
    expect(strip.texts.map((text) => text.text)).toEqual(expect.arrayContaining(["Start", "Sosire", "km", max.label.text]));
  });

  it("lets the end words win over the kilometres: no number stands over «Start» or «Sosire»", () => {
    const g = bibProfileStrip(BASE, STRIP).geometry;
    const width = (text: string) => text.length * BIB_LAYOUT.profileLabelSize * 0.6;
    const start = g.endWords!.start;
    const finish = g.endWords!.finish;
    for (const label of g.kmLabels) {
      const from = label.anchor === "start" ? label.x : label.x - width(label.text) / 2;
      const to = from + width(label.text);
      expect(from >= start.x + width(start.text) + BIB_LAYOUT.checkpointTimeGap || to <= start.x).toBe(true);
      expect(to <= finish.x - width(finish.text) - BIB_LAYOUT.checkpointTimeGap || from >= finish.x).toBe(true);
    }
  });

  it("lets the checkpoints' words win over the kilometres too", () => {
    const g = bibProfileStrip(drawingOf([at(3, null, ["WATER"]), at(6, null, ["FOOD"])]), STRIP).geometry;
    const width = (text: string) => text.length * BIB_LAYOUT.profileLabelSize * 0.6;
    const boxes = g.markers.map((marker) => ({ from: marker.label!.x - width(marker.label!.text) / 2, to: marker.label!.x + width(marker.label!.text) / 2 }));
    expect(g.markers.every((marker) => marker.label !== null)).toBe(true);
    for (const label of g.kmLabels) {
      const from = label.x - width(label.text) / 2;
      const to = label.x + width(label.text) / 2;
      for (const box of boxes) expect(to + BIB_LAYOUT.checkpointTimeGap <= box.from || from >= box.to + BIB_LAYOUT.checkpointTimeGap).toBe(true);
    }
  });

  it("draws neither ticks, numbers, unit, foot rule nor altitudes with the tick off, and keeps «Start», «Sosire» and the pins", () => {
    const strip = bibProfileStrip(drawingOf([at(3, null, ["WATER"])]), { ...STRIP, showScale: false });
    expect(strip.scale).toBe(false);
    expect(strip.geometry.kmTicks).toEqual([]);
    expect(strip.geometry.kmLabels).toEqual([]);
    expect(strip.geometry.kmUnit).toBeNull();
    expect(strip.geometry.extremes).toEqual([]);
    expect(strip.texts.map((text) => text.text)).toEqual(["Start", "Sosire", "km 3 · apă"]);
    expect(strip.geometry.markers).toHaveLength(1);
  });

  it("says only the highest altitude when the route climbs a few metres", () => {
    const flat = parseGpxElevation(elevationGpx({ low: 600, high: 604 }))!;
    const strip = bibProfileStrip(bibProfileDrawing(flat, {}, "ro", SAY), STRIP);
    expect(strip.geometry.extremes.map((extreme) => extreme.kind)).toEqual(["max"]);
  });

  it("keeps the lowest altitude's label off the end words, the checkpoints' words and the kilometres", () => {
    // 608 m at the start, under «Start» (and at the finish, under «Sosire»: the sample is a loop): printed beside the word, not over it.
    const strip = bibProfileStrip(BASE, STRIP);
    expect(strip.geometry.extremes.map((extreme) => extreme.kind)).toEqual(["max", "min"]);
    const low = strip.geometry.extremes.find((extreme) => extreme.kind === "min")!;
    const start = strip.geometry.endWords!.start;
    expect(low.label.text).toBe("608 m");
    expect(low.label.anchor).toBe("start");
    expect(low.label.y).toBe(start.y);
    expect(low.label.x).toBeGreaterThanOrEqual(start.x + start.text.length * BIB_LAYOUT.profileLabelSize * 0.6 + BIB_LAYOUT.checkpointTimeGap);
    expect(strip.texts.map((text) => text.text)).toContain("608 m");
    // A route that bottoms out in the middle gets its «m» label in the foot row, and no kilometre stands over it.
    const valley = parseGpxElevation(elevationGpx().replace(/<ele>([\d.]+)<\/ele>/g, (_, value: string) => `<ele>${(1400 - Number(value)).toFixed(1)}</ele>`))!;
    const g = bibProfileStrip(bibProfileDrawing(valley, {}, "ro", SAY), STRIP).geometry;
    const min = g.extremes.find((extreme) => extreme.kind === "min");
    expect(min).toBeDefined();
    const width = (text: string) => text.length * BIB_LAYOUT.profileLabelSize * 0.6;
    const [from, to] = [min!.label.x - width(min!.label.text) / 2, min!.label.x + width(min!.label.text) / 2];
    for (const label of g.kmLabels) {
      const f = label.x - width(label.text) / 2;
      expect(f + width(label.text) + BIB_LAYOUT.checkpointTimeGap <= from || f >= to + BIB_LAYOUT.checkpointTimeGap).toBe(true);
    }
  });

  it("moves the highest altitude beside a pin it would cover, never over a head or a stem", () => {
    // The summit is the middle of the route: a pin there would sit right under its label.
    const strip = bibProfileStrip(drawingOf([at(4.5, null, ["WATER"])]), STRIP);
    const max = strip.geometry.extremes.find((extreme) => extreme.kind === "max");
    const head = strip.geometry.markers[0].headX;
    // Moved, not dropped: the label is still there, standing against the pin's side.
    expect(max).toBeDefined();
    expect(max!.label.anchor).not.toBe("middle");
    const w = max!.label.text.length * BIB_LAYOUT.profileLabelSize * 0.6;
    const [from, to] = max!.label.anchor === "start" ? [max!.label.x, max!.label.x + w] : max!.label.anchor === "end" ? [max!.label.x - w, max!.label.x] : [max!.label.x - w / 2, max!.label.x + w / 2];
    expect(to <= head - strip.geometry.pinRadius || from >= head + strip.geometry.pinRadius).toBe(true);
    expect(strip.texts.map((text) => text.text)).toContain(max!.label.text);
  });
});

describe("§757 the words under the pins, and the crowding rule", () => {
  it("says «km 5 · apă» with the cut-offs off, and «km 5 · 09:45» with them on, for the same point", () => {
    const sources = [at(3, "09:45", ["WATER"]), at(6, "10:30", ["FOOD"]), at(8)];
    const off = bibProfileStrip(drawingOf(sources), STRIP);
    expect(off.timesShown).toBe(false);
    expect(off.geometry.markers.map((marker) => marker.label?.text)).toEqual(["km 3 · apă", "km 6 · hrană", "km 8"]);
    const on = bibProfileStrip(drawingOf(sources), { ...STRIP, showTimes: true });
    expect(on.timesShown).toBe(true);
    expect(on.geometry.markers.map((marker) => marker.label?.text)).toEqual(["km 3 · 09:45", "km 6 · 10:30", "km 8"]);
  });

  it("has no times while no point has a cut-off, even with the tick", () => {
    const strip = bibProfileStrip(drawingOf([at(3, null, ["WATER"]), at(6, null, ["FOOD"])]), { ...STRIP, showTimes: true });
    expect(strip.timesShown).toBe(false);
    expect(strip.geometry.markers.map((marker) => marker.label?.text)).toEqual(["km 3 · apă", "km 6 · hrană"]);
  });

  it("drops every time, not one, when one label with its time has no room — and keeps the words that fit", () => {
    // 3.0 and 3.8 km: 34 points apart; «km 3 · 09:45» is about 47 wide, «km 3 · apă» about 39 and «km 3» about 16.
    const sources = [at(3, "09:45", ["WATER"]), at(3.8, "09:55", ["TIMING"]), at(7, "11:00", ["FOOD"])];
    const strip = bibProfileStrip(drawingOf(sources), { ...STRIP, showTimes: true });
    expect(strip.timesShown).toBe(false);
    expect(strip.geometry.markers).toHaveLength(3);
    expect(strip.geometry.markers.every((marker) => marker.label === null || !marker.label.text.includes(":"))).toBe(true);
    expect(strip.geometry.markers.map((marker) => marker.label?.text ?? null)).toEqual(["km 3 · apă", null, "km 7 · hrană"]);
  });

  it("never prints a label over «Start» or «Sosire»", () => {
    const strip = bibProfileStrip(drawingOf([at(0, "09:00", ["WATER"]), at(4.5, "10:00"), at(9, "12:00", ["FOOD"])]), { ...STRIP, showTimes: true });
    expect(strip.timesShown).toBe(false);
    expect(strip.geometry.markers.map((marker) => marker.label?.text ?? null)).toEqual([null, "km 4.5", null]);
  });

  it("keeps every label clear of the next and of the end words, whatever the crowd", () => {
    const width = (text: string) => text.length * BIB_LAYOUT.profileLabelSize * 0.6;
    for (const count of [3, 8, 12, 30]) {
      const sources = Array.from({ length: count }, (_, i) => at(Math.round((0.5 + (i * 8) / (count - 1)) * 100) / 100, "10:00", i % 2 ? ["WATER"] : []));
      for (const showTimes of [false, true]) {
        const strip = bibProfileStrip(drawingOf(sources), { ...STRIP, showTimes });
        const boxes = strip.geometry.markers
          .filter((marker) => marker.label)
          .map((marker) => ({ from: marker.label!.x - width(marker.label!.text) / 2, to: marker.label!.x + width(marker.label!.text) / 2 }))
          .sort((a, b) => a.from - b.from);
        const startEnd = strip.geometry.endWords!.start.x + width("Start");
        const finishFrom = strip.geometry.endWords!.finish.x - width("Sosire");
        boxes.forEach((box, i) => {
          expect(box.from).toBeGreaterThanOrEqual(startEnd - 0.01);
          expect(box.to).toBeLessThanOrEqual(finishFrom + 0.01);
          if (i > 0) expect(box.from - boxes[i - 1].to).toBeGreaterThanOrEqual(BIB_LAYOUT.checkpointTimeGap - 0.01);
        });
      }
    }
  });
});

describe("§757 the pins stand side by side, never over one another", () => {
  const point = (km: number, kinds: string[]) => ({ km, kinds, label: "km", bothLabel: "km both", kmLabel: "km", timeLabel: null });
  const radius = BIB_LAYOUT.profilePinRadius;

  it("keeps the aid station when two pins would touch, whichever comes first", () => {
    const close = 0.5 * ((radius * 2 + radius * 0.5) / BIB_LAYOUT.profileChartWidth) * 9;
    const timingFirst = thinBibCheckpoints([point(5, ["TIMING"]), point(5 + close, ["WATER"])], BIB_LAYOUT.profileChartWidth, 9_000, radius);
    expect(timingFirst.map((row) => row.kinds)).toEqual([["WATER"]]);
    const waterFirst = thinBibCheckpoints([point(5, ["WATER"]), point(5 + close, ["TIMING"])], BIB_LAYOUT.profileChartWidth, 9_000, radius);
    expect(waterFirst.map((row) => row.kinds)).toEqual([["WATER"]]);
    expect(thinBibCheckpoints([point(5, ["TIMING"]), point(5 + close, ["DIRECTION"])], BIB_LAYOUT.profileChartWidth, 9_000, radius)).toHaveLength(1);
  });

  it("says both when a water station and a food station are too close to pin apart, in either order — «km 4 · apă + hrană», the drop", () => {
    const sources = (first: string, second: string) => [at(4, null, [first]), at(4.1, null, [second])];
    for (const [first, second] of [["WATER", "FOOD"], ["FOOD", "WATER"]]) {
      const strip = bibProfileStrip(drawingOf(sources(first, second)), STRIP);
      expect(strip.geometry.markers).toHaveLength(1);
      expect(strip.checkpoints).toHaveLength(1);
      expect(strip.checkpoints[0].kinds).toEqual([first, second]);
      expect(strip.texts.map((text) => text.text)).toContain("km 4 · apă + hrană");
      expect(strip.geometry.markers[0].glyph).toBe("water");
    }
    // Two of the same kind stay what they are; an aid station and a plain point stay the aid station's words.
    expect(bibProfileStrip(drawingOf([at(4, null, ["WATER"]), at(4.1, null, ["WATER"])]), STRIP).texts.map((text) => text.text)).toContain("km 4 · apă");
    expect(bibProfileStrip(drawingOf([at(4, null, ["FOOD"]), at(4.1, null, ["TIMING"])]), STRIP).texts.map((text) => text.text)).toContain("km 4 · hrană");
  });

  it("keeps pins that stand a head's reach apart, and the heads of what is drawn never touch", () => {
    const dense = Array.from({ length: 200 }, (_, i) => at((i * 9) / 199, null, i % 3 ? [] : ["WATER"]));
    const strip = bibProfileStrip(drawingOf(dense), STRIP);
    expect(strip.geometry.markers.length).toBeLessThan(200);
    const heads = strip.geometry.markers.map((marker) => marker.headX).sort((a, b) => a - b);
    for (let i = 1; i < heads.length; i++) expect(heads[i] - heads[i - 1]).toBeGreaterThanOrEqual(radius * 2 + radius * 0.5 - 0.01);
    expect(strip.geometry.pinRows).toBe(1);
  });

  it("measures the reach in the chart's own width: a strip without figures keeps pins a narrow one drops", () => {
    const close = [point(50, ["WATER"]), point(52, ["FOOD"])];
    expect(thinBibCheckpoints(close, 380, 100_000, radius)).toHaveLength(1);
    expect(thinBibCheckpoints(close, 523.28, 100_000, radius)).toHaveLength(2);
  });
});

describe("§NNN the unticked checkpoint is not on the strip", () => {
  it("is absent from the markers and the words, though it stays in the checkpoints the event has", () => {
    const sources = [at(3, "09:45", ["WATER"], false), at(6, "10:30", ["FOOD"], true)];
    const strip = bibProfileStrip(drawingOf(sources), { ...STRIP, showTimes: true });
    expect(strip.geometry.markers).toHaveLength(1);
    expect(strip.geometry.markers[0].glyph).toBe("food");
    expect(strip.texts.map((text) => text.text).join(" ")).not.toContain("km 3 ");
  });
});

// ---------------------------------------------------------------------------------------------
// The two renderers draw the strip's one geometry
// ---------------------------------------------------------------------------------------------

const SHEET = { eventTitle: "Crosul de toamnă", eventDate: "21 noiembrie 2026", generatedAt: new Date("2026-10-10T12:00:00Z"), replyTo: "club@example.test" };
const SOURCES = [at(2.4, "10:20", ["WATER"]), at(5.1, "10:55", ["FOOD"]), at(7.2, "11:30", ["WATER"])];

type Call = { name: string; args: unknown[] };
/** What the sheet asks pdfkit to draw: its paths, circles and texts, in the order drawn. */
async function sheetCalls(drawing: BibProfileDrawing, overrides: Partial<BibDesign> = {}) {
  const calls: Call[] = [];
  for (const name of ["moveTo", "lineTo", "circle", "path", "translate"] as const) {
    const original = PDFDocument.prototype[name] as (...a: unknown[]) => PDFKit.PDFDocument;
    vi.spyOn(PDFDocument.prototype, name as "moveTo").mockImplementation(function (this: PDFKit.PDFDocument, ...args: unknown[]) {
      calls.push({ name, args });
      return original.apply(this, args);
    } as never);
  }
  const runs = await drawnRuns(() => renderBibSheet({ ...SHEET, rows: [{ bibNumber: 101, registeredName: "Alergător Unu" }], design: design(overrides), profile: drawing }));
  vi.restoreAllMocks();
  return { calls, runs };
}

/** The markup the picture is drawn from, as plain data: every element with its props. */
function imageNodes(drawing: BibProfileDrawing, overrides: Partial<BibDesign> = {}) {
  const row = bibProfileRow(design(overrides), { profile: drawing, profileFigures: null }, false)!;
  const element = bibExtrasBlock({ row, picture: null, emergency: null, turn: { block: false, profile: false, phone: false }, ink: "#000001" }) as ReactElement;
  const tree = JSON.parse(JSON.stringify(element, (key, value) => (key === "_owner" || key === "_store" ? undefined : value)));
  const nodes: Array<{ type: string; props: Record<string, any> }> = []; // eslint-disable-line @typescript-eslint/no-explicit-any
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === "object") {
      const item = node as { type?: string; props?: { children?: unknown } };
      if (item.type) nodes.push(item as never);
      walk(item.props?.children);
    }
  };
  walk(tree);
  return { row, nodes };
}

/** The width of a run in the sheet's regular type, as pdfkit measures it. */
async function widthOf(text: string): Promise<number> {
  const { readFile } = await import("node:fs/promises");
  const path = await import("node:path");
  const doc = new PDFDocument({ autoFirstPage: false });
  doc.registerFont("body", await readFile(path.join(process.cwd(), "src", "theme", "pdf", "Roboto-Regular.ttf")));
  return doc.font("body").fontSize(BIB_LAYOUT.profileLabelSize).widthOfString(text);
}

describe("§NNN the sheet and the picture draw the same points", () => {
  for (const showTimes of [false, true]) {
    it(`puts every text, pin and point of the strip at the same place in both — cut-offs ${showTimes ? "on" : "off"}`, async () => {
      const drawing = drawingOf(SOURCES);
      const overrides = { showCheckpointTimes: showTimes };
      const { row, nodes } = imageNodes(drawing, overrides);
      expect(row.kind).toBe("gpx");
      if (row.kind !== "gpx") return;
      const strip = row.strip;
      const g = strip.geometry;
      expect(strip.timesShown).toBe(showTimes);
      const { calls, runs } = await sheetCalls(drawing, overrides);
      const size = BIB_LAYOUT.profileLabelSize;
      const chartLeft = BIB_MARGIN + BIB_LAYOUT.inset;

      // The row's top on the paper, found from «Start»'s own place: its top is the baseline less the ascent.
      const start = runs.find((run) => run.text === "Start")!;
      const rowTop = start.y! - (g.endWords!.start.y - BIB_TEXT_ASCENT * size);

      // Every text: the sheet's run and the picture's box agree with the geometry — and with one another.
      const texts = nodes.filter((node) => node.props["data-testid"] === "bib-profile-text");
      expect(texts).toHaveLength(strip.texts.length);
      for (const [index, text] of strip.texts.entries()) {
        const box = texts[index].props;
        expect(box.children).toBe(text.text);
        const width = await widthOf(text.text);
        const run = runs.find((candidate) => candidate.text === text.text && Math.abs(candidate.y! - (rowTop + text.baseline - BIB_TEXT_ASCENT * size)) < 0.01);
        expect(run, `the sheet draws «${text.text}»`).toBeDefined();
        const sheetX = (run!.x! - chartLeft) + (text.anchor === "start" ? 0 : text.anchor === "end" ? width : width / 2);
        expect(sheetX).toBeCloseTo(text.x, 3);
        // The picture's box: its top is the same baseline less the ascent; its left is the anchor's box edge.
        expect(box.style.top / BIB_IMAGE_SCALE).toBeCloseTo(text.baseline - BIB_TEXT_ASCENT * size, 3);
        expect(run!.y! - rowTop).toBeCloseTo(box.style.top / BIB_IMAGE_SCALE, 3);
        const boxWidth = box.style.width / BIB_IMAGE_SCALE;
        const imageX = box.style.left / BIB_IMAGE_SCALE - BIB_LAYOUT.inset + (text.anchor === "start" ? 0 : text.anchor === "end" ? boxWidth : boxWidth / 2);
        expect(imageX).toBeCloseTo(text.x, 3);
      }

      // The line and the area: the picture's path data is the geometry's, the sheet's points are the same, offset by the row.
      const paths = nodes.filter((node) => node.type === "path");
      expect(paths[0].props.d).toBe(pathOf(g.area, true));
      expect(paths[1].props.d).toBe(pathOf(g.line));
      const drawn = calls.filter((call) => call.name === "moveTo" || call.name === "lineTo").map((call) => call.args as [number, number]);
      for (const [x, y] of g.line) {
        expect(drawn.some(([cx, cy]) => Math.abs(cx - (chartLeft + x)) < 0.01 && Math.abs(cy - (rowTop + y)) < 0.01)).toBe(true);
      }

      // The pins: the dot on the line and the ring's head, at the geometry's points in both.
      const circles = calls.filter((call) => call.name === "circle").map((call) => call.args as [number, number, number]);
      const svgCircles = nodes.filter((node) => node.type === "circle").map((node) => node.props);
      expect(g.markers).toHaveLength(SOURCES.length);
      for (const marker of g.markers) {
        const dot = [marker.x, marker.y, BIB_LAYOUT.checkpointDot];
        const head = [marker.headX, marker.headY, g.pinRadius];
        for (const [cx, cy, r] of [dot, head]) {
          expect(circles.some(([x, y, radius]) => Math.abs(x - (chartLeft + cx)) < 0.01 && Math.abs(y - (rowTop + cy)) < 0.01 && Math.abs(radius - r) < 0.01)).toBe(true);
          expect(svgCircles.some((props) => Math.abs(props.cx - cx) < 0.01 && Math.abs(props.cy - cy) < 0.01 && Math.abs(props.r - r) < 0.01)).toBe(true);
        }
      }
      // The glyphs are the core's: one path each, the drop for water and the fork for food.
      expect(nodes.filter((node) => node.props["data-testid"] === "bib-checkpoint-mark").map((node) => node.props["data-glyph"])).toEqual(["water", "food", "water"]);
      expect(calls.filter((call) => call.name === "path")).toHaveLength(SOURCES.length);
    });
  }

  it("leaves the picture's SVG room for the ring of a pin at km 0 and at the printed distance, so it is not clipped", () => {
    const L = BIB_LAYOUT;
    const { nodes, row } = imageNodes(drawingOf([at(0, null, ["WATER"]), at(9, null, ["FOOD"])]), {});
    expect(row.kind).toBe("gpx");
    if (row.kind !== "gpx") return;
    const rings = row.strip.geometry.markers.map((marker) => marker.headX);
    expect(rings).toEqual([0, row.strip.geometry.width]);
    const svg = nodes.find((node) => node.type === "svg" && typeof node.props.viewBox === "string");
    expect(svg).toBeDefined();
    const [left, , width] = (svg!.props.viewBox as string).split(" ").map(Number);
    const reach = L.profilePinRadius + L.profilePinWeight / 2;
    expect(-left).toBeGreaterThanOrEqual(reach);
    expect(left + width).toBeGreaterThanOrEqual(row.strip.geometry.width + reach);
  });

  it("draws no ticks, scale or altitudes in either with the tick off", async () => {
    const drawing = drawingOf(SOURCES);
    const { nodes, row } = imageNodes(drawing, { showProfileScale: false });
    const { runs } = await sheetCalls(drawing, { showProfileScale: false });
    expect(nodes.some((node) => node.props["data-testid"] === "bib-profile-scale")).toBe(false);
    if (row.kind === "gpx") expect(row.strip.texts.map((text) => text.text)).toEqual(["Start", "Sosire", ...SOURCES.map((s) => `km ${s.km} · ${s.kinds[0] === "WATER" ? "apă" : "hrană"}`)]);
    expect(runs.some((run) => run.text === "km")).toBe(false);
  });

  it("is a different picture with the scale than without, and with the pins than without", async () => {
    const draw = (drawing: BibProfileDrawing, overrides: Partial<BibDesign>) =>
      renderBibImage({ bibNumber: 101, registeredName: "A", ...SHEET, bandColour: null, design: design(overrides), profile: drawing }).then(async (response) => Buffer.from(await response.arrayBuffer()));
    const withScale = await draw(BASE, {});
    expect(withScale.equals(await draw(BASE, { showProfileScale: false }))).toBe(false);
    expect((await draw(drawingOf(SOURCES), {})).equals(withScale)).toBe(false);
    expect((await draw({ ...BASE, checkpoints: [] }, {})).equals(withScale)).toBe(true);
  });
});

describe("§757 the extras read the checkpoints only where the design asks", () => {
  beforeEach(() => {
    clearElevationCache();
    stored.get.mockReset();
    stored.get.mockResolvedValue(new TextEncoder().encode(elevationGpx()));
  });

  const event = { routeGpx: { key: "route/a.gpx" } as never, distanceMeters: 9000, elevationGainMeters: null, checkpoints: [at(3, "09:45", ["WATER"]), at(6, null, ["TIMING"])] };
  const ticks = { showProfile: true, showEmergency: false, showDistance: false } as const;

  it("puts the checkpoints on the strip by the printed distance, in the sheet's words — an aid station by name", async () => {
    const extras = await loadBibExtras(event, { ...ticks, showCheckpoints: true }, "ro");
    const rows = extras.profile?.checkpoints ?? [];
    expect(rows.map((row) => row.km)).toEqual([3, 6]);
    expect(rows.map((row) => row.label)).toEqual(["km 3 · apă", "km 6"]);
    expect(rows.map((row) => row.kmLabel)).toEqual(["km 3", "km 6"]);
    expect(extras.profile?.kmUnit).toBe("km");
    expect(extras.profile?.altitudeUnit).toBe("m");
    expect(extras.profile?.distanceMeters).toBe(9000);
  });

  it("adds the clock each limit closes at as the time label — the clock the event page prints (§770)", async () => {
    const extras = await loadBibExtras(event, { ...ticks, showCheckpoints: true, showCheckpointTimes: true }, "ro");
    expect(extras.profile?.checkpoints?.map((row) => row.timeLabel)).toEqual(["km 3 · 09:45", null]);
  });

  it("leaves out a checkpoint the club unticked «Arată pe profilul traseului»", async () => {
    const extras = await loadBibExtras({ ...event, checkpoints: [at(3, null, ["WATER"], false), at(6, null, ["FOOD"], true)] }, { ...ticks, showCheckpoints: true }, "ro");
    expect(extras.profile?.checkpoints?.map((row) => row.km)).toEqual([6]);
  });

  it("puts none when the tick is off, with no checkpoints, or without the profile", async () => {
    const off = await loadBibExtras(event, { ...ticks, showCheckpoints: false }, "ro");
    expect(off.profile?.checkpoints ?? []).toEqual([]);
    const none = await loadBibExtras({ ...event, checkpoints: [] }, { ...ticks, showCheckpoints: true }, "ro");
    expect(none.profile?.checkpoints ?? []).toEqual([]);
    const noProfile = await loadBibExtras(event, { ...ticks, showProfile: false, showCheckpoints: true }, "ro");
    expect(noProfile.profile).toBeNull();
  });

  it("reads the first tick as on when the design says nothing: the default", async () => {
    const extras = await loadBibExtras(event, ticks, "ro");
    expect(extras.profile?.checkpoints).toHaveLength(2);
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

describe("§NNN «Kilometrii și altitudinile pe profil»: the design's tick", () => {
  it("is on by default and for every design saved before the key", () => {
    expect(DEFAULT_BIB_DESIGN.showProfileScale).toBe(true);
    expect(bibDesignSchema.parse({}).showProfileScale).toBe(true);
    expect(bibDesignSchema.parse({ showProfile: true, showCheckpoints: false }).showProfileScale).toBe(true);
    expect(bibDesignSchema.parse({ showProfileScale: false }).showProfileScale).toBe(false);
    expect(bibDesignSchema.parse({ showProfileScale: "yes" }).showProfileScale).toBe(true);
  });

  it("round-trips through the design's JSON: what is stored reads back, on and off", () => {
    for (const value of [true, false]) {
      const stored = JSON.parse(JSON.stringify({ ...DEFAULT_BIB_DESIGN, showProfileScale: value }));
      expect(bibDesignSchema.parse(stored).showProfileScale).toBe(value);
    }
  });

  it("is read by the row: absent or true draws the scale, false does not", () => {
    const extras = { profile: BASE, profileFigures: null };
    const scaleOf = (overrides: Partial<BibDesign>) => {
      const row = bibProfileRow(design(overrides), extras, false);
      return row?.kind === "gpx" ? row.strip.scale : null;
    };
    expect(scaleOf({})).toBe(true);
    expect(scaleOf({ showProfileScale: false })).toBe(false);
    // A picture of the profile has no strip to draw it on.
    expect(bibProfileRow(design({ profileSource: "picture" }), extras, true)).toMatchObject({ kind: "picture" });
  });
});
