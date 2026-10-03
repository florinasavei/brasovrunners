"use client";

import RestartAltIcon from "@mui/icons-material/RestartAlt";
import Button from "@mui/material/Button";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { layOut, readWidths, releaseLayout, tablesOf, WIDTHS_CHANGED, writeWidths } from "./column-widths-dom";

/**
 * One per table, under it (§NNN): lays the table out with the widths this browser stored for it
 * when the page opens and whenever the table's frame changes width, and offers to put every column
 * back the way the server drew it.
 *
 * The control shows only while something is stored — a reset for a table nobody resized is a
 * button that does nothing — and only from `md` up, where the table is (the phone layout has no
 * columns). With JavaScript off it renders nothing at all, and nothing was stored either.
 *
 * Widths are applied after the page has painted once, so a resized table can be seen to settle on
 * the first load. Applying them before paint would need the server to know them, which means a
 * cookie per table read on every request, for a preference about one screen.
 */
export default function ColumnWidths({ tableId }: { tableId: string }) {
  const t = useTranslations("Admin");

  const subscribe = useCallback(
    (onChange: () => void) => {
      const onWidths = (event: Event) => {
        if ((event as CustomEvent<string>).detail === tableId) onChange();
      };
      window.addEventListener(WIDTHS_CHANGED, onWidths);
      window.addEventListener("storage", onChange);
      return () => {
        window.removeEventListener(WIDTHS_CHANGED, onWidths);
        window.removeEventListener("storage", onChange);
      };
    },
    [tableId],
  );
  const stored = useSyncExternalStore(
    subscribe,
    () => Object.keys(readWidths(tableId)).length > 0,
    () => false,
  );

  useEffect(() => {
    const apply = () => {
      const widths = readWidths(tableId);
      if (Object.keys(widths).length === 0) return;
      for (const table of tablesOf(tableId)) layOut(table, widths);
    };
    // Lay out again whenever the table's frame changes width: a breakpoint crossed shows or hides
    // columns, and a table inside a closed fold measures nothing until the fold opens. The frame,
    // not the table, is watched — the table's own width is what a layout sets — and only its
    // width, once per frame, so a layout that changes the rows' height cannot call itself again.
    let frame = 0;
    const seen = new WeakMap<Element, number>();
    const observer = new ResizeObserver((entries) => {
      const changed = entries.some((entry) => seen.get(entry.target) !== entry.contentRect.width);
      for (const entry of entries) seen.set(entry.target, entry.contentRect.width);
      if (!changed) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(apply);
    });
    for (const table of tablesOf(tableId)) {
      if (table.parentElement) observer.observe(table.parentElement);
    }
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [tableId]);

  if (!stored) return null;

  function reset() {
    writeWidths(tableId, {});
    for (const table of tablesOf(tableId)) releaseLayout(table);
  }

  return (
    <Button
      type="button"
      size="small"
      variant="text"
      onClick={reset}
      startIcon={<RestartAltIcon fontSize="small" />}
      data-testid="admin-table-reset-widths"
      sx={{ display: { xs: "none", md: "inline-flex" }, minHeight: 44 }}
    >
      {t("columns.reset")}
    </Button>
  );
}
