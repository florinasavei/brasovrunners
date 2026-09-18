/**
 * Shrink a picture in the browser before it is sent (BR-REQ-054-01, BR-REQ-050-03 c8): the
 * long side to at most 2000px, re-encoded as WebP, upright. Shared by the gallery uploader and
 * the editor's image button, because a phone photo is 4–12 MB and the server's limit is 6.
 * Client-side only: `createImageBitmap` and `canvas` do not exist on the server.
 */
export async function shrinkImageInBrowser(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("no canvas");
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("encode failed"))), "image/webp", 0.86);
  });
}
