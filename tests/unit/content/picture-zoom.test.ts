import { describe, expect, it } from "vitest";
import {
  IDENTITY,
  isDoubleTap,
  isTap,
  MAX_SCALE,
  pan,
  pinch,
  toggleZoom,
  wheelZoom,
  zoomAbout,
  zoomTransform,
} from "@/modules/content/rich-text/ui/picture-zoom";

/**
 * BR-REQ-041-01, `DECISIONS.md` §NNN — the large preview's own pinch-zoom. The owner, 2026-10-01:
 * «Și să pot face zoom pinch pe poze». The arithmetic the dialog's Pointer Events call, proven
 * without a browser.
 */

const SIZE = { width: 400, height: 800 };

describe("§NNN two fingers zoom about their midpoint, within 1–4", () => {
  it("doubles the scale when two fingers 100 px apart move to 200 px, the midpoint staying put", () => {
    const zoom = pinch(IDENTITY, [{ x: 150, y: 400 }, { x: 250, y: 400 }], [{ x: 100, y: 400 }, { x: 300, y: 400 }], SIZE);
    expect(zoom.scale).toBe(2);
    // The picture's point under the midpoint (200, 400) is still under it: 200 = x + 200 · 2.
    expect(zoom.x + 200 * zoom.scale).toBe(200);
    expect(zoom.y + 400 * zoom.scale).toBe(400);
  });

  it("stops at 4 and at 1", () => {
    const out = pinch(IDENTITY, [{ x: 190, y: 400 }, { x: 210, y: 400 }], [{ x: 0, y: 400 }, { x: 400, y: 400 }], SIZE);
    expect(out.scale).toBe(MAX_SCALE);
    const back = pinch({ scale: 2, x: -200, y: -400 }, [{ x: 0, y: 400 }, { x: 400, y: 400 }], [{ x: 199, y: 400 }, { x: 201, y: 400 }], SIZE);
    expect(back).toEqual({ scale: 1, x: 0, y: 0 });
    expect(zoomAbout(IDENTITY, 10, { x: 0, y: 0 }, SIZE).scale).toBe(4);
  });

  it("zooms around the cursor on a trackpad's pinch (a wheel with ctrlKey)", () => {
    const zoom = wheelZoom(IDENTITY, -100 * Math.log(2), { x: 100, y: 100 }, SIZE);
    expect(zoom.scale).toBeCloseTo(2);
    expect(zoom.x + 100 * zoom.scale).toBeCloseTo(100);
    expect(zoom.y + 100 * zoom.scale).toBeCloseTo(100);
  });
});

describe("§NNN one finger pans a zoomed picture, never out of the frame", () => {
  it("moves the picture by the finger's travel at 2×", () => {
    expect(pan({ scale: 2, x: -100, y: -100 }, { x: 50, y: 50 }, { x: 80, y: 20 }, SIZE)).toEqual({ scale: 2, x: -70, y: -130 });
  });

  it("clamps the pan to the bounds: the scaled picture keeps covering the frame", () => {
    expect(pan({ scale: 2, x: -100, y: -100 }, { x: 0, y: 0 }, { x: 900, y: 900 }, SIZE)).toEqual({ scale: 2, x: 0, y: 0 });
    expect(pan({ scale: 2, x: -100, y: -100 }, { x: 900, y: 900 }, { x: 0, y: 0 }, SIZE)).toEqual({ scale: 2, x: -400, y: -800 });
  });

  it("does not move the picture at its own size", () => {
    expect(pan(IDENTITY, { x: 0, y: 0 }, { x: 50, y: 50 }, SIZE)).toBe(IDENTITY);
  });
});

describe("§NNN a double tap toggles 2× and back", () => {
  it("zooms to 2× about the tap, then back to 1×", () => {
    const zoomed = toggleZoom(IDENTITY, { x: 100, y: 200 }, SIZE);
    expect(zoomed).toEqual({ scale: 2, x: -100, y: -200 });
    expect(toggleZoom(zoomed, { x: 100, y: 200 }, SIZE)).toEqual(IDENTITY);
  });

  it("counts a second tap within 300 ms and 24 px as a double tap", () => {
    const first = { x: 100, y: 100, time: 1000 };
    expect(isDoubleTap(first, { x: 110, y: 110, time: 1250 })).toBe(true);
    expect(isDoubleTap(first, { x: 100, y: 100, time: 1301 })).toBe(false);
    expect(isDoubleTap(first, { x: 130, y: 100, time: 1100 })).toBe(false);
  });

  it("is one CSS transform", () => {
    expect(zoomTransform({ scale: 2, x: -100, y: -200 })).toBe("translate(-100px, -200px) scale(2)");
  });
});

describe("§NNN only a tap closes the preview — a pinch's or a pan's end never does", () => {
  const down = { x: 100, y: 100, time: 1000 };

  it("is a tap within 300 ms and 10 px", () => {
    expect(isTap(down, { x: 106, y: 108, time: 1300 })).toBe(true);
  });

  it("is not a tap when the pointer travelled (a pan's end) or stayed down (a pinch's end)", () => {
    expect(isTap(down, { x: 100, y: 111, time: 1100 })).toBe(false);
    expect(isTap(down, { x: 100, y: 100, time: 1301 })).toBe(false);
  });
});
