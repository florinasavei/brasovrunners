import PDFDocument from "pdfkit";
import { vi } from "vitest";
import { DECLARATION_FOOTER, DECLARATION_MARGIN, DECLARATION_PAGE } from "@/modules/registrations/declaration-pdf";

/** One `text()` call of a rendered declaration: the page it landed on (0-based), the words, and its `y` when the call named one. */
export type DrawnRun = { page: number; text: string; x: number | undefined; y: number | undefined; width: number | undefined; size: number | undefined };

/**
 * A run with how it was set (§NNN): `font`, the face's own name («Roboto-Regular», «Caveat-Regular»), and `measured`, how wide
 * the words are on one line in that face at that size — where a run that names no `width` ends, so a layout test can hold it
 * inside its column.
 */
export type MeasuredRun = DrawnRun & { font: string | undefined; measured: number };

/** The `y` every footer line of a declaration is drawn at — `declaration-pdf.ts`'s own geometry. */
export const DECLARATION_FOOTER_Y = DECLARATION_PAGE.height - DECLARATION_MARGIN.bottom + DECLARATION_FOOTER.gap;

/**
 * What a declaration PDF actually draws, page by page (§499). pdfkit writes an embedded font's text
 * as glyph ids, so the file cannot be searched for words; the words are caught on their way in,
 * at `text()`, with the page they were drawn on — the page's place in the buffered file, so a
 * footer drawn after every entry still counts as its own page's.
 */
export async function drawnRuns(render: () => Promise<unknown>): Promise<DrawnRun[]> {
  return caught(render, false);
}

/**
 * The same runs, each with how it was set (§NNN, `MeasuredRun`). A call of its own, so the runs other tests hash whole
 * (`bib-figures-place.test.ts`) keep the shape they were captured with.
 */
export async function measuredRuns(render: () => Promise<unknown>): Promise<MeasuredRun[]> {
  return (await caught(render, true)) as MeasuredRun[];
}

async function caught(render: () => Promise<unknown>, measure: boolean): Promise<DrawnRun[]> {
  const runs: DrawnRun[] = [];
  const original = PDFDocument.prototype.text;
  const spy = vi.spyOn(PDFDocument.prototype, "text").mockImplementation(function (this: PDFKit.PDFDocument, ...args: unknown[]) {
    if (typeof args[0] === "string") {
      // `_pageBuffer` is pdfkit's own list of buffered pages (`bufferPages: true`), undeclared in its types.
      const page = (this as unknown as { _pageBuffer: unknown[]; page: unknown })._pageBuffer.indexOf(this.page);
      const options = args[3] as { width?: number } | undefined;
      const run: DrawnRun = {
        page,
        text: args[0],
        x: typeof args[1] === "number" ? args[1] : undefined,
        y: typeof args[2] === "number" ? args[2] : undefined,
        width: options?.width,
        // The font size the run was set at: pdfkit's own `_fontSize`, undeclared in its types.
        size: (this as unknown as { _fontSize?: number })._fontSize,
      };
      if (measure) {
        // The face's PostScript name, as pdfkit's embedded font keeps it (`_font.name`, undeclared in its types).
        const measured: MeasuredRun = { ...run, font: (this as unknown as { _font?: { name?: string } })._font?.name, measured: this.widthOfString(args[0]) };
        runs.push(measured);
      } else runs.push(run);
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
