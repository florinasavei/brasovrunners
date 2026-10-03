"use client";

import Box from "@mui/material/Box";
import { useTranslations } from "next-intl";
import {
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  clampWidth,
  type ColumnWidths,
  keyboardWidth,
  MAX_COLUMN_WIDTH,
  MIN_COLUMN_WIDTH,
} from "@/modules/staff-identity/domain/column-widths";
import {
  columnWidthNow,
  headingFloor,
  LAID_OUT,
  layOut,
  readWidths,
  setColumnWidth,
  writeWidths,
} from "./column-widths-dom";

type Props = {
  /** The table's name in storage; `AdminTable` checks its shape. */
  tableId: string;
  /** The column's key, as on its `<col>` and its `<th>`. */
  column: string;
  /** The column's heading, already translated, for the handle's accessible name. */
  label: string;
  /** The rightmost resizable edge sits inside its cell, so the frame never scrolls for it. */
  last: boolean;
};

type Drag = {
  table: HTMLTableElement;
  widths: ColumnWidths;
  floor: number;
  startX: number;
  start: number;
  moved: boolean;
};

/**
 * A column's right edge, which a pointer drags and a keyboard moves (§NNN).
 *
 * This island is the whole of the resizing: a strip at the edge of one heading cell, and nothing
 * about the rows. It receives a table name, a column key and a heading — all strings — and
 * reaches the server-rendered table through the DOM (`column-widths-dom.ts`). No participant's
 * name or address crosses into it (§14.5).
 *
 * The window-splitter pattern: `role="separator"`, focusable, its column's width now as the value
 * (said again each time the table is laid out — after a reload, a reset, a double click) — the
 * arrows move it by 16 pixels, Shift by 64, Home to the column's own floor (its heading's longest
 * word, so no heading word is cut) and End to the widest. A double press puts that one column back
 * to its automatic width. Drawn only once hydrated: with JavaScript off the
 * table is exactly what it was, and a handle that did nothing would be a lie.
 *
 * Reach: 16 pixels under a mouse, centred on the edge, inside the next cell's padding; 44 under a
 * finger (BR-REQ-041-01 criterion 6), 28 of them on its own side of the edge and 16 past it, so it
 * stays inside the next heading's padding too and that heading's sort link keeps its own pixels.
 * The visible line is drawn for a mouse only; a finger finds the edge by its reach.
 */
export default function ColumnResizeHandle({ tableId, column, label, last }: Props) {
  const t = useTranslations("Admin");
  const hydrated = useSyncExternalStore(
    useCallback(() => () => {}, []),
    () => true,
    () => false,
  );
  const [width, setWidth] = useState<number | null>(null);
  const [floor, setFloor] = useState<number>(MIN_COLUMN_WIDTH);
  const drag = useRef<Drag | null>(null);
  const self = useRef<HTMLSpanElement | null>(null);

  // The value a focusable separator owes: the column's width as laid out now, read once hydrated
  // and again each time the table says it was laid out or let go. Not while a drag is under way,
  // which says its own width.
  useEffect(() => {
    const table = self.current?.closest("table");
    if (!hydrated || !table) return;
    const measure = () => {
      if (drag.current) return;
      setWidth(columnWidthNow(table, column));
      const th = self.current?.closest("th");
      // Measured only while the heading is one line: a fixed layout may already have wrapped it.
      if (th && !table.dataset.resized) setFloor(headingFloor(th));
    };
    const frame = requestAnimationFrame(measure);
    table.addEventListener(LAID_OUT, measure);
    return () => {
      cancelAnimationFrame(frame);
      table.removeEventListener(LAID_OUT, measure);
    };
  }, [hydrated, column]);

  /** The table this edge belongs to, laid out fixed with what is stored, and every column's width. */
  const freeze = useCallback(
    (element: HTMLElement) => {
      const table = element.closest("table");
      if (!table) return null;
      const laid = layOut(table, readWidths(tableId), true);
      if (!laid) return null;
      const columnFloorNow = laid.floors[column] ?? MIN_COLUMN_WIDTH;
      setFloor(columnFloorNow);
      return { table, widths: laid.widths, floor: columnFloorNow };
    },
    [tableId, column],
  );

  const commit = useCallback(
    (next: number) => {
      writeWidths(tableId, { ...readWidths(tableId), [column]: next });
      setWidth(next);
    },
    [tableId, column],
  );

  if (!hydrated) return null;

  function onPointerDown(event: PointerEvent<HTMLSpanElement>) {
    if (event.button !== 0) return;
    const frozen = freeze(event.currentTarget);
    if (!frozen) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const start = frozen.widths[column] ?? frozen.floor;
    drag.current = { ...frozen, startX: event.clientX, start, moved: false };
    setWidth(start);
  }

  function onPointerMove(event: PointerEvent<HTMLSpanElement>) {
    const current = drag.current;
    if (!current) return;
    const next = clampWidth(current.start + event.clientX - current.startX, current.floor);
    current.moved = true;
    setColumnWidth(current.table, column, current.widths, next);
    setWidth(next);
  }

  function onPointerEnd(event: PointerEvent<HTMLSpanElement>) {
    const current = drag.current;
    if (!current) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    // A press that never moved changes nothing: the table goes back to what was stored.
    if (current.moved) commit(current.widths[column] ?? current.start);
    else layOut(current.table, readWidths(tableId));
  }

  function onKeyDown(event: KeyboardEvent<HTMLSpanElement>) {
    // Tab and every other key belong to the browser; only the splitter's own keys lay out.
    if (keyboardWidth(MIN_COLUMN_WIDTH, event.key, event.shiftKey) === null) return;
    const frozen = freeze(event.currentTarget);
    if (!frozen) return;
    const next = keyboardWidth(frozen.widths[column] ?? frozen.floor, event.key, event.shiftKey, frozen.floor);
    if (next === null) return;
    event.preventDefault();
    commit(next);
    layOut(frozen.table, readWidths(tableId));
  }

  function onDoubleClick(event: MouseEvent<HTMLSpanElement>) {
    const table = event.currentTarget.closest("table");
    const rest = { ...readWidths(tableId) };
    delete rest[column];
    writeWidths(tableId, rest);
    // The layout says the column's automatic width back to this handle (`LAID_OUT`).
    if (table) layOut(table, rest);
  }

  return (
    <Box
      component="span"
      role="separator"
      tabIndex={0}
      aria-orientation="vertical"
      aria-label={t("columns.resize", { column: label })}
      aria-valuemin={floor}
      aria-valuemax={MAX_COLUMN_WIDTH}
      aria-valuenow={width ?? undefined}
      aria-valuetext={width === null ? undefined : `${width} px`}
      title={t("columns.resizeHow")}
      ref={self}
      data-column-resize={column}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onKeyDown={onKeyDown}
      onDoubleClick={onDoubleClick}
      sx={{
        position: "absolute",
        top: 0,
        bottom: 0,
        zIndex: 1,
        width: 16,
        right: last ? 0 : -8,
        cursor: "col-resize",
        touchAction: "none",
        userSelect: "none",
        display: "flex",
        justifyContent: "center",
        "@media (pointer: coarse)": { width: 44, right: last ? 0 : -16 },
        // The line itself, for a mouse: the frame's divider at rest, the brand colour under the
        // pointer or focus.
        "@media (pointer: fine)": {
          "&::after": {
            content: '""',
            width: "2px",
            my: 1,
            borderRadius: 1,
            bgcolor: "divider",
          },
          "&:hover::after, &:focus-visible::after": { bgcolor: "primary.main" },
        },
        "&:focus-visible": {
          outlineStyle: "solid",
          outlineWidth: "2px",
          outlineColor: "primary.main",
          outlineOffset: "-2px",
        },
      }}
    />
  );
}
