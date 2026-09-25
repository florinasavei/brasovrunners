import sharp, { type Metadata, type Sharp, type WebpOptions } from "sharp";
import { DomainError } from "@/shared/errors/domain-error";
import { DEFAULT_IMAGE_QUALITY, type ImageQuality, ladderWidths, masterMaxEdge } from "./ladder";

/**
 * What an uploaded image becomes before it is stored (AGENTS.md §17).
 *
 * One input, and since §414 a ladder of WebP files: `web`, at most 2400px on its long side (4000
 * at «Înaltă») — the master, what a wide screen draws and what every body's address names —
 * `thumb`, at most 640px,
 * for the backoffice's own lists, and a rung at each of `LADDER_WIDTHS` narrower than the master
 * (`ladder.ts`), which is what a phone, a card and a gallery tile load. Nothing else is kept —
 * not the original, not its metadata. `sharp` drops every EXIF field unless asked to keep them
 * (it is not asked), so the GPS position a phone writes into a photo never reaches the bucket;
 * `.rotate()` with no argument applies the EXIF orientation first, so the photo is upright *and
 * then* stripped, rather than stripped and sideways.
 *
 * The browser already downsized what it sent when it had to (`browser-shrink.ts`); this is the
 * server's own check of the same things, because a route handler receives whatever a client
 * posts. Format is decided by the bytes, never the file's name or declared type: `sharp` reads
 * the signature and anything that is not JPEG, PNG or WebP is refused, SVG included — an SVG is
 * a document that can carry script, and §17 says it needs its own sanitizer before it may be
 * served.
 */

/**
 * The bounds live in `limits.ts`, which imports nothing (§178): the browser half of the upload
 * needs `MAX_UPLOAD_BYTES`, and importing it from here dragged `sharp` into the client bundle
 * and broke `next build`. Re-exported so every existing importer of this module keeps working.
 *
 * Why 2400 and 640 (§176; the owner, three times: "pictures look really bad and compressed
 * now", "în continuare imaginile sunt super pixelate, hyper-comprimate"): 1600 was the width of
 * a full-bleed image on a 1× laptop and nothing else. The editor and the event page render a
 * picture across roughly 1000 CSS pixels, and every laptop and phone the club uses has a 2×
 * screen — so the browser was **upscaling a 1600px file to 2000 physical pixels** and the
 * reader saw WebP artefacts magnified.
 */
import { MAX_UPLOAD_BYTES, MAX_DIMENSION, MIN_DIMENSION, THUMB_MAX, WEB_MAX } from "./limits";

export { MAX_UPLOAD_BYTES, MIN_DIMENSION, MAX_DIMENSION, WEB_MAX, THUMB_MAX };

/**
 * The master's quality, unchanged since §176: 88 with `effort: 6` removed the blocking the owner
 * saw around flags, shirts and grass. It is what a laptop draws, which is the screen the owner
 * judged the pictures on, so §414 leaves it exactly where it was.
 */
const WEB_QUALITY = 88;
const THUMB_QUALITY = 78;

/**
 * The rungs' quality (§414). Measured on two race photographs (9 and 6.5 megapixels): at 1200px,
 * 82 is 38.0–38.7 dB against the unencoded pixels and 105–174 KB, where 88 is 39.5–40.6 dB for
 * 37–42% more bytes. A rung is drawn at (or just under) its own width — the browser picks it for that — so
 * its artefacts are never magnified, which is the whole difference from the old single file; and
 * 82 is what keeps a phone's page lighter than before rather than heavier.
 */
const RUNG_QUALITY = 82;

/**
 * "Înaltă" (§414) is two things, and the re-review found the first version had only one of them.
 *
 * **More pixels.** The master keeps up to `HIGH_WEB_MAX` (4000) on its long side rather than
 * 2400, and the browser sends up to 4000 for this choice rather than 3000
 * (`browser-shrink.ts`): a poster photographed at 4000 pixels had its lettering reduced to 60%
 * whatever the encoder did afterwards, so "high" with the same 2400 pixels was no sharper
 * anywhere a screen could show the difference. The ladder gains a 2400 rung under such a
 * master (`LADDER_WIDTHS`), so a laptop at 2× still loads a 2400 file and only a wider screen, or
 * a tap on an album photo, takes the whole master.
 *
 * **A better encode.** Lossy WebP at any quality smears text: a poster with a date and a list of
 * rules measured 37.8 dB at quality 82 and still only 39.1 dB at 92, because WebP's lossy mode
 * halves the colour resolution and rings around every letter. Near-lossless WebP measured
 * 56.8 dB — the letters as drawn — for 225 KB against lossy 92's 166 KB. On a photograph the same
 * setting is 5–7 times the bytes for a difference nobody sees, so "high" decides per picture: it
 * encodes a probe both ways and keeps near-lossless when that is at most twice lossy 90, and
 * lossy 90 otherwise. A poster comes out sharp; a photograph comes out at 90 rather than several
 * megabytes more. 90 rather than 92: on a 4000-pixel master 92 measured 9–25% more bytes.
 *
 * **The bytes, measured** (four phone photographs of 6.5–12 megapixels and a 3200 × 4000
 * poster, on the shared machine): a photograph's master at «Normală» is 279–418 KB (1542 KB for
 * a leaf-covered hillside, the worst case), 0.7–1.1 MB in all its files; at «Înaltă» 650–742 KB
 * (3.8 MB for the hillside), 1.8–2.4 MB in all (8.6 MB), in 5–11 seconds rather than 2–3.5. The
 * poster at «Înaltă» is near-lossless: 218 KB for the 3200 × 4000 master, 1.3 MB in all. A
 * phone still takes a rung, at 90 rather than 82 — 1.3–1.7 times the bytes of the same rung at
 * «Normală» — and a laptop at 2× takes the 2400 rung, 305–453 KB (1.7 MB for the hillside).
 */
const HIGH_QUALITY = 90;
const NEAR_LOSSLESS_QUALITY = 60;
const NEAR_LOSSLESS_MAX_RATIO = 2;
const PROBE_WIDTH = 960;

/**
 * `effort: 6` is WebP's own quality/time dial and costs milliseconds on an upload nobody is
 * waiting on; `smartSubsample` keeps colour detail where a photo has hard edges — a race number
 * on a shirt, a flag, lettering on a banner — which is where the artefacts showed.
 */
const lossy = (quality: number, effort = 6): WebpOptions => ({ quality, effort, smartSubsample: true });
/*
  Effort 4 — libwebp's own default — for the rungs and for near-lossless. Six rungs at effort 6
  measured 5.5 s against 4.1 s at 4 for 4% more bytes, and this is an upload somebody is
  watching, one request per photo; the master, the file the owner judged, keeps its 6.
*/
const RUNG_EFFORT = 4;
const nearLossless: WebpOptions = { nearLossless: true, quality: NEAR_LOSSLESS_QUALITY, effort: RUNG_EFFORT };

const ACCEPTED = new Set(["jpeg", "png", "webp"]);

/** How the ladder was encoded — shown to the person after the upload, with the sizes. */
export type ImageEncoding = "lossy" | "nearLossless";

export type ProcessedImage = {
  /** The master: `web.webp`. */
  web: Buffer;
  thumb: Buffer;
  /** One per `ladderWidths(width)`, narrowest first. */
  rungs: { width: number; body: Buffer }[];
  /** Of the `web` variant. */
  width: number;
  height: number;
  quality: ImageQuality;
  encoding: ImageEncoding;
};

export async function processUploadedImage(
  input: Buffer,
  options: { quality?: ImageQuality } = {},
): Promise<ProcessedImage> {
  const quality = options.quality ?? DEFAULT_IMAGE_QUALITY;
  if (input.byteLength === 0) throw new DomainError("VALIDATION_ERROR", "the file is empty");
  if (input.byteLength > MAX_UPLOAD_BYTES) {
    throw new DomainError("VALIDATION_ERROR", `the file is larger than ${MAX_UPLOAD_BYTES / 1024 / 1024} MB`);
  }

  let metadata: Metadata;
  try {
    metadata = await sharp(input).metadata();
  } catch {
    throw new DomainError("VALIDATION_ERROR", "the file is not an image");
  }
  if (!metadata.format || !ACCEPTED.has(metadata.format)) {
    throw new DomainError("VALIDATION_ERROR", "only JPEG, PNG and WebP photos are accepted");
  }
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (width < MIN_DIMENSION || height < MIN_DIMENSION) {
    throw new DomainError("VALIDATION_ERROR", `the photo must be at least ${MIN_DIMENSION}px on each side`);
  }
  if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
    throw new DomainError("VALIDATION_ERROR", `the photo must be at most ${MAX_DIMENSION}px on each side`);
  }

  /*
    One decode, at the master's size: every file below is made from these pixels, so a
    phone's 12-megapixel photograph is decompressed once rather than nine times. `failOn: "error"`
    refuses a truncated file rather than storing a half-decoded one; sRGB and 8 bits are what
    every file below is written in anyway.
  */
  const masterEdge = masterMaxEdge(quality);
  const { data, info } = await sharp(input, { failOn: "error" })
    .rotate()
    .resize({ width: masterEdge, height: masterEdge, fit: "inside", withoutEnlargement: true })
    .toColourspace("srgb")
    .raw({ depth: "uchar" })
    .toBuffer({ resolveWithObject: true });
  const pixels = () => sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } });

  const encoding = quality === "high" ? await highEncoding(pixels, info.width) : "lossy";
  const masterOptions =
    quality === "normal" ? lossy(WEB_QUALITY) : encoding === "nearLossless" ? nearLossless : lossy(HIGH_QUALITY);
  const rungOptions =
    quality === "normal" ? lossy(RUNG_QUALITY, RUNG_EFFORT) : encoding === "nearLossless" ? nearLossless : lossy(HIGH_QUALITY, RUNG_EFFORT);

  // All at once: `sharp` runs each on libuv's pool, so a machine with more than one core uses them.
  const [web, thumb, ...rungBodies] = await Promise.all([
    pixels().webp(masterOptions).toBuffer(),
    pixels()
      .resize({ width: THUMB_MAX, height: THUMB_MAX, fit: "inside", withoutEnlargement: true })
      .webp({ quality: THUMB_QUALITY, effort: 6 })
      .toBuffer(),
    ...ladderWidths(info.width).map((rung) => pixels().resize({ width: rung }).webp(rungOptions).toBuffer()),
  ]);
  const rungs = ladderWidths(info.width).map((rung, index) => ({ width: rung, body: rungBodies[index] }));

  return { web, thumb, rungs, width: info.width, height: info.height, quality, encoding };
}

/** "Înaltă": near-lossless when it costs at most twice lossy 90 on a probe, lossy 90 otherwise. */
async function highEncoding(pixels: () => Sharp, masterWidth: number): Promise<ImageEncoding> {
  const probe = () => pixels().resize({ width: Math.min(PROBE_WIDTH, masterWidth) });
  const [asNearLossless, asLossy] = await Promise.all([
    probe().webp(nearLossless).toBuffer(),
    probe().webp(lossy(HIGH_QUALITY)).toBuffer(),
  ]);
  return asNearLossless.byteLength <= asLossy.byteLength * NEAR_LOSSLESS_MAX_RATIO ? "nearLossless" : "lossy";
}

/** Every byte the ladder stores, for the facts shown after an upload. */
export function storedBytes(processed: ProcessedImage): number {
  return processed.web.byteLength + processed.thumb.byteLength + processed.rungs.reduce((sum, rung) => sum + rung.body.byteLength, 0);
}
