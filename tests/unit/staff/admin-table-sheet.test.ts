import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AdminTable, { type AdminColumn } from "@/modules/staff-identity/ui/AdminTable";
import { withClientWords } from "../../helpers/client-words";

/**
 * BR-REQ-041-01, `DECISIONS.md` §974 — a table on one page, and on paper: the two things «Planul voluntarilor»'s
 * «Punctele, pe scurt» asks of the house's table (the owner, 2026-11-17: «aș vrea să văd punctele ca și tabel»).
 *
 * - `paged={false}`: every row is on the one page, so no rows-per-page links and no pager — they would only reload it;
 * - `printable`: a sheet is narrower than `md`, where the screen draws a block per row, so on paper the wide table is drawn
 *   whatever the width and the blocks are not, and nothing to press is printed.
 *
 * Both off unless asked for: every list reads and prints as it did. The table as the plan's page draws it, and its print,
 * are `tests/integration/volunteers/plan-table-screens.test.ts`; in a browser, `tests/e2e/volunteer-plan-mail.spec.ts`.
 */
type Row = { id: string; name: string };
const rows: Row[] = [
  { id: "a", name: "Alpha" },
  { id: "b", name: "Beta" },
];
const columns: AdminColumn<Row>[] = [
  { key: "name", label: "Nume", primary: true, render: (r) => r.name },
  { key: "club", label: "Club", hint: "Clubul persoanei.", render: () => "Club A" },
];

function render(options: { paged?: boolean; printable?: boolean } = {}) {
  return renderToStaticMarkup(
    withClientWords(
      createElement(AdminTable<Row>, {
        caption: "Puncte",
        tableId: "sheet-test",
        columns,
        rows,
        rowKey: (r: Row) => r.id,
        basePath: "/ro/admin/x",
        currentParams: {},
        query: { page: 1, perPage: 25, sort: "name", dir: "asc", offset: 0, limit: 25 },
        // More rows than one page holds: a paged list draws its pager.
        total: 60,
        labels: { results: "60 rânduri", page: "Pagina 1 din 3", previous: "Înapoi", next: "Înainte", perPage: "Rânduri pe pagină", actions: "Acțiuni", sortBy: (c: string) => c },
        empty: null,
        ...options,
      }),
    ),
  );
}

/** The emitted CSS, and the markup without it — the structure to find an element's classes in. */
const cssOf = (html: string) => [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((match) => match[1]).join("");
const plainOf = (html: string) => html.replace(/<style[\s\S]*?<\/style>/g, "");
const classesIn = (tag: string) => (/class="([^"]*)"/.exec(tag)?.[1] ?? "").split(" ").filter((part) => part.startsWith("css-"));
const printOf = (css: string, names: readonly string[]) => names.flatMap((name) => [...css.matchAll(new RegExp(`@media print\\{\\.${name}([^{]*)\\{([^}]*)\\}`, "g"))].map((match) => `${match[1]}{${match[2]}}`)).join(";");

/** The table's three frames: the wide one, the phone's blocks and their hints; and the whole table's own root. */
function partsOf(html: string) {
  const plain = plainOf(html);
  return {
    root: classesIn(/<div class="[^"]*MuiStack-root[^"]*"/.exec(plain)![0]),
    // The frame carries its address since §NNN (the bar above it finds it by it): any attributes, the table right inside.
    wide: classesIn(/<div[^>]*class="[^"]*"[^>]*><table/.exec(plain)![0]),
    // The box that holds the frame and its scrollbar at the top (§NNN), and that bar.
    box: classesIn(/<div class="[^"]*"><div[^>]*data-top-scrollbar=/.exec(plain)![0]),
    bar: classesIn(/<div[^>]*data-top-scrollbar=[^>]*>/.exec(plain)![0]),
    blocks: classesIn(/<ul class="[^"]*MuiStack-root[^"]*"/.exec(plain)![0]),
    hints: classesIn(/<div class="[^"]*"[^>]*data-testid="admin-table-hints"/.exec(plain)![0]),
  };
}

describe("§974 a table on one page", () => {
  it("pages through its address by default: the page sizes, and a pager past one page", () => {
    const html = render();
    expect(html).toContain("Rânduri pe pagină");
    expect(html).toContain('href="/ro/admin/x?perPage=50"');
    expect(html).toContain("Pagina 1 din 3");
    expect(html).toContain("60 rânduri");
  });

  it("draws no page sizes and no pager with paged={false}, and keeps the line under the table", () => {
    const html = render({ paged: false });
    expect(html).not.toContain("Rânduri pe pagină");
    expect(html).not.toContain("perPage=");
    expect(html).not.toContain("Pagina 1 din 3");
    expect(html).not.toContain("Înainte");
    expect(html).toContain("60 rânduri");
    // The rows, both layouts, as ever.
    expect(plainOf(html).match(/>Alpha</g)).toHaveLength(2);
  });
});

describe("§974 a table on paper", () => {
  it("prints a printable table as a table: the wide frame whatever the sheet's width, never the blocks or their hints, nothing to press", () => {
    const html = render({ printable: true, paged: false });
    const css = cssOf(html);
    const { root, wide, blocks, hints, box, bar } = partsOf(html);

    // The box around the frame is drawn on paper as the frame is (§NNN); the scrollbar at its top never is.
    expect(printOf(css, box)).toMatch(/display:block/);
    expect(printOf(css, bar)).toMatch(/display:none/);
    // The wide frame: hidden under `md` on a screen, drawn on paper — the print rule after the screen's.
    expect(printOf(css, wide)).toMatch(/display:block/);
    expect(css.indexOf(`@media print{.${wide[0]}{display:block`)).toBeGreaterThan(css.indexOf(`.${wide[0]}{display:none`));
    expect(css.indexOf(`.${wide[0]}{display:none`)).toBeGreaterThan(-1);
    // The phone's blocks and the hints above them: never on paper.
    expect(printOf(css, blocks)).toMatch(/display:none/);
    expect(printOf(css, hints)).toMatch(/display:none/);
    // Nothing to press: a column's edge, «Coloane» and the widths' reset, by the islands' own marks.
    const controls = printOf(css, root);
    for (const mark of ["[data-column-resize]", "[data-testid='admin-table-columns']", "[data-testid='admin-table-reset-widths']"]) {
      expect(controls, mark).toContain(mark);
    }
    expect(controls).toMatch(/\{display:none;?\}/);
  });

  it("keeps the page sizes and the pager off the paper of a printable list that pages", () => {
    const html = render({ printable: true });
    const plain = plainOf(html);
    const css = cssOf(html);
    const sizes = classesIn(/<div class="[^"]*"><p[^>]*>Rânduri pe pagină/.exec(plain)![0]);
    expect(printOf(css, sizes)).toMatch(/display:none/);
    // On the first page «Înapoi» is a plain box, not a link (`PageStep`): the pager's frame is the element around it.
    const pager = classesIn(/<div class="[^"]*"><div class="[^"]*" aria-hidden="true">Înapoi/.exec(plain)![0]);
    expect(printOf(css, pager)).toMatch(/display:none/);
  });

  it("prints a list as before when not asked: no print rule on its frames or its root", () => {
    const html = render();
    const css = cssOf(html);
    const { root, wide, blocks, hints } = partsOf(html);
    for (const names of [root, wide, blocks, hints]) expect(printOf(css, names)).toBe("");
  });
});
