import { readFile } from "node:fs/promises";
import path from "node:path";
import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import { CLUB_NAME } from "@/theme/brand";
import { type Box, mm } from "./domain/sheets";
import type { LogoVector } from "./logo-vector";

/**
 * What the «PR Kit»'s PDFs share (§1015): a document with the site's Roboto, collected into one buffer; the logo drawn from its
 * vector paths (`logo-vector.ts`); a code drawn module by module from `qrcode`'s matrix, never a picture — so a print shop
 * enlarges either without a soft edge. Every size in here is in millimetres and turned into points at the last moment.
 */

const ASSETS = path.join(process.cwd(), "src", "theme", "pdf");

export type KitDocument = { doc: PDFKit.PDFDocument; finished: Promise<Buffer> };

/**
 * A document of one page of `size` points (A4 when not said), no margin — every position below is absolute — the site's two
 * Roboto weights registered as `body` and `bold`, and the bytes gathered as pdfkit writes them.
 */
export async function kitDocument(info: { title: string; generatedAt: Date }, size: [number, number] | "A4" = "A4"): Promise<KitDocument> {
  const [regular, bold] = await Promise.all([readFile(path.join(ASSETS, "Roboto-Regular.ttf")), readFile(path.join(ASSETS, "Roboto-Bold.ttf"))]);
  const doc = new PDFDocument({
    size,
    margin: 0,
    // A Buffer is what `doc.font()` accepts; only `@types/pdfkit` still says string here.
    font: regular as unknown as string,
    info: { Title: info.title, Author: CLUB_NAME, CreationDate: info.generatedAt, ModDate: info.generatedAt },
  });
  doc.registerFont("body", regular);
  doc.registerFont("bold", bold);
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  return { doc, finished };
}

/**
 * The logo's drawing — not its frame — laid into `box` (millimetres) in one colour: the file's own paths under its own
 * translation, scaled so the drawing fills the box's width. Each path keeps its fill rule (the runners are even-odd).
 */
export function drawLogo(doc: PDFKit.PDFDocument, vector: LogoVector, box: Box, hex: string): void {
  const scale = mm(box.width) / vector.drawing.width;
  doc.save();
  doc.transform(scale, 0, 0, scale, mm(box.x) - vector.drawing.x * scale, mm(box.y) - vector.drawing.y * scale);
  doc.translate(vector.translate[0], vector.translate[1]);
  for (const { d, evenOdd } of vector.paths) doc.path(d).fill(hex, evenOdd ? "evenodd" : "nonzero");
  doc.restore();
}

/** A code's modules for an address: `qrcode`'s matrix, `size` modules on a side. */
export type CodeMatrix = { size: number; dark: (row: number, column: number) => boolean };

export function codeMatrix(text: string, level: "M" | "Q"): CodeMatrix {
  const { modules } = QRCode.create(text, { errorCorrectionLevel: level });
  return { size: modules.size, dark: (row, column) => modules.get(row, column) === 1 };
}

/**
 * The code drawn as vector squares, black on whatever is under it (the caller keeps that white and the quiet zone clear).
 * Each row's dark run is one rectangle, a hair taller than its module where another row follows, so no viewer draws a seam
 * between two rows of the same black.
 */
export function drawCode(doc: PDFKit.PDFDocument, matrix: CodeMatrix, box: Box, hex: string): void {
  const side = mm(box.width) / matrix.size;
  const left = mm(box.x);
  const top = mm(box.y);
  const seam = Math.min(0.05, side / 20);
  for (let row = 0; row < matrix.size; row += 1) {
    let column = 0;
    while (column < matrix.size) {
      if (!matrix.dark(row, column)) {
        column += 1;
        continue;
      }
      let end = column;
      while (end < matrix.size && matrix.dark(row, end)) end += 1;
      doc.rect(left + column * side, top + row * side, (end - column) * side, side + (row < matrix.size - 1 ? seam : 0));
      column = end;
    }
  }
  doc.fill(hex);
}

/**
 * The largest size, up to `size`, at which a line of `font` fits `width` (both in millimetres): an address longer than the
 * sticker was drawn for is set smaller, never cut and never run over the cut.
 */
export function fittedSize(doc: PDFKit.PDFDocument, text: string, font: "body" | "bold", size: number, width: number, characterSpacing = 0): number {
  doc.font(font).fontSize(mm(size));
  const measured = doc.widthOfString(text, { characterSpacing: mm(characterSpacing) });
  return measured <= mm(width) ? size : (size * mm(width)) / measured;
}

/** One line of text with its baseline at `baseline` (millimetres), centred on `centre` or starting at `left`. */
export function textLine(
  doc: PDFKit.PDFDocument,
  text: string,
  at: { font: "body" | "bold"; size: number; baseline: number; colour: string; characterSpacing?: number } & ({ centre: number } | { left: number }),
): number {
  doc.font(at.font).fontSize(mm(at.size)).fillColor(at.colour);
  const options = { lineBreak: false, baseline: "alphabetic" as const, characterSpacing: mm(at.characterSpacing ?? 0) };
  // pdfkit 0.20 counts the spacing between the letters only, so the width is the letters' own.
  const width = doc.widthOfString(text, options);
  const x = "centre" in at ? mm(at.centre) - width / 2 : mm(at.left);
  doc.text(text, x, mm(at.baseline), options);
  return (width * 25.4) / 72;
}

/** A line's width in millimetres, as `textLine` would draw it. */
export function textWidth(doc: PDFKit.PDFDocument, text: string, font: "body" | "bold", size: number, characterSpacing = 0): number {
  doc.font(font).fontSize(mm(size));
  return (doc.widthOfString(text, { characterSpacing: mm(characterSpacing) }) * 25.4) / 72;
}
