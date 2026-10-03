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
 * The browser half of the resizable columns (§650): reading and writing the stored widths, and
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

/**
 * What this page itself was told, per table, while the browser's storage refused (a private
 * window, a policy): without it, the second arrow press or drag would lay the table out from the
 * empty storage and snap every column back. It lives as long as the page, which is all a refused
 * storage allows; a write the storage accepts drops it, so the storage stays the one truth.
 */
const unsaved = new Map<string, ColumnWidths>();

export function readWidths(tableId: string): ColumnWidths {
  // What this page was told and storage refused to keep comes first (a read may work while a write
  // throws: a full store, an old private window); a successful write deletes the entry, so storage
  // is the one truth otherwise. Storage blocked for reading too: nothing, the automatic layout.
  const kept = unsaved.get(tableId);
  if (kept) return { ...kept };
  try {
    return parseWidths(window.localStorage.getItem(storageKey(tableId)));
  } catch {
    return {};
  }
}

export function writeWidths(tableId: string, widths: ColumnWidths): void {
  try {
    if (Object.keys(widths).length === 0) window.localStorage.removeItem(storageKey(tableId));
    else window.localStorage.setItem(storageKey(tableId), JSON.stringify(widths));
    unsaved.delete(tableId);
  } catch {
    // Not kept past this page, but kept on it: the next press or drag starts from here.
    if (Object.keys(widths).length === 0) unsaved.delete(tableId);
    else unsaved.set(tableId, { ...widths });
  }
  window.dispatchEvent(new CustomEvent(WIDTHS_CHANGED, { detail: tableId }));
}

/**
 * Each column's floor as the last fixed layout measured it, per table. Once a table is resized
 * its headings may wrap, so a floor can no longer be measured there; a handle that mounts or is
 * told of a layout after that (a reload with stored widths) reads it here instead, so its
 * `aria-valuemin` is the column's own floor and not the table-wide least.
 */
const floorsByTable = new WeakMap<object, ColumnWidths>();

export function recordFloors(table: object, floors: ColumnWidths): void {
  floorsByTable.set(table, { ...floors });
}

/** The floor the last fixed layout measured for `key`, or `undefined` before any. */
export function recordedFloor(table: object, key: string): number | undefined {
  return floorsByTable.get(table)?.[key];
}

/**
 * The `<style>` the inline script under the table wrote before the first paint
 * (`column-widths-script.ts`), removed the moment an island lays the table out itself, so that
 * after hydration the islands are the one source of the table's widths.
 */
export function dropEarlyStyle(tableId: string): void {
  for (const style of document.head.querySelectorAll(`style[data-column-widths="${tableId}"]`)) style.remove();
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
  // Whatever lays the table out from here on, the pre-paint style is no longer its source.
  if (table.dataset.tableId) dropEarlyStyle(table.dataset.tableId);
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
  recordFloors(table, floors);
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
