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

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}
