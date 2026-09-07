import Box from "@mui/material/Box";
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
 * What that costs is real and worth naming: no column resizing, no drag-reordering, no keyboard
 * navigation between cells, and sorting and paging are round-trips rather than instant. That is
 * the trade; the `loading.tsx` boundaries are what make the round-trip legible rather than dead.
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
  sortable?: boolean;
  /** Which way this column reads first: a name starts A to Z, a date starts newest first. */
  initialDir?: "asc" | "desc";
  align?: "left" | "right" | "center";
  /** Dropped from the wide table under this breakpoint. It still appears in the phone layout. */
  hideBelow?: "sm" | "md" | "lg";
  /** The row's headline on a phone. Exactly one column should set it. */
  primary?: boolean;
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

const HIDE = {
  sm: { display: { xs: "none", sm: "table-cell" } },
  md: { display: { xs: "none", md: "table-cell" } },
  lg: { display: { xs: "none", lg: "table-cell" } },
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
  if (rows.length === 0) return <>{empty}</>;

  const pages = pageCount(total, query.perPage);
  const primary = columns.find((column) => column.primary) ?? columns[0];
  const secondary = columns.filter((column) => column !== primary);

  return (
    <Stack spacing={2}>
      <Box
        sx={{
          display: { xs: "none", md: "block" },
          border: 1,
          borderColor: "divider",
          borderRadius: 1,
          overflow: "hidden",
        }}
      >
        <Table size="small">
          <Box component="caption" sx={VISUALLY_HIDDEN}>
            {caption}
          </Box>
          <TableHead>
            <TableRow sx={{ bgcolor: "action.hover" }}>
              {columns.map((column) => (
                <TableCell
                  key={column.key}
                  align={column.align}
                  aria-sort={column.sortable ? ariaSortFor(query, column.key) : undefined}
                  sx={{
                    fontWeight: 700,
                    whiteSpace: "nowrap",
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
                        {column.label}
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
                    column.label
                  )}
                </TableCell>
              ))}
              {rowActions && (
                <TableCell align="right" sx={{ fontWeight: 700 }}>
                  {labels.actions}
                </TableCell>
              )}
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={rowKey(row)} hover>
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
      </Box>

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
        <Typography variant="body2" color="text.secondary">
          {labels.results}
        </Typography>

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
