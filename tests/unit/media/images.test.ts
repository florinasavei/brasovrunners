import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { MAX_UPLOAD_BYTES, processUploadedImage, THUMB_MAX, WEB_MAX } from "@/modules/media/images";
import { isDomainError } from "@/shared/errors/domain-error";

/**
 * BR-REQ-054-01 criteria 3–4 — what an upload becomes, and what is refused.
 *
 * The images are made here with sharp itself, so the test needs no fixture files: a 2400×1600
 * JPEG with EXIF orientation and a GPS tag stands in for a phone photo.
 */
async function phonePhoto(width = 2400, height = 1600): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 30, g: 60, b: 200 } } })
    .jpeg()
    // Orientation 6 = rotate 90° clockwise to display; a GPS position beside it.
    .withMetadata({ orientation: 6, exif: { IFD0: { Copyright: "x" }, IFD3: { GPSLatitudeRef: "N" } } })
    .toBuffer();
}

describe("BR-REQ-054-01 the image pipeline", () => {
  it("makes a web and a thumb WebP within their bounds, upright, with no metadata", async () => {
    const result = await processUploadedImage(await phonePhoto());

    const web = await sharp(result.web).metadata();
    const thumb = await sharp(result.thumb).metadata();
    expect(web.format).toBe("webp");
    expect(thumb.format).toBe("webp");
    // Orientation 6 on a landscape source: the stored image is portrait, and the recorded
    // dimensions are the stored image's.
    expect(Math.max(web.width ?? 0, web.height ?? 0)).toBeLessThanOrEqual(WEB_MAX);
    expect(web.height).toBeGreaterThan(web.width ?? 0);
    expect(result.width).toBe(web.width);
    expect(result.height).toBe(web.height);
    expect(Math.max(thumb.width ?? 0, thumb.height ?? 0)).toBeLessThanOrEqual(THUMB_MAX);
    // Stripped: no EXIF block at all, so no GPS, and no orientation left to re-apply.
    expect(web.exif).toBeUndefined();
    expect(web.orientation).toBeUndefined();
    expect(thumb.exif).toBeUndefined();
  });

  it("does not enlarge a small photo", async () => {
    const result = await processUploadedImage(await phonePhoto(640, 480));
    // Orientation 6 rotates it: 480 wide, 640 tall, and nothing scaled up.
    expect(result.width).toBe(480);
    expect(result.height).toBe(640);
  });

  it("refuses what is not a raster photo, an SVG included", async () => {
    for (const bytes of [
      Buffer.from("<svg xmlns='http://www.w3.org/2000/svg' width='300' height='300'></svg>"),
      Buffer.from("not an image at all"),
      Buffer.alloc(0),
    ]) {
      const refused = await processUploadedImage(bytes).catch((e: unknown) => e);
      expect(isDomainError(refused) && refused.code).toBe("VALIDATION_ERROR");
    }
  });

  it("refuses a tiny image and an oversized upload", async () => {
    const tiny = await sharp({ create: { width: 100, height: 100, channels: 3, background: "#fff" } }).png().toBuffer();
    const refusedTiny = await processUploadedImage(tiny).catch((e: unknown) => e);
    expect(isDomainError(refusedTiny) && refusedTiny.code).toBe("VALIDATION_ERROR");

    const refusedBig = await processUploadedImage(Buffer.alloc(MAX_UPLOAD_BYTES + 1)).catch((e: unknown) => e);
    expect(isDomainError(refusedBig) && refusedBig.code).toBe("VALIDATION_ERROR");
  });
});
