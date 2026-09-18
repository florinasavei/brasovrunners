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

export const MAX_UPLOAD_BYTES = 6 * 1024 * 1024;
/** Below this a "photo" is an icon; above the upper bound a phone did not take it. */
export const MIN_DIMENSION = 200;
export const MAX_DIMENSION = 12_000;
export const WEB_MAX = 1600;
export const THUMB_MAX = 480;

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
    .webp({ quality: 80 })
    .toBuffer({ resolveWithObject: true });
  const thumb = await upright
    .clone()
    .resize({ width: THUMB_MAX, height: THUMB_MAX, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 72 })
    .toBuffer();

  return { web, thumb, width: info.width, height: info.height };
}
