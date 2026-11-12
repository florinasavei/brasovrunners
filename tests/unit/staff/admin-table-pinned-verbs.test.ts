import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AdminTable, { type AdminColumn } from "@/modules/staff-identity/ui/AdminTable";
import { earlyWidthsScript } from "@/modules/staff-identity/ui/column-widths-script";
import { BOXED_DISCLOSURE_SX } from "@/shared/ui/disclosure";
import { ADMIN_TABLE_SURFACE, ON_CARD_SX, SURFACE_VARIABLE } from "@/shared/ui/surface";
import { withClientWords } from "../../helpers/client-words";

/**
 * BR-REQ-041-01, `DECISIONS.md` §NNN — the owner, 2026-11-12, of the registrations list on a wide
 * screen: «Aici mi se face crop!». A backoffice table wider than its frame scrolls inside it, and
 * what fell outside was the last column: the row's verbs. They are pinned to the frame's right edge
 * now, by CSS alone; a heading takes no more room than it needs; and a mouse gets a denser table.
 *
 * The geometry itself — the verbs inside the frame at a narrow width, the other columns passing
 * under them — is the browser's and is walked in `tests/e2e/admin-column-widths.spec.ts`.
 */
type Row = { id: string; name: string };
const rows: Row[] = [
  { id: "a", name: "Alpha" },
  { id: "b", name: "Beta" },
];
const columns: AdminColumn<Row>[] = [
  { key: "name", label: "Nume", primary: true, sortable: true, render: (r) => r.name },
  { key: "bib", label: "Număr de concurs (BIB)", hint: "Numărul de pe piept.", render: () => "12" },
];

function render(options: { verbs?: boolean; lead?: boolean; named?: boolean } = {}) {
  return renderToStaticMarkup(
    withClientWords(
      createElement(AdminTable<Row>, {
        caption: "Înscrieri",
        tableId: "registrations",
        columns,
        rows,
        leadRows: options.lead ? [{ key: "i1", cells: { name: "Ana Pop" }, actions: "Vezi invitația" }] : [],
        rowKey: (r: Row) => r.id,
        rowId: options.named ? (r: Row) => `reg-${r.id}` : undefined,
        basePath: "/ro/admin/registrations",
        currentParams: {},
        query: { page: 1, perPage: 25, sort: "name", dir: "asc" } as never,
        total: rows.length,
        labels: { results: "2", page: "1", previous: "<", next: ">", perPage: "Pe pagină", actions: "Acțiuni", sortBy: (c: string) => c },
        rowActions: options.verbs === false ? undefined : (r: Row) => `verbe ${r.id}`,
        empty: null,
      }),
    ),
  );
}

/** The emitted CSS without its line breaks, and the table's own class in it. */
function cssOf(html: string) {
  const css = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((match) => match[1]).join("");
  const table = /class="([^"]*MuiTable-root[^"]*)"/.exec(html)?.[1].split(" ").find((name) => name.startsWith("css-")) ?? "";
  return { css, table: `.${table}` };
}

const ROOT = process.cwd();
const read = (...parts: string[]) => readFileSync(path.join(ROOT, ...parts), "utf8").replace(/\r\n/g, "\n");

describe("§NNN the row verbs stay in view", () => {
  it("marks the verbs' heading and every row's verbs, a lead row's too; a table without verbs marks nothing", () => {
    const html = render({ lead: true });
    // The wide table alone: the phone's blocks have no columns to scroll.
    const wide = html.slice(html.indexOf("<table"), html.indexOf("</table>"));
    expect(wide.match(/<th[^>]*data-pinned=""/g)).toHaveLength(1);
    expect(wide).toMatch(/<th[^>]*data-column="__actions"[^>]*data-pinned=""/);
    // One per body row: the lead row, then the page's two.
    expect(wide.match(/<td[^>]*data-pinned=""/g)).toHaveLength(3);
    for (const verbs of ["Vezi invitația", "verbe a", "verbe b"]) {
      expect(wide).toMatch(new RegExp(`<td[^>]*data-pinned=""[^>]*>${verbs}</td>`));
    }
    expect(html.slice(html.indexOf("</table>"))).not.toContain("data-pinned");

    const plain = render({ verbs: false });
    expect(plain.slice(plain.indexOf("<table"), plain.indexOf("</table>"))).not.toContain("data-pinned=");
  });

  it("pins them with CSS alone: sticky at the frame's right edge, opaque in the surface's colour, above the column edges", () => {
    const { css, table } = cssOf(render());
    const pinned = new RegExp(`${table}>thead>tr>th\\[data-pinned\\],${table}>tbody>tr>td\\[data-pinned\\]\\{([^}]*)\\}`).exec(css)?.[1] ?? "";
    expect(pinned).toContain("position:sticky");
    expect(pinned).toContain("right:0");
    // The column edges are 1 (`ColumnResizeHandle`): the ones that pass under the verbs stay under.
    expect(pinned).toContain("z-index:2");
    expect(read("src", "modules", "staff-identity", "ui", "ColumnResizeHandle.tsx")).toMatch(/zIndex: 1,/);
    expect(pinned).toContain(`background-color:${ADMIN_TABLE_SURFACE}`);
    // The row's own fill again, over the opaque surface: the heading's, a lead row's, a hovered row's.
    const tinted = new RegExp(
      `${table}>thead>tr>th\\[data-pinned\\],${table}>tbody>tr\\[data-row-kind='lead'\\]>td\\[data-pinned\\],${table}>tbody>tr\\.MuiTableRow-hover:hover>td\\[data-pinned\\]\\{([^}]*)\\}`,
    ).exec(css)?.[1];
    expect(tinted).toBe("background-image:linear-gradient(var(--mui-palette-action-hover), var(--mui-palette-action-hover));");
    // No island decides it: the pinning is in the server's own stylesheet, so it holds before hydration.
    expect(read("src", "modules", "staff-identity", "ui", "AdminTable.tsx")).not.toMatch(/^"use client"/);
  });

  it("fades into the columns under it only while the frame says more lies that way", () => {
    const { css, table } = cssOf(render());
    const edge = new RegExp(`${table}>thead>tr>th\\[data-pinned\\]::before,${table}>tbody>tr>td\\[data-pinned\\]::before\\{([^}]*)\\}`).exec(css)?.[1] ?? "";
    expect(edge).toContain("opacity:0");
    expect(edge).toContain("right:100%");
    expect(edge).toContain("pointer-events:none");
    expect(css).toContain(`[data-more-end]>${table} [data-pinned]::before{opacity:1;}`);
    // The frame's attribute is the chips rows' own watcher's, kept by the table's island.
    const island = read("src", "modules", "staff-identity", "ui", "ColumnWidths.tsx");
    expect(island).toMatch(/watchScrollRow\(table\.parentElement, ResizeObserver, MutationObserver\)/);
    expect(island).toMatch(/for \(const stop of unwatch\) stop\(\);/);
    // A resized table clips its body cells, but not the verbs': the fade lies outside that cell.
    expect(css).toContain(`${table}[data-resized]>tbody>tr>td:not([data-pinned]){overflow:hidden;overflow-wrap:anywhere;}`);
  });

  it("takes the colour of what it stands on: the card that says so, else the page", () => {
    expect(ADMIN_TABLE_SURFACE).toBe(`var(${SURFACE_VARIABLE}, var(--mui-palette-background-default))`);
    expect(ON_CARD_SX).toEqual({ [SURFACE_VARIABLE]: "var(--mui-palette-background-paper)" });
    // The two cards a backoffice table stands in: a boxed fold, and a `Panel` that does not fold.
    expect(BOXED_DISCLOSURE_SX).toMatchObject({ bgcolor: "background.paper", ...ON_CARD_SX });
    expect(read("src", "shared", "ui", "Panel.tsx")).toMatch(/bgcolor: "background\.paper",\n\s+\.\.\.ON_CARD_SX,/);
  });
});

describe("§NNN a named row can be found in both layouts", () => {
  it("is the wide table's row by its id and the phone's block by a mark — one id in the page, never two", () => {
    const html = render({ named: true });
    const wide = html.slice(html.indexOf("<table"), html.indexOf("</table>"));
    const phone = html.slice(html.indexOf("</table>"));
    expect(wide.match(/<tr[^>]* id="reg-a"/g)).toHaveLength(1);
    expect(phone).not.toMatch(/ id="reg-a"/);
    expect(phone.match(/<li[^>]*data-row-anchor="reg-a"/g)).toHaveLength(1);
    expect(phone.match(/<li[^>]*data-row-anchor="reg-b"/g)).toHaveLength(1);
    // A list that names no rows marks none.
    expect(render()).not.toContain("data-row-anchor");
  });
});

describe("§NNN a heading takes no more room than it needs", () => {
  it("wraps a long heading onto a second line in the automatic layout, at a width a squeezed table cannot shrink", () => {
    const { css, table } = cssOf(render());
    const heading = new RegExp(`${table}:not\\(\\[data-resized\\]\\)>thead>tr>th \\[data-column-heading\\]\\{([^}]*)\\}`).exec(css)?.[1] ?? "";
    expect(heading).toContain("display:inline-block");
    // Definite: as wide as its text, never past 7em — so a table at its least width does not wrap it a word to a line.
    expect(heading).toContain("width:max-content");
    expect(heading).toContain("max-width:7em");
    expect(heading).toContain("white-space:normal");
  });

  it("a resized table lets it go, before hydration too: a heading wraps to its column's own width there", () => {
    const body = earlyWidthsScript("registrations");
    expect(body).toContain("'>thead>tr>th [data-column-heading]{display:inline;width:auto;max-width:none}'");
    // After the heading cells' own `white-space`, in the one style the script writes.
    expect(body.indexOf("[data-column-heading]")).toBeGreaterThan(body.indexOf(">thead>tr>th{white-space:normal}"));
  });

  it("under a mouse the «?» is small and the cells' side padding 12 px; a touch screen keeps the thumb's sizes", () => {
    const { css, table } = cssOf(render());
    const fine = [...css.matchAll(/@media \(pointer: fine\)\{((?:[^{}]*\{[^{}]*\})+)\}/g)].map((match) => match[1]).join("");
    expect(fine).toContain(`${table}>thead>tr>th[data-column]:not([data-pinned])>.MuiIconButton-root{min-width:0;min-height:0;`);
    expect(fine).toContain(`${table}>thead>tr>th,${table}>tbody>tr>td{padding-left:12px;padding-right:12px;}`);
    // Outside the query nothing shrinks the «?»: `Hint` keeps its 44 by 44.
    expect(read("src", "shared", "ui", "Hint.tsx")).toMatch(/minWidth: 44, minHeight: 44/);
    // «Coloane», in the verbs' heading, is not a hint and keeps its size.
    expect(css).not.toMatch(new RegExp(`${table}>thead>tr>th\\[data-pinned\\]>\\.MuiIconButton-root`));
  });
});
