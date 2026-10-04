import Box from "@mui/material/Box";
import Hint from "@/shared/ui/Hint";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import Link from "next/link";
import type { ReactNode } from "react";
import {
  ariaSortFor,
  buildListHref,
  type ListQuery,
  pageCount,
  PER_PAGE_OPTIONS,
  sortHref,
} from "@/modules/staff-identity/domain/admin-list-query";
import { ACTIONS_COLUMN, isEssentialColumn, TABLE_ID_PATTERN } from "@/modules/staff-identity/domain/column-widths";
import ColumnResizeHandle from "./ColumnResizeHandle";
import ColumnVisibility from "./ColumnVisibility";
import ColumnWidths from "./ColumnWidths";
import ColumnWidthsScript from "./ColumnWidthsScript";

/**
 * The one table every backoffice list is built from.
 *
 * ## Why this is not `@mui/x-data-grid`
 *
 * A grid would have given sorting, resizing, density and keyboard cell navigation for the price
 * of one dependency, and it was refused for reasons that are specific rather than reflexive
 * (§1.5; `DECISIONS.md` §53 records the argument in full):
 *
 *   - It is a Client Component. Every row it displays has to cross the server boundary as a
 *     prop, and the rows on the busiest list here are participants — a name and a delivery
 *     address each. §14.5 lets participant data reach a client component only when it needs it,
 *     and a table that renders on the server needs none of it there.
 *   - Sorting, filtering and paging would move from the URL into client memory, so a filtered
 *     list would stop being something an organizer can bookmark, reload, or return to after a
 *     Server Action redirects — which every write in this backoffice does.
 *   - Its pagination is client-side in the free tier, and the requirement is the opposite: the
 *     club will have thousands of registrations across seasons and none of them belong in a
 *     browser at once.
 *   - The lists would stop working with JavaScript off, which today they do.
 *
 * What that costs is real and worth naming: no drag-reordering, no keyboard navigation between
 * cells, and sorting and paging are round-trips rather than instant. That is the trade; the
 * `loading.tsx` boundaries are what make the round-trip legible rather than dead.
 *
 * ## Resizable columns, without the grid (§650)
 *
 * The refusal above first named "no column resizing" as a price too, and resizing is what the
 * owner then asked for — so it is paid here, inside this table, and every reason above still
 * holds. The table stays server-rendered; a `<colgroup>` gives each column a `<col data-column>`,
 * and one small island per heading (`ColumnResizeHandle`) is the column's right edge, dragged by a
 * pointer or moved by the arrow keys, never narrower than its heading's longest word. It receives
 * strings — the table's id, the column's key, its heading — and lays the table out through the
 * DOM, so no row ever crosses to the client. The widths are this browser's own, per `tableId`, in
 * `localStorage`: a preference about one screen, not something the server or the URL needs to
 * know. Right after `</table>`, `ColumnWidthsScript` applies them as a `<style>` before the first
 * paint, so a resized table does not jump on load; under the table, `ColumnWidths` takes over once
 * hydrated (removing that style), lays the table out again when its frame changes width, and
 * offers «Lățimi și coloane implicite» while any is stored. With JavaScript off neither island draws anything, and the table is the
 * automatic one it always was.
 *
 * ## Columns that can be hidden, without the grid (§NNN)
 *
 * The owner's second grid ask, showing and hiding columns, is paid the same way. The actions'
 * heading (or, on a list without row verbs, the line under the table) carries «Coloane», one more
 * island (`ColumnVisibility`): a menu with a checkbox per column and «Arată toate coloanele». What
 * is hidden is this browser's own, beside the widths (`br.table.<id>.hidden`), hidden before the
 * first paint by the same script and undone by the same reset. A column marked `essential` — and
 * always the first one and the phone's headline — has no checkbox (`data-column-essential` on its
 * `<col>`). The phone layout and the exports keep every column: hiding is a view, not a disclosure.
 *
 * A resized table switches to `table-layout: fixed` at the sum of its columns' widths: wider
 * than the frame, the frame scrolls sideways inside its border; narrower, it stops short. The
 * phone layout has no columns and is untouched.
 *
 * ## Two layouts, one definition
 *
 * A table at `md` and up, and a block per row below it, because race morning is a phone (§18.5)
 * and eight columns at 320px is not a table anybody reads — it is a sideways scroll over
 * somebody's name. Both are generated from the same `columns` array, so a column cannot appear
 * in one and be forgotten in the other. The phone layout is emitted alongside the table and
 * hidden by CSS rather than chosen in JavaScript: the server cannot know the viewport, and
 * guessing it is how a desktop table gets shipped to a phone for one frame.
 */

export type AdminColumn<Row> = {
  /** Also the `?sort=` value when the column is sortable, so it must match the repository. */
  key: string;
  /** Already translated by the caller. */
  label: string;
  /**
   * What this column's values mean, how to read them and what to do about them, shown behind a
   * "?" beside the heading (§200) — and once above the phone layout, which has no heading. For
   * a column whose values are shorthand — "3/6 · Loc rezervat" — the heading alone cannot say
   * what the six are, and a legend above the table is a legend nobody reads twice. A list is
   * written one `\n– item` per line; the tooltip keeps the lines (§257, §341).
   */
  hint?: string;
  sortable?: boolean;
  /** Which way this column reads first: a name starts A to Z, a date starts newest first. */
  initialDir?: "asc" | "desc";
  align?: "left" | "right" | "center";
  /** Dropped from the wide table under this breakpoint. It still appears in the phone layout. */
  hideBelow?: "sm" | "md" | "lg";
  /** The row's headline on a phone. Exactly one column should set it. */
  primary?: boolean;
  /**
   * Never hidden from the «Coloane» menu (§NNN): the state, which a row cannot be read without.
   * The first column and the `primary` one are essential without saying so.
   */
  essential?: boolean;
  render: (row: Row) => ReactNode;
};

export type AdminTableLabels = {
  results: string;
  page: string;
  previous: string;
  next: string;
  perPage: string;
  actions: string;
  /** Takes a column label and returns its header link's accessible name. */
  sortBy: (column: string) => string;
};

type Props<Row> = {
  /** Names the table for anybody who cannot see the heading above it. */
  caption: string;
  /**
   * The table's name for the column widths this browser keeps (§650): lowercase letters, digits
   * and hyphens, one per list — two tables sharing one would share their widths. Never anything
   * about a row or a person: it is written into the browser's storage.
   */
  tableId: string;
  columns: readonly AdminColumn<Row>[];
  rows: readonly Row[];
  rowKey: (row: Row) => string;
  /** The already-localized path this list lives at, such as `/ro/admin/registrations`. */
  basePath: string;
  /** The current query string, so a sort link keeps the filters and a filter keeps the sort. */
  currentParams: Record<string, string | undefined>;
  query: ListQuery;
  /** The count of matching rows in the database, not the length of `rows`. */
  total: number;
  labels: AdminTableLabels;
  /** The permitted verbs for one row, in their own column and their own block. */
  rowActions?: (row: Row) => ReactNode;
  /** Shown instead of the table when nothing matches. Says what to do, not just "nothing". */
  empty: ReactNode;
};

/**
 * A visible line between two rows (§453): MUI's own cell border is the divider lightened
 * almost to nothing, and a list of events with pills and a series' dates read as one block.
 * The theme's `divider` token, so the dark scheme (§93) gets its own; none under the last row,
 * where the frame's border already is. Each body row says which it wears in
 * `data-row-separator` ("line" or "none"), the handle the render test reads. A step more
 * vertical padding makes each row one block, and the header's rule is 2px of `text.secondary`
 * so the headings stand apart from the first row in both schemes.
 */
const ROW_SEPARATOR = {
  "& > td": { borderBottom: 1, borderColor: "divider", py: 1.25 },
} as const;
const LAST_ROW = {
  "& > td": { borderBottom: 0, py: 1.25 },
} as const;
const HEAD_RULE = { borderBottom: 2, borderColor: "text.secondary" } as const;

const HIDE = {
  sm: { display: { xs: "none", sm: "table-cell" } },
  md: { display: { xs: "none", md: "table-cell" } },
  lg: { display: { xs: "none", lg: "table-cell" } },
} as const;

/**
 * The same breakpoints for a column's `<col>` (§650). A `<col>` hidden with its cells keeps the
 * colgroup and the cells counting the same columns: a cell hidden while its `<col>` stayed would
 * shift every cell after it under the wrong width.
 */
const HIDE_COL = {
  sm: { display: { xs: "none", sm: "table-column" } },
  md: { display: { xs: "none", md: "table-column" } },
  lg: { display: { xs: "none", lg: "table-column" } },
} as const;

/**
 * A resized table (`data-resized`, set by the islands) has fixed widths, so a long value wraps
 * inside its column rather than pushing the column wider, and a body cell clips what still does
 * not fit. A heading wraps between its words only, never inside one: no column goes narrower than
 * its heading's longest word (`headingFloor`). A heading cell does not clip: its resize handle
 * reaches past its edge.
 */
const RESIZED = {
  "&[data-resized] > thead > tr > th": { whiteSpace: "normal" },
  "&[data-resized] > tbody > tr > td": { overflow: "hidden", overflowWrap: "anywhere" },
} as const;

/**
 * Every link here is a `next/link` element wrapping a styled `<span>`, never
 * `<Box component={Link}>`.
 *
 * `component={Link}` passes a *function* as a prop to MUI's `Box`, which is a Client Component,
 * and React refuses that outright: "Functions cannot be passed directly to Client Components".
 * It type-checks, builds, and throws at request time — the whole backoffice rendered its error
 * boundary. `admin/page.tsx` already carried the warning for `Button`; this is the same rule.
 *
 * A real `next/link` rather than `component="a"` on purpose: an anchor would be a full document
 * load, and a soft navigation is what makes the `loading.tsx` boundaries appear when a column is
 * sorted or a page turned. The `<a>` still carries a real `href`, so both work with JavaScript
 * off.
 */
const LINK_RESET = { textDecoration: "none", color: "inherit" } as const;

/**
 * Off-screen but announced — the table needs a name, and a visible one would repeat the heading.
 *
 * `"1px"` and not `1`. MUI reads a *number* between 0 and 1 in `sx` as a fraction, so `width: 1`
 * is `width: 100%` — the caption was laid out at the full width of its containing block and gave
 * the page 65 pixels of horizontal scroll, on a table whose whole purpose is to be readable
 * without any. Caught by measuring `scrollWidth` rather than by looking at it, because a
 * visually hidden element is invisible in exactly the way that hides this.
 */
const VISUALLY_HIDDEN = {
  position: "absolute",
  width: "1px",
  height: "1px",
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
} as const;

export default function AdminTable<Row>({
  caption,
  tableId,
  columns,
  rows,
  rowKey,
  basePath,
  currentParams,
  query,
  total,
  labels,
  rowActions,
  empty,
}: Props<Row>) {
  // It becomes part of a storage key and a CSS selector, so its shape is checked, not trusted.
  if (!TABLE_ID_PATTERN.test(tableId)) throw new Error(`AdminTable: tableId "${tableId}" is not lowercase-hyphenated`);
  if (rows.length === 0) return <>{empty}</>;

  const pages = pageCount(total, query.perPage);
  const primary = columns.find((column) => column.primary) ?? columns[0];
  const secondary = columns.filter((column) => column !== primary);
  const hinted = columns.filter((column) => column.hint);
  // What the «Coloane» menu offers (§NNN): strings and a flag per column, never a row.
  const menuColumns = columns.map((column, index) => ({
    key: column.key,
    label: column.label,
    essential: isEssentialColumn(column, index),
  }));
  const columnMenu = <ColumnVisibility tableId={tableId} columns={menuColumns} />;

  return (
    <Stack spacing={2}>
      <Box
        sx={{
          display: { xs: "none", md: "block" },
          border: 1,
          borderColor: "divider",
          borderRadius: 1,
          // A resized table wider than the frame scrolls inside it (§650), never the page.
          overflowX: "auto",
          overflowY: "hidden",
        }}
      >
        <Table size="small" data-table-id={tableId} sx={RESIZED}>
          <Box component="caption" sx={VISUALLY_HIDDEN}>
            {caption}
          </Box>
          <colgroup>
            {columns.map((column, index) => (
              <Box
                key={column.key}
                component="col"
                data-column={column.key}
                data-column-essential={isEssentialColumn(column, index) ? "" : undefined}
                sx={column.hideBelow ? HIDE_COL[column.hideBelow] : undefined}
              />
            ))}
            {rowActions && <col data-column={ACTIONS_COLUMN} />}
          </colgroup>
          <TableHead>
            <TableRow sx={{ bgcolor: "action.hover" }}>
              {columns.map((column, index) => (
                <TableCell
                  key={column.key}
                  align={column.align}
                  aria-sort={column.sortable ? ariaSortFor(query, column.key) : undefined}
                  data-column={column.key}
                  sx={{
                    position: "relative",
                    fontWeight: 700,
                    whiteSpace: "nowrap",
                    ...HEAD_RULE,
                    ...(column.hideBelow ? HIDE[column.hideBelow] : {}),
                  }}
                >
                  {column.sortable ? (
                    <Link
                      href={sortHref(
                        basePath,
                        currentParams,
                        query,
                        column.key,
                        column.initialDir ?? "asc",
                      )}
                      aria-label={labels.sortBy(column.label)}
                      style={LINK_RESET}
                    >
                      <Box
                        component="span"
                        sx={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 0.5,
                          minHeight: 44,
                          color: "inherit",
                          "&:hover": { textDecoration: "underline" },
                        }}
                      >
                        <span data-column-heading="">{column.label}</span>
                        {/* Decorative: `aria-sort` on the cell reports the state, and repeating
                            it in text would announce it twice. */}
                        <Box
                          component="span"
                          aria-hidden
                          sx={{ opacity: query.sort === column.key ? 1 : 0.25 }}
                        >
                          {query.sort === column.key && query.dir === "asc" ? "▲" : "▼"}
                        </Box>
                      </Box>
                    </Link>
                  ) : (
                    <span data-column-heading="">{column.label}</span>
                  )}
                  {column.hint && <Hint text={column.hint} />}
                  <ColumnResizeHandle
                    tableId={tableId}
                    column={column.key}
                    label={column.label}
                    last={!rowActions && index === columns.length - 1}
                  />
                </TableCell>
              ))}
              {rowActions && (
                <TableCell
                  align="right"
                  data-column={ACTIONS_COLUMN}
                  sx={{ fontWeight: 700, whiteSpace: "nowrap", ...HEAD_RULE }}
                >
                  {labels.actions}
                  {columnMenu}
                </TableCell>
              )}
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row, index) => (
              <TableRow
                key={rowKey(row)}
                hover
                data-row-separator={index === rows.length - 1 ? "none" : "line"}
                sx={index === rows.length - 1 ? LAST_ROW : ROW_SEPARATOR}
              >
                {columns.map((column) => (
                  <TableCell
                    key={column.key}
                    align={column.align}
                    sx={column.hideBelow ? HIDE[column.hideBelow] : undefined}
                  >
                    {column.render(row)}
                  </TableCell>
                ))}
                {rowActions && <TableCell align="right">{rowActions(row)}</TableCell>}
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {/* Right after the table: its stored widths, before the first paint (§650). */}
        <ColumnWidthsScript tableId={tableId} />
      </Box>

      {/*
        The column hints, once, above the phone layout (§341). The table's "?" lives in its
        heading, and the phone layout has no heading — a block per row, each label repeated — so
        on the screen race morning is read on, the explanation of "3/6" or "2*" was nowhere.
        Once above the blocks rather than beside every row's label: a hundred identical "?"
        would be a hundred client islands saying the same thing.
      */}
      {hinted.length > 0 && (
        <Stack
          direction="row"
          sx={{ display: { xs: "flex", md: "none" }, flexWrap: "wrap", alignItems: "center", columnGap: 2 }}
          data-testid="admin-table-hints"
        >
          {hinted.map((column) => (
            <Typography key={column.key} component="span" variant="body2" color="text.secondary" sx={{ display: "inline-flex", alignItems: "center" }}>
              {column.label}
              <Hint text={column.hint as string} />
            </Typography>
          ))}
        </Stack>
      )}

      <Stack
        component="ul"
        spacing={1.5}
        sx={{ display: { xs: "flex", md: "none" }, listStyle: "none", p: 0, m: 0 }}
      >
        {rows.map((row) => (
          <Box
            key={rowKey(row)}
            component="li"
            sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 2 }}
          >
            <Typography component="div" sx={{ fontWeight: 700, fontSize: "1rem", mb: 1 }}>
              {primary.render(row)}
            </Typography>
            <Stack spacing={0.5}>
              {secondary.map((column) => (
                <Stack
                  key={column.key}
                  direction="row"
                  sx={{ justifyContent: "space-between", alignItems: "baseline", gap: 1 }}
                >
                  <Typography variant="body2" color="text.secondary" sx={{ flexShrink: 0 }}>
                    {column.label}
                  </Typography>
                  <Box sx={{ textAlign: "right", minWidth: 0 }}>{column.render(row)}</Box>
                </Stack>
              ))}
            </Stack>
            {rowActions && <Box sx={{ mt: 1.5 }}>{rowActions(row)}</Box>}
          </Box>
        ))}
      </Stack>

      <Stack
        direction="row"
        sx={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 1 }}
      >
        <Stack direction="row" sx={{ alignItems: "center", flexWrap: "wrap", gap: 1 }}>
          <Typography variant="body2" color="text.secondary">
            {labels.results}
          </Typography>
          <ColumnWidths tableId={tableId} />
          {/* A list without row verbs has no actions' heading to carry the menu: it sits here. */}
          {!rowActions && columnMenu}
        </Stack>

        <Stack direction="row" sx={{ alignItems: "center", flexWrap: "wrap", gap: 1 }}>
          <Typography variant="body2" color="text.secondary" sx={{ mr: 1 }}>
            {labels.perPage}
          </Typography>
          {PER_PAGE_OPTIONS.map((size) => (
            <Link
              key={size}
              href={buildListHref(basePath, currentParams, { perPage: size })}
              aria-current={query.perPage === size ? "true" : undefined}
              style={LINK_RESET}
            >
              <Box
                component="span"
                sx={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  minWidth: 44,
                  minHeight: 44,
                  borderRadius: 1,
                  color: query.perPage === size ? "primary.contrastText" : "text.secondary",
                  bgcolor: query.perPage === size ? "primary.main" : "transparent",
                }}
              >
                {size}
              </Box>
            </Link>
          ))}
        </Stack>
      </Stack>

      {pages > 1 && (
        <Stack
          direction="row"
          spacing={1}
          sx={{ justifyContent: "center", alignItems: "center", flexWrap: "wrap", gap: 1 }}
        >
          <PageStep
            href={buildListHref(basePath, currentParams, { page: query.page - 1 })}
            disabled={query.page <= 1}
            label={labels.previous}
          />
          <Typography variant="body2" sx={{ px: 2 }}>
            {labels.page}
          </Typography>
          <PageStep
            href={buildListHref(basePath, currentParams, { page: query.page + 1 })}
            disabled={query.page >= pages}
            label={labels.next}
          />
        </Stack>
      )}
    </Stack>
  );
}

/**
 * One step through the pages.
 *
 * At the ends it becomes a plain box rather than a disabled link, because there is no such
 * thing as a disabled anchor: an `<a>` without an `href` is still focusable in some browsers
 * and still announced as a link, and `aria-disabled` on one that navigates anyway is a lie.
 * Dropping the link is the honest version, and `aria-hidden` keeps it out of the reading order
 * while it holds its place in the layout.
 */
function PageStep({ href, disabled, label }: { href: string; disabled: boolean; label: string }) {
  const sx = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: 44,
    minHeight: 44,
    px: 2,
    border: 1,
    borderColor: "divider",
    borderRadius: 1,
    textDecoration: "none",
  } as const;

  if (disabled) {
    return (
      <Box aria-hidden sx={{ ...sx, color: "text.disabled", borderColor: "action.disabledBackground" }}>
        {label}
      </Box>
    );
  }

  return (
    <Link href={href} style={LINK_RESET}>
      <Box component="span" sx={{ ...sx, color: "text.primary" }}>
        {label}
      </Box>
    </Link>
  );
}
