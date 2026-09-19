import { readFile } from "node:fs/promises";
import { plainInline } from "./domain/inline";
import path from "node:path";
import PDFDocument from "pdfkit";
import { COLOR } from "@/theme/brand";
import type { LegalDocumentBody } from "./domain/content-hash";

/**
 * A legal document version as a PDF: the club's lockup, the title, the version and the date it
 * takes effect, the text, and on every page the hash and the page number (BR-REQ-053-03).
 *
 * ## Why a PDF, and why this library
 *
 * The owner asked for it on 2026-09-17: a declaration he can download from the backoffice,
 * carrying the logo and the version, to read on paper or send on. It is a *rendering* of a
 * stored version — the same rows the public page reads, the same hash — never a source of text,
 * so `AGENTS.md` §11.1 (no CMS writes legal text) is untouched.
 *
 * `pdfkit`, pinned, is the one dependency (`DECISIONS.md` §63): pure JavaScript, no browser and
 * no native binary — a headless Chromium does not fit a serverless function — with text
 * wrapping, page breaks and TrueType embedding built in. It is loaded here and nowhere else, on
 * the server only, so no visitor pays a byte for it.
 *
 * ## The font is embedded, and it is the site's own
 *
 * PDF's fourteen standard fonts cannot spell ș, ț, ă, â or î, so the text is set in Roboto —
 * the site's body face — from `src/theme/pdf/`, two static weights subset to Latin Extended
 * (SIL OFL; licence beside them). `options.font` is the buffer, so pdfkit never loads Helvetica
 * and never reads its metrics from disk.
 *
 * ## Pure over its inputs
 *
 * Everything user-facing arrives in `labels`, already translated by the caller, so this module
 * holds no prose and renders either language. The clock is injected (`generatedAt`) for the
 * same reason every time-dependent rule takes one (`AGENTS.md` §1.5).
 */

export type LegalPdfInput = {
  /** The version's own facts, exactly as stored. */
  version: number;
  isApproved: boolean;
  effectiveAt: Date;
  contentSha256: string;
  /** One locale's translation. */
  title: string;
  body: LegalDocumentBody;
  locale: string;
  generatedAt: Date;
  labels: {
    /** The club's name, for the document's author and the footer. */
    organization: string;
    /** "Version {version}", already formatted. */
    version: string;
    /** "Effective from {date}", already formatted. */
    effectiveFrom: string;
    /** Shown in a band under the title when the version is not approved. Empty when it is. */
    draftNotice: string;
    /** "Generated on {date}", already formatted. */
    generatedOn: string;
    /** "Page {n} of {total}" — called per page. */
    page: (n: number, total: number) => string;
  };
};

const ASSETS = path.join(process.cwd(), "src", "theme", "pdf");

/** A4 in points, and the margins the text sits inside. */
const PAGE = { width: 595.28, height: 841.89 } as const;
const MARGIN = { top: 56, bottom: 64, left: 56, right: 56 } as const;
const TEXT_WIDTH = PAGE.width - MARGIN.left - MARGIN.right;

// The site's own tokens: `brand.ts` is the one file allowed a hex value, and a printed
// declaration should look like the site that produced it.
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

  // The lockup, whole, at the top of the first page — the same artwork as the header.
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
    // A band, not a watermark: a watermark is decoration people learn to read past, and a
    // sentence in a box under the title is read before the text is.
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

  // The text. pdfkit breaks pages by itself; a heading is kept with its first paragraph by
  // asking for the room before drawing it, rather than trusting the break to land well.
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

  // Footers, once every page exists: the hash on every page is what makes a printed copy
  // checkable against the stored version, and the page count is what makes a missing page
  // noticeable.
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
