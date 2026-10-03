import {
  columnFloor,
  type ColumnWidths,
  fixedLayout,
  MIN_COLUMN_WIDTH,
  parseWidths,
  storageKey,
  touchesVisible,
} from "@/modules/staff-identity/domain/column-widths";

/**
 * The browser half of the resizable columns (§NNN): reading and writing the stored widths, and
 * laying a server-rendered table out with them. Called only from the two islands' handlers and
 * effects, never during a render, so nothing here runs on the server.
 *
 * The table itself stays a Server Component's markup. The islands reach it through the DOM —
 * `table[data-table-id]`, its `<col data-column>` and `<th data-column>` — rather than through
 * React, because the alternative is a client table that receives every row as a prop, which is
 * the first reason `AdminTable` is not a data grid.
 */

/** Said on `window` whenever a table's stored widths change, so its reset control can appear. */
export const WIDTHS_CHANGED = "br:admin-table-widths";

/**
 * Said on a `<table>` itself each time it is laid out or let go, so each of its handles can say
 * its column's width now (`aria-valuenow`) — after a reload, a reset, a double click, a breakpoint.
 */
export const LAID_OUT = "br:admin-table-layout";

/** What a fixed layout gave every visible column, and each one's floor. */
export type Laid = { widths: ColumnWidths; floors: ColumnWidths };

export function readWidths(tableId: string): ColumnWidths {
  try {
    return parseWidths(window.localStorage.getItem(storageKey(tableId)));
  } catch {
    // Storage blocked (a private window, a policy): the table simply keeps its automatic layout.
    return {};
  }
}

export function writeWidths(tableId: string, widths: ColumnWidths): void {
  try {
    if (Object.keys(widths).length === 0) window.localStorage.removeItem(storageKey(tableId));
    else window.localStorage.setItem(storageKey(tableId), JSON.stringify(widths));
  } catch {
    // Not kept past this page, but the drag itself still worked.
  }
  window.dispatchEvent(new CustomEvent(WIDTHS_CHANGED, { detail: tableId }));
}

export function tablesOf(tableId: string): HTMLTableElement[] {
  return [...document.querySelectorAll<HTMLTableElement>(`table[data-table-id="${tableId}"]`)];
}

function columns(table: HTMLTableElement): HTMLTableColElement[] {
  return [...table.querySelectorAll<HTMLTableColElement>(":scope > colgroup > col[data-column]")];
}

function headerCell(table: HTMLTableElement, key: string): HTMLTableCellElement | null {
  return table.querySelector<HTMLTableCellElement>(`:scope > thead th[data-column="${CSS.escape(key)}"]`);
}

function unfix(table: HTMLTableElement): void {
  for (const col of columns(table)) col.style.width = "";
  table.style.tableLayout = "";
  table.style.width = "";
  delete table.dataset.resized;
}

function announce(table: HTMLTableElement): void {
  table.dispatchEvent(new Event(LAID_OUT));
}

/** Back to the browser's own layout: no widths on the columns, the table at its natural width. */
export function releaseLayout(table: HTMLTableElement): void {
  unfix(table);
  announce(table);
}

/**
 * The narrowest a column may go so that no word of its heading is cut: the heading's longest word,
 * plus whatever sits beside the words on the heading's line (the sort arrow, a hint) and the cell's
 * padding. Measured in the automatic layout, where a heading is one line (`nowrap`): the line's
 * width less the words' width is what stays beside them once the heading wraps between words.
 */
export function headingFloor(th: HTMLTableCellElement): number {
  const heading = th.querySelector<HTMLElement>("[data-column-heading]");
  const words = (heading?.textContent ?? "").split(/\s+/).filter(Boolean);
  if (!heading || words.length === 0) return MIN_COLUMN_WIDTH;

  const range = document.createRange();
  range.selectNodeContents(th);
  const handle = th.querySelector("[data-column-resize]");
  if (handle) range.setEndBefore(handle);
  const line = range.getBoundingClientRect().width;
  const label = heading.getBoundingClientRect().width;

  // A probe inside the heading inherits its font; absolute, so it moves nothing while it is there.
  const probe = document.createElement("span");
  probe.style.cssText = "position:absolute;visibility:hidden;white-space:pre;";
  heading.appendChild(probe);
  let longest = 0;
  for (const word of words) {
    probe.textContent = word;
    longest = Math.max(longest, probe.getBoundingClientRect().width);
  }
  probe.remove();

  const style = getComputedStyle(th);
  const padding = (Number.parseFloat(style.paddingLeft) || 0) + (Number.parseFloat(style.paddingRight) || 0);
  // Two pixels for the subpixel rounding of the words and the border between the cells.
  return columnFloor(Math.max(0, line - label) + longest + padding + 2);
}

/**
 * A column's width as laid out now, whole — the width a fixed layout set on its `<col>`, else the
 * heading's measured one — or `null` while the table is not displayed.
 */
export function columnWidthNow(table: HTMLTableElement, key: string): number | null {
  const col = table.querySelector<HTMLTableColElement>(`:scope > colgroup > col[data-column="${CSS.escape(key)}"]`);
  const set = Number.parseFloat(col?.style.width ?? "");
  if (table.dataset.resized && Number.isFinite(set) && set > 0) return Math.round(set);
  const th = headerCell(table, key);
  const width = th?.getBoundingClientRect().width ?? 0;
  return width > 0 ? Math.round(width) : null;
}

/**
 * Lays `table` out with `stored`, and returns every visible column's width in that layout and its
 * floor — or `null` when the table is left automatic: nothing stored for a column on screen and
 * `force` unset, or the table not displayed at all (below `md` the phone layout shows instead,
 * and a hidden table measures zero).
 *
 * It always measures from the automatic layout first, so a column nobody dragged gets the width
 * the browser would give it today, on today's rows, and not one remembered from another page —
 * and each heading's floor (`headingFloor`) is measured there too, while the heading is one line.
 */
export function layOut(table: HTMLTableElement, stored: ColumnWidths, force = false): Laid | null {
  unfix(table);
  if (table.offsetParent === null) {
    announce(table);
    return null;
  }

  const visible: { key: string; col: HTMLTableColElement; th: HTMLTableCellElement; measured: number }[] = [];
  for (const col of columns(table)) {
    const key = col.dataset.column as string;
    const th = headerCell(table, key);
    if (!th || getComputedStyle(th).display === "none") continue;
    visible.push({ key, col, th, measured: th.getBoundingClientRect().width });
  }
  if (!force && !touchesVisible(visible, stored)) {
    announce(table);
    return null;
  }

  const floors: ColumnWidths = {};
  for (const { key, th } of visible) floors[key] = headingFloor(th);
  const { widths, total } = fixedLayout(
    visible.map(({ key, measured }) => ({ key, measured, floor: floors[key] })),
    stored,
  );
  for (const { key, col } of visible) col.style.width = `${widths[key]}px`;
  table.style.tableLayout = "fixed";
  table.style.width = `${total}px`;
  table.dataset.resized = "true";
  announce(table);
  return { widths, floors };
}

/** During a drag: one column's new width, and the table's width moved by the same amount. */
export function setColumnWidth(table: HTMLTableElement, key: string, widths: ColumnWidths, width: number): void {
  const col = table.querySelector<HTMLTableColElement>(`:scope > colgroup > col[data-column="${CSS.escape(key)}"]`);
  if (!col) return;
  widths[key] = width;
  col.style.width = `${width}px`;
  table.style.width = `${Object.values(widths).reduce((sum, value) => sum + value, 0)}px`;
}
