/**
 * The arithmetic behind a backoffice table's resizable columns (§NNN), kept apart from the DOM
 * so it can be tested without a browser.
 *
 * What is stored is only what somebody changed: one width in CSS pixels per column key they
 * dragged, per table, in that browser's `localStorage`. A column nobody touched keeps the width
 * the browser's automatic layout gives it, measured at the moment the table switches to a fixed
 * layout, so a table with one widened column still reads like the table it was.
 *
 * Pixels rather than proportions (§271 stored proportions for a page's table, written once and
 * read at every width): this is one person's own screen, read again on the same screen, and a
 * proportion would move every other column the moment one was dragged.
 */

/** Narrow enough to tuck a column away, wide enough to keep its handle and a few letters. */
export const MIN_COLUMN_WIDTH = 56;
/** Wider than any column needs on a desktop screen; a stored value past it is a broken one. */
export const MAX_COLUMN_WIDTH = 960;
/** One press of an arrow key on a column's edge, and one with Shift held. */
export const KEY_STEP = 16;
export const KEY_STEP_LARGE = 64;

/** A table's name in the browser's storage: short, lowercase, and never anybody's data. */
export const TABLE_ID_PATTERN = /^[a-z0-9-]{1,40}$/;

/** The `<col>` of the row-verbs column: never a column key, so never resizable or stored. */
export const ACTIONS_COLUMN = "__actions";

export type ColumnWidths = Record<string, number>;

export function storageKey(tableId: string): string {
  return `br.admin-table.${tableId}.widths`;
}

export function clampWidth(width: number): number {
  return Math.round(Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, width)));
}

/**
 * What storage held, read defensively: anything that is not an object of finite numbers is
 * dropped key by key, and every width is brought back inside the limits. A browser that blocks
 * storage, a value from an older shape or one somebody edited by hand all read as "nothing
 * changed" rather than as a broken table.
 */
export function parseWidths(raw: string | null | undefined): ColumnWidths {
  if (!raw) return {};
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const widths: ColumnWidths = {};
  for (const [key, width] of Object.entries(value as Record<string, unknown>)) {
    if (key === ACTIONS_COLUMN || key.length > 80) continue;
    if (typeof width !== "number" || !Number.isFinite(width)) continue;
    widths[key] = clampWidth(width);
  }
  return widths;
}

/**
 * The fixed layout for the columns on screen now: each one's stored width when it has one,
 * otherwise the width the automatic layout measured, and the table as wide as their sum.
 * `visible` is in column order and leaves out a column the breakpoint hides.
 */
export function fixedLayout(
  visible: readonly { key: string; measured: number }[],
  stored: ColumnWidths,
): { widths: ColumnWidths; total: number } {
  const widths: ColumnWidths = {};
  let total = 0;
  for (const { key, measured } of visible) {
    const width = key in stored && key !== ACTIONS_COLUMN ? stored[key] : Math.round(measured);
    widths[key] = width;
    total += width;
  }
  return { widths, total };
}

/** Whether any stored width belongs to a column on screen — otherwise the table stays automatic. */
export function touchesVisible(visible: readonly { key: string }[], stored: ColumnWidths): boolean {
  return visible.some(({ key }) => key !== ACTIONS_COLUMN && key in stored);
}

/**
 * The width after one key press on a column's edge (the window-splitter pattern): the arrows
 * move it by a step, Shift by a larger one, Home and End to the limits. Any other key is
 * `null`, so the caller leaves it to the browser.
 */
export function keyboardWidth(current: number, key: string, shift: boolean): number | null {
  const step = shift ? KEY_STEP_LARGE : KEY_STEP;
  switch (key) {
    case "ArrowRight":
      return clampWidth(current + step);
    case "ArrowLeft":
      return clampWidth(current - step);
    case "Home":
      return MIN_COLUMN_WIDTH;
    case "End":
      return MAX_COLUMN_WIDTH;
    default:
      return null;
  }
}
