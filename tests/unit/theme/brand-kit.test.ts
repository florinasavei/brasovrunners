import { readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { clubConfig } from "../../../scripts/brand-assets-lock.mjs";
import {
  KIT_DIR,
  KIT_MARGIN,
  KIT_PNG_WIDTH,
  KIT_WIDTH_MM,
  inPixels,
  kitColours,
  kitFileName,
  kitSvg,
  measureLogo,
  paddedFrame,
  parseLogoSvg,
  pathBounds,
} from "../../../scripts/brand-kit.mjs";
import { parseKitSvg } from "@/modules/pr-kit/logo-vector";

/**
 * BR-REQ-101-01 (§885, §1015) — the «PR Kit»'s logo files are the club's lockup as `yarn brand:assets` measured and wrote it.
 *
 * - **Measured, never guessed**: the drawing's box comes from the path data itself — every segment's ends, every curve's and
 *   arc's turning points — under the group's translation; this club's lockup measures 73.04 → 2926.96 across and
 *   918.77 → 2081.23 down, where a raster at a unit a pixel read 73 → 2927 and 918 → 2082.
 * - **4 % of the drawing's width on every side**, and an explicit size, 200 mm wide, so no viewer clips the last letter.
 * - **The mountains' file holds the mountains' path alone**: the paths the mark's own frame (`club.json`'s `logo.mark.viewBox`)
 *   shows whole — here the first, the runners under it falling a unit outside.
 * - **Each committed file is exactly what the script writes** from today's source and palette, so a source or a colour changed
 *   without `yarn brand:assets` fails here, as the lock fails (`brand-assets-lock.test.ts`); the PNGs are 4000 pixels wide, on
 *   a transparent ground, in the ink's own colour.
 */
const ROOT = path.resolve(__dirname, "../../..");
const club = clubConfig(ROOT);
const sourceText = readFileSync(path.join(ROOT, "public/brand/logo.svg"), "utf8");
const source = parseLogoSvg(sourceText);
const measured = measureLogo(source, club.logo.mark.viewBox);

const close = (actual: number[], expected: number[], digits = 2) => actual.forEach((value, index) => expect(value, `[${index}]`).toBeCloseTo(expected[index], digits));

describe("BR-REQ-101-01 §1015 the logo's drawing, measured from its path data", () => {
  it("measures lines, both Béziers, their smooth forms and arcs exactly, absolute or relative", () => {
    expect(pathBounds("M0 0 H10 V5 H0 Z")).toEqual([0, 0, 10, 5]);
    expect(pathBounds("m 2,3 l 4,0 0,4 -4,0 z")).toEqual([2, 3, 6, 7]);
    // A cubic that bulges past its end points: its top is three quarters of the way to the control points.
    close(pathBounds("M0 0 C0 10 10 10 10 0"), [0, 0, 10, 7.5], 9);
    close(pathBounds("M0 0 Q5 10 10 0"), [0, 0, 10, 5], 9);
    close(pathBounds("M0 0 C0 10 10 10 10 0 S20 -10 20 0"), [0, -7.5, 20, 7.5], 9);
    close(pathBounds("M0 0 Q5 10 10 0 T20 0"), [0, -5, 20, 5], 9);
    // A circle of radius 5 as two arcs, and an arc's flags glued to its numbers.
    close(pathBounds("M0 5 A5 5 0 1 0 10 5 A5 5 0 1 0 0 5"), [0, 0, 10, 10], 9);
    close(pathBounds("M0 5a5 5 0 1010 0a5 5 0 1 0-10 0"), [0, 0, 10, 10], 9);
    // A quarter arc sweeps only its quarter.
    close(pathBounds("M10 0 A10 10 0 0 1 20 10"), [10, 0, 20, 10], 9);
    expect(() => pathBounds("")).toThrow();
  });

  it("measures this club's lockup to the unit a raster saw, and its mountains as the first path alone", () => {
    expect(source.paths).toHaveLength(5);
    close(measured.lockup.drawing, [73.041, 918.77, 2926.959, 2081.23]);
    expect(measured.mountains.paths).toEqual([0]);
    close(measured.mountains.drawing, [74.85, 918.77, 2886.9, 1788.738]);
    // The runners' path starts a unit below the mark's frame (906 + 889 = 1795): the mark hides them, so the kit leaves them out.
    const [, markTop, , markHeight] = club.logo.mark.viewBox.split(/\s+/).map(Number);
    expect(measured.boxes[3][1]).toBeGreaterThan(markTop + markHeight);
  });

  it("frames each drawing 4 % of its width out on every side", () => {
    for (const shape of ["lockup", "mountains"] as const) {
      const [x0, y0, x1, y1] = measured[shape].drawing;
      const margin = (x1 - x0) * KIT_MARGIN;
      close(paddedFrame(measured[shape].drawing), [x0 - margin, y0 - margin, x1 - x0 + 2 * margin, y1 - y0 + 2 * margin], 9);
    }
  });
});

describe("BR-REQ-101-01 §1015 the kit's committed files", () => {
  for (const shape of ["lockup", "mountains"] as const) {
    for (const { key: ink, hex } of kitColours(club.palette)) {
      const svgName = kitFileName(club.slug, shape, ink, "svg");
      const pngName = kitFileName(club.slug, shape, ink, "png");
      const svg = readFileSync(path.join(ROOT, KIT_DIR, svgName), "utf8").replace(/\r\n/g, "\n");

      it(`${svgName} is what yarn brand:assets writes from today's lockup and palette`, () => {
        expect(svg, "the lockup or the palette changed since the kit was built — run yarn brand:assets").toBe(kitSvg(source, measured, shape, hex));
      });

      it(`${svgName}: the measured frame, 200 mm wide with its height written out, its own paths in ${hex}`, () => {
        const root = /<svg\b[^>]*>/.exec(svg)?.[0] ?? "";
        const viewBox = (/viewBox="([^"]+)"/.exec(root)?.[1] ?? "").split(" ").map(Number);
        close(viewBox, paddedFrame(measured[shape].drawing), 2);
        expect(/width="([^"]+)"/.exec(root)?.[1]).toBe(`${KIT_WIDTH_MM}mm`);
        const height = Number.parseFloat(/height="([^"]+)"/.exec(root)?.[1] ?? "");
        expect(height).toBeCloseTo((KIT_WIDTH_MM * viewBox[3]) / viewBox[2], 2);
        expect(svg).toContain(`fill="${hex}"`);
        const paths = [...svg.matchAll(/<path\b[^>]*\sd="([^"]+)"/g)].map((match) => match[1]);
        expect(paths).toEqual(measured[shape].paths.map((index: number) => source.paths[index].d));
        // The app reads the same file back: the drawing it places is the measured one.
        const vector = parseKitSvg(svg);
        close([vector.drawing.x, vector.drawing.y, vector.drawing.x + vector.drawing.width, vector.drawing.y + vector.drawing.height], measured[shape].drawing, 2);
        expect(vector.widthMm).toBe(KIT_WIDTH_MM);
      });

      it(`${pngName}: ${KIT_PNG_WIDTH} pixels wide, transparent around the drawing, the drawing in ${hex}`, async () => {
        const { data, info } = await sharp(path.join(ROOT, KIT_DIR, pngName)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        expect(info.width).toBe(KIT_PNG_WIDTH);
        const [, , frameWidth, frameHeight] = paddedFrame(measured[shape].drawing);
        expect(info.height).toBe(Math.round((KIT_PNG_WIDTH * frameHeight) / frameWidth));
        // The corners are the margin: nothing drawn there.
        for (const at of [0, (info.width - 1) * 4, (info.height - 1) * info.width * 4, data.length - 4]) expect(data[at + 3], `corner at ${at}`).toBe(0);
        const opaque = new Set<string>();
        for (let at = 0; at < data.length; at += 4) if (data[at + 3] === 255) opaque.add(`#${data.subarray(at, at + 3).toString("hex")}`);
        expect([...opaque]).toEqual([hex]);
      });
    }
  }

  it("sizes the PNG's SVG in pixels, the frame's proportion kept", () => {
    const svg = kitSvg(source, measured, "lockup", "#000000");
    const sized = inPixels(svg, 4000);
    expect(sized).toMatch(/ width="4000" height="\d+"/);
    expect(sized.replace(/ width="[^"]+" height="[^"]+"/, "")).toBe(svg.replace(/ width="[^"]+" height="[^"]+"/, ""));
  });
});
