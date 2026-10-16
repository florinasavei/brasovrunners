import { renderToStaticMarkup } from "react-dom/server";
import { type ComponentProps, createElement } from "react";
import { describe, expect, it } from "vitest";
import ElevationPointer from "@/modules/routes/elevation/ElevationPointer";
import { fill, indexAtShare, nearestMarkerName, POINTER_MARKER_REACH_KM, READOUT_GAP, readoutAt, readoutLeft, shareAtX, stepIndex, xAtShare } from "@/modules/routes/elevation/pointer";

/**
 * §NNN — the elevation chart's pointer: the arithmetic behind «4,5 km · 712 m» (`routes/elevation/pointer.ts`) and what the
 * island (`ElevationPointer.tsx`) draws before anybody touches it.
 */
const SCALE = { plotLeft: 40, plotRight: 340, mirrored: false };
const POINTS = Array.from({ length: 101 }, (_, i) => [i * 90, 600 + i] as const);

describe("§NNN where the pointer's readout stands", () => {
  // The page's inner width at a 320 px phone, and the readouts the owner's own route gives: «3,8 km · 805 m · Punct izvor» is about 190 px wide.
  const HOST = 288;
  const inside = (left: number, width: number) => left >= 0 && left + width <= HOST;

  it("stands beside the line, to its right in the first half and to its left in the second, when it fits", () => {
    expect(readoutLeft(40, 100, HOST)).toBe(40 + READOUT_GAP);
    expect(readoutLeft(250, 100, HOST)).toBe(250 - READOUT_GAP - 100);
  });

  it("never leaves the wrapper, whatever the width and the place of the line — a name must not widen the page nor lose its first words", () => {
    for (const width of [60, 150, 190, 203, 260, 288]) {
      for (let line = 0; line <= HOST; line += 4) expect(inside(readoutLeft(line, width, HOST), width)).toBe(true);
    }
  });

  it("takes the side that fits when the preferred one does not: a long readout at 3,8 km goes to the left of its line, not off the screen", () => {
    // The line at 150 px (the first half): to its right 158 + 190 would reach 348 > 288, so it stands on the left (150 − 8 − 190 < 0 does not fit either → clamped to 0).
    expect(readoutLeft(150, 190, HOST)).toBe(0);
    // Narrower: fits on the left of a line past the middle only.
    expect(readoutLeft(200, 150, HOST)).toBe(200 - READOUT_GAP - 150);
    expect(readoutLeft(120, 190, HOST)).toBe(HOST - 190);
  });

  it("starts at 0 for a readout as wide as, or wider than, the wrapper (the caller lets it wrap)", () => {
    expect(readoutLeft(100, HOST, HOST)).toBe(0);
    expect(readoutLeft(100, HOST + 40, HOST)).toBe(0);
  });

  it("fills a template's placeholders and leaves one it was not handed as written", () => {
    expect(fill("{km} km · {altitude} m", { km: "4,5", altitude: "827" })).toBe("4,5 km · 827 m");
    expect(fill("{km} · {name}", { km: "4,5" })).toBe("4,5 · {name}");
  });
});

describe("§NNN the pointer's arithmetic", () => {
  it("turns a position on the chart into a share of the route, clamped to the plot", () => {
    expect(shareAtX(SCALE, 40)).toBe(0);
    expect(shareAtX(SCALE, 190)).toBe(0.5);
    expect(shareAtX(SCALE, 340)).toBe(1);
    expect(shareAtX(SCALE, 0)).toBe(0);
    expect(shareAtX(SCALE, 999)).toBe(1);
    expect(shareAtX({ ...SCALE, mirrored: true }, 40)).toBe(1);
    expect(shareAtX({ plotLeft: 10, plotRight: 10, mirrored: false }, 10)).toBe(0);
  });

  it("is the inverse of xAtShare", () => {
    for (const mirrored of [false, true]) for (const share of [0, 0.25, 0.6, 1]) expect(shareAtX({ ...SCALE, mirrored }, xAtShare({ ...SCALE, mirrored }, share))).toBeCloseTo(share, 10);
  });

  it("picks the nearest of the evenly spaced points", () => {
    expect(indexAtShare(101, 0)).toBe(0);
    expect(indexAtShare(101, 0.5)).toBe(50);
    expect(indexAtShare(101, 0.504)).toBe(50);
    expect(indexAtShare(101, 0.506)).toBe(51);
    expect(indexAtShare(101, 1)).toBe(100);
    expect(indexAtShare(101, 2)).toBe(100);
    expect(indexAtShare(101, -1)).toBe(0);
  });

  it("reads the kilometre on the plot's distance and the altitude there", () => {
    // The points run to 9 000 m; the club typed 10 000 m: the half-way point is 5 km, not 4.5.
    expect(readoutAt({ points: POINTS, distanceMeters: 10_000 }, 50)).toEqual({ index: 50, share: 0.5, km: 5, altitude: 650 });
    expect(readoutAt({ points: POINTS, distanceMeters: 9_000 }, 50).km).toBe(4.5);
    expect(readoutAt({ points: POINTS, distanceMeters: 9_000 }, 500).index).toBe(100);
    expect(readoutAt({ points: POINTS, distanceMeters: 9_000 }, -5).index).toBe(0);
  });

  it("moves a hundredth of the route a key, a tenth a page key, to the ends with home and end, and ignores other keys", () => {
    expect(stepIndex(50, 101, "ArrowRight")).toBe(51);
    expect(stepIndex(50, 101, "ArrowLeft")).toBe(49);
    expect(stepIndex(50, 101, "PageUp")).toBe(60);
    expect(stepIndex(50, 101, "PageDown")).toBe(40);
    expect(stepIndex(50, 101, "Home")).toBe(0);
    expect(stepIndex(50, 101, "End")).toBe(100);
    expect(stepIndex(100, 101, "ArrowRight")).toBe(100);
    expect(stepIndex(0, 101, "ArrowLeft")).toBe(0);
    // A long profile steps a hundredth: 400 points, four at a time.
    expect(stepIndex(10, 400, "ArrowRight")).toBe(14);
    expect(stepIndex(10, 101, "Tab")).toBeNull();
    expect(stepIndex(10, 101, "a")).toBeNull();
  });

  it("names the checkpoint within two hundred metres of the pointer, the nearest of two, and none farther", () => {
    const markers = [
      { km: 3.8, name: "Cabana" },
      { km: 4.5, name: "Izvorul" },
      { km: 6.2, name: "Vârful" },
    ];
    expect(POINTER_MARKER_REACH_KM).toBe(0.2);
    expect(nearestMarkerName(markers, 4.4)).toBe("Izvorul");
    expect(nearestMarkerName(markers, 4.3)).toBe("Izvorul");
    expect(nearestMarkerName(markers, 4.29)).toBeNull();
    expect(nearestMarkerName(markers, 3.7)).toBe("Cabana");
    expect(nearestMarkerName([{ km: 5, name: "A" }, { km: 5.1, name: "B" }], 5.08)).toBe("B");
    expect(nearestMarkerName(markers, 0)).toBeNull();
    expect(nearestMarkerName([], 1)).toBeNull();
  });
});

describe("§NNN the pointer island before any event", () => {
  const props: ComponentProps<typeof ElevationPointer> = {
    charts: [{ size: "narrow", viewWidth: 360, viewHeight: 240, plotLeft: 40, plotRight: 340, plotTop: 60, plotBottom: 200, altitudeMin: 590, altitudeMax: 840 }],
    points: POINTS,
    distanceMeters: 9000,
    markers: [{ km: 4.5, name: "Izvorul" }],
    locale: "ro",
    words: { readout: "{km} km · {altitude} m", readoutNamed: "{km} km · {altitude} m · {name}", hint: "Profilul traseului: săgețile." },
    children: createElement("svg", { "data-size": "narrow" }),
  };
  const render = () => renderToStaticMarkup(createElement(ElevationPointer, props));

  it("draws nothing of its own: the static chart stands, with a tab stop and a polite, empty readout", () => {
    const html = render();
    expect(html).toContain("<svg");
    expect(html).toContain('role="group"');
    expect(html).toContain('aria-label="Profilul traseului: săgețile."');
    expect(html).toContain('tabindex="0"');
    expect(html).not.toContain("elevation-pointer-line");
    expect(html).not.toContain("elevation-pointer-readout");
    expect(html).toMatch(/role="status"[^>]*aria-live="polite"[^>]*><\/div>|aria-live="polite"[^>]*role="status"[^>]*><\/div>/);
  });

  it("lets a vertical swipe scroll the page while a horizontal one moves the line", () => {
    expect(render()).toMatch(/touch-action:\s*pan-y|touch-action:pan-y/);
  });
});
