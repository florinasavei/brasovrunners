"use client";

import Box from "@mui/material/Box";
import { useTranslations } from "next-intl";
import {
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  useCallback,
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
import { layOut, readWidths, setColumnWidth, writeWidths } from "./column-widths-dom";

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
 * The window-splitter pattern: `role="separator"`, focusable, its width as the value — the
 * arrows move it by 16 pixels, Shift by 64, Home and End to the limits. A double press puts that
 * one column back to its automatic width. Drawn only once hydrated: with JavaScript off the
 * table is exactly what it was, and a handle that did nothing would be a lie.
 *
 * Reach: 16 pixels under a mouse, 44 under a finger (BR-REQ-041-01 criterion 6), centred on the
 * edge so the heading's sort link keeps its own pixels.
 */
export default function ColumnResizeHandle({ tableId, column, label, last }: Props) {
  const t = useTranslations("Admin");
  const hydrated = useSyncExternalStore(
    useCallback(() => () => {}, []),
    () => true,
    () => false,
  );
  const [width, setWidth] = useState<number | null>(null);
  const drag = useRef<Drag | null>(null);

  /** The table this edge belongs to, laid out fixed with what is stored, and every column's width. */
  const freeze = useCallback(
    (element: HTMLElement) => {
      const table = element.closest("table");
      if (!table) return null;
      const widths = layOut(table, readWidths(tableId), true);
      return widths ? { table, widths } : null;
    },
    [tableId],
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
    const start = frozen.widths[column] ?? MIN_COLUMN_WIDTH;
    drag.current = { ...frozen, startX: event.clientX, start, moved: false };
    setWidth(start);
  }

  function onPointerMove(event: PointerEvent<HTMLSpanElement>) {
    const current = drag.current;
    if (!current) return;
    const next = clampWidth(current.start + event.clientX - current.startX);
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
    const next = keyboardWidth(frozen.widths[column] ?? MIN_COLUMN_WIDTH, event.key, event.shiftKey);
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
    setWidth(null);
    if (table) layOut(table, rest);
  }

  return (
    <Box
      component="span"
      role="separator"
      tabIndex={0}
      aria-orientation="vertical"
      aria-label={t("columns.resize", { column: label })}
      aria-valuemin={MIN_COLUMN_WIDTH}
      aria-valuemax={MAX_COLUMN_WIDTH}
      aria-valuenow={width ?? undefined}
      title={t("columns.resizeHow")}
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
        "@media (pointer: coarse)": { width: 44, right: last ? 0 : -22 },
        // The line itself: the frame's divider at rest, the brand colour under the pointer or focus.
        "&::after": {
          content: '""',
          width: "2px",
          my: 1,
          borderRadius: 1,
          bgcolor: "divider",
        },
        "&:hover::after, &:focus-visible::after": { bgcolor: "primary.main" },
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
