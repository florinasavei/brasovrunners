import { readFile } from "node:fs/promises";
import path from "node:path";
import PDFDocument from "pdfkit";
import { COLOR } from "@/theme/brand";
import { bibBandColour, bibFooterLine } from "./bib-design";
import type { BibRow } from "./bibs";

/**
 * Race numbers as a sheet to print (BR-REQ-038-01, `DECISIONS.md` §180): A4 portrait, two bibs
 * per page, a dashed cut line between them — and each bib laid out as a race number actually
 * is, rather than as a certificate with a logo in the corner.
 *
 * A coloured band across the whole top, in the event's own `bib_colour` and the club's blue
 * when it names none (§173, `bib-design.ts`); the lockup in white at the left of it and the
 * race and its date at the right, both on the band; the number filling everything under it in
 * the body ink; the registered name beneath; and one thin line at the foot naming the partners
 * (§168) and the mailbox the club answers on. That is the order the eye reads a bib in at a
 * start line — colour first, which start line; then the number; then, close up, the name.
 *
 * Two per page because that is what a club prints at home: an A4 folded or cut in half is the
 * size a number is worn at (A5, roughly 21 × 15 cm), and a page per bib would double the paper
 * for no wider a number. The number is set in the site's Roboto Bold from `src/theme/pdf/`
 * (the same face and files the legal PDF uses, §63), which also covers every name with a
 * diacritic; the lockup is `logo-white.png`, the white-on-transparent raster
 * `scripts/brand-assets.mjs` writes — the email's white lockup is baked onto the club's blue
 * and would show its own rectangle on a green band.
 *
 * **No telephone number is printed**, the participant's least of all their emergency contact:
 * see `bibFooterLine`.
 *
 * Pure over its inputs: rows, an event header and a label for the footer; the caller decides
 * the language.
 */

export type BibSheetInput = {
  rows: readonly Pick<BibRow, "bibNumber" | "registeredName">[];
  eventTitle: string;
  /** Already formatted in the event's zone and the sheet's language. */
  eventDate: string;
  /** The event's `bib_colour`; null is the club's own (§173). */
  bandColour?: string | null;
  /** The partners' names, as `readCoHosts` gives them (§168). */
  partners?: readonly string[];
  /** `EMAIL_REPLY_TO`, the mailbox every email already says to write to. */
  replyTo?: string | null;
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

/** The coloured strip along the top, and the strip of small print along the bottom. */
const BAND_HEIGHT = 62;
const FOOTER_HEIGHT = 22;
/** How much room the name takes under the number, so the number knows what is left. */
const NAME_BLOCK = 44;

export async function renderBibSheet(input: BibSheetInput): Promise<Buffer> {
  const [regular, bold, logo] = await Promise.all([
    readFile(path.join(ASSETS, "Roboto-Regular.ttf")),
    readFile(path.join(ASSETS, "Roboto-Bold.ttf")),
    readFile(path.join(ASSETS, "logo-white.png")),
  ]);
  const band = bibBandColour(input.bandColour);
  const footer = bibFooterLine(input.partners ?? [], input.replyTo);

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

  /*
    The lockup embedded once, then drawn on every bib.

    `doc.image(buffer, …)` embeds a fresh copy of the bytes each time it is called — pdfkit
    only dedupes when it is handed a path string it can key a registry on — so a two-hundred
    runner sheet was carrying two hundred copies of the same 18 KiB raster. `openImage` returns
    the embeddable object to reuse; it is missing from `@types/pdfkit`, like the font buffers
    above, hence the cast rather than a second file read.
  */
  const lockup = (doc as unknown as { openImage: (src: Buffer) => Buffer }).openImage(logo);

  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const drawBib = (row: Pick<BibRow, "bibNumber" | "registeredName">, top: number) => {
    const left = MARGIN;

    // The band first, edge to edge across the top: it is what says which race this is before
    // anybody is close enough to read a word of it.
    doc.rect(left, top, BIB.width, BAND_HEIGHT).fill(band);

    // The lockup at the left of the band, white on whatever colour the band is; the race and
    // its date at the right, also white. 2.424:1, the lockup's own proportion.
    const logoWidth = 122;
    doc.image(lockup, left + 18, top + (BAND_HEIGHT - logoWidth / 2.424) / 2, { width: logoWidth });
    const headerLeft = left + logoWidth + 36;
    const headerWidth = BIB.width - logoWidth - 54;
    doc
      .font("bold")
      .fontSize(13)
      .fillColor(COLOR.surface)
      .text(input.eventTitle, headerLeft, top + 15, { width: headerWidth, align: "right", lineBreak: false, ellipsis: true })
      .font("body")
      .fontSize(10.5)
      .text(input.eventDate, headerLeft, top + 34, { width: headerWidth, align: "right", lineBreak: false, ellipsis: true });

    // The number: everything the card has left under the band, in the body ink — a number is
    // read at distance, and ink on white is the highest contrast the paper can carry.
    const digits = String(row.bibNumber);
    const numberSize = digits.length >= 5 ? 140 : digits.length === 4 ? 175 : 200;
    const numberArea = BIB.height - BAND_HEIGHT - FOOTER_HEIGHT - NAME_BLOCK;
    doc.font("bold").fontSize(numberSize).fillColor(COLOR.ink);
    const numberHeight = doc.heightOfString(digits, { width: BIB.width, lineBreak: false });
    doc.text(digits, left, top + BAND_HEIGHT + Math.max(0, (numberArea - numberHeight) / 2), {
      width: BIB.width,
      align: "center",
      lineBreak: false,
    });

    // The name, under the number, large enough to read at a finish line.
    doc
      .font("bold")
      .fontSize(24)
      .fillColor(COLOR.ink)
      .text(row.registeredName, left + 18, top + BIB.height - FOOTER_HEIGHT - 34, {
        width: BIB.width - 36,
        align: "center",
        lineBreak: false,
        ellipsis: true,
      });

    // The small print: who is putting the race on, and where to write. Never a telephone
    // number — `bibFooterLine` says why.
    if (footer) {
      doc
        .font("body")
        .fontSize(8)
        .fillColor(COLOR.inkMuted)
        .text(footer, left + 18, top + BIB.height - 16, {
          width: BIB.width - 36,
          align: "center",
          lineBreak: false,
          ellipsis: true,
        });
    }

    // The bib's edge, thin, so the cut is guided on all four sides. Last, over the band, so
    // the band's own corner does not sit on top of it.
    doc.rect(left, top, BIB.width, BIB.height).lineWidth(0.75).strokeColor(COLOR.line).stroke();
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
