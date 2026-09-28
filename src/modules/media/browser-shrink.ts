import { DEFAULT_IMAGE_QUALITY, type ImageQuality } from "./ladder";
import { BROWSER_SEND_BYTES, HIGH_WEB_MAX, MAX_DIMENSION, MAX_UPLOAD_BYTES, ORIGINAL_WEB_MAX } from "./limits";

/**
 * Shrink a picture in the browser only when it has to be (BR-REQ-054-01, BR-REQ-050-03 c8; §176).
 * A file the server accepts is sent untouched, so the server's encode is the only lossy step;
 * otherwise it is resized at 0.95, an intermediate the server encodes again. Browser only.
 */

/** The longest side worth sending per choice: the server's master edge plus headroom (§414, §437). */
const MAX_EDGE: Record<ImageQuality, number> = { low: 1600, normal: 3000, high: HIGH_WEB_MAX, original: ORIGINAL_WEB_MAX };

/** The choices whose file is sent as it is whenever it fits the send limit, whatever its pixels. */
const SENT_AS_IT_IS: ReadonlySet<ImageQuality> = new Set(["high", "original"]);

/** A picture's pixels and weight: the file chosen, or what the browser sends of it (§437). */
export type ImageFileFacts = { width: number; height: number; bytes: number };

/**
 * What an upload sends and what it was chosen from (§437). `reencoded`: a new file was encoded;
 * `resized`: it also has fewer pixels (a merely heavy file is re-encoded at its own size).
 */
export type PreparedUpload = { blob: Blob; chosen: ImageFileFacts; sent: ImageFileFacts; resized: boolean; reencoded: boolean };

/** High, because the server re-encodes the intermediate. */
const INTERMEDIATE_QUALITY = 0.95;

/** The smaller of the server's limit and the platform's request body (`limits.ts`, §414). */
const SEND_LIMIT = Math.min(MAX_UPLOAD_BYTES, BROWSER_SEND_BYTES);

export async function shrinkImageInBrowser(file: File, quality: ImageQuality = DEFAULT_IMAGE_QUALITY): Promise<Blob> {
  return (await prepareImageUpload(file, quality)).blob;
}

/** The same shrink with its facts (§437); `onChosen` hears the chosen file's as soon as it is decoded. */
export async function prepareImageUpload(
  file: File,
  quality: ImageQuality = DEFAULT_IMAGE_QUALITY,
  onChosen?: (chosen: ImageFileFacts) => void,
): Promise<PreparedUpload> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const chosen: ImageFileFacts = { width: bitmap.width, height: bitmap.height, bytes: file.size };
  onChosen?.(chosen);
  const longest = Math.max(bitmap.width, bitmap.height);
  const maxEdge = MAX_EDGE[quality];

  /*
    Sent untouched when it fits: one lossy encode, not two. «Mare» and «Originală» ignore the edge
    (within `MAX_DIMENSION`): a 4032-pixel JPEG re-encoded here at 0.95 measured twice its size.
    The server's `.rotate()` reads the same EXIF orientation.
  */
  const fitsAsItIs = SENT_AS_IT_IS.has(quality) ? longest <= MAX_DIMENSION : longest <= maxEdge;
  if (file.size <= SEND_LIMIT && fitsAsItIs) {
    bitmap.close();
    return { blob: file, chosen, sent: chosen, resized: false, reencoded: false };
  }

  const scale = Math.min(1, maxEdge / longest);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("no canvas");
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const encoded = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("encode failed"))),
      "image/webp",
      INTERMEDIATE_QUALITY,
    );
  });

  /* Still over the send limit: step the edge down, holding quality, rather than be refused. */
  if (encoded.size <= SEND_LIMIT) return sentAs(encoded, chosen, canvas.width, canvas.height);
  const fitted = await shrinkToFit(canvas, SEND_LIMIT);
  return sentAs(fitted.blob, chosen, fitted.width, fitted.height);
}

/** A re-encoded file's facts; `resized` only when its pixels are not the chosen file's (§437). */
function sentAs(blob: Blob, chosen: ImageFileFacts, width: number, height: number): PreparedUpload {
  const resized = width !== chosen.width || height !== chosen.height;
  return { blob, chosen, sent: { width, height, bytes: blob.size }, resized, reencoded: true };
}

async function shrinkToFit(source: HTMLCanvasElement, limit: number): Promise<{ blob: Blob; width: number; height: number }> {
  let width = source.width;
  let height = source.height;
  let out: Blob | null = null;

  // Bounded: four steps of 0.8 in each edge.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    width = Math.round(width * 0.8);
    height = Math.round(height * 0.8);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("no canvas");
    context.drawImage(source, 0, 0, width, height);
    out = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("encode failed"))),
        "image/webp",
        INTERMEDIATE_QUALITY,
      );
    });
    if (out.size <= limit) return { blob: out, width, height };
  }
  if (!out) throw new Error("encode failed");
  return { blob: out, width, height };
}
