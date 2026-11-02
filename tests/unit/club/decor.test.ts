import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * BR-REQ-101-01 (§885): the mountains drawing is the club's, in `club/decor.json`, and Brașov's is the drawing that
 * was written in `MountainMark.tsx` — the same two ridges, the same markup. A club with no mountains draws none.
 */

/** The two ridges as `MountainMark.tsx` wrote them on origin/qa, and the mark's markup at 96 pixels. */
const FAR = "M6 48 38 17l12 10 23-22 18 18 12-6 17 12v19Z";
const NEAR = "M0 48 22 26l8 6 18-20 12 14 8-6 18 18 8-6 26 16Z";
const MARK_96 = `<svg viewBox="0 0 120 48" width="96" height="38" fill="currentColor" focusable="false" style="display:block;flex-shrink:0" aria-hidden="true" data-testid="mountain-mark"><path d="${FAR}" opacity="0.55"></path><path d="${NEAR}"></path></svg>`;

/** A canvas that records what is filled, and at what alpha. */
function recordingContext() {
  const filled: { alpha: number; path: string }[] = [];
  const ctx = { globalAlpha: 1, fill: (path: { d: string }) => filled.push({ alpha: ctx.globalAlpha, path: path.d }) };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, filled };
}

class FakePath2D {
  constructor(readonly d: string) {}
}

afterEach(() => {
  vi.doUnmock("@club/decor.json");
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("BR-REQ-101-01: the mountains are the club's drawing (§885)", () => {
  it("draws Brașov's two ridges in the box they were drawn in, far then near", async () => {
    const { MOUNTAINS } = await import("@/club/decor");
    expect(MOUNTAINS).toEqual({ width: 120, height: 48, layers: [{ depth: "far", d: FAR }, { depth: "near", d: NEAR }] });
  });

  it("renders the mark's markup exactly as before", async () => {
    const { default: MountainMark } = await import("@/shared/ui/MountainMark");
    expect(renderToStaticMarkup(createElement(MountainMark, { width: 96 }))).toBe(MARK_96);
  });

  it("fills each ridge at its depth's alpha on a canvas, far first", async () => {
    vi.stubGlobal("Path2D", FakePath2D);
    const { fillMountains } = await import("@/club/decor");
    const { ctx, filled } = recordingContext();
    fillMountains(ctx, 0.6, 0.9);
    expect(filled).toEqual([
      { alpha: 0.6, path: FAR },
      { alpha: 0.9, path: NEAR },
    ]);
  });

  it("with empty layers, draws nothing: no mark on the page and no fill on the canvas", async () => {
    vi.doMock("@club/decor.json", () => ({ default: { mountains: { width: 120, height: 48, layers: [] } } }));
    vi.stubGlobal("Path2D", FakePath2D);
    const { fillMountains } = await import("@/club/decor");
    const { default: MountainMark } = await import("@/shared/ui/MountainMark");
    expect(renderToStaticMarkup(createElement(MountainMark, { width: 96, title: "Munții" }))).toBe("");
    const { ctx, filled } = recordingContext();
    fillMountains(ctx, 0.6, 0.9);
    expect(filled).toEqual([]);
  });
});
