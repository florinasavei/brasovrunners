import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AdminTable from "@/modules/staff-identity/ui/AdminTable";

/**
 * §NNN — every backoffice table row but the last carries a visible separator; the last one
 * none, the frame's own border closing the table.
 */
type Row = { id: string; name: string };
const rows: Row[] = [
  { id: "a", name: "Alpha" },
  { id: "b", name: "Beta" },
  { id: "c", name: "Gamma" },
];

describe("AdminTable row separators (§NNN)", () => {
  it("marks a line under every body row but the last", () => {
    const html = renderToStaticMarkup(
      createElement(AdminTable<Row>, {
        caption: "Evenimente",
        columns: [{ key: "name", label: "Nume", primary: true, render: (r: Row) => r.name }],
        rows,
        rowKey: (r: Row) => r.id,
        basePath: "/ro/admin/events",
        currentParams: {},
        query: { page: 1, perPage: 25, sort: "name", dir: "asc" } as never,
        total: 3,
        labels: {
          results: "3",
          page: "1",
          previous: "<",
          next: ">",
          perPage: "Pe pagină",
          actions: "Acțiuni",
          sortBy: (c: string) => c,
        },
        empty: null,
      }),
    );
    const marks = [...html.matchAll(/data-row-separator="(\w+)"/g)].map((m) => m[1]);
    expect(marks).toEqual(["line", "line", "none"]);
  });
});
