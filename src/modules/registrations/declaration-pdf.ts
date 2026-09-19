import { readFile } from "node:fs/promises";
import path from "node:path";
import PDFDocument from "pdfkit";
import type { LegalDocumentBody } from "@/modules/legal-documents/domain/content-hash";
import { COLOR } from "@/theme/brand";

/**
 * A declaration as the club's paper one looks (`DECISIONS.md` §95): the lockup, the title
 * centred, the text with its blanks filled — or left as dotted blanks on the form printed for
 * the desk — and at the foot "DREPT PENTRU CARE SEMNEZ", the signature and the date.
 *
 * Two uses of one renderer. **Signed**: one participant's acceptance, the name they typed set
 * in the handwriting face the page showed it in (Caveat, the site's own signature font,
 * OFL beside it), the instant, the method, the version and the hash — a copy for the runner
 * and the club's record. **Blank**: the same text for one event with every field a blank,
 * to print for a runner whose email never arrived and who signs at the table.
 *
 * `pdfkit` as in `legal-documents/pdf.ts`; Roboto for the text because the standard fonts
 * cannot spell ș and ț. Pure over its inputs: every label arrives translated.
 */
export type DeclarationEntry = {
  title: string;
  /** Already merged (`mergeLegalBody`): the fill-ins are in the text, or the dotted blanks are. */
  body: LegalDocumentBody;
  eventTitle: string;
  /** The version's facts, under the signature and in the document's subject. */
  version: number;
  contentSha256: string;
  /** Absent for the blank form. */
  signature?: {
    typedName: string;
    idDocument: string | null;
    signedAt: string;
    /** "Signed electronically from the link sent by email" or "Signed on paper, recorded by X". */
    method: string;
  };
};

export type DeclarationPdfInput = {
  /** One for a runner's copy or the blank form; every signed one of an event for the archive. */
  entries: readonly DeclarationEntry[];
  locale: string;
  generatedAt: Date;
  labels: {
    organization: string;
    whereupon: string;
    signature: string;
    date: string;
    idDocument: string;
    version: string;
    generatedOn: string;
    page: (n: number, total: number) => string;
  };
};

const ASSETS = path.join(process.cwd(), "src", "theme", "pdf");
/** Opened once per document (`doc.openImage`): pdfkit embeds a Buffer again on every `image()` call, and two hundred copies of the lockup are the difference between two megabytes and ten. */
let LOGO: Buffer;
const PAGE = { width: 595.28, height: 841.89 } as const;
const MARGIN = { top: 48, bottom: 64, left: 56, right: 56 } as const;
const TEXT_WIDTH = PAGE.width - MARGIN.left - MARGIN.right;
const BLANK_LINE = "………………………………………………";

export async function renderDeclarationPdf(input: DeclarationPdfInput): Promise<Buffer> {
  const [regular, bold, hand, logo] = await Promise.all([
    readFile(path.join(ASSETS, "Roboto-Regular.ttf")),
    readFile(path.join(ASSETS, "Roboto-Bold.ttf")),
    readFile(path.join(ASSETS, "Caveat-Regular.ttf")),
    readFile(path.join(ASSETS, "logo.png")),
  ]);
  LOGO = logo;

  const first = input.entries[0];
  const doc = new PDFDocument({
    size: "A4",
    margins: MARGIN,
    bufferPages: true,
    autoFirstPage: false,
    font: regular as unknown as string,
    lang: input.locale,
    info: {
      Title: first ? `${first.title} — ${first.eventTitle}` : input.labels.organization,
      Author: input.labels.organization,
      Subject: first ? `${input.labels.version} ${first.version} · sha256 ${first.contentSha256}` : "",
      CreationDate: input.generatedAt,
      ModDate: input.generatedAt,
    },
  });
  doc.registerFont("body", regular);
  doc.registerFont("bold", bold);
  doc.registerFont("hand", hand);

  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  // `openImage` is real and undeclared in `@types/pdfkit`; the object it returns is what `image()` reuses.
  const lockup = (doc as unknown as { openImage(src: Buffer): unknown }).openImage(LOGO);
  for (const entry of input.entries) drawEntry(doc, entry, input.labels, lockup);

  // A bundle with nothing in it is still a valid file that says so, rather than an error.
  if (input.entries.length === 0) {
    doc.addPage();
    doc.font("body").fontSize(12).fillColor(COLOR.inkMuted).text("—", MARGIN.left, MARGIN.top);
  }

  // Footers: the page count is what makes a missing page noticeable; the hash of each text
  // is under its own signature block, where a printed copy is checked against the version.
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const y = PAGE.height - MARGIN.bottom + 22;
    doc.moveTo(MARGIN.left, y - 8).lineTo(PAGE.width - MARGIN.right, y - 8).strokeColor(COLOR.line).lineWidth(0.5).stroke();
    doc
      .font("body")
      .fontSize(8)
      .fillColor(COLOR.inkMuted)
      .text(`${input.labels.organization} · ${input.labels.generatedOn}`, MARGIN.left, y, { width: TEXT_WIDTH - 90, lineBreak: false })
      .text(input.labels.page(i + 1, range.count), MARGIN.left, y, { width: TEXT_WIDTH, align: "right", lineBreak: false });
    doc.page.margins.bottom = bottom;
  }

  doc.end();
  return finished;
}

function drawEntry(doc: PDFKit.PDFDocument, entry: DeclarationEntry, labels: DeclarationPdfInput["labels"], lockup: unknown): void {
  doc.addPage();
  // The lockup, and the title centred under it, as the paper form has them.
  const logoWidth = 140;
  doc.image(lockup as string, MARGIN.left, MARGIN.top, { width: logoWidth });
  doc.y = MARGIN.top + logoWidth * (495 / 1200) + 20;
  doc.font("bold").fontSize(14).fillColor(COLOR.ink).text(entry.title.toUpperCase(), MARGIN.left, doc.y, { width: TEXT_WIDTH, align: "center" });
  doc.moveDown(0.2);
  doc.font("body").fontSize(11).fillColor(COLOR.ink).text(entry.eventTitle, { width: TEXT_WIDTH, align: "center" });
  doc.moveDown(1.2);

  // The text. A heading is kept with its first paragraph; a paragraph that starts with a
  // bullet is indented as one.
  for (const section of entry.body.sections) {
    if (section.heading) {
      const needed = doc.font("bold").fontSize(11).heightOfString(section.heading, { width: TEXT_WIDTH }) + 30;
      if (doc.y + needed > PAGE.height - MARGIN.bottom - 120) doc.addPage();
      doc.font("bold").fontSize(11).fillColor(COLOR.ink).text(section.heading, { width: TEXT_WIDTH });
      doc.moveDown(0.3);
    }
    for (const paragraph of section.paragraphs) {
      const bullet = /^[•\-–]\s/.test(paragraph);
      doc
        .font("body")
        .fontSize(10.5)
        .fillColor(COLOR.ink)
        .text(paragraph, bullet ? MARGIN.left + 14 : MARGIN.left, doc.y, { width: bullet ? TEXT_WIDTH - 14 : TEXT_WIDTH, lineGap: 2, align: "justify" });
      doc.x = MARGIN.left;
      doc.moveDown(bullet ? 0.3 : 0.6);
    }
    doc.moveDown(0.3);
  }

  // The signature block, kept together at the foot.
  const blockHeight = 170;
  if (doc.y + blockHeight > PAGE.height - MARGIN.bottom) doc.addPage();
  doc.moveDown(1);
  doc.font("bold").fontSize(11).fillColor(COLOR.ink).text(labels.whereupon, MARGIN.left, doc.y, { width: TEXT_WIDTH });
  doc.moveDown(0.8);

  const row = (label: string, value: string | null, hand = false) => {
    const y = doc.y;
    doc.font("body").fontSize(10.5).fillColor(COLOR.ink).text(`${label}:`, MARGIN.left, y, { lineBreak: false });
    const x = MARGIN.left + doc.widthOfString(`${label}:`) + 8;
    if (value === null) {
      doc.font("body").fontSize(10.5).fillColor(COLOR.inkMuted).text(BLANK_LINE, x, y, { lineBreak: false });
      doc.y = y + 22;
    } else if (hand) {
      // The typed name in the hand the page showed it in, sitting on the same baseline as its label.
      doc.font("hand").fontSize(26).fillColor(COLOR.blueInk).text(value, x, y - 10, { lineBreak: false });
      doc.y = y + 30;
    } else {
      doc.font("body").fontSize(10.5).fillColor(COLOR.ink).text(value, x, y, { lineBreak: false });
      doc.y = y + 22;
    }
    doc.x = MARGIN.left;
  };

  const signature = entry.signature;
  row(labels.signature, signature ? signature.typedName : null, Boolean(signature));
  if (signature ? signature.idDocument !== null : true) row(labels.idDocument, signature ? signature.idDocument : null);
  row(labels.date, signature ? signature.signedAt : null);
  doc.moveDown(0.4);
  // How it was signed, and against which text: the version and the hash a printed copy is
  // checked against the stored version with.
  doc
    .font("body")
    .fontSize(8.5)
    .fillColor(COLOR.inkMuted)
    .text(
      [signature?.method, `${labels.version} ${entry.version} · sha256 ${entry.contentSha256}`].filter(Boolean).join("\n"),
      MARGIN.left,
      doc.y,
      { width: TEXT_WIDTH },
    );
}
