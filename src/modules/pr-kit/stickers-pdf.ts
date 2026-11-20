import { CLUB_NAME, PALETTE, PR_KIT_COLOURS } from "@/theme/brand";
import { type StickerSheetKey, shownAddress } from "./domain/kit";
import { type Box, CUT_LINE_MM, STICKER_SHEETS, codeStickerLayout, logoStickerLayout, mm, sheetCells, sheetGrid, stickerCount } from "./domain/sheets";
import { codeMatrix, drawCode, drawLogo, fittedSize, kitDocument, textLine } from "./draw";
import { readLogoVector } from "./logo-vector";

/**
 * «Autocolante» (§1015): one A4 sheet of stickers as a PDF, drawn on request — the owner's approved sheets of 2026-11-20,
 * reproduced with pdfkit. Two carry a code to the site, the address from `APP_BASE_URL` printed under it without its scheme
 * (error correction M, four modules of quiet zone inside every sticker, `sheets.ts`); four carry the logo alone, one of them
 * white on the club's primary. The logo is the kit's own vector paths and the code vector squares, so the sheet prints sharp at
 * any size; a light-grey dashed line runs along every cut — white on the primary.
 *
 * Pure over its inputs but for reading the kit's file and the fonts: the caller passes the site's address and the moment.
 */
export async function renderStickerSheet(input: { sheet: StickerSheetKey; siteUrl: string; generatedAt: Date }): Promise<Buffer> {
  const sheet = STICKER_SHEETS[input.sheet];
  const onPrimary = sheet.ground === "primary";
  const vector = await readLogoVector("lockup", onPrimary ? "white" : "primary");
  const { doc, finished } = await kitDocument({ title: `${CLUB_NAME} — stickers, ${stickerCount(sheet)} per sheet`, generatedAt: input.generatedAt });
  const cells = sheetCells(sheet);
  const grid = sheetGrid();

  if (onPrimary) doc.rect(mm(grid.x), mm(grid.y), mm(grid.width), mm(grid.height)).fill(PR_KIT_COLOURS.ink.primary);

  if (sheet.layout === "logo") {
    const ink = onPrimary ? PR_KIT_COLOURS.ink.white : PR_KIT_COLOURS.ink.primary;
    for (const cell of cells) drawLogo(doc, vector, logoStickerLayout(sheet, cell, vector.aspect), ink);
  } else {
    const matrix = codeMatrix(input.siteUrl, "M");
    const address = shownAddress(input.siteUrl);
    for (const cell of cells) {
      const layout = codeStickerLayout(sheet, cell, vector.aspect);
      drawLogo(doc, vector, layout.logo, PR_KIT_COLOURS.ink.primary);
      drawCode(doc, matrix, layout.code, PR_KIT_COLOURS.code);
      // As large as the sticker was drawn for, smaller only for an address longer than its line.
      const size = fittedSize(doc, address, "bold", layout.address.size, layout.address.width);
      textLine(doc, address, { font: "bold", size, baseline: layout.address.baseline, colour: PALETTE.primary, centre: layout.address.x + layout.address.width / 2 });
    }
  }

  drawCuts(doc, grid, sheet.cols, sheet.rows, onPrimary ? PR_KIT_COLOURS.cutLineOnPrimary : PR_KIT_COLOURS.cutLine);
  doc.end();
  return finished;
}

/** The cut lines: every column's and every row's edge across the grid, the outer four included, dashed. */
function drawCuts(doc: PDFKit.PDFDocument, grid: Box, cols: number, rows: number, colour: string): void {
  doc.save();
  doc.lineWidth(mm(CUT_LINE_MM.width)).strokeColor(colour).dash(mm(CUT_LINE_MM.dash), { space: mm(CUT_LINE_MM.gap) });
  for (let column = 0; column <= cols; column += 1) {
    const x = mm(grid.x + (grid.width * column) / cols);
    doc.moveTo(x, mm(grid.y)).lineTo(x, mm(grid.y + grid.height));
  }
  for (let row = 0; row <= rows; row += 1) {
    const y = mm(grid.y + (grid.height * row) / rows);
    doc.moveTo(mm(grid.x), y).lineTo(mm(grid.x + grid.width), y);
  }
  doc.stroke();
  doc.undash();
  doc.restore();
}
