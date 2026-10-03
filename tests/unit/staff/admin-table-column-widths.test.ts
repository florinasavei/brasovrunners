import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  ACTIONS_COLUMN,
  clampWidth,
  fixedLayout,
  KEY_STEP,
  KEY_STEP_LARGE,
  keyboardWidth,
  MAX_COLUMN_WIDTH,
  MIN_COLUMN_WIDTH,
  parseWidths,
  storageKey,
  TABLE_ID_PATTERN,
  touchesVisible,
} from "@/modules/staff-identity/domain/column-widths";
import AdminTable, { type AdminColumn } from "@/modules/staff-identity/ui/AdminTable";
import { withClientWords } from "../../helpers/client-words";

/**
 * §NNN — a backoffice table's columns can be resized, and none of the reasons `AdminTable` gives
 * for refusing a data grid is given up for it: the table is still server-rendered, the islands receive strings and never a
 * row, the widths live in this browser only, and with JavaScript off the table is what it was.
 */
type Row = { id: string; name: string; club: string };
const rows: Row[] = [
  { id: "a", name: "Alpha", club: "Club A" },
  { id: "b", name: "Beta", club: "Club B" },
];
const columns: AdminColumn<Row>[] = [
  { key: "name", label: "Nume", primary: true, sortable: true, render: (r) => r.name },
  { key: "club", label: "Club", hideBelow: "lg", render: (r) => r.club },
  { key: "state", label: "Stare", render: () => "Confirmată" },
];

function render(props: { tableId?: string; withActions?: boolean } = {}) {
  return renderToStaticMarkup(
    withClientWords(
      createElement(AdminTable<Row>, {
        caption: "Înscrieri",
        tableId: props.tableId ?? "registrations",
        columns,
        rows,
        rowKey: (r: Row) => r.id,
        basePath: "/ro/admin/registrations",
        currentParams: {},
        query: { page: 1, perPage: 25, sort: "name", dir: "asc" } as never,
        total: 2,
        labels: {
          results: "2 rezultate",
          page: "1",
          previous: "<",
          next: ">",
          perPage: "Pe pagină",
          actions: "Acțiuni",
          sortBy: (c: string) => c,
        },
        rowActions: props.withActions === false ? undefined : () => "⋮",
        empty: null,
      }),
    ),
  );
}

describe("§NNN the widths' arithmetic", () => {
  it("keeps a width inside the limits and whole", () => {
    expect(clampWidth(10)).toBe(MIN_COLUMN_WIDTH);
    expect(clampWidth(5000)).toBe(MAX_COLUMN_WIDTH);
    expect(clampWidth(120.6)).toBe(121);
  });

  it("reads storage defensively: garbage, arrays and non-numbers are nothing", () => {
    expect(parseWidths(null)).toEqual({});
    expect(parseWidths("not json")).toEqual({});
    expect(parseWidths("[1,2]")).toEqual({});
    expect(parseWidths('{"name":"wide","state":null,"email":1e400}')).toEqual({});
    expect(parseWidths(`{"name":20,"state":240,"${ACTIONS_COLUMN}":300}`)).toEqual({
      name: MIN_COLUMN_WIDTH,
      state: 240,
    });
  });

  it("names the storage by table, and accepts only a short lowercase id", () => {
    expect(storageKey("registrations")).toBe("br.admin-table.registrations.widths");
    expect(TABLE_ID_PATTERN.test("legal-event-declaration")).toBe(true);
    for (const bad of ["", "Registrations", "a b", 'x"]', "a".repeat(41)]) expect(TABLE_ID_PATTERN.test(bad)).toBe(false);
  });

  it("fixes the visible columns at their stored width, else at the measured one, and sums them", () => {
    const visible = [
      { key: "name", measured: 180.4 },
      { key: "state", measured: 120 },
      { key: ACTIONS_COLUMN, measured: 90 },
    ];
    expect(fixedLayout(visible, { name: 300, email: 400 })).toEqual({
      widths: { name: 300, state: 120, [ACTIONS_COLUMN]: 90 },
      total: 510,
    });
    // A width stored for a column the breakpoint hides does not, alone, fix the table.
    expect(touchesVisible(visible, { email: 400 })).toBe(false);
    expect(touchesVisible(visible, { state: 200 })).toBe(true);
  });

  it("moves an edge by the splitter's keys and leaves every other key to the browser", () => {
    expect(keyboardWidth(200, "ArrowRight", false)).toBe(200 + KEY_STEP);
    expect(keyboardWidth(200, "ArrowLeft", true)).toBe(200 - KEY_STEP_LARGE);
    expect(keyboardWidth(60, "ArrowLeft", true)).toBe(MIN_COLUMN_WIDTH);
    expect(keyboardWidth(200, "Home", false)).toBe(MIN_COLUMN_WIDTH);
    expect(keyboardWidth(200, "End", false)).toBe(MAX_COLUMN_WIDTH);
    expect(keyboardWidth(200, "Tab", false)).toBeNull();
    expect(keyboardWidth(200, "Enter", false)).toBeNull();
  });
});

describe("§NNN AdminTable's columns, as the server draws them", () => {
  it("emits one <col> per column, in order, the actions' last, and marks the headings to match", () => {
    const html = render();
    const cols = [...html.matchAll(/<col[^>]*data-column="([^"]+)"/g)].map((m) => m[1]);
    expect(cols).toEqual(["name", "club", "state", ACTIONS_COLUMN]);
    const headings = [...html.matchAll(/<th[^>]*data-column="([^"]+)"/g)].map((m) => m[1]);
    expect(headings).toEqual(cols);
    expect(html).toContain('data-table-id="registrations"');
  });

  it("has no actions <col> when the rows have no verbs", () => {
    const cols = [...render({ withActions: false }).matchAll(/<col[^>]*data-column="([^"]+)"/g)].map((m) => m[1]);
    expect(cols).toEqual(["name", "club", "state"]);
  });

  it("draws no handle and no reset control before JavaScript runs, so the table is the one it was", () => {
    const html = render();
    expect(html).not.toContain('role="separator"');
    expect(html).not.toContain("data-column-resize");
    expect(html).not.toContain("admin-table-reset-widths");
    // The selector is in the stylesheet; the attribute itself is set only by an island.
    expect(html).not.toMatch(/<table[^>]*data-resized/);
    expect(html).not.toMatch(/<col[^>]*style=/);
  });

  it("refuses a table id that could not be a storage name or a selector", () => {
    expect(() => render({ tableId: 'a"] , b' })).toThrow(/tableId/);
  });
});

const ROOT = process.cwd();
const read = (...parts: string[]) => readFileSync(path.join(ROOT, ...parts), "utf8").replace(/\r\n/g, "\n");

describe("§NNN no row crosses to the client (§14.5)", () => {
  it("hands each island strings and a flag, never a row or a render function", () => {
    const table = read("src", "modules", "staff-identity", "ui", "AdminTable.tsx");
    const handle = table.match(/<ColumnResizeHandle([\s\S]*?)\/>/)?.[1] ?? "";
    expect([...handle.matchAll(/(\w+)=\{/g)].map((m) => m[1])).toEqual(["tableId", "column", "label", "last"]);
    expect(table).toMatch(/<ColumnWidths tableId=\{tableId\} \/>/);

    const handleSource = read("src", "modules", "staff-identity", "ui", "ColumnResizeHandle.tsx");
    const props = handleSource.match(/type Props = \{([\s\S]*?)\n\};/)?.[1] ?? "";
    expect([...props.matchAll(/^\s+(\w+): (\w+);/gm)].map((m) => `${m[1]}:${m[2]}`)).toEqual([
      "tableId:string",
      "column:string",
      "label:string",
      "last:boolean",
    ]);
    const widthsSource = read("src", "modules", "staff-identity", "ui", "ColumnWidths.tsx");
    expect(widthsSource).toContain("export default function ColumnWidths({ tableId }: { tableId: string })");
  });
});

describe("§NNN every list names its table", () => {
  const LISTS: Record<string, string[]> = {
    events: ["src", "app", "[locale]", "admin", "(list)", "page.tsx"],
    pages: ["src", "app", "[locale]", "admin", "pages", "(list)", "page.tsx"],
    albums: ["src", "app", "[locale]", "admin", "gallery", "(list)", "page.tsx"],
    pictures: ["src", "app", "[locale]", "admin", "gallery", "pictures", "page.tsx"],
    staff: ["src", "app", "[locale]", "admin", "staff", "page.tsx"],
    registrations: ["src", "app", "[locale]", "admin", "registrations", "(list)", "page.tsx"],
    legal: ["src", "app", "[locale]", "admin", "legal", "(list)", "page.tsx"],
  };

  it("passes a tableId of its own to AdminTable, so two lists never share their widths", () => {
    const ids = Object.entries(LISTS).map(([name, parts]) => {
      const id = read(...parts).match(/<AdminTable[\s\S]*?tableId=(?:"([^"]+)"|\{`([^`$]+)\$\{)/);
      expect(id, name).not.toBeNull();
      return (id?.[1] ?? id?.[2]) as string;
    });
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(["events", "pages", "albums-", "pictures", "staff", "registrations", "legal-"]);
  });
});
