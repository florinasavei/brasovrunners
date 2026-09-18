import { readFile } from "node:fs/promises";
import path from "node:path";
import PDFDocument from "pdfkit";
import { COLOR } from "@/theme/brand";
import type { BibRow } from "./bibs";

/**
 * Race numbers as a sheet to print (BR-REQ-038-01): A4 portrait, two bibs per page, a dashed
 * cut line between them, each bib the club's lockup, the number as large as the paper allows,
 * the participant's registered name, and the event's title and date.
 *
 * Two per page because that is what a club prints at home: an A4 folded or cut in half is the
 * size a number is worn at (A5, roughly 21 × 15 cm), and a page per bib would double the paper
 * for no wider a number. The number is set in the site's Roboto Bold from `src/theme/pdf/`
 * (the same face and files the legal PDF uses, `DECISIONS.md` §63), which also covers every
 * name with a diacritic; the logo is the same rasterised lockup.
 *
 * Pure over its inputs: rows, an event header and a label for the footer; the caller decides
 * the language.
 */

export type BibSheetInput = {
  rows: readonly BibRow[];
  eventTitle: string;
  /** Already formatted in the event's zone and the sheet's language. */
  eventDate: string;
  /** "Page n of N", called per page. */
  pageLabel: (n: number, total: number) => string;
  generatedAt: Date;
  /**
   * `two`: two A5-sized bibs on each A4 page with a dashed cut line — the default sheet.
   * `one`: the same A5-sized bib, one per A4 page, centred, for a printer that will not take
   * a cut or a club that pins the whole page (`DECISIONS.md` §79).
   */
  layout?: "two" | "one";
};

const ASSETS = path.join(process.cwd(), "src", "theme", "pdf");

const PAGE = { width: 595.28, height: 841.89 } as const;
const MARGIN = 28;
const GAP = 16;
/** Two bibs stacked on a portrait page, the cut line in the gap between them. */
const BIB = {
  width: PAGE.width - 2 * MARGIN,
  height: (PAGE.height - 2 * MARGIN - GAP) / 2,
} as const;

export async function renderBibSheet(input: BibSheetInput): Promise<Buffer> {
  const [regular, bold, logo] = await Promise.all([
    readFile(path.join(ASSETS, "Roboto-Regular.ttf")),
    readFile(path.join(ASSETS, "Roboto-Bold.ttf")),
    readFile(path.join(ASSETS, "logo.png")),
  ]);

  const doc = new PDFDocument({
    size: "A4",
    margin: MARGIN,
    bufferPages: true,
    autoFirstPage: false,
    // A Buffer is what `doc.font()` accepts; only `@types/pdfkit` still says string here.
    font: regular as unknown as string,
    info: {
      Title: `${input.eventTitle} — bibs`,
      Author: "Brașov Runners",
      CreationDate: input.generatedAt,
      ModDate: input.generatedAt,
    },
  });
  doc.registerFont("body", regular);
  doc.registerFont("bold", bold);

  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const drawBib = (row: BibRow, top: number) => {
    const left = MARGIN;
    // The bib's edge, thin, so the cut is guided on all four sides.
    doc.rect(left, top, BIB.width, BIB.height).lineWidth(0.75).strokeColor(COLOR.line).stroke();

    // Lockup, top-left; title and date, top-right, in the muted ink.
    const logoWidth = 120;
    doc.image(logo, left + 18, top + 16, { width: logoWidth });
    doc
      .font("body")
      .fontSize(11)
      .fillColor(COLOR.inkMuted)
      .text(input.eventTitle, left + logoWidth + 36, top + 20, {
        width: BIB.width - logoWidth - 54,
        align: "right",
        lineBreak: false,
      })
      .text(input.eventDate, left + logoWidth + 36, top + 36, {
        width: BIB.width - logoWidth - 54,
        align: "right",
        lineBreak: false,
      });

    // The number: as big as the width allows for four digits, centred, in the club's blue.
    const numberSize = 190;
    doc
      .font("bold")
      .fontSize(numberSize)
      .fillColor(COLOR.blue)
      .text(String(row.bibNumber), left, top + BIB.height / 2 - numberSize * 0.62, {
        width: BIB.width,
        align: "center",
        lineBreak: false,
      });

    // The name, under the number, large enough to read at a finish line.
    doc
      .font("bold")
      .fontSize(22)
      .fillColor(COLOR.ink)
      .text(row.registeredName, left + 18, top + BIB.height - 54, {
        width: BIB.width - 36,
        align: "center",
        lineBreak: false,
        ellipsis: true,
      });
  };

  if (input.layout === "one") {
    // The bib keeps its size — an A5 number on a shirt is the size that reads from the finish
    // line — and sits in the middle of the page, so the cut is optional.
    for (const row of input.rows) {
      doc.addPage();
      drawBib(row, (PAGE.height - BIB.height) / 2);
    }
  }

  for (let index = 0; input.layout !== "one" && index < input.rows.length; index += 2) {
    doc.addPage();
    drawBib(input.rows[index], MARGIN);
    if (input.rows[index + 1]) {
      // The cut line, in the gap, dashed so it reads as "cut here" and not as a rule.
      const y = MARGIN + BIB.height + GAP / 2;
      doc
        .moveTo(MARGIN, y)
        .lineTo(PAGE.width - MARGIN, y)
        .lineWidth(0.5)
        .strokeColor(COLOR.inkMuted)
        .dash(4, { space: 4 })
        .stroke()
        .undash();
      drawBib(input.rows[index + 1], MARGIN + BIB.height + GAP);
    }
  }

  // A sheet with nothing to print is still a valid file that says so, rather than an error.
  if (input.rows.length === 0) {
    doc.addPage();
    doc.font("body").fontSize(12).fillColor(COLOR.inkMuted).text("—", MARGIN, MARGIN);
  }

  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc
      .font("body")
      .fontSize(7)
      .fillColor(COLOR.inkMuted)
      .text(input.pageLabel(i + 1, range.count), MARGIN, PAGE.height - MARGIN + 8, {
        width: BIB.width,
        align: "right",
        lineBreak: false,
      });
    doc.page.margins.bottom = bottom;
  }

  doc.end();
  return finished;
}
