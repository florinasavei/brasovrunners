import QRCode from "qrcode";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { mm } from "@/modules/pr-kit/domain/sheets";
import { codeMatrix, drawCode } from "@/modules/pr-kit/draw";

/**
 * §1015 — the «PR Kit»'s codes are drawn as vector squares from `qrcode`'s matrix, never pasted as a picture. A code drawn
 * transposed or mirrored still shows its three finder squares in three corners and reads as nothing: so every dark module the
 * sheets and the poster draw is checked against the library's own picture of the same address, module for module, and every
 * light one against its light — error correction M (the stickers) and Q (the poster).
 */
type Rect = [x: number, y: number, width: number, height: number];

/** The squares `drawCode` lays into `box`, caught with a stand-in for pdfkit's two calls. */
function drawn(url: string, level: "M" | "Q") {
  const matrix = codeMatrix(url, level);
  const rects: Rect[] = [];
  const doc = {
    rect(x: number, y: number, width: number, height: number) {
      rects.push([x, y, width, height]);
      return doc;
    },
    fill() {
      return doc;
    },
  };
  const box = { x: 10, y: 20, width: 50, height: 50 };
  drawCode(doc as unknown as PDFKit.PDFDocument, matrix, box, "#000000");
  const side = mm(box.width) / matrix.size;
  const dark = new Set<string>();
  for (const [x, y, width, height] of rects) {
    const row = Math.round((y - mm(box.y)) / side);
    const first = Math.round((x - mm(box.x)) / side);
    const count = Math.round(width / side);
    // A module's height, the hair below it that closes the seam to the next row aside.
    expect(height).toBeGreaterThanOrEqual(side);
    expect(height).toBeLessThan(side * 1.06);
    for (let column = first; column < first + count; column += 1) dark.add(`${row},${column}`);
  }
  return { size: matrix.size, dark, rects };
}

describe("§1015 the codes, drawn module by module", () => {
  for (const url of ["https://example.org", "https://qa.example-club.org", "https://www.youtube.com/@example-club"]) {
    for (const level of ["M", "Q"] as const) {
      it(`draws ${url} at ${level} as qrcode's own picture of it`, async () => {
        const { size, dark, rects } = drawn(url, level);
        const png = await QRCode.toBuffer(url, { errorCorrectionLevel: level, margin: 0, scale: 1, type: "png" });
        const { data, info } = await sharp(png).removeAlpha().greyscale().raw().toBuffer({ resolveWithObject: true });
        expect([info.width, info.height]).toEqual([size, size]);
        const expected = new Set<string>();
        for (let row = 0; row < size; row += 1) {
          for (let column = 0; column < size; column += 1) if (data[(row * size + column) * info.channels] < 128) expected.add(`${row},${column}`);
        }
        expect([...dark].sort()).toEqual([...expected].sort());
        // A row's dark run is one rectangle: far fewer than one per module.
        expect(rects.length).toBeLessThan(expected.size);
      });
    }
  }
});
