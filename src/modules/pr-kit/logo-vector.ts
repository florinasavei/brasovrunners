import { readFile } from "node:fs/promises";
import path from "node:path";
import { KIT_MARGIN, type LogoInk, type LogoShape, logoFileName } from "./domain/kit";
import type { Box } from "./domain/sheets";

/**
 * The kit's logo as vector paths (§NNN), read from the file `yarn brand:assets` wrote (`public/brand/kit/`,
 * `scripts/brand-kit.mjs`): its frame, the drawing inside it, the group's translation and each path's data and fill rule —
 * what pdfkit's `doc.path()` draws the PDFs from, so the logo on a sticker, on the poster and in the logo's own PDF is the
 * very artwork of the SVG beside it, never a raster.
 *
 * The file is the script's own, so its shape is known: one `viewBox`, one `<g>` with an optional `translate(…)` and the fill,
 * and the paths, each with its data and `fill-rule="evenodd"` where the source had it. A file of any other shape is refused by
 * name.
 */

export type LogoPath = { d: string; evenOdd: boolean };

export type LogoVector = {
  /** The file's frame, in its own units: the `viewBox`. */
  frame: Box;
  /** The drawing inside the frame, the margin taken off: 4 % of its width on every side. */
  drawing: Box;
  /** The size the file is written at, in millimetres. */
  widthMm: number;
  heightMm: number;
  translate: [number, number];
  paths: LogoPath[];
  /** The drawing's height over its width: how a box fits it. */
  aspect: number;
};

const attribute = (tag: string, name: string): string | undefined => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];

/** A kit SVG as paths and measures; anything not written by the script is refused. */
export function parseKitSvg(text: string): LogoVector {
  const root = /<svg\b[^>]*>/.exec(text)?.[0];
  const viewBox = root ? attribute(root, "viewBox") : undefined;
  const width = root ? attribute(root, "width") : undefined;
  const height = root ? attribute(root, "height") : undefined;
  if (!viewBox || !width?.endsWith("mm") || !height?.endsWith("mm")) throw new Error("pr-kit: not a kit SVG (no viewBox or no size in mm)");
  const [x, y, frameWidth, frameHeight] = viewBox.split(/[\s,]+/).map(Number);
  const group = /<g\b[^>]*>/.exec(text)?.[0] ?? "";
  const transform = attribute(group, "transform");
  let translate: [number, number] = [0, 0];
  if (transform !== undefined) {
    const match = /^translate\(\s*([-+\d.eE]+)(?:[\s,]+([-+\d.eE]+))?\s*\)$/.exec(transform.trim());
    if (!match) throw new Error(`pr-kit: the kit SVG's transform is not a translate: ${transform}`);
    translate = [Number(match[1]), Number(match[2] ?? 0)];
  }
  const paths = [...text.matchAll(/<path\b[^>]*>/g)].map(({ 0: tag }) => {
    const d = attribute(tag, "d");
    if (!d) throw new Error("pr-kit: a path of the kit SVG has no data");
    return { d, evenOdd: attribute(tag, "fill-rule") === "evenodd" };
  });
  if (paths.length === 0) throw new Error("pr-kit: the kit SVG has no paths");
  // The frame is the drawing and 4 % of its width on either side: the drawing's width is the frame's over 1.08.
  const drawingWidth = frameWidth / (1 + 2 * KIT_MARGIN);
  const margin = drawingWidth * KIT_MARGIN;
  const drawing = { x: x + margin, y: y + margin, width: drawingWidth, height: frameHeight - 2 * margin };
  return {
    frame: { x, y, width: frameWidth, height: frameHeight },
    drawing,
    widthMm: Number.parseFloat(width),
    heightMm: Number.parseFloat(height),
    translate,
    paths,
    aspect: drawing.height / drawing.width,
  };
}

/** A kit file on the disk: `public/brand/kit/<name>`, traced into the routes that read it (`next.config.ts`). */
export function kitFilePath(name: string): string {
  return path.join(process.cwd(), "public", "brand", "kit", name);
}

const read = new Map<string, Promise<LogoVector>>();

/**
 * One shape of the logo as paths, read once per process: the ink's own file, so a PDF draws exactly what that SVG holds. A
 * file that cannot be read is not remembered, so the next request tries again.
 */
export function readLogoVector(shape: LogoShape, ink: LogoInk = "primary"): Promise<LogoVector> {
  const name = logoFileName(shape, ink, "svg");
  let vector = read.get(name);
  if (!vector) {
    vector = readFile(kitFilePath(name), "utf8").then(parseKitSvg);
    vector.catch(() => read.delete(name));
    read.set(name, vector);
  }
  return vector;
}
