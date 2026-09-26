import { readFile } from "node:fs/promises";
import path from "node:path";
import PDFDocument from "pdfkit";
import { CLUB_NAME, COLOR } from "@/theme/brand";
import {
  bandTextColour,
  type BibDesign,
  bibBandColour,
  DEFAULT_BIB_DESIGN,
  numberScaleFactor,
} from "./bib-design";
import { bibFooterLines, bibFooterParts } from "./bib-footer";
import { A4_PAGE, BIB_CARD, BIB_FOOTER_LINE, BIB_LAYOUT, BIB_MARGIN, BIB_PAPER, bibNumberPoints } from "./bib-geometry";
import type { BibRow } from "./bibs";

/**
 * Race numbers as a sheet to print (BR-REQ-038-01, `DECISIONS.md` §180, §338): **every bib is an
 * A5 sheet lying on its side, two to an A4 portrait page**, one above the other, and the page is
 * cut exactly in half — the owner, 2026-09-23: "they will be printed on an A4 page so we gonna
 * have 2 per page, basically their format is A5". The paper's edge is the bib's edge; a dashed
 * line at the middle of the page is the one cut there is.
 *
 * Each bib is laid out as a race number actually is, rather than as a certificate with a logo in
 * the corner, inside an 18-point white margin (`bib-geometry.ts`): a coloured band across the top,
 * in the event's own `bib_colour` and the club's blue when it names none (§173, `bib-design.ts`);
 * the lockup in white at the left of it and the race and its date at the right, both on the band;
 * the number filling everything under it in the body ink; the registered name beneath; and the
 * small print at the foot — the partners (§168) and the mailbox the club answers on unless the
 * club composed it otherwise (§317), on one line or two. That is the order the eye reads a bib in
 * at a start line — colour first, which start line; then the number; then, close up, the name.
 *
 * The number is set in the site's Roboto Bold from `src/theme/pdf/` (the same face and files the
 * legal PDF uses, §63), which also covers every name with a diacritic; the lockup is
 * `logo-white.png`, the white-on-transparent raster `scripts/brand-assets.mjs` writes — the
 * email's white lockup is baked onto the club's blue and would show its own rectangle on a green
 * band.
 *
 * **No telephone number is printed**, the participant's least of all their emergency contact:
 * see `bibFooterParts`.
 *
 * Pure over its inputs: rows, an event header and the facts of the footer; the caller decides
 * the language.
 */

/**
 * One bib to print: a number and the name under it, or — a desk spare (§444) — no name, which
 * prints an empty line where the name goes, for the marker at the desk.
 */
export type BibSheetRow = { bibNumber: BibRow["bibNumber"]; registeredName: string | null };

export type BibSheetInput = {
  rows: readonly BibSheetRow[];
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
  generatedAt: Date;
  /** Two bibs to a page — the default — or one; see `bibSheetSlots`. */
  layout?: BibSheetLayout;
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
  /**
   * The small words under a desk spare's empty name line (§444) — «înscris la fața locului» — in
   * the sheet's language, from the caller's catalogue; absent, the line alone.
   */
  blankMark?: string;
};

/**
 * `two`: two A5 bibs on each A4 page, the upper half and the lower — the sheet the club cuts.
 *
 * `one`: the same A5-sized bib, centred one per A4 page, no cut line — for a printer that will
 * not take a cut, or a club that pins the whole page (§79; BR-REQ-038-01 criterion 5). The bib
 * itself does not grow: an A5 number on a shirt is the size that reads from the finish line, and
 * `one` is a reprint of a single number or the registration's own "download the bib", never a
 * reason to draw the paper's cut on a page that has nothing to cut from.
 */
export type BibSheetLayout = "two" | "one";

/** One bib's place on the sheet: its page, counted from 0, and its A5 box on that page in points. */
export type BibSlot = { page: number; x: number; y: number; width: number; height: number };

/**
 * Where each bib of a sheet is printed, in order: two to a page, the upper half and then the
 * lower, so an odd count leaves the last page's lower half blank rather than printing half a bib;
 * or, with `one`, every bib centred alone on a page of its own (§79). Every box is `BIB_PAPER`:
 * 595.28 × 420.945 points, A5 landscape, half of the A4 page exactly.
 */
export function bibSheetSlots(count: number, layout: BibSheetLayout = "two"): BibSlot[] {
  const perPage = layout === "one" ? 1 : 2;
  // `one` centres the A5 box on the A4 page rather than stacking it in the upper half — there is
  // no cut on that page, so nothing marks where the upper half would have ended (§79).
  const centred = (A4_PAGE.height - BIB_PAPER.height) / 2;
  return Array.from({ length: count }, (_, index) => ({
    page: Math.floor(index / perPage),
    x: 0,
    y: layout === "one" ? centred : (index % perPage) * BIB_PAPER.height,
    width: BIB_PAPER.width,
    height: BIB_PAPER.height,
  }));
}

/** Where the page is cut: exactly half-way down, the upper bib's foot and the lower bib's top. */
export const BIB_SHEET_CUT = A4_PAGE.height / 2;

/**
 * The small print's geometry (§317): 8 points, across the card less its inset each side — 523.28
 * points on the A5 bib — and a second line 10 points above the first when the footer needs two.
 * `width / size` is the footer's measure in ems, `BIB_FOOTER_EMS`, which the picture shares — that
 * is how the two renderers break the footer in the same places.
 */
export const BIB_SHEET_FOOTER = BIB_FOOTER_LINE;

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

const ASSETS = path.join(process.cwd(), "src", "theme", "pdf");

export async function renderBibSheet(input: BibSheetInput): Promise<Buffer> {
  const [regular, bold, logo] = await Promise.all([
    readFile(path.join(ASSETS, "Roboto-Regular.ttf")),
    readFile(path.join(ASSETS, "Roboto-Bold.ttf")),
    readFile(path.join(ASSETS, "logo-white.png")),
  ]);
  const band = bibBandColour(input.bandColour);
  const bandText = bandTextColour(band);
  const design = input.design ?? DEFAULT_BIB_DESIGN;
  const L = BIB_LAYOUT;

  const doc = new PDFDocument({
    size: "A4",
    /*
      No page margin: the margin is each bib's own, inside its half (`BIB_MARGIN`). A page margin
      would also be a trap — pdfkit moves any text given a width whose line would cross the
      bottom margin onto a new page of its own, and the lower bib's largest number, under its
      name, has a line that ends within a point of the old 28-point margin.
    */
    margin: 0,
    autoFirstPage: false,
    // A Buffer is what `doc.font()` accepts; only `@types/pdfkit` still says string here.
    font: regular as unknown as string,
    info: {
      Title: `${input.eventTitle} — bibs`,
      Author: CLUB_NAME,
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
  const sponsorHeight = sponsorPicture ? L.sponsorHeight : 0;
  // The same on every bib of the sheet, so laid out once (§317), and told which header the sheet
  // really draws. A second line takes its height from the number's area, never from the small
  // print's size.
  const footerLines = bibSheetFooterLines(input, headerPicture !== null);
  const footerHeight = L.footerHeight + Math.max(0, footerLines.length - 1) * BIB_SHEET_FOOTER.lineHeight;

  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  /** One bib, in its A5 box: everything inside the white margin, nothing across the cut. */
  const drawBib = (row: BibSheetRow, slot: BibSlot) => {
    const left = slot.x + BIB_MARGIN;
    const top = slot.y + BIB_MARGIN;
    const bottom = top + BIB_CARD.height;

    /*
      The club's own picture across the top (§249), or the coloured band with the lockup and the
      race on it. The picture replaces the band whole — a band *and* a picture is two headers —
      and it is drawn to cover the strip, so a photograph of any proportion fills it without
      being squashed: centred, and cropped to the strip's 9.02:1.
    */
    if (headerPicture) {
      doc.image(headerPicture, left, top, { cover: [BIB_CARD.width, L.bandHeight], align: "center", valign: "center" });
    } else {
      // The band first, across the card: it is what says which race this is before anybody is
      // close enough to read a word of it.
      doc.rect(left, top, BIB_CARD.width, L.bandHeight).fill(band);

      // The lockup at the left of the band, white on whatever colour the band is; the race and
      // its date at the right, in whichever of white and ink can be read on it.
      if (design.showLogo) {
        doc.image(lockup, left + L.inset, top + (L.bandHeight - L.logoWidth / L.logoRatio) / 2, { width: L.logoWidth });
      }
      const headerLeft = left + (design.showLogo ? L.logoWidth + 2 * L.inset : L.inset);
      const headerWidth = BIB_CARD.width - (design.showLogo ? L.logoWidth + 3 * L.inset : 2 * L.inset);
      if (design.showEventTitle) {
        doc
          .font("bold")
          .fontSize(L.titleSize)
          .fillColor(bandText)
          .text(input.eventTitle, headerLeft, top + L.titleTop, { width: headerWidth, align: "right", lineBreak: false, ellipsis: true });
      }
      if (design.showDate) {
        doc
          .font("body")
          .fontSize(L.dateSize)
          .fillColor(bandText)
          .text(input.eventDate, headerLeft, top + (design.showEventTitle ? L.dateTop : L.dateTopAlone), {
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

      The number's line is centred on its area even when the line is taller than the area — a
      large number over a sponsors' strip and two lines of small print — because its digits are
      shorter than its line and still fit; the picture centres it the same way, and a number that
      hugged the band here would be a preview of a different bib (§338).
    */
    const nameBlock = design.showName ? L.nameBlock : 0;
    const nameAbove = design.showName && design.namePosition === "above";
    const digits = String(row.bibNumber);
    const numberSize = bibNumberPoints(digits, numberScaleFactor(design));
    const sponsorTop = bottom - footerHeight - sponsorHeight;
    const numberArea = BIB_CARD.height - L.bandHeight - footerHeight - nameBlock - sponsorHeight;
    const numberTop = top + L.bandHeight + (nameAbove ? nameBlock : 0);

    /*
      The name, or — on a desk spare (§444) — the empty line it is written on in marker: a rule
      centred in the same strip, at the name's baseline, so the handwritten name sits where a
      printed one would. `stripTop` is the strip's top; the name is set `nameTop` into it.
    */
    const drawName = (stripTop: number) => {
      if (row.registeredName === null) {
        const lineY = stripTop + L.blankLineTop;
        const lineLeft = left + (BIB_CARD.width - L.blankLineWidth) / 2;
        doc
          .moveTo(lineLeft, lineY)
          .lineTo(lineLeft + L.blankLineWidth, lineY)
          .lineWidth(L.blankLineWeight)
          .strokeColor(COLOR.ink)
          .stroke();
        if (input.blankMark) {
          doc
            .font("body")
            .fontSize(L.blankMarkSize)
            .fillColor(COLOR.inkMuted)
            .text(input.blankMark, left + L.inset, stripTop + L.blankMarkTop, {
              width: BIB_CARD.width - 2 * L.inset,
              align: "center",
              lineBreak: false,
              ellipsis: true,
            });
        }
        return;
      }
      doc
        .font("bold")
        .fontSize(L.nameSize)
        .fillColor(COLOR.ink)
        .text(row.registeredName, left + L.inset, stripTop + L.nameTop, {
          width: BIB_CARD.width - 2 * L.inset,
          align: "center",
          lineBreak: false,
          ellipsis: true,
        });
    };

    if (nameAbove) drawName(top + L.bandHeight);

    doc.font("bold").fontSize(numberSize).fillColor(COLOR.ink);
    const numberHeight = doc.heightOfString(digits, { width: BIB_CARD.width, lineBreak: false });
    doc.text(digits, left, numberTop + (numberArea - numberHeight) / 2, {
      width: BIB_CARD.width,
      align: "center",
      lineBreak: false,
    });

    // The name under the number, large enough to read at a finish line.
    if (design.showName && !nameAbove) drawName(sponsorTop - L.nameBlock);

    // The sponsors' strip above the small print (§249), its own proportion kept.
    if (sponsorPicture) {
      doc.image(sponsorPicture, left + L.inset, sponsorTop + L.sponsorTop, {
        fit: [BIB_CARD.width - 2 * L.inset, L.sponsorPicture],
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
      lower — over the second line, or off the card. Without a width pdfkit cannot wrap at all,
      and `bibFooterWidth` measured the line no narrower than pdfkit sets it, kerning included,
      so it fits the 523 points it was laid out for.
    */
    doc.font("body").fontSize(BIB_SHEET_FOOTER.size).fillColor(COLOR.inkMuted);
    footerLines.forEach((line, index) => {
      doc.text(
        line,
        left + L.inset + (BIB_SHEET_FOOTER.width - doc.widthOfString(line)) / 2,
        bottom - BIB_SHEET_FOOTER.lastLineTop - (footerLines.length - 1 - index) * BIB_SHEET_FOOTER.lineHeight,
        { lineBreak: false },
      );
    });
  };

  /**
   * The cut, on every two-up page — the upper bib's foot is the cut whether or not a second bib
   * is under it: a dashed line across the page, exactly half-way down. Never drawn with `one`
   * (§79): that page holds a single, centred A5 bib with nothing above or below it to cut from.
   *
   * With the club's cut marks (§249), a short solid rule at each end of it as well, from the
   * paper's edge across the margin — what a guillotine is lined up on, and still there when a
   * printer drops the dashes. Never a frame round the card: the paper's edge is the bib's edge,
   * and a line round the card would be cut along and leave a bib smaller than A5.
   */
  const drawCut = () => {
    doc
      .moveTo(0, BIB_SHEET_CUT)
      .lineTo(A4_PAGE.width, BIB_SHEET_CUT)
      .lineWidth(0.5)
      .strokeColor(COLOR.inkMuted)
      .dash(4, { space: 4 })
      .stroke()
      .undash();
    if (!design.cutMarks) return;
    trimMarksAt(BIB_SHEET_CUT);
  };

  /** A short solid rule at each end of a horizontal cut, from the paper's edge across the margin. */
  const trimMarksAt = (y: number) => {
    const length = BIB_MARGIN + L.inset;
    doc.lineWidth(0.75).strokeColor(COLOR.ink);
    doc.moveTo(0, y).lineTo(length, y).stroke();
    doc.moveTo(A4_PAGE.width - length, y).lineTo(A4_PAGE.width, y).stroke();
  };

  /**
   * The trim guide of a `one` page, with the club's cut marks (§249; A5 bibs two per sheet,
   * §338): the centred A5 bib has no paper edge above or below it, so a club that asked for cut
   * marks gets them at the bib's own top and foot — the same short solid rules at each end as the
   * two-up cut carries, which is where origin/qa's corner marks told a printer to trim. No dashed
   * line and no frame: without the club's marks the page is the bib alone, as §79 keeps it, and a
   * rule across the picture would be cut along. The bib is the page's full width, so its sides
   * are the paper's own and need nothing.
   */
  const drawTrimGuide = (slot: BibSlot) => {
    if (!design.cutMarks) return;
    trimMarksAt(slot.y);
    trimMarksAt(slot.y + slot.height);
  };

  const perPage = input.layout === "one" ? 1 : 2;
  const slots = bibSheetSlots(input.rows.length, input.layout);
  slots.forEach((slot, index) => {
    // The first bib of a page opens it; the second, if there is one, joins it below the cut.
    if (index % perPage === 0) {
      doc.addPage();
      if (perPage === 2) drawCut();
    }
    drawBib(input.rows[index], slot);
    if (perPage === 1) drawTrimGuide(slot);
  });

  // A sheet with nothing to print is still a valid file that says so, rather than an error.
  if (input.rows.length === 0) {
    doc.addPage();
    doc.font("body").fontSize(12).fillColor(COLOR.inkMuted).text("—", BIB_MARGIN, BIB_MARGIN);
  }

  doc.end();
  return finished;
}
