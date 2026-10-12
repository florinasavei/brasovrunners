import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AdminTable from "@/modules/staff-identity/ui/AdminTable";
import { withClientWords } from "../../helpers/client-words";

/**
 * BR-REQ-037-07, `DECISIONS.md` §737 — the registrations list draws an event's open invitations as
 * rows of another kind above its registrations: in the same columns, drawn even when no registration
 * matches, and never counted in the page's own rows.
 */
type Row = { id: string; name: string };

function render(rows: Row[], leadRows: { key: string; cells: Record<string, string>; testId?: string }[]) {
  return renderToStaticMarkup(
    withClientWords(
      createElement(AdminTable<Row>, {
        caption: "Înscrieri",
        tableId: "registrations",
        columns: [
          { key: "name", label: "Nume", primary: true, render: (r: Row) => r.name },
          { key: "status", label: "Stare", render: () => "Confirmată" },
        ],
        rows,
        leadRows,
        rowKey: (r: Row) => r.id,
        basePath: "/ro/admin/registrations",
        currentParams: {},
        query: { page: 1, perPage: 25, sort: "name", dir: "asc" } as never,
        total: rows.length,
        labels: { results: String(rows.length), page: "1", previous: "<", next: ">", perPage: "Pe pagină", actions: "Acțiuni", sortBy: (c: string) => c },
        empty: createElement("p", null, "Nicio înscriere"),
      }),
    ),
  );
}

describe("§737 rows of another kind above the table's own", () => {
  it("draws the lead rows first, in the table and in the phone's blocks, with their own cells", () => {
    const html = render([{ id: "a", name: "Alpha" }], [{ key: "i1", cells: { name: "Ana Pop", status: "Invitație trimisă" }, testId: "registrations-invitation-row" }]);
    // Once in the table and once in the phone's list.
    expect(html.match(/data-row-kind="lead"/g)).toHaveLength(2);
    expect(html.indexOf("Ana Pop")).toBeLessThan(html.indexOf("Alpha"));
    expect(html).toContain("Invitație trimisă");
  });

  it("draws the table for the lead rows alone when no registration matches", () => {
    const html = render([], [{ key: "i1", cells: { name: "Ana Pop" } }]);
    expect(html).toContain("Ana Pop");
    expect(html).not.toContain("Nicio înscriere");
    expect(render([], [])).toContain("Nicio înscriere");
  });
});
