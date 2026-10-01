import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * The two Roboto files the PDF sheet embeds, for the pictures `next/og` draws — the share
 * cards (`DECISIONS.md` §90) and the bibs (§94). Satori's bundled fallback has one weight,
 * so without these a race number is never bold. Literal paths, so the files are traced into
 * each function that reads them; read once per process.
 */
type OgFont = { name: string; data: ArrayBuffer; weight: 400 | 700; style: "normal" };

let fonts: Promise<OgFont[]> | undefined;

export function brandFonts(): Promise<OgFont[]> {
  fonts ??= Promise.all([
    readFile(path.join(process.cwd(), "src", "theme", "pdf", "Roboto-Regular.ttf")),
    readFile(path.join(process.cwd(), "src", "theme", "pdf", "Roboto-Bold.ttf")),
  ]).then(([regular, bold]) => [
    { name: "Roboto", data: toArrayBuffer(regular), weight: 400, style: "normal" },
    { name: "Roboto", data: toArrayBuffer(bold), weight: 700, style: "normal" },
  ]);
  return fonts;
}

let handwriting: Promise<OgFont> | undefined;

/**
 * Caveat, the site's handwriting face — the one the signed declaration's PDF already embeds — for
 * the share card's tagline (§NNN). Its own function rather than a third entry of `brandFonts`:
 * the file is six times Roboto's, Satori parses every font it is handed on every picture, and
 * only a card that carries a tagline draws a letter of it — the bibs and the plain card never do.
 */
export function handwritingFont(): Promise<OgFont> {
  handwriting ??= readFile(path.join(process.cwd(), "src", "theme", "pdf", "Caveat-Regular.ttf")).then((data) => ({
    name: "Caveat",
    data: toArrayBuffer(data),
    weight: 400,
    style: "normal",
  }));
  return handwriting;
}

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}
