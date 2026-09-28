import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Roboto regular and bold for `next/og` pictures — share cards (§90) and bibs (§94); Satori's
 * fallback has one weight. Literal paths so the files are traced into each function.
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
