import sharp, { type Metadata, type Sharp, type WebpOptions } from "sharp";
import { DomainError } from "@/shared/errors/domain-error";
import { DEFAULT_IMAGE_QUALITY, type ImageQuality, ladderWidths, masterMaxEdge } from "./ladder";

/**
 * What an uploaded image becomes before it is stored (AGENTS.md §17): a WebP master `web`, a
 * `thumb` for the backoffice lists, and the ladder's rungs (§414, §437). Nothing else is kept.
 * `sharp` drops EXIF (so no GPS reaches the bucket) and `.rotate()` applies the orientation first.
 *
 * The server re-checks what the browser shrank, since a route receives whatever is posted. Format
 * is read from the bytes: only JPEG, PNG and WebP; SVG can carry script and needs a sanitizer (§17).
 */

/** Bounds live in `limits.ts` so the browser can import them without `sharp` (§178, §176). */
import { MAX_UPLOAD_BYTES, MAX_DIMENSION, MIN_DIMENSION, THUMB_MAX, WEB_MAX } from "./limits";

export { MAX_UPLOAD_BYTES, MIN_DIMENSION, MAX_DIMENSION, WEB_MAX, THUMB_MAX };

/** The master's quality (§176): 88 at effort 6 removed visible blocking on a 2× laptop. */
const WEB_QUALITY = 88;
const THUMB_QUALITY = 78;

/**
 * The rungs' quality (§414): 82 costs about 1.5 dB against 88 for ~40% fewer bytes, and a rung
 * is drawn at its own width, so its artefacts are never magnified.
 */
const RUNG_QUALITY = 82;

/**
 * «Mare» (§414): more pixels (`HIGH_WEB_MAX`) and a better encode. Lossy WebP smears lettering
 * at any quality (it halves colour resolution), so a probe decides per picture: near-lossless
 * when it costs at most twice lossy 90 (a poster), lossy 90 otherwise (a photograph). 92 measured
 * 9–25% more bytes than 90 on a 4000-pixel master.
 */
const HIGH_QUALITY = 90;

/** «Minimă» (§437): a light picture nobody magnifies. */
const LOW_QUALITY = 78;
const LOW_RUNG_QUALITY = 76;

/**
 * «Originală» (§437): the file's own pixels, lossy at 95 with «Mare»'s near-lossless probe. The
 * rungs stay «Mare»'s: a phone sees no difference between 90 and 95 at a rung's width.
 */
const ORIGINAL_QUALITY = 95;
const NEAR_LOSSLESS_QUALITY = 60;
const NEAR_LOSSLESS_MAX_RATIO = 2;
const PROBE_WIDTH = 960;

/** `smartSubsample` keeps colour detail on hard edges (numbers, flags, lettering). */
const lossy = (quality: number, effort = 6): WebpOptions => ({ quality, effort, smartSubsample: true });
/* Effort 4 for rungs and near-lossless: effort 6 measured 5.5 s against 4.1 s for 4% fewer bytes. */
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

  /* One decode for every file below; `failOn: "error"` refuses a truncated file. */
  const masterEdge = masterMaxEdge(quality);
  const { data, info } = await sharp(input, { failOn: "error" })
    .rotate()
    .resize({ width: masterEdge, height: masterEdge, fit: "inside", withoutEnlargement: true })
    .toColourspace("srgb")
    .raw({ depth: "uchar" })
    .toBuffer({ resolveWithObject: true });
  const pixels = () => sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } });

  const encoding = quality === "high" || quality === "original" ? await highEncoding(pixels, info.width) : "lossy";
  const { master: masterOptions, rung: rungOptions } = encoderOptions(quality, encoding);

  // All at once: `sharp` runs each on libuv's pool, so a machine with more than one core uses them.
  const [web, { thumb, rungs }] = await Promise.all([pixels().webp(masterOptions).toBuffer(), encodeLadder(pixels, info.width, rungOptions)]);

  return { web, thumb, rungs, width: info.width, height: info.height, quality, encoding };
}

/** The thumbnail and rungs from a master's decoded pixels; shared by the upload and §430. */
async function encodeLadder(
  pixels: () => Sharp,
  masterWidth: number,
  rungOptions: WebpOptions,
): Promise<{ thumb: Buffer; rungs: { width: number; body: Buffer }[] }> {
  const widths = ladderWidths(masterWidth);
  const [thumb, ...rungBodies] = await Promise.all([
    pixels()
      .resize({ width: THUMB_MAX, height: THUMB_MAX, fit: "inside", withoutEnlargement: true })
      .webp({ quality: THUMB_QUALITY, effort: 6 })
      .toBuffer(),
    ...widths.map((rung) => pixels().resize({ width: rung }).webp(rungOptions).toBuffer()),
  ]);
  return { thumb, rungs: widths.map((rung, index) => ({ width: rung, body: rungBodies[index] })) };
}

/** What a stored master becomes when it is given its ladder afterwards (§430). */
export type LadderFromMaster = {
  thumb: Buffer;
  rungs: { width: number; body: Buffer }[];
  /** Of the master as it is stored — read from its bytes, never from the row. */
  width: number;
  height: number;
};

/**
 * The ladder of a pre-§414 picture from its stored master (the original was never kept, §66),
 * for §430's button. The master is kept as is; rungs and a new thumbnail (pre-§176 ones are 480
 * pixels) use «Medie»'s settings. A file read back from the bucket is checked like any input (§17).
 */
export async function ladderFromStoredMaster(master: Buffer): Promise<LadderFromMaster> {
  let metadata: Metadata;
  try {
    metadata = await sharp(master).metadata();
  } catch {
    throw new DomainError("VALIDATION_ERROR", "the stored picture is not an image");
  }
  if (metadata.format !== "webp") throw new DomainError("VALIDATION_ERROR", "the stored picture is not a WebP");
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (width < MIN_DIMENSION || height < MIN_DIMENSION || width > MAX_DIMENSION || height > MAX_DIMENSION) {
    throw new DomainError("VALIDATION_ERROR", "the stored picture has a size no upload could have given it");
  }

  /* A corrupt body shows only on full decode; refuse it so the batch skips it rather than stalls (§430). */
  try {
    const { data, info } = await sharp(master, { failOn: "error" })
      .toColourspace("srgb")
      .raw({ depth: "uchar" })
      .toBuffer({ resolveWithObject: true });
    const pixels = () => sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } });
    const { thumb, rungs } = await encodeLadder(pixels, info.width, lossy(RUNG_QUALITY, RUNG_EFFORT));
    return { thumb, rungs, width: info.width, height: info.height };
  } catch (error) {
    throw new DomainError("VALIDATION_ERROR", `the stored picture could not be decoded: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** The master's and the rungs' encoder settings for a choice and what its probe decided. */
function encoderOptions(quality: ImageQuality, encoding: ImageEncoding): { master: WebpOptions; rung: WebpOptions } {
  if (quality === "low") return { master: lossy(LOW_QUALITY), rung: lossy(LOW_RUNG_QUALITY, RUNG_EFFORT) };
  if (quality === "normal") return { master: lossy(WEB_QUALITY), rung: lossy(RUNG_QUALITY, RUNG_EFFORT) };
  if (encoding === "nearLossless") return { master: nearLossless, rung: nearLossless };
  return {
    master: lossy(quality === "original" ? ORIGINAL_QUALITY : HIGH_QUALITY),
    rung: lossy(HIGH_QUALITY, RUNG_EFFORT),
  };
}

/**
 * «Mare» and «Originală»: near-lossless when it costs at most twice lossy 90 on a probe, lossy
 * otherwise (90 for «Mare», 95 for «Originală»).
 */
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
