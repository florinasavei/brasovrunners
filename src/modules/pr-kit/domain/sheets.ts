import type { StickerSheetKey } from "./kit";

/**
 * The sticker sheets' geometry (§1015), in millimetres — the owner's approved sheets of 2026-11-20, reproduced: an A4 page, 9 mm
 * margins left and right and 8 mm top and bottom, the stickers in a grid filling the rest, a light-grey dashed line on every
 * cut. Pure, so `tests/unit/pr-kit/sheets.test.ts` can hold every sheet to it without drawing one.
 *
 * - **«12 pe foaie» with a code** (3 × 4, upright): the logo, the code 34 mm square, the site's address under it.
 * - **«24 pe foaie» with a code** (3 × 8, lying down): the logo and the address on the left, the code 24 mm square on the right.
 * - **The logo alone**, 12 (2 × 6), 24 (3 × 8) and 40 (4 × 10) to a sheet, and 12 white on the club's primary.
 *
 * **The code's quiet zone is four modules, inside the sticker** (ISO/IEC 18004): nothing is drawn within four modules of the
 * code and the cut stays outside them, for every code the address can make. The gaps below are set for the widest such zone,
 * a version-1 code's 21 modules (`SMALLEST_CODE_MODULES`) — a longer address makes a code of more, smaller modules and a
 * narrower zone, never a wider one.
 *
 * Each logo is fitted inside its box by the drawing's own proportion (`logoAspect`: height over width), so a club whose
 * lockup is squarer still stands inside the sticker.
 */

export type Box = { x: number; y: number; width: number; height: number };

export const A4_MM = { width: 210, height: 297 } as const;

/** The sheets' page margins, as the approved sheets have them. */
export const SHEET_MARGIN_MM = { x: 9, y: 8 } as const;

/** The quiet zone around a code, in modules, on every side. */
export const QUIET_ZONE_MODULES = 4;

/** The fewest modules a code has (version 1): the widest quiet zone a code of a given size can need. */
export const SMALLEST_CODE_MODULES = 21;

/** The cut line: 0.2 mm, dashed. */
export const CUT_LINE_MM = { width: 0.2, dash: 0.9, gap: 0.6 } as const;

/** What one sheet holds: its grid, its kind, and the sizes its layout draws at. */
export type StickerSheet =
  | {
      key: StickerSheetKey;
      cols: number;
      rows: number;
      /** The logo over the code over the address, centred. */
      layout: "qr-upright";
      code: number;
      /** The logo's box: the drawing is fitted inside it. */
      logo: { width: number; height: number };
      /** The address's size: its cap height and descent are the font's (`TEXT_METRICS`). */
      text: number;
      gap: number;
      ground: "paper";
    }
  | {
      key: StickerSheetKey;
      cols: number;
      rows: number;
      /** The logo over the address on the left, the code on the right. */
      layout: "qr-landscape";
      code: number;
      logo: { width: number; height: number };
      text: number;
      /** The space from the cut to the left column, and the code's own margins on its other sides. */
      inset: number;
      codeMargin: number;
      /** Between the logo and the address. */
      lineGap: number;
      ground: "paper";
    }
  | {
      key: StickerSheetKey;
      cols: number;
      rows: number;
      /** The logo alone, centred. */
      layout: "logo";
      logo: { width: number; height: number };
      ground: "paper" | "primary";
    };

export const STICKER_SHEETS: Record<StickerSheetKey, StickerSheet> = {
  "qr-12": { key: "qr-12", cols: 3, rows: 4, layout: "qr-upright", code: 34, logo: { width: 36, height: 15 }, text: 3.6, gap: 6.8, ground: "paper" },
  "qr-24": { key: "qr-24", cols: 3, rows: 8, layout: "qr-landscape", code: 24, logo: { width: 26, height: 11 }, text: 2.6, inset: 3.2, codeMargin: 4.8, lineGap: 1.8, ground: "paper" },
  "logo-12": { key: "logo-12", cols: 2, rows: 6, layout: "logo", logo: { width: 78, height: 32 }, ground: "paper" },
  "logo-24": { key: "logo-24", cols: 3, rows: 8, layout: "logo", logo: { width: 52, height: 21.5 }, ground: "paper" },
  "logo-40": { key: "logo-40", cols: 4, rows: 10, layout: "logo", logo: { width: 39, height: 16 }, ground: "paper" },
  "logo-12-primary": { key: "logo-12-primary", cols: 2, rows: 6, layout: "logo", logo: { width: 78, height: 32 }, ground: "primary" },
};

/** How many stickers a sheet holds. */
export function stickerCount(sheet: StickerSheet): number {
  return sheet.cols * sheet.rows;
}

/** The grid: the page inside its margins. */
export function sheetGrid(): Box {
  return { x: SHEET_MARGIN_MM.x, y: SHEET_MARGIN_MM.y, width: A4_MM.width - 2 * SHEET_MARGIN_MM.x, height: A4_MM.height - 2 * SHEET_MARGIN_MM.y };
}

/** Every sticker's box, row by row: equal cells sharing their cuts. */
export function sheetCells(sheet: StickerSheet): Box[] {
  const grid = sheetGrid();
  const width = grid.width / sheet.cols;
  const height = grid.height / sheet.rows;
  return Array.from({ length: sheet.cols * sheet.rows }, (_, index) => ({
    x: grid.x + (index % sheet.cols) * width,
    y: grid.y + Math.floor(index / sheet.cols) * height,
    width,
    height,
  }));
}

/**
 * The text's vertical measures as a share of its size: Roboto Bold's cap height and descent (`src/theme/pdf/Roboto-Bold.ttf`,
 * 1456 and 500 of 2048 units) — what the address line takes above and below its baseline.
 */
export const TEXT_METRICS = { cap: 1456 / 2048, descent: 500 / 2048 } as const;

/** The drawing fitted inside a box by its proportion, centred in it. */
export function fitInside(box: Box, aspect: number): Box {
  const width = Math.min(box.width, box.height / aspect);
  const height = width * aspect;
  return { x: box.x + (box.width - width) / 2, y: box.y + (box.height - height) / 2, width, height };
}

/** One line of text: its left edge, its baseline, the width it may take and its size, and the box its letters fill. */
export type TextLine = { x: number; baseline: number; width: number; size: number; box: Box };

function line(x: number, top: number, width: number, size: number): TextLine {
  const baseline = top + size * TEXT_METRICS.cap;
  return { x, baseline, width, size, box: { x, y: top, width, height: size * (TEXT_METRICS.cap + TEXT_METRICS.descent) } };
}

/** A sticker with a code: where its logo, its code and its address go in one cell. */
export type CodeSticker = { logo: Box; code: Box; address: TextLine };

/**
 * The code stickers' layout in one cell. Upright: the logo, a gap, the code, a gap, the address, the block centred. Lying down:
 * the code against the right with its margin, the logo over the address in the column left of it, both centred.
 */
export function codeStickerLayout(sheet: StickerSheet, cell: Box, logoAspect: number): CodeSticker {
  if (sheet.layout === "qr-upright") {
    const logo = fitInside({ x: 0, y: 0, ...sheet.logo }, logoAspect);
    const textHeight = sheet.text * (TEXT_METRICS.cap + TEXT_METRICS.descent);
    const total = logo.height + sheet.gap + sheet.code + sheet.gap + textHeight;
    const top = cell.y + (cell.height - total) / 2;
    const centre = cell.x + cell.width / 2;
    const codeTop = top + logo.height + sheet.gap;
    return {
      logo: { x: centre - logo.width / 2, y: top, width: logo.width, height: logo.height },
      code: { x: centre - sheet.code / 2, y: codeTop, width: sheet.code, height: sheet.code },
      // The address may take the cell's width but the gap on either side, centred under the code.
      address: line(cell.x + sheet.gap, codeTop + sheet.code + sheet.gap, cell.width - 2 * sheet.gap, sheet.text),
    };
  }
  if (sheet.layout === "qr-landscape") {
    const code: Box = { x: cell.x + cell.width - sheet.codeMargin - sheet.code, y: cell.y + (cell.height - sheet.code) / 2, width: sheet.code, height: sheet.code };
    const column = { x: cell.x + sheet.inset, width: code.x - sheet.codeMargin - (cell.x + sheet.inset) };
    const logo = fitInside({ x: column.x, y: 0, width: Math.min(column.width, sheet.logo.width), height: sheet.logo.height }, logoAspect);
    const textHeight = sheet.text * (TEXT_METRICS.cap + TEXT_METRICS.descent);
    const total = logo.height + sheet.lineGap + textHeight;
    const top = cell.y + (cell.height - total) / 2;
    return {
      logo: { x: column.x + (column.width - logo.width) / 2, y: top, width: logo.width, height: logo.height },
      code,
      address: line(column.x, top + logo.height + sheet.lineGap, column.width, sheet.text),
    };
  }
  throw new Error(`the sheet ${sheet.key} has no code`);
}

/** A logo sticker's drawing: the logo fitted inside its box, centred in the cell. */
export function logoStickerLayout(sheet: StickerSheet, cell: Box, logoAspect: number): Box {
  const box = { x: cell.x + (cell.width - sheet.logo.width) / 2, y: cell.y + (cell.height - sheet.logo.height) / 2, width: sheet.logo.width, height: sheet.logo.height };
  return fitInside(box, logoAspect);
}

/** The code's quiet zone: the code's box grown by four modules on every side. */
export function quietZone(code: Box, modules: number): Box {
  const margin = (QUIET_ZONE_MODULES * code.width) / modules;
  return { x: code.x - margin, y: code.y - margin, width: code.width + 2 * margin, height: code.height + 2 * margin };
}

/** Whether `inner` lies wholly inside `outer`, to a hundredth of a millimetre. */
export function contains(outer: Box, inner: Box): boolean {
  const slack = 0.01;
  return inner.x >= outer.x - slack && inner.y >= outer.y - slack && inner.x + inner.width <= outer.x + outer.width + slack && inner.y + inner.height <= outer.y + outer.height + slack;
}

/** Whether two boxes share any area — more than a millionth of a millimetre, so two cells that share a cut do not. */
export function overlaps(a: Box, b: Box): boolean {
  const slack = 1e-6;
  return a.x < b.x + b.width - slack && b.x < a.x + a.width - slack && a.y < b.y + b.height - slack && b.y < a.y + a.height - slack;
}

/** Millimetres as PDF points. */
export const mm = (value: number): number => (value * 72) / 25.4;
