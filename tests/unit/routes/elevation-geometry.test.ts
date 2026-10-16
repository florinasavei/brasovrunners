import { describe, expect, it } from "vitest";
import {
  altitudeAtShare,
  elevationGeometry,
  type ElevationGeometry,
  type ElevationMarkerInput,
  type ElevationOptions,
  glyphForKinds,
  kmStep,
  niceAltitudes,
  pathOf,
} from "@/modules/routes/elevation/geometry";
import { ELEVATION_GLYPH_PATHS } from "@/modules/routes/elevation/glyphs";
import { type ElevationProfileData } from "@/modules/routes/elevation/parse";

/**
 * §NNN (amending §718, §750, §757) — the elevation profile's geometry, `routes/elevation/geometry.ts`: where the line, the
 * scales, the labels and the checkpoints' pins stand in a box of any aspect, which the event page, the editor's preview and
 * the race number's strip all draw from.
 */

/** A route of `km` kilometres rising from `low` to `high` in a straight line, a hundred points. */
function ramp(km: number, low = 600, high = 800, count = 101): ElevationProfileData {
  const points = Array.from({ length: count }, (_, i) => [(km * 1000 * i) / (count - 1), low + ((high - low) * i) / (count - 1)] as const);
  return { points, distanceMeters: km * 1000, minAltitude: low, maxAltitude: high, gainMeters: high - low };
}

const FORMAT = { km: (km: number) => String(km), altitude: (m: number) => `${m}` };

/** The event page's wide chart: 1000 × 280, labels 19 units. */
const WIDE: ElevationOptions = {
  width: 1000,
  height: 280,
  inset: { top: 60, left: 46, right: 40, bottom: 32 },
  textSize: 19,
  minGap: 8,
  format: FORMAT,
  kmUnit: "km",
  altitudeTicks: 5,
};

/** A race number's strip: 380 × 38 points, no axis at the side, the words in the foot row. */
const STRIP: ElevationOptions = {
  width: 380,
  height: 38,
  inset: { top: 9, bottom: 9 },
  textSize: 6,
  minGap: 3,
  format: FORMAT,
  endWords: { start: "Start", finish: "Sosire" },
  pinRadius: 3,
};

const box = (g: ElevationGeometry) => ({ left: 0, right: g.width, top: 0, bottom: g.height });
const labelBox = (label: { x: number; text: string; anchor: string }, size: number) => {
  const w = label.text.length * size * 0.6;
  return label.anchor === "start" ? [label.x, label.x + w] : label.anchor === "end" ? [label.x - w, label.x] : [label.x - w / 2, label.x + w / 2];
};

describe("§NNN the kilometre scale", () => {
  it("steps by 1 km up to 12 km, 2 km up to 25 km and 5 km beyond", () => {
    expect(kmStep(9)).toBe(1);
    expect(kmStep(12)).toBe(1);
    expect(kmStep(12.01)).toBe(2);
    expect(kmStep(21.1)).toBe(2);
    expect(kmStep(25)).toBe(2);
    expect(kmStep(25.01)).toBe(5);
    expect(kmStep(42.2)).toBe(5);
  });

  it("puts a tick at every step from 0 and none past the end", () => {
    expect(elevationGeometry(ramp(9), [], WIDE).kmTicks.map((tick) => tick.km)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(elevationGeometry(ramp(21.1), [], WIDE).kmTicks.map((tick) => tick.km)).toEqual([0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20]);
    expect(elevationGeometry(ramp(42.2), [], WIDE).kmTicks.map((tick) => tick.km)).toEqual([0, 5, 10, 15, 20, 25, 30, 35, 40]);
    const ticks = elevationGeometry(ramp(9), [], WIDE).kmTicks;
    for (const tick of ticks) expect(tick.x).toBeCloseTo(46 + (tick.km / 9) * (1000 - 46 - 40), 1);
  });

  it("puts the unit after the last label kept, inside the box", () => {
    const g = elevationGeometry(ramp(9), [], WIDE);
    expect(g.kmLabels.map((label) => label.text)).toEqual(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]);
    const last = g.kmLabels[g.kmLabels.length - 1];
    expect(g.kmUnit).not.toBeNull();
    expect(g.kmUnit!.text).toBe("km");
    expect(g.kmUnit!.anchor).toBe("start");
    expect(g.kmUnit!.x).toBeGreaterThan(labelBox(last, 19)[1]);
    expect(labelBox(g.kmUnit!, 19)[1]).toBeLessThanOrEqual(1000);
  });

  it("drops the labels that would touch a kept one, keeps every tick, and leaves the end words alone", () => {
    // 42 km on a 380-point strip: the labels «0 5 10 …» cannot all stand, the end words are never touched.
    const g = elevationGeometry(ramp(42.2), [], STRIP);
    expect(g.kmTicks.length).toBe(9);
    expect(g.kmLabels.length).toBeLessThan(g.kmTicks.length);
    expect(g.endWords).not.toBeNull();
    const boxes = [...g.kmLabels, g.endWords!.start, g.endWords!.finish].map((label) => labelBox(label, 6)).sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < boxes.length; i++) expect(boxes[i][0] - boxes[i - 1][1]).toBeGreaterThanOrEqual(3 - 1e-9);
    for (const [from, to] of boxes) {
      expect(from).toBeGreaterThanOrEqual(0);
      expect(to).toBeLessThanOrEqual(380);
    }
  });

  it("has no kilometre scale when the caller does not want one", () => {
    const g = elevationGeometry(ramp(9), [], { ...WIDE, kmScale: false });
    expect(g.kmTicks).toEqual([]);
    expect(g.kmLabels).toEqual([]);
    expect(g.kmUnit).toBeNull();
  });

  it("spans the distance the caller says, stretching the profile to it", () => {
    // The club typed 10 km for a track of 9: the last tick is 10 km, and the line ends at the plot's right edge.
    const g = elevationGeometry(ramp(9), [], { ...WIDE, distanceMeters: 10_000 });
    expect(g.kmTicks[g.kmTicks.length - 1].km).toBe(10);
    expect(g.line[g.line.length - 1][0]).toBeCloseTo(g.plot.right, 1);
  });
});

describe("§NNN the altitude scale", () => {
  it("picks round values in a step of 10, 25, 50, 100, 200 or 500 metres, at most as many as asked", () => {
    expect(niceAltitudes(595, 841, 4)).toEqual([600, 700, 800]);
    expect(niceAltitudes(595, 841, 5)).toEqual([600, 650, 700, 750, 800]);
    expect(niceAltitudes(0, 100, 5)).toEqual([0, 25, 50, 75, 100]);
    expect(niceAltitudes(0, 600, 4)).toEqual([0, 200, 400, 600]);
    expect(niceAltitudes(0, 2000, 5)).toEqual([0, 500, 1000, 1500, 2000]);
    expect(niceAltitudes(0, 2000, 4)).toEqual([0, 1000, 2000]);
    expect(niceAltitudes(1010, 1090, 3)).toEqual([1025, 1050, 1075]);
    expect(niceAltitudes(0, 100, 0)).toEqual([]);
  });

  it("gives each tick its y, its words and a grid line across the plot", () => {
    const g = elevationGeometry(ramp(9, 608, 828), [], { ...WIDE, altitudeTicks: 4 });
    expect(g.altitudeTicks.map((tick) => tick.altitude)).toEqual([600, 700, 800]);
    for (const tick of g.altitudeTicks) {
      expect(tick.label.text).toBe(String(tick.altitude));
      expect(tick.label.anchor).toBe("end");
      expect(tick.label.x).toBeLessThan(g.plot.left);
      expect(tick.gridFrom).toBe(g.plot.left);
      expect(tick.gridTo).toBe(g.plot.right);
      expect(tick.y).toBeGreaterThanOrEqual(g.plot.top);
      expect(tick.y).toBeLessThanOrEqual(g.plot.bottom);
    }
    // Higher altitudes stand higher on the plot.
    const ys = g.altitudeTicks.map((tick) => tick.y);
    expect([...ys].sort((a, b) => b - a)).toEqual(ys);
  });

  it("has none unless asked, and fewer when the plot is too short for the words", () => {
    expect(elevationGeometry(ramp(9), [], { ...WIDE, altitudeTicks: 0 }).altitudeTicks).toEqual([]);
    const squat = elevationGeometry(ramp(9, 0, 1000), [], { ...WIDE, height: 100, inset: { top: 10, bottom: 10, left: 46, right: 40 }, altitudeTicks: 9 });
    expect(squat.altitudeTicks.length).toBeLessThan(9);
    const ys = squat.altitudeTicks.map((tick) => tick.y);
    for (let i = 1; i < ys.length; i++) expect(ys[i - 1] - ys[i]).toBeGreaterThanOrEqual(19 * 1.5 - 1e-6);
  });

  it("draws a route that climbs a few metres flat, in a range of at least 20 m, not stretched to the box", () => {
    const g = elevationGeometry(ramp(9, 300, 305), [], WIDE);
    expect(g.altitude.max - g.altitude.min).toBeCloseTo(20, 5);
    const ys = g.line.map((point) => point[1]);
    const rise = Math.max(...ys) - Math.min(...ys);
    expect(rise).toBeLessThan((g.plot.bottom - g.plot.top) * 0.3);
    // A range that wide is centred on the route.
    expect((g.altitude.min + g.altitude.max) / 2).toBeCloseTo(302.5, 5);
  });

  it("puts the highest point at the top of the range and the lowest at its foot, with a little room", () => {
    const g = elevationGeometry(ramp(9, 600, 800), [], WIDE);
    const ys = g.line.map((point) => point[1]);
    expect(Math.min(...ys)).toBeGreaterThan(g.plot.top);
    expect(Math.max(...ys)).toBeLessThan(g.plot.bottom);
    expect(g.altitude.min).toBeLessThan(600);
    expect(g.altitude.max).toBeGreaterThan(800);
  });
});

describe("§NNN the extremes", () => {
  it("labels the highest and the lowest point where they are, inside the box", () => {
    const g = elevationGeometry(ramp(9, 600, 800), [], { ...STRIP, extremes: true });
    expect(g.extremes.map((extreme) => extreme.kind)).toEqual(["max", "min"]);
    const [max, min] = g.extremes;
    expect(max.label.text).toBe("800");
    expect(min.label.text).toBe("600");
    // The ramp's top is at its right end and its foot at its left: the words are anchored to stay in the box.
    expect(max.x).toBeCloseTo(g.plot.right, 1);
    expect(min.x).toBeCloseTo(g.plot.left, 1);
    for (const extreme of g.extremes) {
      const [from, to] = labelBox(extreme.label, 6);
      expect(from).toBeGreaterThanOrEqual(0);
      expect(to).toBeLessThanOrEqual(380);
      expect(extreme.label.y).toBeGreaterThan(0);
      expect(extreme.label.y).toBeLessThanOrEqual(38);
    }
    expect(max.label.anchor).toBe("end");
    expect(min.label.anchor).toBe("start");
  });

  it("labels only the highest when the two are within the few-metres limit", () => {
    expect(elevationGeometry(ramp(9, 600, 610), [], { ...STRIP, extremes: true }).extremes.map((e) => e.kind)).toEqual(["max"]);
    expect(elevationGeometry(ramp(9, 600, 620), [], { ...STRIP, extremes: true }).extremes.map((e) => e.kind)).toEqual(["max", "min"]);
    expect(elevationGeometry(ramp(9, 600, 650), [], { ...STRIP, extremes: true, minAltitudeGapMeters: 100 }).extremes.map((e) => e.kind)).toEqual(["max"]);
  });

  it("draws none unless asked", () => {
    expect(elevationGeometry(ramp(9), [], STRIP).extremes).toEqual([]);
  });
});

describe("§NNN the extremes keep the foot row clear (`clearExtremes`, the race number's strip)", () => {
  /** A route that falls to its lowest point at 5 km of 9 and rises again: the lowest label stands in the foot row at that kilometre. */
  function valley(count = 91): ElevationProfileData {
    const points = Array.from({ length: count }, (_, i) => {
      const share = i / (count - 1);
      return [9000 * share, 600 + 200 * Math.abs(share - 5 / 9) * (share < 5 / 9 ? 1.8 : 2.25)] as const;
    });
    const altitudes = points.map((point) => point[1]);
    return { points, distanceMeters: 9000, minAltitude: Math.min(...altitudes), maxAltitude: Math.max(...altitudes), gainMeters: 100 };
  }
  const wide = (g: ElevationGeometry, label: { x: number; text: string; anchor: string }) => labelBox(label, 6);
  const touches = (a: number[], b: number[], gap: number) => a[0] < b[1] + gap && a[1] > b[0] - gap;

  it("is off by default: the lowest label is where its point is, whatever stands there", () => {
    const g = elevationGeometry(valley(), [], { ...STRIP, extremes: true });
    const min = g.extremes.find((extreme) => extreme.kind === "min")!;
    expect(min).toBeDefined();
    // The kilometre «5» stands at the same place, over it: nothing kept them apart.
    expect(g.kmLabels.some((label) => touches(wide(g, label), wide(g, min.label), 0))).toBe(true);
  });

  it("keeps the lowest label and lets the kilometres give way to it", () => {
    const g = elevationGeometry(valley(), [], { ...STRIP, extremes: true, clearExtremes: true });
    const min = g.extremes.find((extreme) => extreme.kind === "min")!;
    expect(min).toBeDefined();
    expect(min.label.y).toBeGreaterThan(g.plot.bottom);
    expect(g.kmLabels.length).toBeGreaterThan(0);
    for (const label of g.kmLabels) expect(touches(wide(g, label), wide(g, min.label), STRIP.minGap)).toBe(false);
    // The ticks stay: only the words went.
    expect(g.kmTicks).toHaveLength(10);
  });

  it("drops the lowest label where it would touch an end word or a marker's words, and the highest above the line stays", () => {
    // The ramp's lowest point is its start, under «Start».
    const ramp9 = elevationGeometry(ramp(9, 600, 800), [], { ...STRIP, extremes: true, clearExtremes: true });
    expect(ramp9.extremes.map((extreme) => extreme.kind)).toEqual(["max"]);
    // A marker's words at the lowest point win over it.
    const marked = elevationGeometry(valley(), [{ km: 5, kinds: ["WATER"], label: "km 5" }], { ...STRIP, extremes: true, clearExtremes: true });
    expect(marked.markers[0].label).not.toBeNull();
    expect(marked.extremes.map((extreme) => extreme.kind)).toEqual(["max"]);
  });

  it("changes nothing else: the line, the area, the pins and the ticks are the same with or without it", () => {
    const options = { ...STRIP, extremes: true };
    const markers: ElevationMarkerInput[] = [{ km: 2, kinds: ["FOOD"], label: "km 2" }];
    const plain = elevationGeometry(valley(), markers, options);
    const clear = elevationGeometry(valley(), markers, { ...options, clearExtremes: true });
    expect(clear.line).toEqual(plain.line);
    expect(clear.area).toEqual(plain.area);
    expect(clear.markers).toEqual(plain.markers);
    expect(clear.kmTicks).toEqual(plain.kmTicks);
  });
});

describe("§NNN the markers", () => {
  const point = (km: number, kinds: string[] = ["WATER"], label?: string): ElevationMarkerInput => ({ km, kinds, label });

  it("gives one marker per checkpoint handed in, on the line, in the order handed in", () => {
    const g = elevationGeometry(ramp(10, 600, 800), [point(5), point(2.5, ["FOOD"]), point(10, [])], WIDE);
    expect(g.markers).toHaveLength(3);
    expect(g.markers.map((marker) => marker.index)).toEqual([0, 1, 2]);
    // 5 km of 10 is half way along the plot, and half way up a ramp.
    expect(g.markers[0].x).toBeCloseTo((g.plot.left + g.plot.right) / 2, 1);
    expect(g.markers[0].y).toBeCloseTo((g.plot.top + g.plot.bottom) / 2, 0);
    expect(g.markers[2].x).toBeCloseTo(g.plot.right, 1);
  });

  it("chooses the glyph by kind: water, then food, first aid, timing, direction, else none", () => {
    expect(glyphForKinds(["WATER", "FOOD"])).toBe("water");
    expect(glyphForKinds(["FOOD"])).toBe("food");
    expect(glyphForKinds(["TIMING", "FIRST_AID"])).toBe("firstAid");
    expect(glyphForKinds(["DIRECTION", "TIMING"])).toBe("timing");
    expect(glyphForKinds(["DIRECTION"])).toBe("direction");
    expect(glyphForKinds([])).toBe("none");
    expect(glyphForKinds(["TELEPORT"])).toBe("none");
    for (const glyph of ["water", "food", "firstAid", "timing", "direction", "none"] as const) expect(ELEVATION_GLYPH_PATHS[glyph]).toMatch(/^M/);
  });

  it("keeps a pin in the band above the plot, at the first row, when no two touch", () => {
    const g = elevationGeometry(ramp(10), [point(2), point(8)], WIDE);
    expect(g.pinRows).toBe(1);
    for (const marker of g.markers) {
      expect(marker.raised).toBe(0);
      expect(marker.headY + g.pinRadius).toBeLessThanOrEqual(g.plot.top);
      expect(marker.headY - g.pinRadius).toBeGreaterThanOrEqual(0);
    }
  });

  it("raises a pin to the next row up when two would touch, and never drops one", () => {
    // Three points within a pin's width of each other, one far away.
    const g = elevationGeometry(ramp(10), [point(5), point(5.1, ["FOOD"]), point(5.2, []), point(9)], { ...WIDE, inset: { top: 100, left: 46, right: 40, bottom: 32 } });
    expect(g.markers).toHaveLength(4);
    expect(g.markers.map((marker) => marker.raised)).toEqual([0, 1, 2, 0]);
    expect(g.pinRows).toBe(3);
    // The higher the row the higher the head.
    expect(g.markers[1].headY).toBeLessThan(g.markers[0].headY);
    expect(g.markers[2].headY).toBeLessThan(g.markers[1].headY);
    // Two heads in one row never overlap.
    const byRow = new Map<number, number[]>();
    for (const marker of g.markers) byRow.set(marker.raised, [...(byRow.get(marker.raised) ?? []), marker.headX]);
    for (const xs of byRow.values()) {
      xs.sort((a, b) => a - b);
      for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeGreaterThanOrEqual(g.pinRadius * 2);
    }
  });

  it("keeps every pin when the band has only so many rows: the last row is shared, none is dropped", () => {
    const tight = elevationGeometry(ramp(10), [point(5), point(5.01), point(5.02), point(5.03)], { ...WIDE, inset: { top: 20, left: 46, right: 40, bottom: 32 } });
    expect(tight.markers).toHaveLength(4);
    expect(tight.pinRows).toBe(1);
    for (const marker of tight.markers) expect(marker.headY - tight.pinRadius).toBeGreaterThanOrEqual(0);
  });

  it("clamps a checkpoint beyond the route to its end instead of dropping it", () => {
    const g = elevationGeometry(ramp(10), [point(12), point(-1)], WIDE);
    expect(g.markers[0].x).toBeCloseTo(g.plot.right, 1);
    expect(g.markers[1].x).toBeCloseTo(g.plot.left, 1);
  });

  it("prints a label in the foot row where there is room and drops it, never the pin, where it would touch", () => {
    const g = elevationGeometry(ramp(10), [point(2, ["WATER"], "km 2"), point(2.1, ["FOOD"], "km 2,1"), point(7, ["WATER"], "km 7")], { ...WIDE, kmScale: false });
    expect(g.markers.map((marker) => marker.label?.text ?? null)).toEqual(["km 2", null, "km 7"]);
    expect(g.markers).toHaveLength(3);
    const first = g.markers[0].label!;
    expect(first.anchor).toBe("middle");
    expect(first.x).toBeCloseTo(g.markers[0].x, 1);
  });

  it("lets a marker's label take the place of a kilometre label, the markers first", () => {
    const g = elevationGeometry(ramp(10), [point(5, ["WATER"], "km 5,2")], WIDE);
    expect(g.markers[0].label?.text).toBe("km 5,2");
    const kept = g.kmLabels.map((label) => label.text);
    expect(kept).not.toContain("5");
    expect(kept).toContain("0");
  });

  it("drops a label that would touch an end word, and keeps the marker", () => {
    const g = elevationGeometry(ramp(10), [point(0.1, ["WATER"], "km 0,1"), point(9.9, ["WATER"], "km 9,9")], STRIP);
    expect(g.markers.map((marker) => marker.label)).toEqual([null, null]);
    expect(g.markers).toHaveLength(2);
  });

  it("anchors a label that would leave the box to its end", () => {
    const g = elevationGeometry(ramp(10), [point(10, ["WATER"], "km 10,00")], { ...WIDE, kmScale: false, inset: { top: 60, left: 46, right: 4, bottom: 32 } });
    const label = g.markers[0].label!;
    expect(label.anchor).toBe("end");
    expect(label.x).toBeLessThanOrEqual(1000);
  });
});

describe("§NNN the compact mode", () => {
  it("drops the marker labels and keeps the pins, keeps at most two altitude ticks and labels only the highest", () => {
    const markers: ElevationMarkerInput[] = [{ km: 3, kinds: ["WATER"], label: "km 3" }];
    const full = elevationGeometry(ramp(9), markers, { ...WIDE, kmScale: false, extremes: true, altitudeTicks: 5 });
    const compact = elevationGeometry(ramp(9), markers, { ...WIDE, kmScale: false, extremes: true, altitudeTicks: 5, compact: true });
    expect(full.markers[0].label).not.toBeNull();
    expect(compact.markers).toHaveLength(1);
    expect(compact.markers[0].label).toBeNull();
    expect(compact.markers[0].glyph).toBe("water");
    expect(full.altitudeTicks.length).toBeGreaterThan(2);
    expect(compact.altitudeTicks.length).toBeLessThanOrEqual(2);
    expect(full.extremes).toHaveLength(2);
    expect(compact.extremes.map((extreme) => extreme.kind)).toEqual(["max"]);
  });
});

describe("§NNN the mirror", () => {
  it("flips every x across the box and the anchors with it, and nothing else", () => {
    const markers: ElevationMarkerInput[] = [{ km: 3, kinds: ["FOOD"], label: "km 3" }];
    const options: ElevationOptions = { ...WIDE, extremes: true, endWords: { start: "Start", finish: "Sosire" } };
    const normal = elevationGeometry(ramp(9, 600, 800), markers, options);
    const mirrored = elevationGeometry(ramp(9, 600, 800), markers, { ...options, orientation: "mirrored" });
    expect(mirrored.orientation).toBe("mirrored");
    expect(mirrored.plot).toEqual({ left: 1000 - normal.plot.right, right: 1000 - normal.plot.left, top: normal.plot.top, bottom: normal.plot.bottom });
    mirrored.line.forEach(([x, y], i) => {
      expect(x).toBeCloseTo(1000 - normal.line[i][0], 1);
      expect(y).toBe(normal.line[i][1]);
    });
    expect(mirrored.markers[0].x).toBeCloseTo(1000 - normal.markers[0].x, 1);
    expect(mirrored.markers[0].headX).toBeCloseTo(1000 - normal.markers[0].headX, 1);
    expect(mirrored.markers[0].y).toBe(normal.markers[0].y);
    expect(mirrored.kmTicks.map((tick) => tick.x)).toEqual(normal.kmTicks.map((tick) => Math.round((1000 - tick.x) * 100) / 100));
    // The start word is at the right now, anchored to its end; the finish at the left.
    expect(normal.endWords!.start).toMatchObject({ text: "Start", anchor: "start" });
    expect(mirrored.endWords!.start).toMatchObject({ text: "Start", anchor: "end" });
    expect(mirrored.endWords!.start.x).toBeCloseTo(1000 - normal.endWords!.start.x, 1);
    expect(mirrored.endWords!.finish).toMatchObject({ text: "Sosire", anchor: "start" });
    // The altitude words go to the other side of the plot.
    expect(normal.altitudeTicks[0].label.anchor).toBe("end");
    expect(mirrored.altitudeTicks[0].label.anchor).toBe("start");
    expect(mirrored.altitudeTicks[0].label.x).toBeGreaterThan(mirrored.plot.right);
    // The same things are said in the same places: the same texts, the same altitudes.
    expect(mirrored.altitudeTicks.map((tick) => tick.label.text)).toEqual(normal.altitudeTicks.map((tick) => tick.label.text));
    expect(mirrored.kmLabels.map((label) => label.text)).toEqual(normal.kmLabels.map((label) => label.text));
  });

  it("puts the unit on the far side of the last label when mirrored", () => {
    const g = elevationGeometry(ramp(9), [], { ...WIDE, orientation: "mirrored" });
    expect(g.kmUnit).not.toBeNull();
    expect(g.kmUnit!.anchor).toBe("end");
    const lowest = g.kmLabels.reduce((a, b) => (b.x < a.x ? b : a));
    expect(g.kmUnit!.x).toBeLessThan(labelBox(lowest, 19)[0]);
  });
});

describe("§NNN the line and the area", () => {
  it("hands them over as point arrays, one per profile point, inside the plot, the area closed under the line", () => {
    const profile = ramp(9);
    const g = elevationGeometry(profile, [], WIDE);
    expect(g.line).toHaveLength(profile.points.length);
    for (const [x, y] of g.line) {
      expect(x).toBeGreaterThanOrEqual(g.plot.left - 0.01);
      expect(x).toBeLessThanOrEqual(g.plot.right + 0.01);
      expect(y).toBeGreaterThanOrEqual(g.plot.top);
      expect(y).toBeLessThanOrEqual(g.plot.bottom);
    }
    expect(g.area).toHaveLength(g.line.length + 2);
    expect(g.area.slice(0, g.line.length)).toEqual(g.line);
    expect(g.area[g.area.length - 2]).toEqual([g.line[g.line.length - 1][0], g.plot.bottom]);
    expect(g.area[g.area.length - 1]).toEqual([g.line[0][0], g.plot.bottom]);
  });

  it("stays in the box whatever its aspect and size", () => {
    for (const [width, height] of [[380, 38], [360, 240], [1000, 280], [400, 170], [90, 300]] as const) {
      const g = elevationGeometry(ramp(21.1), [{ km: 10, kinds: ["WATER"], label: "km 10" }], {
        width,
        height,
        inset: { top: height * 0.25, bottom: height * 0.2, left: width * 0.08, right: width * 0.08 },
        textSize: Math.max(4, height / 14),
        minGap: 3,
        format: FORMAT,
        endWords: { start: "Start", finish: "Sosire" },
        extremes: true,
        altitudeTicks: 3,
        kmUnit: "km",
      });
      const edges = box(g);
      for (const [x, y] of [...g.line, ...g.area]) {
        expect(x).toBeGreaterThanOrEqual(edges.left);
        expect(x).toBeLessThanOrEqual(edges.right);
        expect(y).toBeGreaterThanOrEqual(edges.top);
        expect(y).toBeLessThanOrEqual(edges.bottom);
      }
      for (const marker of g.markers) {
        expect(marker.headX).toBeGreaterThanOrEqual(edges.left);
        expect(marker.headX).toBeLessThanOrEqual(edges.right);
        expect(marker.headY).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("reads the altitude at a share of the route by linear interpolation", () => {
    const profile = ramp(10, 600, 800);
    expect(altitudeAtShare(profile, 0)).toBe(600);
    expect(altitudeAtShare(profile, 0.5)).toBeCloseTo(700, 5);
    expect(altitudeAtShare(profile, 1)).toBe(800);
    expect(altitudeAtShare(profile, 2)).toBe(800);
    expect(altitudeAtShare(profile, -1)).toBe(600);
  });

  it("writes a path for an SVG from the points, closed on demand", () => {
    expect(pathOf([[0, 1], [2.555, 3]])).toBe("M0 1 L2.56 3");
    expect(pathOf([[0, 1], [2, 3], [4, 5]], true)).toBe("M0 1 L2 3 L4 5 Z");
  });
});
