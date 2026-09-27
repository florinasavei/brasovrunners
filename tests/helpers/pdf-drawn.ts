import PDFDocument from "pdfkit";
import { vi } from "vitest";
import { DECLARATION_FOOTER, DECLARATION_MARGIN, DECLARATION_PAGE } from "@/modules/registrations/declaration-pdf";

/** One `text()` call of a rendered declaration: the page it landed on (0-based), the words, and its `y` when the call named one. */
export type DrawnRun = { page: number; text: string; y: number | undefined };

/** The `y` every footer line of a declaration is drawn at — `declaration-pdf.ts`'s own geometry. */
export const DECLARATION_FOOTER_Y = DECLARATION_PAGE.height - DECLARATION_MARGIN.bottom + DECLARATION_FOOTER.gap;

/**
 * What a declaration PDF actually draws, page by page (§NNN). pdfkit writes an embedded font's text
 * as glyph ids, so the file cannot be searched for words; the words are caught on their way in,
 * at `text()`, with the page they were drawn on — the page's place in the buffered file, so a
 * footer drawn after every entry still counts as its own page's.
 */
export async function drawnRuns(render: () => Promise<unknown>): Promise<DrawnRun[]> {
  const runs: DrawnRun[] = [];
  const original = PDFDocument.prototype.text;
  const spy = vi.spyOn(PDFDocument.prototype, "text").mockImplementation(function (this: PDFKit.PDFDocument, ...args: unknown[]) {
    if (typeof args[0] === "string") {
      // `_pageBuffer` is pdfkit's own list of buffered pages (`bufferPages: true`), undeclared in its types.
      const page = (this as unknown as { _pageBuffer: unknown[]; page: unknown })._pageBuffer.indexOf(this.page);
      runs.push({ page, text: args[0], y: typeof args[2] === "number" ? args[2] : undefined });
    }
    return (original as (...a: unknown[]) => PDFKit.PDFDocument).apply(this, args);
  });
  try {
    await render();
  } finally {
    spy.mockRestore();
  }
  return runs;
}
