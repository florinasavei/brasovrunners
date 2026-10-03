"use client";

import RestartAltIcon from "@mui/icons-material/RestartAlt";
import Button from "@mui/material/Button";
import { useTranslations } from "next-intl";
import { useCallback, useLayoutEffect, useSyncExternalStore } from "react";
import { storageKey } from "@/modules/staff-identity/domain/column-widths";
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
 * Widths are applied in a layout effect, in the same frame the handles appear, but after the
 * server's HTML has painted once, so a resized table can be seen to settle on the first load.
 * Applying them before that first paint would need the server to know them, which means a cookie
 * per table read on every request, for a preference about one screen. Another tab that changes
 * this table's widths lays it out here too (`storage`), and the reset hands the keyboard's focus
 * to the table's first column edge rather than dropping it with the button.
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

  useLayoutEffect(() => {
    const apply = () => {
      const widths = readWidths(tableId);
      if (Object.keys(widths).length === 0) return;
      for (const table of tablesOf(tableId)) layOut(table, widths);
    };
    // Once now, before the browser paints this commit; the observer below keeps it true after.
    apply();
    // Another tab resized or reset this table: lay it out again, back to automatic if emptied.
    const onStorage = (event: StorageEvent) => {
      if (event.key !== null && event.key !== storageKey(tableId)) return;
      const widths = readWidths(tableId);
      for (const table of tablesOf(tableId)) layOut(table, widths);
    };
    window.addEventListener("storage", onStorage);
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
      window.removeEventListener("storage", onStorage);
    };
  }, [tableId]);

  if (!stored) return null;

  function reset() {
    const tables = tablesOf(tableId);
    // The button goes once nothing is stored; the focus goes to the first column edge, not to <body>.
    tables[0]?.querySelector<HTMLElement>('[role="separator"]')?.focus();
    writeWidths(tableId, {});
    for (const table of tables) releaseLayout(table);
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
