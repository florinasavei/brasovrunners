import { readFile } from "node:fs/promises";
import path from "node:path";
import PDFDocument from "pdfkit";
import { COLOR } from "@/theme/brand";
import {
  bandTextColour,
  type BibDesign,
  bibBandColour,
  DEFAULT_BIB_DESIGN,
  numberScaleFactor,
} from "./bib-design";
import { bibFooterLines, bibFooterParts } from "./bib-footer";
import type { BibRow } from "./bibs";

/**
 * Race numbers as a sheet to print (BR-REQ-038-01, `DECISIONS.md` §180): A4 portrait, two bibs
 * per page, a dashed cut line between them — and each bib laid out as a race number actually
 * is, rather than as a certificate with a logo in the corner.
 *
 * A coloured band across the whole top, in the event's own `bib_colour` and the club's blue
 * when it names none (§173, `bib-design.ts`); the lockup in white at the left of it and the
 * race and its date at the right, both on the band; the number filling everything under it in
 * the body ink; the registered name beneath; and the small print at the foot — the partners
 * (§168) and the mailbox the club answers on unless the club composed it otherwise (§317), on one
 * line or two. That is the order the eye reads a bib in at a start line — colour first, which
 * start line; then the number; then, close up, the name.
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
 * see `bibFooterParts`.
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
  /** `APP_BASE_URL`, for the website in the footer when the club asks for it (§317). */
  siteUrl?: string | null;
  /** "Page n of N", called per page. */
  pageLabel: (n: number, total: number) => string;
  generatedAt: Date;
  /**
   * `two`: two A5-sized bibs on each A4 page with a dashed cut line — the default sheet.
   * `one`: the same A5-sized bib, one per A4 page, centred, for a printer that will not take
   * a cut or a club that pins the whole page (`DECISIONS.md` §79).
   */
  layout?: "two" | "one";
  /** What the club decided this bib shows (§249); absent is the platform's own design. */
  design?: BibDesign;
  /**
   * The header and sponsor pictures, already fetched by the caller.
   *
   * Bytes rather than addresses, deliberately: this function is pure over its inputs and a
   * printer sheet is not the place to discover that a store is slow. The route fetches them,
   * caps their size and hands over what it got — `null` where it got nothing, which prints the
   * coloured band exactly as before (§249).
   */
  pictures?: { header?: Buffer | null; sponsors?: Buffer | null };
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

/**
 * The small print's geometry (§317): 8 points, across the bib less 18 points each side, and a
 * second line 10 points above the first when the footer needs two. `width / size` is the
 * footer's measure in ems, `BIB_FOOTER_EMS`, which the picture shares — that is how the two
 * renderers break the footer in the same places.
 */
export const BIB_SHEET_FOOTER = { width: BIB.width - 36, size: 8, lineHeight: 10 } as const;

/**
 * The footer lines this sheet prints, decided by `bib-footer.ts` from the club's design. A
 * function of its own so the test can hold it beside the picture's: the two must agree.
 *
 * `headerPicture` is whether this sheet really draws the club's picture at the top — not
 * whether the design names one: a picture the route could not fetch prints the band, with the
 * title and the date the footer would otherwise repeat.
 */
export function bibSheetFooterLines(
  input: Pick<BibSheetInput, "design" | "partners" | "replyTo" | "siteUrl" | "eventTitle" | "eventDate">,
  headerPicture: boolean,
): string[] {
  return bibFooterLines(
    bibFooterParts(input.design ?? DEFAULT_BIB_DESIGN, {
      partners: input.partners ?? [],
      replyTo: input.replyTo,
      siteUrl: input.siteUrl,
      eventTitle: input.eventTitle,
      eventDate: input.eventDate,
      headerPicture,
    }),
  );
}

export async function renderBibSheet(input: BibSheetInput): Promise<Buffer> {
  const [regular, bold, logo] = await Promise.all([
    readFile(path.join(ASSETS, "Roboto-Regular.ttf")),
    readFile(path.join(ASSETS, "Roboto-Bold.ttf")),
    readFile(path.join(ASSETS, "logo-white.png")),
  ]);
  const band = bibBandColour(input.bandColour);
  const bandText = bandTextColour(band);
  const design = input.design ?? DEFAULT_BIB_DESIGN;

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
  const embed = (doc as unknown as { openImage: (src: Buffer) => Buffer }).openImage.bind(doc);
  const lockup = embed(logo);
  // The club's own pictures, embedded once each for the same reason the lockup is (§249).
  const headerPicture = input.pictures?.header ? embed(input.pictures.header) : null;
  const sponsorPicture = input.pictures?.sponsors ? embed(input.pictures.sponsors) : null;
  /** The strip of sponsors takes this much above the small print, when there is one. */
  const SPONSOR_HEIGHT = sponsorPicture ? 30 : 0;
  // The same on every bib of the sheet, so laid out once (§317), and told which header the sheet
  // really draws. A second line takes its height from the number's area, never from the small
  // print's size.
  const footerLines = bibSheetFooterLines(input, headerPicture !== null);
  const footerHeight = FOOTER_HEIGHT + Math.max(0, footerLines.length - 1) * BIB_SHEET_FOOTER.lineHeight;

  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const drawBib = (row: Pick<BibRow, "bibNumber" | "registeredName">, top: number) => {
    const left = MARGIN;

    /*
      The club's own picture across the top (§249), or the coloured band with the lockup and the
      race on it. The picture replaces the band whole — a band *and* a picture is two headers —
      and it is drawn to cover the strip, so a photograph of any proportion fills it without
      being squashed.
    */
    if (headerPicture) {
      doc.image(headerPicture, left, top, { cover: [BIB.width, BAND_HEIGHT], align: "center", valign: "center" });
    } else {
      // The band first, edge to edge across the top: it is what says which race this is before
      // anybody is close enough to read a word of it.
      doc.rect(left, top, BIB.width, BAND_HEIGHT).fill(band);

      // The lockup at the left of the band, white on whatever colour the band is; the race and
      // its date at the right, in whichever of white and ink can be read on it. 2.424:1, the
      // lockup's own proportion.
      const logoWidth = 122;
      if (design.showLogo) {
        doc.image(lockup, left + 18, top + (BAND_HEIGHT - logoWidth / 2.424) / 2, { width: logoWidth });
      }
      const headerLeft = left + (design.showLogo ? logoWidth + 36 : 18);
      const headerWidth = BIB.width - (design.showLogo ? logoWidth + 54 : 36);
      if (design.showEventTitle) {
        doc
          .font("bold")
          .fontSize(13)
          .fillColor(bandText)
          .text(input.eventTitle, headerLeft, top + 15, { width: headerWidth, align: "right", lineBreak: false, ellipsis: true });
      }
      if (design.showDate) {
        doc
          .font("body")
          .fontSize(10.5)
          .fillColor(bandText)
          .text(input.eventDate, headerLeft, top + (design.showEventTitle ? 34 : 22), {
            width: headerWidth,
            align: "right",
            lineBreak: false,
            ellipsis: true,
          });
      }
    }

    /*
      The number: everything the card has left under the header, in the body ink — a number is
      read at distance, and ink on white is the highest contrast the paper can carry. Its size
      is the club's choice as a multiple of that (§249), so the preview on the screen and this
      sheet scale together.

      The name is above it or below it, or nowhere; what it takes is given back to the number
      when it is switched off, which is what makes "just the number" a real choice rather than
      a bib with a gap in it.
    */
    const nameBlock = design.showName ? NAME_BLOCK : 0;
    const nameAbove = design.showName && design.namePosition === "above";
    const digits = String(row.bibNumber);
    const numberSize = Math.round((digits.length >= 5 ? 140 : digits.length === 4 ? 175 : 200) * numberScaleFactor(design));
    const numberArea = BIB.height - BAND_HEIGHT - footerHeight - nameBlock - SPONSOR_HEIGHT;
    const numberTop = top + BAND_HEIGHT + (nameAbove ? nameBlock : 0);

    const drawName = (y: number) =>
      doc
        .font("bold")
        .fontSize(24)
        .fillColor(COLOR.ink)
        .text(row.registeredName, left + 18, y, { width: BIB.width - 36, align: "center", lineBreak: false, ellipsis: true });

    if (nameAbove) drawName(top + BAND_HEIGHT + 10);

    doc.font("bold").fontSize(numberSize).fillColor(COLOR.ink);
    const numberHeight = doc.heightOfString(digits, { width: BIB.width, lineBreak: false });
    doc.text(digits, left, numberTop + Math.max(0, (numberArea - numberHeight) / 2), {
      width: BIB.width,
      align: "center",
      lineBreak: false,
    });

    // The name under the number, large enough to read at a finish line.
    if (design.showName && !nameAbove) drawName(top + BIB.height - footerHeight - SPONSOR_HEIGHT - 34);

    // The sponsors' strip above the small print (§249), its own proportion kept.
    if (sponsorPicture) {
      doc.image(sponsorPicture, left + 18, top + BIB.height - footerHeight - SPONSOR_HEIGHT + 2, {
        fit: [BIB.width - 36, SPONSOR_HEIGHT - 6],
        align: "center",
        valign: "center",
      });
    }

    /*
      The small print, as the club composed it (§317): one line, or two with the last where the
      one line always sat. Never a telephone number — `bibFooterParts` says why.

      Each line is centred by hand and handed to pdfkit with **no width**. Given a width, pdfkit
      wraps whatever `lineBreak` says, and its `ellipsis` does nothing without a `height`; so a
      line a point wider than its box would drop its last word onto a line of its own, 9 points
      lower — over the second line, or over the cut edge. Without a width pdfkit cannot wrap at
      all, and `bibFooterWidth` measured the line no narrower than pdfkit sets it, kerning
      included, so it fits the 503 points it was laid out for.
    */
    doc.font("body").fontSize(BIB_SHEET_FOOTER.size).fillColor(COLOR.inkMuted);
    footerLines.forEach((line, index) => {
      doc.text(
        line,
        left + 18 + (BIB_SHEET_FOOTER.width - doc.widthOfString(line)) / 2,
        top + BIB.height - 16 - (footerLines.length - 1 - index) * BIB_SHEET_FOOTER.lineHeight,
        { lineBreak: false },
      );
    });

    // The bib's edge, thin, so the cut is guided on all four sides. Last, over the band, so
    // the band's own corner does not sit on top of it.
    doc.rect(left, top, BIB.width, BIB.height).lineWidth(0.75).strokeColor(COLOR.line).stroke();
  };

  /**
   * Corner marks, for a club that takes the sheet to a printer (§249).
   *
   * Short rules outside each corner of the bib rather than a frame: a printer trims to them and
   * a pair of scissors follows them, and neither is helped by a line across the picture.
   */
  const cutMarks = (top: number) => {
    if (!design.cutMarks) return;
    const length = 10;
    const gap = 4;
    const corners = [
      [MARGIN, top],
      [PAGE.width - MARGIN, top],
      [MARGIN, top + BIB.height],
      [PAGE.width - MARGIN, top + BIB.height],
    ] as const;
    doc.lineWidth(0.5).strokeColor(COLOR.inkMuted);
    for (const [x, y] of corners) {
      const towardsLeft = x === MARGIN ? -1 : 1;
      const towardsTop = y === top ? -1 : 1;
      doc.moveTo(x + towardsLeft * gap, y).lineTo(x + towardsLeft * (gap + length), y).stroke();
      doc.moveTo(x, y + towardsTop * gap).lineTo(x, y + towardsTop * (gap + length)).stroke();
    }
  };

  if (input.layout === "one") {
    // The bib keeps its size — an A5 number on a shirt is the size that reads from the finish
    // line — and sits in the middle of the page, so the cut is optional.
    for (const row of input.rows) {
      doc.addPage();
      const top = (PAGE.height - BIB.height) / 2;
      drawBib(row, top);
      cutMarks(top);
    }
  }

  for (let index = 0; input.layout !== "one" && index < input.rows.length; index += 2) {
    doc.addPage();
    drawBib(input.rows[index], MARGIN);
    cutMarks(MARGIN);
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
      cutMarks(MARGIN + BIB.height + GAP);
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
