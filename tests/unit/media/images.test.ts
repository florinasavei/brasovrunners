import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { MAX_UPLOAD_BYTES, processUploadedImage, storedBytes, THUMB_MAX, WEB_MAX } from "@/modules/media/images";
import { ladderWidths } from "@/modules/media/ladder";
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

  it("stores a rung at every ladder width below the master, each exactly that wide, never enlarged (§NNN)", async () => {
    const result = await processUploadedImage(await phonePhoto(3000, 2000));
    // Orientation 6: the stored master is 1600 × 2400, so the rungs are 480…1280.
    expect(result.width).toBe(1600);
    expect(result.rungs.map((rung) => rung.width)).toEqual(ladderWidths(1600));
    for (const rung of result.rungs) {
      const meta = await sharp(rung.body).metadata();
      expect(meta.format).toBe("webp");
      expect(meta.width).toBe(rung.width);
      expect(meta.width).toBeLessThan(result.width);
      expect(meta.exif).toBeUndefined();
    }
    expect(result.quality).toBe("normal");
    expect(result.encoding).toBe("lossy");
    expect(storedBytes(result)).toBe(
      result.web.byteLength + result.thumb.byteLength + result.rungs.reduce((sum, rung) => sum + rung.body.byteLength, 0),
    );
    // A small photograph has no rung at all: nothing is made bigger than it is.
    expect((await processUploadedImage(await phonePhoto(640, 480))).rungs).toEqual([]);
  });

  it("keeps a poster's lettering near-lossless at «Înaltă», and a photograph lossy (§NNN)", async () => {
    // Flat colour and hard edges: what near-lossless WebP stores for almost nothing.
    const poster = await sharp({ create: { width: 1080, height: 1350, channels: 3, background: "#0b3d91" } })
      .composite([{ input: Buffer.from("<svg xmlns='http://www.w3.org/2000/svg' width='1080' height='300'><text x='40' y='200' font-size='120' fill='#fff'>CROSUL 2026</text></svg>"), top: 200, left: 0 }])
      .png()
      .toBuffer();
    const high = await processUploadedImage(poster, { quality: "high" });
    expect(high.quality).toBe("high");
    expect(high.encoding).toBe("nearLossless");

    // Noise: every pixel different, which near-lossless stores at many times lossy's size.
    const noise = Buffer.alloc(1200 * 900 * 3);
    for (let index = 0; index < noise.length; index += 1) noise[index] = (index * 2654435761) % 251;
    const photo = await sharp(noise, { raw: { width: 1200, height: 900, channels: 3 } }).jpeg({ quality: 95 }).toBuffer();
    const highPhoto = await processUploadedImage(photo, { quality: "high" });
    expect(highPhoto.encoding).toBe("lossy");
    // "Înaltă" is a larger file than "Normală" for the same photograph — which is what it says.
    const normalPhoto = await processUploadedImage(photo, { quality: "normal" });
    expect(highPhoto.rungs[0].body.byteLength).toBeGreaterThan(normalPhoto.rungs[0].body.byteLength);
  });

  it("refuses a tiny image and an oversized upload", async () => {
    const tiny = await sharp({ create: { width: 100, height: 100, channels: 3, background: "#fff" } }).png().toBuffer();
    const refusedTiny = await processUploadedImage(tiny).catch((e: unknown) => e);
    expect(isDomainError(refusedTiny) && refusedTiny.code).toBe("VALIDATION_ERROR");

    const refusedBig = await processUploadedImage(Buffer.alloc(MAX_UPLOAD_BYTES + 1)).catch((e: unknown) => e);
    expect(isDomainError(refusedBig) && refusedBig.code).toBe("VALIDATION_ERROR");
  });
});
