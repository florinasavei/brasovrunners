import { readFile } from "node:fs/promises";
import { mergeTextSegments, type MergeValues } from "@/modules/legal-documents/domain/merge-fields";
import { plainInline } from "@/modules/legal-documents/domain/inline";
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
  /**
   * The template as approved, **unmerged**. The blanks are filled while drawing, so the
   * filled-in parts can be set in bold (§225) — a signer checks their own name, their
   * identity document and the race, and everything around those was approved once and reads
   * the same for everybody. Pre-merging would have thrown away which span was which.
   */
  body: LegalDocumentBody;
  /** What fills the blanks; absent on the blank form the desk prints, which shows the dots. */
  values?: MergeValues;
  eventTitle: string;
  /** The version's facts, under the signature and in the document's subject. */
  version: number;
  contentSha256: string;
  /** Absent for the blank form. */
  signature?: {
    /** The declarant's signature: the adult's own, or the parent's or guardian's for a minor. */
    typedName: string;
    idDocument: string | null;
    /**
     * The minor's own signature and document, signed beside the parent's (§330). Null for an
     * adult, and for a minor's acceptance recorded before two signatures were asked — which then
     * prints the one signature it has, as it always did.
     */
    minor: { typedName: string; idDocument: string | null } | null;
    signedAt: string;
    /** "Signed electronically from the link sent by email" or "Signed on paper, recorded by X". */
    method: string;
  };
  /**
   * The blank form a minor signs with a parent or guardian (§330): two signature lines, two
   * identity-document lines. Only for the blank form — a signed entry says who signed by itself.
   */
  forMinor?: boolean;
};

export type DeclarationPdfInput = {
  /** One for a runner's copy or the blank form; every signed one of an event for the archive. */
  entries: readonly DeclarationEntry[];
  locale: string;
  generatedAt: Date;
  /**
   * A second footer line on every page while the file carries a full identity document (§418):
   * the event's bundle, downloaded by staff, says it must be deleted within seven days of the event.
   * Drawn only when some entry's signature still holds a document the database has not cleared.
   */
  idDocumentsNotice?: string;
  labels: {
    organization: string;
    whereupon: string;
    /** "DREPT PENTRU CARE SEMNĂM" — a minor's declaration, signed by two (§330). */
    whereuponTogether: string;
    signature: string;
    /** The two signature lines of a minor's declaration (§330): the child's, then the parent's. */
    minorSignature: string;
    guardianSignature: string;
    date: string;
    idDocument: string;
    version: string;
    generatedOn: string;
    page: (n: number, total: number) => string;
  };
};

/** What stands in for the hidden characters of an identity document (§320). */
export const ID_DOCUMENT_MASK = "••••";

/**
 * An identity document as the club's copies print it (§320): "BV 123456" becomes "BV ••••56".
 *
 * The first two and the last two characters that are not spaces, with the mask between — enough
 * for somebody at the club to tell which runner's paper it is and to match it against the card
 * shown at the desk, not enough to be the number. Counted without spaces because people type
 * "BV 123456", "BV123456" and "CI seria BV nr. 123456" for the same card.
 *
 * Shown only while at least as many characters stay hidden as are shown: under eight, the four
 * characters kept would be most of the document (the form allows four to thirty, `ID_DOCUMENT`),
 * so the whole value becomes the mask. Pure, so it is tested on its own and the PDF only draws
 * what it returns.
 */
export function maskIdDocument(value: string): string {
  const characters = [...value.replace(/\s+/g, "")];
  if (characters.length < 8) return ID_DOCUMENT_MASK;
  return `${characters.slice(0, 2).join("")} ${ID_DOCUMENT_MASK}${characters.slice(-2).join("")}`;
}

/**
 * One run of a paragraph as the PDF draws it: the marks stripped (`plainInline`), and a space at
 * either end kept, because the run beside it is drawn straight after it and `plainInline` trims.
 * Exported for its test; the drawing is the only caller.
 */
export function runText(raw: string): string {
  const plain = plainInline(raw);
  if (plain === "") return /\s/.test(raw) ? " " : "";
  return `${/^\s/.test(raw) ? " " : ""}${plain}${/\s$/.test(raw) ? " " : ""}`;
}

const ASSETS = path.join(process.cwd(), "src", "theme", "pdf");
/** Opened once per document (`doc.openImage`): pdfkit embeds a Buffer again on every `image()` call, and two hundred copies of the lockup are the difference between two megabytes and ten. */
let LOGO: Buffer;
/** The A4 page and its margins, in PDF points — exported so the layout test measures against these rather than copies. */
export const DECLARATION_PAGE = { width: 595.28, height: 841.89 } as const;
export const DECLARATION_MARGIN = { top: 48, bottom: 64, left: 56, right: 56 } as const;
/** The footer's one line of text: its top `gap` points under the bottom margin, set at `size`. */
export const DECLARATION_FOOTER = { gap: 22, size: 8 } as const;
const PAGE = DECLARATION_PAGE;
const MARGIN = DECLARATION_MARGIN;
const TEXT_WIDTH = PAGE.width - MARGIN.left - MARGIN.right;
const BLANK_LINE = "………………………………………………";

/**
 * The footer's second line (§418), or nothing: only a file that still carries an identity document
 * the database has not cleared — a signed entry's, the declarant's or a minor's — says to delete it.
 * A blank form, or a bundle drawn after the seven-day sweep, has none to warn about. Pure, for its test.
 */
export function idDocumentsNoticeFor(input: Pick<DeclarationPdfInput, "entries" | "idDocumentsNotice">): string | undefined {
  const carries = input.entries.some((entry) => Boolean(entry.signature?.idDocument || entry.signature?.minor?.idDocument));
  return carries ? input.idDocumentsNotice : undefined;
}

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
  const idDocumentsNotice = idDocumentsNoticeFor(input);
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const y = PAGE.height - MARGIN.bottom + DECLARATION_FOOTER.gap;
    doc.moveTo(MARGIN.left, y - 8).lineTo(PAGE.width - MARGIN.right, y - 8).strokeColor(COLOR.line).lineWidth(0.5).stroke();
    doc
      .font("body")
      .fontSize(DECLARATION_FOOTER.size)
      .fillColor(COLOR.inkMuted)
      .text(`${input.labels.organization} · ${input.labels.generatedOn}`, MARGIN.left, y, { width: TEXT_WIDTH - 90, lineBreak: false })
      .text(input.labels.page(i + 1, range.count), MARGIN.left, y, { width: TEXT_WIDTH, align: "right", lineBreak: false });
    if (idDocumentsNotice) {
      doc
        .font("bold")
        .fontSize(DECLARATION_FOOTER.size)
        .fillColor(COLOR.inkMuted)
        .text(idDocumentsNotice, MARGIN.left, y + DECLARATION_FOOTER.size + 3, { width: TEXT_WIDTH, lineBreak: false });
    }
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
      const width = bullet ? TEXT_WIDTH - 14 : TEXT_WIDTH;
      const left = bullet ? MARGIN.left + 14 : MARGIN.left;
      /*
        Drawn a run at a time so the fill-ins can be bold (§225).

        `continued: true` is how pdfkit lays several runs into one justified paragraph: each
        call adds to the same block and only the last one ends it, so the line breaking and
        the justification are the paragraph's, not each run's. The last run must therefore
        carry `continued: false`, or the next paragraph joins this one.

        The marks are stripped per run rather than over the whole string, which is the same
        order the screen uses (`LegalDocumentBody`): a value is plain text and never markup.

        Found while checking the two-signature page (§330): the runs after the first were
        passed as `text(run, undefined, undefined, options)`, and pdfkit reads a third argument
        only when an `x` is given — an undefined `x` defaults to `{}` and is taken as the options.
        So every run after the first lost `continued`, the width and the alignment, and the PDF
        broke the line after every fill-in ("Subsemnatul/a Ana Pop" / ", posesor…" / "BV 123456"
        / ", declar…"), on every signed declaration since §225. The runs after the first now pass
        their options as the second argument. And a paragraph of several runs is set flush left:
        pdfkit justifies each run's own piece of a line, which spread a bold "Carte de identitate"
        into four words across the width; a paragraph with no fill-in stays justified. And the
        space either side of a fill-in is kept (`runText`): `plainInline` trims, which the line
        breaks used to hide, and "Subsemnatul/aAna Pop" is what it printed once they were gone.
      */
      const runs = mergeTextSegments(paragraph, entry.values ?? {});
      doc.fontSize(10.5).fillColor(COLOR.ink);
      const align = runs.length > 1 ? "left" : "justify";
      runs.forEach((run, index) => {
        const options = { width, lineGap: 2, align, continued: index < runs.length - 1 } as const;
        doc.font(run.filled ? "bold" : "body");
        if (index === 0) doc.text(runText(run.text), left, doc.y, options);
        else doc.text(runText(run.text), options);
      });
      doc.x = MARGIN.left;
      doc.moveDown(bullet ? 0.3 : 0.6);
    }
    doc.moveDown(0.3);
  }

  /*
    The signature block, kept together at the foot. A minor's declaration is signed by two
    (§330): the minor's signature and document, then the parent's or guardian's, under one date —
    one press online, one sitting at the desk — so the block is taller and says "we sign".
  */
  const signature = entry.signature;
  const twoSigners = signature ? signature.minor !== null : Boolean(entry.forMinor);
  const blockHeight = twoSigners ? 260 : 170;
  if (doc.y + blockHeight > PAGE.height - MARGIN.bottom) doc.addPage();
  doc.moveDown(1);
  doc.font("bold").fontSize(11).fillColor(COLOR.ink).text(twoSigners ? labels.whereuponTogether : labels.whereupon, MARGIN.left, doc.y, { width: TEXT_WIDTH });
  doc.moveDown(0.8);

  const row = (label: string, value: string | null, hand = false) => {
    const y = doc.y;
    doc.font("body").fontSize(10.5).fillColor(COLOR.ink).text(`${label}:`, MARGIN.left, y, { lineBreak: false });
    const x = MARGIN.left + doc.widthOfString(`${label}:`) + 8;
    if (value === null) {
      doc.font("body").fontSize(10.5).fillColor(COLOR.inkMuted).text(BLANK_LINE, x, y, { lineBreak: false });
      doc.y = y + 22;
    } else if (hand) {
      /*
        The typed name in the hand the page showed it in, sitting on the same baseline as its
        label — or on the line under it when a long label ("Semnătura părintelui sau tutorelui")
        and a long name would not fit beside each other and the name would run off the page.
      */
      const fits = x + doc.font("hand").fontSize(26).widthOfString(value) <= MARGIN.left + TEXT_WIDTH;
      if (fits) {
        doc.font("hand").fontSize(26).fillColor(COLOR.blueInk).text(value, x, y - 10, { lineBreak: false });
        doc.y = y + 30;
      } else {
        doc.font("hand").fontSize(26).fillColor(COLOR.blueInk).text(value, MARGIN.left + 14, y + 8, { width: TEXT_WIDTH - 14, lineBreak: false });
        doc.y = y + 46;
      }
    } else {
      doc.font("body").fontSize(10.5).fillColor(COLOR.ink).text(value, x, y, { lineBreak: false });
      doc.y = y + 22;
    }
    doc.x = MARGIN.left;
  };

  if (twoSigners) {
    // The minor first, as the text names them first; then the parent or guardian who declares
    // with them. A document line only where a document was asked (or on the blank form).
    const minor = signature?.minor ?? null;
    row(labels.minorSignature, minor ? minor.typedName : null, Boolean(minor));
    if (signature ? minor !== null && minor.idDocument !== null : true) row(labels.idDocument, minor ? minor.idDocument : null);
    doc.moveDown(0.4);
    row(labels.guardianSignature, signature ? signature.typedName : null, Boolean(signature));
    if (signature ? signature.idDocument !== null : true) row(labels.idDocument, signature ? signature.idDocument : null);
  } else {
    row(labels.signature, signature ? signature.typedName : null, Boolean(signature));
    if (signature ? signature.idDocument !== null : true) row(labels.idDocument, signature ? signature.idDocument : null);
  }
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
