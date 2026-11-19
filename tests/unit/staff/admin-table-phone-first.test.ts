import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AdminTable, { type AdminColumn } from "@/modules/staff-identity/ui/AdminTable";
import { withClientWords } from "../../helpers/client-words";

/**
 * §983 — `phoneFirst`: a column whose line a phone's block draws right under the headline (the «Voluntari» list's state and its
 * «Prezent» tick, which race morning reads and presses on a phone, would otherwise sit a dozen lines down a card), the columns that
 * say so in their own order and the rest after them — while the wide table keeps every column where the array puts it.
 */
type Row = { id: string; name: string };

const COLUMNS: readonly AdminColumn<Row>[] = [
  { key: "name", label: "Nume", primary: true, render: (r) => r.name },
  { key: "age", label: "Vârstă", render: () => "31" },
  { key: "city", label: "Oraș", render: () => "Brașov" },
  { key: "state", label: "Stare", phoneFirst: true, render: () => "Confirmat" },
  { key: "kit", label: "Are kit", render: () => "Nu" },
  { key: "present", label: "Prezent", phoneFirst: true, render: () => "Da" },
  { key: "since", label: "Din", render: () => "ieri" },
];

function render(columns: readonly AdminColumn<Row>[]): string {
  return renderToStaticMarkup(
    withClientWords(
      createElement(AdminTable<Row>, {
        caption: "Voluntari",
        tableId: "volunteers",
        columns,
        rows: [{ id: "a", name: "Ana Pop" }],
        rowKey: (r: Row) => r.id,
        basePath: "/ro/admin/volunteers",
        currentParams: {},
        query: { page: 1, perPage: 25, sort: "name", dir: "asc" } as never,
        total: 1,
        labels: { results: "1", page: "1", previous: "<", next: ">", perPage: "Pe pagină", actions: "Acțiuni", sortBy: (c: string) => c },
        empty: createElement("p", null, "Niciun voluntar"),
      }),
    ),
  ).replace(/<style[\s\S]*?<\/style>/g, "");
}

/** The order of the labels in one part of the markup: the wide table's head, or the phone's block. */
const order = (html: string, labels: readonly string[]) =>
  labels
    .map((label) => ({ label, at: html.indexOf(`>${label}<`) }))
    .filter((entry) => entry.at >= 0)
    .sort((a, b) => a.at - b.at)
    .map((entry) => entry.label);

describe("§983 a column a phone's block draws first", () => {
  const labels = ["Vârstă", "Oraș", "Stare", "Are kit", "Prezent", "Din"];

  it("draws the state and «Prezent» right under the headline on a phone, then the rest in the columns' order", () => {
    const html = render(COLUMNS);
    const phone = html.slice(html.lastIndexOf("<ul"));
    expect(phone).toContain("Ana Pop");
    expect(order(phone, labels)).toEqual(["Stare", "Prezent", "Vârstă", "Oraș", "Are kit", "Din"]);
  });

  it("keeps the wide table's columns where the array puts them", () => {
    const html = render(COLUMNS);
    const table = html.slice(html.indexOf("<thead"), html.indexOf("</thead>"));
    expect(order(table, labels)).toEqual(labels);
  });

  it("reads in the columns' order when no column says so", () => {
    const html = render(COLUMNS.map((column) => ({ ...column, phoneFirst: undefined })));
    const phone = html.slice(html.lastIndexOf("<ul"));
    expect(order(phone, labels)).toEqual(labels);
  });

  it("is what the «Voluntari» list asks of its state and its «Prezent» tick", async () => {
    const { readFileSync } = await import("node:fs");
    const page = readFileSync("src/app/[locale]/admin/volunteers/(list)/page.tsx", "utf8");
    for (const key of ["state", "present"]) {
      expect(page, key).toMatch(new RegExp(`key: "${key}",[\\s\\S]{0,400}?phoneFirst: true`));
    }
  });
});
