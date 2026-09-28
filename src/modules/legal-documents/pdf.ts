import { readFile } from "node:fs/promises";
import { plainInline } from "./domain/inline";
import path from "node:path";
import PDFDocument from "pdfkit";
import { COLOR } from "@/theme/brand";
import type { LegalDocumentBody } from "./domain/content-hash";

/**
 * A legal version as a PDF: lockup, title, version, effective date, text, and the hash and page
 * number on every page (BR-REQ-053-03). A rendering only, never a source of text (AGENTS.md §11.1).
 * `pdfkit` (§63): no browser or native binary, server-only. Roboto is embedded because the
 * standard PDF fonts cannot spell ș, ț, ă, â, î; `options.font` is the buffer, so pdfkit never
 * loads Helvetica from disk. Labels arrive translated and the clock injected (AGENTS.md §1.5).
 */

export type LegalPdfInput = {
  version: number;
  isApproved: boolean;
  effectiveAt: Date;
  contentSha256: string;
  title: string;
  body: LegalDocumentBody;
  locale: string;
  generatedAt: Date;
  labels: {
    organization: string;
    /** "Version {version}", already formatted. */
    version: string;
    /** "Effective from {date}", already formatted. */
    effectiveFrom: string;
    /** Empty when the version is approved. */
    draftNotice: string;
    /** "Generated on {date}", already formatted. */
    generatedOn: string;
    page: (n: number, total: number) => string;
  };
};

const ASSETS = path.join(process.cwd(), "src", "theme", "pdf");

/** A4 in points. */
const PAGE = { width: 595.28, height: 841.89 } as const;
const MARGIN = { top: 56, bottom: 64, left: 56, right: 56 } as const;
const TEXT_WIDTH = PAGE.width - MARGIN.left - MARGIN.right;

// `brand.ts` is the one file allowed a hex value.
const INK = COLOR.ink;
const MUTED = COLOR.inkMuted;
const RULE = COLOR.line;
const DRAFT = COLOR.orange;

export async function renderLegalDocumentPdf(input: LegalPdfInput): Promise<Buffer> {
  const [regular, bold, logo] = await Promise.all([
    readFile(path.join(ASSETS, "Roboto-Regular.ttf")),
    readFile(path.join(ASSETS, "Roboto-Bold.ttf")),
    readFile(path.join(ASSETS, "logo.png")),
  ]);

  const doc = new PDFDocument({
    size: "A4",
    margins: MARGIN,
    bufferPages: true,
    // A Buffer is what `doc.font()` accepts and what the constructor hands to it; only
    // `@types/pdfkit` still says string here.
    font: regular as unknown as string,
    lang: input.locale,
    info: {
      Title: input.title,
      Author: input.labels.organization,
      Subject: `${input.labels.version} · sha256 ${input.contentSha256}`,
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

  const logoWidth = 150;
  doc.image(logo, MARGIN.left, MARGIN.top, { width: logoWidth });
  doc.moveDown();
  doc.y = MARGIN.top + logoWidth * (495 / 1200) + 18;

  doc.font("bold").fontSize(20).fillColor(INK).text(input.title, { width: TEXT_WIDTH });
  doc.moveDown(0.4);
  doc
    .font("body")
    .fontSize(10)
    .fillColor(MUTED)
    .text(`${input.labels.version} · ${input.labels.effectiveFrom}`, { width: TEXT_WIDTH });

  if (!input.isApproved && input.labels.draftNotice) {
    // A band, not a watermark: read before the text, not learned past.
    doc.moveDown(0.8);
    const bandTop = doc.y;
    const bandHeight =
      doc.font("bold").fontSize(10.5).heightOfString(input.labels.draftNotice, { width: TEXT_WIDTH - 24 }) + 16;
    doc.rect(MARGIN.left, bandTop, TEXT_WIDTH, bandHeight).fillOpacity(0.14).fill(DRAFT).fillOpacity(1);
    doc
      .fillColor(INK)
      .text(input.labels.draftNotice, MARGIN.left + 12, bandTop + 8, { width: TEXT_WIDTH - 24 });
    // `text(…, x, y)` moves the left edge for everything after it; put it back.
    doc.x = MARGIN.left;
    doc.y = bandTop + bandHeight;
  }

  doc.moveDown(1);
  doc.moveTo(MARGIN.left, doc.y).lineTo(PAGE.width - MARGIN.right, doc.y).strokeColor(RULE).lineWidth(0.75).stroke();
  doc.moveDown(1);

  // A heading is kept with its first paragraph by checking the room before drawing it.
  for (const section of input.body.sections) {
    if (section.heading) {
      const needed = doc.font("bold").fontSize(12.5).heightOfString(section.heading, { width: TEXT_WIDTH }) + 36;
      if (doc.y + needed > PAGE.height - MARGIN.bottom) doc.addPage();
      doc.font("bold").fontSize(12.5).fillColor(INK).text(section.heading, { width: TEXT_WIDTH });
      doc.moveDown(0.4);
    }
    for (const paragraph of section.paragraphs) {
      doc.font("body").fontSize(10.5).fillColor(INK).text(plainInline(paragraph), { width: TEXT_WIDTH, lineGap: 2.5 });
      doc.moveDown(0.6);
    }
    doc.moveDown(0.4);
  }

  // Footers once every page exists: the hash makes a printed copy checkable, the count a missing page noticeable.
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    // Writing below the bottom margin would open a new page; lift the margin for the footer.
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const y = PAGE.height - MARGIN.bottom + 22;
    doc.moveTo(MARGIN.left, y - 8).lineTo(PAGE.width - MARGIN.right, y - 8).strokeColor(RULE).lineWidth(0.5).stroke();
    doc
      .font("body")
      .fontSize(8)
      .fillColor(MUTED)
      .text(
        `${input.labels.organization} · ${input.labels.version} · sha256 ${input.contentSha256.slice(0, 16)}… · ${input.labels.generatedOn}`,
        MARGIN.left,
        y,
        { width: TEXT_WIDTH - 90, lineBreak: false },
      )
      .text(input.labels.page(i + 1, range.count), MARGIN.left, y, { width: TEXT_WIDTH, align: "right", lineBreak: false });
    doc.page.margins.bottom = bottom;
  }

  doc.end();
  return finished;
}
