import sharp, { type Metadata } from "sharp";
import { DomainError } from "@/shared/errors/domain-error";

/**
 * What an uploaded image becomes before it is stored (AGENTS.md §17).
 *
 * One input, two outputs, both WebP: `web`, at most 1600px on its long side, is what the album
 * page shows when a photo is opened; `thumb`, at most 480px, is the grid. Nothing else is kept —
 * not the original, not its metadata. `sharp` drops every EXIF field unless asked to keep them
 * (it is not asked), so the GPS position a phone writes into a photo never reaches the bucket;
 * `.rotate()` with no argument applies the EXIF orientation first, so the photo is upright *and
 * then* stripped, rather than stripped and sideways.
 *
 * The browser already downsized what it sent (`PhotoUploader`); this is the server's own check
 * of the same things, because a route handler receives whatever a client posts. Format is
 * decided by the bytes, never the file's name or declared type: `sharp` reads the signature and
 * anything that is not JPEG, PNG or WebP is refused, SVG included — an SVG is a document that
 * can carry script, and §17 says it needs its own sanitizer before it may be served.
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
 * WebP quality. 80 is the number one reaches for when the file has been encoded once; this one
 * has been encoded **twice** — the browser shrinks and re-encodes before upload (§176 changed
 * that too, but every picture already stored went through it) — and lossy generations stack.
 * 88 with `effort: 6` costs roughly a third more bytes and removes the blocking the owner saw
 * around flags, shirts and grass, which is exactly where a low-effort WebP falls apart.
 */
const WEB_QUALITY = 88;
const THUMB_QUALITY = 78;

const ACCEPTED = new Set(["jpeg", "png", "webp"]);

export type ProcessedImage = {
  web: Buffer;
  thumb: Buffer;
  /** Of the `web` variant. */
  width: number;
  height: number;
};

export async function processUploadedImage(input: Buffer): Promise<ProcessedImage> {
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

  // `failOn: "error"` refuses a truncated file rather than storing a half-decoded one.
  const upright = sharp(input, { failOn: "error" }).rotate();

  const { data: web, info } = await upright
    .clone()
    .resize({ width: WEB_MAX, height: WEB_MAX, fit: "inside", withoutEnlargement: true })
    // `effort: 6` is WebP's own quality/time dial and costs milliseconds on an upload nobody is
    // waiting on; `smartSubsample` keeps colour detail where a photo has hard edges — a race
    // number on a shirt, a flag, lettering on a banner — which is where the artefacts showed.
    .webp({ quality: WEB_QUALITY, effort: 6, smartSubsample: true })
    .toBuffer({ resolveWithObject: true });
  const thumb = await upright
    .clone()
    .resize({ width: THUMB_MAX, height: THUMB_MAX, fit: "inside", withoutEnlargement: true })
    .webp({ quality: THUMB_QUALITY, effort: 6 })
    .toBuffer();

  return { web, thumb, width: info.width, height: info.height };
}
