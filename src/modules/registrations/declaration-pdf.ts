import { readFile } from "node:fs/promises";
import { dropsParagraph, mergeTextSegments, type MergeValues } from "@/modules/legal-documents/domain/merge-fields";
import { runText } from "@/modules/legal-documents/domain/signed-text";
import { formatSigningInstant } from "@/i18n/dates";
import { type SignatureTrace, signatureTraceLine } from "@/modules/legal-documents/domain/signature-trace";
import path from "node:path";
import PDFDocument from "pdfkit";
import type { LegalDocumentBody } from "@/modules/legal-documents/domain/content-hash";
import { COLOR, LOGO_HEIGHT_SHARE } from "@/theme/brand";

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
 *
 * **Signed by both parties** (§991): a caller whose text the host organisation signs too — the volunteer agreement —
 * passes `labels.hostSignature`, and every signature block is two columns, the signer's rows on the left and the
 * host's on the right (`drawSignatureColumns`). Every other caller passes none and draws its block as it always did.
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
  /**
   * The day that version took effect, as `/admin/legal` shows it (§499): the version line under the
   * title and in every page's footer says «Versiunea N, în vigoare din …», the signing pages' words.
   */
  effectiveAt: Date;
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
    /** The same instant inside a sentence — "joi, 24 sept. 2026, la 18:05" — for the footer's «semnată …» (§499). */
    signedAtInline: string;
    /** The instant itself, from the row: the proof line prints it to the second (§556). */
    acceptedAt: Date;
    /** "Signed electronically from the link sent by email" or "Signed on paper, recorded by X". */
    method: string;
    /**
     * The trace of an electronic signature (§771, amending §418, §330 and §769): the IP address and browser the row
     * kept when the typed name was posted, printed small under the signature — «Semnat electronic la … · IP … · …».
     * Null for a paper acceptance (nothing was kept, and the staff member's own would say nothing about the signer),
     * for an electronic one from before the trace, and for one that arrived without the headers; absent is null.
     * One line for the one press, also when a minor and a parent signed together (§330).
     */
    trace?: SignatureTrace | null;
  };
  /**
   * The blank form a minor signs with a parent or guardian (§330): two signature lines, two
   * identity-document lines. Only for the blank form — a signed entry says who signed by itself.
   */
  forMinor?: boolean;
  /**
   * A text that asks for no identity document draws no line for one (§758): the volunteer agreement is signed by
   * the volunteer and the organizer, neither with a document. Absent, the lines are drawn as they always were.
   */
  noIdDocument?: boolean;
  /**
   * The words on a single signature line, in place of the bundle's `labels.signature` (§768): the volunteer agreement of a
   * minor draws two entries, one for the volunteer's own acceptance and one for the guardian's, and each names its own signer.
   * Absent, `labels.signature` as ever.
   */
  signatureLabel?: string;
  /**
   * The SHA-256 of the exact text signed (§556, `signedTextHash`), from the row; null on a row from
   * before it, whose proof line then prints no hash — never one computed now, which would prove only
   * what the text says today. Absent on the blank form, which nobody has signed.
   */
  textHash?: string | null;
};

/**
 * The second party of a text signed by both on paper (§991): the host organisation's column, drawn on the right of the
 * signer's — the party it is, its name, and the lines its representative fills in by hand. Words and a name only: the
 * renderer draws the column, the caller says what it holds.
 */
export type DeclarationHostSignature = {
  /** The party, at the column's head: «Asociația» / "The Association". */
  heading: string;
  /** Its name under the heading — the club's legal name, as the caller reads it from the club's facts, never a literal. */
  name: string;
  /** The lines filled in by hand, top to bottom, each a label over a dotted line: «Reprezentant (nume și funcție)», «Semnătura», «Data». */
  lines: readonly string[];
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
    /** «Versiunea 3, în vigoare din 12 septembrie 2026» — the signing pages' `Legal.inForce` (§499), no weekday (§534). */
    versionInForce: (version: number, effectiveAt: Date) => string;
    /** «semnată joi, 24 sept. 2026, la 18:05» — the footer of a signed entry's pages (§499). */
    signedWhen: (when: string) => string;
    generatedOn: string;
    page: (n: number, total: number) => string;
    /**
     * «Versiunea 3 · Semnat la 24.09.2026, 18:05:12 (ora României) · Amprenta documentului (SHA-256): …»
     * (§556): the version, the instant to the second and the signed text's hash, all from the row —
     * the hash part left out when the row has none.
     */
    proofLine: (version: number, signedAt: string, textHash: string | null) => string;
    /**
     * «Semnat electronic la 24.09.2026, 18:05:12 (ora României)» (§771): the head of the trace line under an
     * electronic signature, the instant to the second as the proof line prints it; the address and the browser follow.
     */
    signedElectronically: (when: string) => string;
    /** «IP» (§771): the word before the address in the trace line. */
    ip: string;
    /**
     * The volunteer agreement's second party (§991; the owner, 2026-11-19: «să las în dreapta și „Asociația” ca să printăm
     * și să semnăm fizic»): with it every entry's signature block is two columns under «DREPT PENTRU CARE SEMNĂM» — the
     * signer's side on the left, exactly the rows it always had, and this column on the right — with the version, the
     * fingerprint and the proof under both. Absent — the race declaration, its blank form, the group run's — the block is
     * drawn down the left margin as it always was (`tests/unit/registrations/declaration-pdf-unchanged.test.ts`).
     */
    hostSignature?: DeclarationHostSignature;
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
 * The signature block in two columns (§991): the signer's from the left margin, the host's from past the page's middle, two
 * equal widths and a gutter between — exported so the layout test measures against these rather than copies.
 */
const SIGNATURE_GUTTER = 24;
const SIGNATURE_COLUMN_WIDTH = (TEXT_WIDTH - SIGNATURE_GUTTER) / 2;
export const DECLARATION_SIGNATURE_COLUMNS = {
  signer: { x: MARGIN.left, width: SIGNATURE_COLUMN_WIDTH },
  host: { x: MARGIN.left + SIGNATURE_COLUMN_WIDTH + SIGNATURE_GUTTER, width: SIGNATURE_COLUMN_WIDTH },
} as const;

/**
 * Which version of which text an entry carries, under its title (§499): «Versiunea 3, în vigoare
 * din sâmbătă, 12 sept. 2026 · sha256 0123456789abcdef…» — the number and the day it took effect as
 * `/admin/legal` and the signing pages say them, and the first sixteen characters of its hash, as the
 * legal documents' own PDF prints them (§53). The full hash stays under the signature and in the
 * file's metadata. Pure, for its test.
 */
export function declarationVersionLine(
  entry: Pick<DeclarationEntry, "version" | "contentSha256" | "effectiveAt">,
  labels: Pick<DeclarationPdfInput["labels"], "versionInForce">,
): string {
  return `${labels.versionInForce(entry.version, entry.effectiveAt)} · sha256 ${entry.contentSha256.slice(0, 16)}…`;
}

/**
 * The footer's line, left of the page count (§499), so a page that travels alone — the second sheet
 * of a printed form, one page of the event's bundle, the file a runner forwarded — still says which
 * approved text it is: the club, the version in force of the text on that page, and when that entry
 * was signed — or, for the blank form, when the file was drawn. A bundle holds many entries, possibly
 * of different versions — a declaration signed before the club approved a new text keeps its own — so
 * it is the page's own entry, never the file's first. A page with no entry (the empty bundle) says
 * what it said before. Pure, for its test.
 */
export function declarationFooterLine(
  entry: (Pick<DeclarationEntry, "version" | "effectiveAt"> & { signature?: Pick<NonNullable<DeclarationEntry["signature"]>, "signedAtInline"> }) | undefined,
  labels: Pick<DeclarationPdfInput["labels"], "organization" | "versionInForce" | "signedWhen" | "generatedOn">,
): string {
  if (!entry) return `${labels.organization} · ${labels.generatedOn}`;
  const when = entry.signature ? labels.signedWhen(entry.signature.signedAtInline) : labels.generatedOn;
  return [labels.organization, labels.versionInForce(entry.version, entry.effectiveAt), when].join(" · ");
}

/**
 * The proof of signing (§556; the second review of 2026-09-29: «the PDF should print the version, the
 * signing instant and the document hash»): «Versiunea N · Semnat la ZZ.LL.AAAA, hh:mm:ss (ora
 * României) · Amprenta documentului (SHA-256): <hex>». Under the signature, and again on every page
 * of a signed entry under its footer line, so a loose page still carries it. The version and the
 * instant come from the row, the hash from the row; a row from before the hash prints the line without
 * it. Nothing for the blank form, which nobody signed. Pure, for its test.
 */
export function declarationProofLine(
  entry: (Pick<DeclarationEntry, "version" | "textHash"> & { signature?: Pick<NonNullable<DeclarationEntry["signature"]>, "acceptedAt"> }) | undefined,
  labels: Pick<DeclarationPdfInput["labels"], "proofLine">,
): string | undefined {
  if (!entry?.signature) return undefined;
  return labels.proofLine(entry.version, formatSigningInstant(entry.signature.acceptedAt), entry.textHash ?? null);
}

/**
 * The trace of an electronic signature as one small line under the signature (§771): «Semnat electronic la
 * 24.09.2026, 18:05:12 (ora României) · IP 203.0.113.9 · Mozilla/5.0 …», or «Signed electronically on …» — the
 * instant to the second, the caller's address and browser as the row kept them. Undefined when there is nothing to
 * say: a paper acceptance, a row from before the trace, one that arrived without either header, the blank form.
 * Pure, for its test.
 */
export function declarationTraceLine(
  entry: { signature?: Pick<NonNullable<DeclarationEntry["signature"]>, "acceptedAt" | "trace"> } | undefined,
  labels: Pick<DeclarationPdfInput["labels"], "signedElectronically" | "ip">,
): string | undefined {
  const signature = entry?.signature;
  if (!signature?.trace || (!signature.trace.ip && !signature.trace.userAgent)) return undefined;
  return signatureTraceLine(signature.trace, { signedElectronically: labels.signedElectronically, ip: labels.ip }, formatSigningInstant(signature.acceptedAt));
}

/**
 * Which entry each page of the file belongs to (§499), from the number of pages the file had after
 * each entry was drawn: `[2, 3]` is two pages of the first entry and one of the second. Pure, for its test.
 */
export function pageOwners<E>(entries: readonly E[], pagesAfterEach: readonly number[]): E[] {
  const owners: E[] = [];
  entries.forEach((entry, index) => {
    while (owners.length < (pagesAfterEach[index] ?? owners.length)) owners.push(entry);
  });
  return owners;
}

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
  return renderDeclarationParts([input], { locale: input.locale, generatedAt: input.generatedAt });
}

/**
 * One document of a file that holds several (§966): its entries, the words they are drawn with — each part in its own
 * language — and the footer's second line. A part counts its own pages, «Pagina 1 din 2» from its first page, so a
 * printed stack of them reads as the separate documents they are.
 */
export type DeclarationPart = Pick<DeclarationPdfInput, "entries" | "labels" | "idDocumentsNotice">;

/**
 * Several documents drawn into one file, one after the other (§966; the owner, 2026-11-17, of the volunteer agreements: «și
 * vreau să pot printa și contractul de voluntariat, să am la fața locului»), each exactly as `renderDeclarationPdf` draws it
 * on its own — its pages, its footers, its own page count — so the desk prints one file in place of dozens. pdfkit cannot
 * append one finished PDF to another; every part is drawn into the one document instead. The file's language and its
 * metadata (the first part's first entry, as a lone document's) are `file`'s and the first part's; at least one part, which
 * may hold no entry: it is then the page that says so.
 *
 * A lone document is one part, and its file is byte for byte what it was before parts existed: the same calls, in the same
 * order, on the same document (`tests/integration/volunteers/agreements-route.test.ts` holds the volunteer agreement to it).
 */
export async function renderDeclarationParts(parts: readonly [DeclarationPart, ...DeclarationPart[]], file: { locale: string; generatedAt: Date }): Promise<Buffer> {
  const [regular, bold, hand, logo] = await Promise.all([
    readFile(path.join(ASSETS, "Roboto-Regular.ttf")),
    readFile(path.join(ASSETS, "Roboto-Bold.ttf")),
    readFile(path.join(ASSETS, "Caveat-Regular.ttf")),
    readFile(path.join(ASSETS, "logo.png")),
  ]);
  LOGO = logo;

  const labels = parts[0].labels;
  const first = parts[0].entries[0];
  const doc = new PDFDocument({
    size: "A4",
    margins: MARGIN,
    bufferPages: true,
    autoFirstPage: false,
    font: regular as unknown as string,
    lang: file.locale,
    info: {
      Title: first ? `${first.title} — ${first.eventTitle}` : labels.organization,
      Author: labels.organization,
      Subject: first ? `${labels.version} ${first.version} · sha256 ${first.contentSha256}` : "",
      CreationDate: file.generatedAt,
      ModDate: file.generatedAt,
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

  // `openImage` is real and undeclared in `@types/pdfkit`; the object it returns is what `image()` reuses — one lockup for every part.
  const lockup = (doc as unknown as { openImage(src: Buffer): unknown }).openImage(LOGO);
  for (const part of parts) drawPart(doc, part, lockup);

  doc.end();
  return finished;
}

/**
 * One part into the document, after the pages already in it: its entries, then the footers of its own pages. Every
 * entry starts on a new page (`drawEntry`), and sets the font, the size and the colour of everything it draws, so a part
 * draws the same pages after another part as alone.
 */
function drawPart(doc: PDFKit.PDFDocument, part: DeclarationPart, lockup: unknown): void {
  // The pages before this part: its own are counted from the next one.
  const before = doc.bufferedPageRange();
  const start = before.start + before.count;
  // How many pages the part has after each entry, so each page's footer names its own entry's version (§499).
  const pagesAfterEach: number[] = [];
  for (const entry of part.entries) {
    drawEntry(doc, entry, part.labels, lockup);
    pagesAfterEach.push(doc.bufferedPageRange().count - before.count);
  }
  const owners = pageOwners(part.entries, pagesAfterEach);

  // A bundle with nothing in it is still a valid file that says so, rather than an error.
  if (part.entries.length === 0) {
    doc.addPage();
    doc.font("body").fontSize(12).fillColor(COLOR.inkMuted).text("—", MARGIN.left, MARGIN.top);
  }

  // Footers: the page count is what makes a missing page noticeable; the version in force of the
  // text on that page and when it was signed (§499) are what make a loose page say what it is. The
  // full hash is under each text's own signature block, where a printed copy is checked against it.
  const range = doc.bufferedPageRange();
  const end = range.start + range.count;
  const count = end - start;
  const idDocumentsNotice = idDocumentsNoticeFor(part);
  for (let i = start; i < end; i++) {
    doc.switchToPage(i);
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const y = PAGE.height - MARGIN.bottom + DECLARATION_FOOTER.gap;
    doc.moveTo(MARGIN.left, y - 8).lineTo(PAGE.width - MARGIN.right, y - 8).strokeColor(COLOR.line).lineWidth(0.5).stroke();
    const pageLabel = part.labels.page(i - start + 1, count);
    // The left line ends where the page count begins, measured, whatever length the language gives the date.
    const pageLabelWidth = doc.font("body").fontSize(DECLARATION_FOOTER.size).widthOfString(pageLabel);
    doc
      .fillColor(COLOR.inkMuted)
      .text(declarationFooterLine(owners[i - start], part.labels), MARGIN.left, y, { width: TEXT_WIDTH - pageLabelWidth - 8, lineBreak: false })
      .text(pageLabel, MARGIN.left, y, { width: TEXT_WIDTH, align: "right", lineBreak: false });
    let next = y + DECLARATION_FOOTER.size + 3;
    // The page's own entry's proof of signing (§556), on one line: a 64-character hash is long, so the
    // line is set a step smaller until it fits the width rather than wrapping into the notice below.
    const proof = declarationProofLine(owners[i - start], part.labels);
    if (proof) {
      let size = DECLARATION_FOOTER.size - 1;
      while (size > 5 && doc.font("body").fontSize(size).widthOfString(proof) > TEXT_WIDTH) size -= 0.5;
      doc.font("body").fontSize(size).fillColor(COLOR.inkMuted).text(proof, MARGIN.left, next, { width: TEXT_WIDTH, lineBreak: false });
      next += size + 3;
    }
    if (idDocumentsNotice) {
      doc
        .font("bold")
        .fontSize(DECLARATION_FOOTER.size)
        .fillColor(COLOR.inkMuted)
        .text(idDocumentsNotice, MARGIN.left, next, { width: TEXT_WIDTH, lineBreak: false });
    }
    doc.page.margins.bottom = bottom;
  }
}

/** The lockup at the head of each declaration: 140 points wide, as tall as its own proportion makes it (§885). */
export const DECLARATION_LOGO = { width: 140, height: 140 * LOGO_HEIGHT_SHARE } as const;

function drawEntry(doc: PDFKit.PDFDocument, entry: DeclarationEntry, labels: DeclarationPdfInput["labels"], lockup: unknown): void {
  doc.addPage();
  // The lockup, and the title centred under it, as the paper form has them.
  doc.image(lockup as string, MARGIN.left, MARGIN.top, { width: DECLARATION_LOGO.width });
  doc.y = MARGIN.top + DECLARATION_LOGO.height + 20;
  doc.font("bold").fontSize(14).fillColor(COLOR.ink).text(entry.title.toUpperCase(), MARGIN.left, doc.y, { width: TEXT_WIDTH, align: "center" });
  doc.moveDown(0.2);
  doc.font("body").fontSize(11).fillColor(COLOR.ink).text(entry.eventTitle, { width: TEXT_WIDTH, align: "center" });
  // Which approved text this is, before a word of it is read (§499) — on the blank form the desk
  // prints too, so a stack of paper says which version each sheet was printed from.
  doc.moveDown(0.2);
  doc.font("body").fontSize(8.5).fillColor(COLOR.inkMuted).text(declarationVersionLine(entry, labels), { width: TEXT_WIDTH, align: "center" });
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
      // "Declar că am cel puțin {{minimumAge}}." on a run with no minimum is no sentence (§440).
      if (dropsParagraph(paragraph, entry.values ?? {})) continue;
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
  // The trace of an electronic signature (§771) is one more small line, or two with a long browser string: the room is asked for with the block.
  const traceLine = declarationTraceLine(entry, labels);
  // Signed by the host too (§991): the two-column block. Without a host — every text but the volunteer agreement — what follows, as it always was.
  if (labels.hostSignature) {
    drawSignatureColumns(doc, entry, labels, labels.hostSignature, traceLine);
    return;
  }
  const traceHeight = traceLine ? doc.font("body").fontSize(8).heightOfString(traceLine, { width: TEXT_WIDTH }) + 8 : 0;
  const blockHeight = (twoSigners ? 260 : 170) + traceHeight;
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

  for (const item of signerRows(entry, labels)) {
    if (item === "gap") doc.moveDown(0.4);
    else row(item.label, item.value, item.hand);
  }
  doc.moveDown(0.4);
  // The electronic signature's trace, small, straight under the signature and its date: when, from which address, in which browser (§771).
  if (traceLine) {
    doc.font("body").fontSize(8).fillColor(COLOR.inkMuted).text(traceLine, MARGIN.left, doc.y, { width: TEXT_WIDTH });
    doc.moveDown(0.4);
  }
  // How it was signed, and against which text: the version and the hash a printed copy is
  // checked against the stored version with.
  doc
    .font("body")
    .fontSize(8.5)
    .fillColor(COLOR.inkMuted)
    .text(
      // The proof of signing last (§556): the version, the instant to the second, the signed text's hash.
      [signature?.method, `${labels.version} ${entry.version} · sha256 ${entry.contentSha256}`, declarationProofLine(entry, labels)].filter(Boolean).join("\n"),
      MARGIN.left,
      doc.y,
      { width: TEXT_WIDTH },
    );
}

/**
 * The signer's rows of a signature block, top to bottom, for both shapes of block: the signature — or, signed by two (§330),
 * the minor's and then the parent's or guardian's with a little room between (`"gap"`) — each with its identity-document line
 * where one is asked (on the blank form, always; never where the text asks none, §758), then the date. `hand` is a typed name,
 * set in the handwriting face; a null value is a blank, on the form printed to sign by hand. Pure.
 */
type SignerRow = { label: string; value: string | null; hand: boolean } | "gap";

function signerRows(entry: DeclarationEntry, labels: DeclarationPdfInput["labels"]): SignerRow[] {
  const signature = entry.signature;
  const twoSigners = signature ? signature.minor !== null : Boolean(entry.forMinor);
  const rows: SignerRow[] = [];
  if (twoSigners) {
    // The minor first, as the text names them first; then the parent or guardian who declares
    // with them. A document line only where a document was asked (or on the blank form).
    const minor = signature?.minor ?? null;
    rows.push({ label: labels.minorSignature, value: minor ? minor.typedName : null, hand: Boolean(minor) });
    if (!entry.noIdDocument && (signature ? minor !== null && minor.idDocument !== null : true)) rows.push({ label: labels.idDocument, value: minor ? minor.idDocument : null, hand: false });
    rows.push("gap");
    rows.push({ label: labels.guardianSignature, value: signature ? signature.typedName : null, hand: Boolean(signature) });
    if (!entry.noIdDocument && (signature ? signature.idDocument !== null : true)) rows.push({ label: labels.idDocument, value: signature ? signature.idDocument : null, hand: false });
  } else {
    rows.push({ label: entry.signatureLabel ?? labels.signature, value: signature ? signature.typedName : null, hand: Boolean(signature) });
    if (!entry.noIdDocument && (signature ? signature.idDocument !== null : true)) rows.push({ label: labels.idDocument, value: signature ? signature.idDocument : null, hand: false });
  }
  rows.push({ label: labels.date, value: signature ? signature.signedAt : null, hand: false });
  return rows;
}

/** A column of the two-column signature block (§991): where it starts and how wide it is. */
type SignatureColumn = { readonly x: number; readonly width: number };

/**
 * The two-column block's rhythm (§991), the single-column block's own (`drawEntry`): a 10.5-point line of words, 22 points
 * from one row to the next, 30 under a name in its hand beside its label; a name under its label starts 8 points under the
 * label's top, at 26 points, smaller until it fits its column — a little lower as it gets smaller, so its letters keep clear
 * of the label — never under 14, where a longer one wraps inside the column. A line to fill in by hand is its label and, 22
 * points under the label's top, a dotted line across the column: room to write above the dots, the space a signature takes.
 * The small lines under a signature are 5 points apart, as `moveDown(0.4)` sets them; the lines under both columns, 8.
 */
const COLUMN = { line: 13, row: 22, handRow: 30, handSize: 26, handMinSize: 14, handIndent: 14, blankDrop: 22, gap: 5, tailGap: 8 } as const;

/** The dotted line to write on: as many of the blank's dots as fit `width`, at the body's size. */
function dotsFor(doc: PDFKit.PDFDocument, width: number): string {
  const dot = BLANK_LINE[0];
  doc.font("body").fontSize(10.5);
  let dots = dot.repeat(Math.max(1, Math.floor(width / doc.widthOfString(dot))));
  while (dots.length > 1 && doc.widthOfString(dots) > width) dots = dots.slice(0, -1);
  return dots;
}

/**
 * One row of a signature column (§991), measured — and drawn with `draw` — from its top `y`: the label, and its value beside it
 * when that fits inside the column, else under it inside the column. Returns where the next row starts. The one arithmetic
 * measures and draws, so the room the block asks for before drawing is the room it draws, and nothing it sets reaches past
 * its column: a value under its label is wrapped or set smaller to the column's width.
 */
function columnRow(doc: PDFKit.PDFDocument, column: SignatureColumn, y: number, row: Exclude<SignerRow, "gap">, draw: boolean): number {
  const caption = `${row.label}:`;
  doc.font("body").fontSize(10.5);
  const captionWidth = doc.widthOfString(caption);
  // Every label is a few of the platform's words, well inside a column; one that were not would wrap inside it, its value under it.
  const oneLine = captionWidth <= column.width;
  const captionBottom = oneLine ? y + COLUMN.line : y + doc.heightOfString(caption, { width: column.width });
  if (draw) doc.fillColor(COLOR.ink).text(caption, column.x, y, oneLine ? { lineBreak: false } : { width: column.width });
  const besideX = column.x + captionWidth + 8;
  const room = oneLine ? column.x + column.width - besideX : 0;

  if (row.value === null) {
    // To fill in by hand: the dotted line under the label, across the column.
    const top = captionBottom - COLUMN.line + COLUMN.blankDrop;
    if (draw) doc.font("body").fontSize(10.5).fillColor(COLOR.inkMuted).text(dotsFor(doc, column.width), column.x, top, { lineBreak: false });
    return top + COLUMN.row;
  }
  if (row.hand) {
    // The typed name in the hand the page showed it in, on its label's baseline when it fits beside it (`drawEntry`'s row)…
    if (doc.font("hand").fontSize(COLUMN.handSize).widthOfString(row.value) <= room) {
      if (draw) doc.fillColor(COLOR.blueInk).text(row.value, besideX, y - 10, { lineBreak: false });
      return y + COLUMN.handRow;
    }
    // …else on the line under it, at the size that fits the column, and wrapped inside it at the smallest.
    const width = column.width - COLUMN.handIndent;
    let size: number = COLUMN.handSize;
    while (size > COLUMN.handMinSize && doc.font("hand").fontSize(size).widthOfString(row.value) > width) size -= 1;
    const fits = doc.font("hand").fontSize(size).widthOfString(row.value) <= width;
    const top = captionBottom - COLUMN.line + 8 + (COLUMN.handSize - size) / 2;
    const height = doc.heightOfString(row.value, { width });
    if (draw) doc.fillColor(COLOR.blueInk).text(row.value, column.x + COLUMN.handIndent, top, fits ? { lineBreak: false } : { width });
    return top + height + COLUMN.gap;
  }
  // Plain words — the date: beside the label, or under it wrapped inside the column.
  doc.font("body").fontSize(10.5);
  if (doc.widthOfString(row.value) <= room) {
    if (draw) doc.fillColor(COLOR.ink).text(row.value, besideX, y, { lineBreak: false });
    return y + COLUMN.row;
  }
  const height = doc.heightOfString(row.value, { width: column.width });
  if (draw) doc.fillColor(COLOR.ink).text(row.value, column.x, captionBottom, { width: column.width });
  return captionBottom + height + COLUMN.row - COLUMN.line;
}

/**
 * The signer's column (§991): exactly the rows the single-column block draws (`signerRows`), then, small, the electronic
 * signature's trace straight under the signature and its date (§771), and how it was signed — the signer's own side, every
 * word of it inside the column. Returns its bottom.
 */
function signerColumn(doc: PDFKit.PDFDocument, entry: DeclarationEntry, labels: DeclarationPdfInput["labels"], traceLine: string | undefined, column: SignatureColumn, top: number, draw: boolean): number {
  let y = top;
  for (const item of signerRows(entry, labels)) y = item === "gap" ? y + COLUMN.gap : columnRow(doc, column, y, item, draw);
  for (const [words, size] of [
    [traceLine, 8],
    [entry.signature?.method, 8.5],
  ] as const) {
    if (!words) continue;
    y += COLUMN.gap;
    const height = doc.font("body").fontSize(size).heightOfString(words, { width: column.width });
    if (draw) doc.fillColor(COLOR.inkMuted).text(words, column.x, y, { width: column.width });
    y += height;
  }
  return y;
}

/** The host's column (§991): the party, its name under it, and each of its representative's lines to fill in by hand. Returns its bottom. */
function hostColumn(doc: PDFKit.PDFDocument, host: DeclarationHostSignature, column: SignatureColumn, top: number, draw: boolean): number {
  let y = top;
  for (const [words, face, after] of [
    [host.heading, "bold", 1],
    [host.name, "body", 8],
  ] as const) {
    const height = doc.font(face).fontSize(10.5).heightOfString(words, { width: column.width });
    if (draw) doc.fillColor(COLOR.ink).text(words, column.x, y, { width: column.width });
    y += height + after;
  }
  for (const line of host.lines) y = columnRow(doc, column, y, { label: line, value: null, hand: false }, draw);
  return y;
}

/**
 * The signature block of a text the host signs too (§991; the owner, 2026-11-19, of the volunteer agreements printed for the
 * race: «să las în dreapta și „Asociația” ca să printăm și să semnăm fizic»): «DREPT PENTRU CARE SEMNĂM» across the page —
 * two parties sign — the signer's column on the left and the host's on the right from the same line, and under the taller of
 * the two, across the page, the version, the fingerprint and the proof of signing, whose 64-character hash needs the page's
 * width. Measured whole before a line of it is drawn, so it moves to a new page together, as the single-column block does.
 */
function drawSignatureColumns(doc: PDFKit.PDFDocument, entry: DeclarationEntry, labels: DeclarationPdfInput["labels"], host: DeclarationHostSignature, traceLine: string | undefined): void {
  const { signer, host: hostBox } = DECLARATION_SIGNATURE_COLUMNS;
  // About a line of the text above, and under the heading — the single-column block's `moveDown(1)` and `moveDown(0.8)`.
  const above = 12;
  const underHeading = 10;
  const tail = [`${labels.version} ${entry.version} · sha256 ${entry.contentSha256}`, declarationProofLine(entry, labels)].filter(Boolean).join("\n");
  const headingHeight = doc.font("bold").fontSize(11).heightOfString(labels.whereuponTogether, { width: TEXT_WIDTH });
  const columnsHeight = Math.max(signerColumn(doc, entry, labels, traceLine, signer, 0, false), hostColumn(doc, host, hostBox, 0, false));
  const tailHeight = doc.font("body").fontSize(8.5).heightOfString(tail, { width: TEXT_WIDTH });
  if (doc.y + above + headingHeight + underHeading + columnsHeight + COLUMN.tailGap + tailHeight > PAGE.height - MARGIN.bottom) doc.addPage();

  let y = doc.y + above;
  doc.font("bold").fontSize(11).fillColor(COLOR.ink).text(labels.whereuponTogether, MARGIN.left, y, { width: TEXT_WIDTH });
  y += headingHeight + underHeading;
  y = Math.max(signerColumn(doc, entry, labels, traceLine, signer, y, true), hostColumn(doc, host, hostBox, y, true)) + COLUMN.tailGap;
  doc.font("body").fontSize(8.5).fillColor(COLOR.inkMuted).text(tail, MARGIN.left, y, { width: TEXT_WIDTH });
  doc.x = MARGIN.left;
}
