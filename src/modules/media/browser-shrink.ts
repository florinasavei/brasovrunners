import { DEFAULT_IMAGE_QUALITY, type ImageQuality } from "./ladder";
import { BROWSER_SEND_BYTES, HIGH_WEB_MAX, MAX_DIMENSION, MAX_UPLOAD_BYTES } from "./limits";

/**
 * Shrink a picture in the browser **only when it has to be** (BR-REQ-054-01, BR-REQ-050-03 c8;
 * `DECISIONS.md` §176).
 *
 * The point of this function is the server's 6 MB limit: a phone photo is 4–12 MB and would be
 * refused. It is not a compression step, and it had become one — every upload was re-encoded to
 * WebP at quality 0.86 in a canvas, and the server then decoded that and re-encoded it to WebP
 * again. **Two lossy generations**, and the second one working from an image whose detail the
 * first had already thrown away. That is what the owner was seeing: "în continuare imaginile
 * sunt super pixelate, hyper-comprimate".
 *
 * So: a file the server will accept as it stands is sent **untouched**, and the server's single
 * encode is the only lossy step. Only a file that is too large, or larger than any page will
 * ever show, is resized here — and then at 0.95, because this output is an *intermediate* and
 * its artefacts are permanent once the server encodes it again.
 *
 * Client-side only: `createImageBitmap` and `canvas` do not exist on the server.
 */

/**
 * The longest side worth sending, per choice. At «Normală» the server keeps `WEB_MAX` (2400)
 * and throws the rest away, and a little headroom means a picture the club later wants larger is
 * not already destroyed. At «Înaltă» the server keeps `HIGH_WEB_MAX` (4000; §NNN), so the
 * browser sends that much: capping it at 3000 here was the half of "high is no sharper" the
 * server could not undo.
 */
const MAX_EDGE: Record<ImageQuality, number> = { normal: 3000, high: HIGH_WEB_MAX };

/** Quality for the intermediate. High, because the server re-encodes it — see above. */
const INTERMEDIATE_QUALITY = 0.95;

/**
 * The most one upload sends: the server's own limit, or the platform's request body, whichever
 * is smaller (`limits.ts`, §NNN). Every "fits" below is measured against this.
 */
const SEND_LIMIT = Math.min(MAX_UPLOAD_BYTES, BROWSER_SEND_BYTES);

export async function shrinkImageInBrowser(file: File, quality: ImageQuality = DEFAULT_IMAGE_QUALITY): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const longest = Math.max(bitmap.width, bitmap.height);
  const maxEdge = MAX_EDGE[quality];

  /*
    Nothing to do: small enough for the server and no larger than anything renders. Sending the
    original means one lossy encode instead of two — and for a PNG (a poster, a screenshot, a
    diagram) it means the only encode, rather than a canvas turning it lossy on the way out.

    At «Înaltă» a file that fits is sent as it is **whatever its pixels** (within the server's
    `MAX_DIMENSION`): the server resizes to 4000 before its one encode, and a phone's 4032-pixel
    JPEG re-encoded here at 0.95 measured larger than the JPEG itself — 4.85 MB from 2.37 MB for
    a leaf-covered hillside, over the send limit, so it would have been stepped down to 3200 and
    the choice lost. «Normală» keeps its edge: the server keeps 2400 of it either way.

    `imageOrientation: "from-image"` above is the one thing the canvas was also doing for us; the
    server rotates with `sharp(...).rotate()`, which reads the same EXIF, so nothing is lost.
  */
  const fitsAsItIs = quality === "high" ? longest <= MAX_DIMENSION : longest <= maxEdge;
  if (file.size <= SEND_LIMIT && fitsAsItIs) {
    bitmap.close();
    return file;
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

  /*
    A photograph at 3000px (4000 at «Înaltă») and quality 0.95 can still exceed the send limit.
    Rather than refuse it at the server with a message about megabytes, step the long edge down
    until it fits — quality is held, because size is the constraint the platform actually has and
    softness is the one the reader actually sees.
  */
  if (encoded.size <= SEND_LIMIT) return encoded;
  return shrinkToFit(canvas, SEND_LIMIT);
}

async function shrinkToFit(source: HTMLCanvasElement, limit: number): Promise<Blob> {
  let width = source.width;
  let height = source.height;
  let out: Blob | null = null;

  // Four halvings of area is 375px from 3000px — far past anything a photograph needs to be,
  // so the loop is bounded by arithmetic rather than by hoping.
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
    if (out.size <= limit) return out;
  }
  if (!out) throw new Error("encode failed");
  return out;
}
