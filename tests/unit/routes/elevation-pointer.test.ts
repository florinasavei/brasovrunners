import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import ElevationPointer from "@/modules/routes/elevation/ElevationPointer";
import { indexAtShare, nearestMarkerName, POINTER_MARKER_REACH_KM, readoutAt, shareAtX, stepIndex, xAtShare } from "@/modules/routes/elevation/pointer";

/**
 * §NNN — the elevation chart's pointer: the arithmetic behind «4,5 km · 712 m» (`routes/elevation/pointer.ts`) and what the
 * island (`ElevationPointer.tsx`) draws before anybody touches it.
 */
const SCALE = { plotLeft: 40, plotRight: 340, mirrored: false };
const POINTS = Array.from({ length: 101 }, (_, i) => [i * 90, 600 + i] as const);

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
  const render = () =>
    renderToStaticMarkup(
      createElement(
        ElevationPointer,
        {
          charts: [{ size: "narrow", viewWidth: 360, viewHeight: 240, plotLeft: 40, plotRight: 340, plotTop: 60, plotBottom: 200, altitudeMin: 590, altitudeMax: 840 }],
          points: POINTS,
          distanceMeters: 9000,
          markers: [{ km: 4.5, name: "Izvorul" }],
          locale: "ro",
          words: { readout: "{km} km · {altitude} m", readoutNamed: "{km} km · {altitude} m · {name}", hint: "Profilul traseului: săgețile." },
        },
        createElement("svg", { "data-size": "narrow" }),
      ),
    );

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
