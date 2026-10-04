"use client";

import ViewColumnIcon from "@mui/icons-material/ViewColumn";
import Checkbox from "@mui/material/Checkbox";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import ListItemText from "@mui/material/ListItemText";
import ListSubheader from "@mui/material/ListSubheader";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import { useTranslations } from "next-intl";
import { useCallback, useId, useState, useSyncExternalStore } from "react";
import { applyHidden, layOut, readHidden, readWidths, tablesOf, WIDTHS_CHANGED, writeHidden } from "./column-widths-dom";

type Props = {
  /** The table's name in storage; `AdminTable` checks its shape. */
  tableId: string;
  /** The table's columns in order, each heading already translated; the row verbs' never. */
  columns: readonly { key: string; label: string; essential: boolean }[];
};

/**
 * «Coloane» (§NNN): which of a backoffice table's columns this browser shows. One checkbox per
 * column that may be hidden, and «Arată toate coloanele»; the essential ones (the first, the state)
 * are named under the list as always shown, with no checkbox.
 *
 * Like the resize handles (§652) it receives strings and flags — the table's id, each column's key,
 * heading and whether it is essential — and never a row: it hides through the same store
 * (`br.table.<id>.hidden`, beside the widths) and the same `<style>` in `<head>` the pre-paint script
 * writes, then lays the table out again so its fixed widths count only the columns shown. A hidden
 * column keeps its stored width for when it returns. Drawn only once hydrated, and only from `md`
 * up, where the table is: with JavaScript off, or on the phone layout, every column shows.
 *
 * A view, not a disclosure: the exports keep their own columns, and nothing reaches the server.
 */
export default function ColumnVisibility({ tableId, columns }: Props) {
  const t = useTranslations("Admin");
  const menuId = useId();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const hydrated = useSyncExternalStore(
    useCallback(() => () => {}, []),
    () => true,
    () => false,
  );
  const subscribe = useCallback(
    (onChange: () => void) => {
      const onHidden = (event: Event) => {
        if ((event as CustomEvent<string>).detail === tableId) onChange();
      };
      window.addEventListener(WIDTHS_CHANGED, onHidden);
      window.addEventListener("storage", onChange);
      return () => {
        window.removeEventListener(WIDTHS_CHANGED, onHidden);
        window.removeEventListener("storage", onChange);
      };
    },
    [tableId],
  );
  // A string, so the snapshot is stable between reads; one key per line.
  const hiddenText = useSyncExternalStore(subscribe, () => readHidden(tableId).join("\n"), () => "");

  if (!hydrated) return null;

  const hideable = columns.filter((column) => !column.essential);
  const essential = columns.filter((column) => column.essential);
  if (hideable.length === 0) return null;
  const hidden = new Set(hiddenText ? hiddenText.split("\n") : []);
  const hiddenHere = hideable.filter((column) => hidden.has(column.key));

  function show(next: readonly string[]) {
    writeHidden(tableId, next);
    applyHidden(tableId);
    // The fixed widths are the sum of the columns shown: lay the table out again, back to
    // automatic when nothing is stored. The widths of a hidden column stay stored.
    const widths = readWidths(tableId);
    for (const table of tablesOf(tableId)) layOut(table, widths);
  }

  function toggle(key: string) {
    const keys = hideable.map((column) => column.key);
    const now = keys.filter((other) => hidden.has(other));
    show(now.includes(key) ? now.filter((other) => other !== key) : [...now, key]);
  }

  return (
    <>
      <IconButton
        size="small"
        aria-label={t("columns.menu")}
        title={t("columns.menuHow")}
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        aria-controls={anchor !== null ? menuId : undefined}
        onClick={(event) => setAnchor(event.currentTarget)}
        data-testid="admin-table-columns"
        sx={{ display: { xs: "none", md: "inline-flex" }, minWidth: 44, minHeight: 44, verticalAlign: "middle" }}
      >
        <ViewColumnIcon fontSize="small" />
      </IconButton>
      <Menu id={menuId} anchorEl={anchor} open={anchor !== null} onClose={() => setAnchor(null)}>
        {hideable.map((column) => {
          const shown = !hidden.has(column.key);
          return (
            <MenuItem
              key={column.key}
              role="menuitemcheckbox"
              aria-checked={shown}
              onClick={() => toggle(column.key)}
              data-column-toggle={column.key}
              sx={{ minHeight: 44 }}
            >
              <Checkbox
                checked={shown}
                size="small"
                tabIndex={-1}
                disableRipple
                slotProps={{ input: { "aria-hidden": true, tabIndex: -1 } }}
                sx={{ p: 0, mr: 1.5 }}
              />
              <ListItemText>{column.label}</ListItemText>
            </MenuItem>
          );
        })}
        <Divider />
        <MenuItem disabled={hiddenHere.length === 0} onClick={() => show([])} sx={{ minHeight: 44 }}>
          <ListItemText>{t("columns.showAll")}</ListItemText>
        </MenuItem>
        {essential.length > 0 && (
          <ListSubheader sx={{ position: "static", lineHeight: 1.5, py: 1, maxWidth: 320, whiteSpace: "normal" }}>
            {t("columns.always", { columns: essential.map((column) => column.label).join(", ") })}
          </ListSubheader>
        )}
      </Menu>
    </>
  );
}
