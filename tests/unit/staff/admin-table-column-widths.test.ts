import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ACTIONS_COLUMN,
  clampWidth,
  columnFloor,
  fixedLayout,
  hiddenColumnsCss,
  hiddenStorageKey,
  isEssentialColumn,
  KEY_STEP,
  KEY_STEP_LARGE,
  keyboardWidth,
  MAX_COLUMN_WIDTH,
  MIN_COLUMN_WIDTH,
  parseHidden,
  parseWidths,
  storageKey,
  TABLE_ID_PATTERN,
  touchesVisible,
} from "@/modules/staff-identity/domain/column-widths";
import AdminTable, { type AdminColumn } from "@/modules/staff-identity/ui/AdminTable";
import {
  readHidden,
  readWidths,
  recordedFloor,
  recordFloors,
  WIDTHS_CHANGED,
  writeHidden,
  writeWidths,
} from "@/modules/staff-identity/ui/column-widths-dom";
import { earlyWidthsScript } from "@/modules/staff-identity/ui/column-widths-script";
import { withClientWords } from "../../helpers/client-words";

/**
 * §650 — a backoffice table's columns can be resized, and none of the reasons `AdminTable` gives
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
  { key: "state", label: "Stare", essential: true, render: () => "Confirmată" },
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

describe("§650 the widths' arithmetic", () => {
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
    expect(storageKey("registrations")).toBe("br.table.registrations.widths");
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

  it("keeps each column above its own floor, so no heading word is cut", () => {
    // «Evenimentul» measured at 118.2 px with its arrow and padding: that column never goes under 119.
    expect(columnFloor(118.2)).toBe(119);
    expect(columnFloor(undefined)).toBe(MIN_COLUMN_WIDTH);
    expect(columnFloor(20)).toBe(MIN_COLUMN_WIDTH);
    expect(columnFloor(5000)).toBe(MAX_COLUMN_WIDTH);
    expect(clampWidth(60, 119)).toBe(119);
    expect(clampWidth(240, 119)).toBe(240);
    // The keys respect it: Home goes to the floor, not to the table-wide least.
    expect(keyboardWidth(200, "Home", false, 119)).toBe(119);
    expect(keyboardWidth(130, "ArrowLeft", false, 119)).toBe(119);
    expect(keyboardWidth(130, "ArrowRight", false, 119)).toBe(130 + KEY_STEP);
    // A stored width under a heading's floor (the other language's longer word) is raised to it.
    expect(fixedLayout([{ key: "event", measured: 150, floor: 119 }], { event: 60 })).toEqual({
      widths: { event: 119 },
      total: 119,
    });
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

describe("§650 AdminTable's columns, as the server draws them", () => {
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
    // The pre-paint script names the edge in a selector (§NNN); no element carries it.
    expect(html.replace(/<script[\s\S]*?<\/script>/g, "")).not.toContain("data-column-resize");
    expect(html).not.toContain("admin-table-reset-widths");
    // The selector is in the stylesheet; the attribute itself is set only by an island.
    expect(html).not.toMatch(/<table[^>]*data-resized/);
    expect(html).not.toMatch(/<col[^>]*style=/);
  });

  it("refuses a table id that could not be a storage name or a selector", () => {
    expect(() => render({ tableId: 'a"] , b' })).toThrow(/tableId/);
    expect(() => earlyWidthsScript("</script><script>")).toThrow(/tableId/);
  });

  it("carries exactly one pre-paint script per table, right after it, static but for the table's id", () => {
    const html = render();
    const scripts = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)];
    expect(scripts).toHaveLength(1);
    expect(scripts[0][1]).toContain('data-column-widths-script="registrations"');
    expect(html).toMatch(/<\/table><script[^>]*>/);
    const body = scripts[0][2];
    expect(body).toBe(earlyWidthsScript("registrations"));
    // The id is the only thing that varies, and it appears once, as a JSON string literal.
    expect(body.split('"registrations"')).toHaveLength(2);
    expect(body.replace('"registrations"', '"staff"')).toBe(earlyWidthsScript("staff"));
    expect(body).toContain('"br.table."+i+".widths"');
    expect(body).not.toContain("</");
    // It writes one <style> into <head> and touches no attribute React owns.
    expect(body).toContain("document.head.appendChild");
    expect(body).toContain("'data-column-widths'");
    expect(body).not.toMatch(/\.style\.|setAttribute\('(?!data-column-widths'|data-column-hidden')|dataset/);
    expect(body).toContain(`Math.max(${MIN_COLUMN_WIDTH},`);
  });
});

const ROOT = process.cwd();
const read = (...parts: string[]) => readFileSync(path.join(ROOT, ...parts), "utf8").replace(/\r\n/g, "\n");

describe("§650 the pre-paint script, run against a stand-in for the page", () => {
  type Element = { display: string; width: number };
  function run(
    stored: string | null,
    headings: Record<string, Element>,
    options: { hiddenFrames?: number; connected?: boolean; hidden?: string; essential?: string[] } = {},
  ) {
    const appended: { attributes: Record<string, string>; textContent?: string }[] = [];
    const cols = Object.keys(headings).map((key) => ({
      getAttribute: () => key,
      hasAttribute: (name: string) => name === "data-column-essential" && (options.essential ?? []).includes(key),
    }));
    let hiddenFrames = options.hiddenFrames ?? 0;
    const frames: (() => void)[] = [];
    const table = {
      get offsetParent() {
        return hiddenFrames > 0 ? null : {};
      },
      querySelectorAll: () => cols,
      querySelector: (selector: string) => {
        const heading = headings[/data-column="([^"]+)"/.exec(selector)?.[1] ?? ""];
        return heading && { display: heading.display, getBoundingClientRect: () => ({ width: heading.width }) };
      },
    };
    const document = {
      currentScript: { isConnected: options.connected ?? true },
      querySelector: () => table,
      createElement: () => {
        const element = { attributes: {} as Record<string, string>, setAttribute: (n: string, v: string) => void (element.attributes[n] = v) };
        return element;
      },
      head: { appendChild: (element: (typeof appended)[number]) => void appended.push(element) },
    };
    const localStorage = { getItem: (key: string) => (key.endsWith(".hidden") ? (options.hidden ?? null) : stored) };
    const getComputedStyle = (heading: Element) => ({ display: heading.display });
    const requestAnimationFrame = (callback: () => void) => void frames.push(callback);
    new Function("document", "localStorage", "getComputedStyle", "requestAnimationFrame", earlyWidthsScript("registrations"))(
      document,
      localStorage,
      getComputedStyle,
      requestAnimationFrame,
    );
    // Each frame, as the browser would run it: the streamed list is revealed after a few.
    let ran = 0;
    while (frames.length > 0) {
      hiddenFrames -= 1;
      ran += 1;
      (frames.shift() as () => void)();
    }
    return Object.assign(appended, { frames: ran });
  }
  const headings = {
    name: { display: "table-cell", width: 100.4 },
    club: { display: "none", width: 0 },
    state: { display: "table-cell", width: 90 },
    [ACTIONS_COLUMN]: { display: "table-cell", width: 70 },
  };

  it("writes one style: the stored widths, the others as measured, the table at their sum", () => {
    const appended = run(JSON.stringify({ name: 300, club: 500, [ACTIONS_COLUMN]: 10 }), headings);
    expect(appended).toHaveLength(1);
    expect(appended[0].attributes).toEqual({ "data-column-widths": "registrations" });
    const css = appended[0].textContent ?? "";
    const q = 'table[data-table-id="registrations"]';
    expect(css).toContain(`${q}{table-layout:fixed;width:460px}`);
    expect(css).toContain(`${q}>colgroup>col[data-column="name"]{width:300px}`);
    expect(css).toContain(`${q}>colgroup>col[data-column="state"]{width:90px}`);
    expect(css).toContain(`${q}>colgroup>col[data-column="${ACTIONS_COLUMN}"]{width:70px}`);
    expect(css).not.toContain('"club"');
  });

  it("waits for a list streamed in hidden to be revealed, and stops once hydration removed it", () => {
    const revealed = run(JSON.stringify({ name: 300 }), headings, { hiddenFrames: 3 });
    expect(revealed.frames).toBe(3);
    expect(revealed).toHaveLength(1);
    expect(revealed[0].textContent).toContain('col[data-column="name"]{width:300px}');
    expect(run(JSON.stringify({ name: 300 }), headings, { connected: false })).toHaveLength(0);
  });

  it("writes nothing when nothing stored touches a column on screen, or the table is not displayed", () => {
    expect(run(null, headings)).toHaveLength(0);
    expect(run("not json", headings)).toHaveLength(0);
    expect(run(JSON.stringify({ club: 500 }), headings)).toHaveLength(0);
    // A table that never shows (the phone layout) is looked for a few seconds' frames, then left.
    const never = run(JSON.stringify({ name: 300 }), headings, { hiddenFrames: Number.POSITIVE_INFINITY });
    expect(never).toHaveLength(0);
    expect(never.frames).toBe(300);
    // A width under the least floor is raised to it, as the islands would.
    expect(run(JSON.stringify({ name: 10 }), headings)[0].textContent).toContain(`{width:${MIN_COLUMN_WIDTH}px}`);
  });

  it("§NNN hides the stored hidden columns first, in their own style, the same text the islands write", () => {
    const appended = run(null, headings, { hidden: JSON.stringify(["state", "name"]), essential: ["name"] });
    // Nothing stored for the widths: one style, the hidden one, and the essential «name» still shown.
    expect(appended).toHaveLength(1);
    expect(appended[0].attributes).toEqual({ "data-column-hidden": "registrations" });
    const columns = [
      { key: "name", essential: true },
      { key: "club", essential: false },
      { key: "state", essential: false },
    ];
    expect(appended[0].textContent).toBe(hiddenColumnsCss("registrations", columns, ["state", "name"], true));
    expect(appended[0].textContent).toContain(':nth-child(3)');
    expect(appended[0].textContent).not.toContain(':nth-child(1)');
  });

  it("§NNN writes the hidden style once, beside the widths' one, and nothing for garbage", () => {
    const both = run(JSON.stringify({ name: 300 }), headings, { hidden: JSON.stringify(["club"]), hiddenFrames: 2 });
    expect(both.map((style) => Object.keys(style.attributes)[0])).toEqual(["data-column-hidden", "data-column-widths"]);
    expect(run(null, headings, { hidden: "not json" })).toHaveLength(0);
    expect(run(null, headings, { hidden: JSON.stringify({ club: true }) })).toHaveLength(0);
    expect(run(null, headings, { hidden: JSON.stringify(["nothing-here"]) })).toHaveLength(0);
  });
});

describe("§NNN columns that can be hidden", () => {
  it("names the hidden columns' storage beside the widths'", () => {
    expect(hiddenStorageKey("registrations")).toBe("br.table.registrations.hidden");
  });

  it("reads storage defensively: only an array of column keys, each once, never the verbs'", () => {
    expect(parseHidden(null)).toEqual([]);
    expect(parseHidden("not json")).toEqual([]);
    expect(parseHidden('{"email":true}')).toEqual([]);
    expect(parseHidden(`["email",3,null,"email","${ACTIONS_COLUMN}","a b","x\\"]","bib"]`)).toEqual(["email", "bib"]);
  });

  it("keeps the first column, the phone's headline and a column marked essential", () => {
    expect(isEssentialColumn({}, 0)).toBe(true);
    expect(isEssentialColumn({ primary: true }, 3)).toBe(true);
    expect(isEssentialColumn({ essential: true }, 2)).toBe(true);
    expect(isEssentialColumn({}, 1)).toBe(false);
  });

  it("turns hidden columns into one rule set per position, never an essential one", () => {
    const columns = [
      { key: "name", essential: true },
      { key: "email", essential: false },
      { key: "status", essential: true },
      { key: "bib", essential: false },
    ];
    const q = 'table[data-table-id="registrations"]';
    expect(hiddenColumnsCss("registrations", columns, [], true)).toBe("");
    expect(hiddenColumnsCss("registrations", columns, ["name", "status"], true)).toBe("");
    expect(hiddenColumnsCss("registrations", columns, ["email", "bib", "gone"], true)).toBe(
      `${q}>colgroup>col:nth-child(2),${q}>thead>tr>th:nth-child(2),${q}>tbody>tr>td:nth-child(2){display:none}` +
        `${q}>colgroup>col:nth-child(4),${q}>thead>tr>th:nth-child(4),${q}>tbody>tr>td:nth-child(4){display:none}`,
    );
    // Without row verbs, the last column shown keeps its edge inside its own cell (§652's `last`).
    expect(hiddenColumnsCss("registrations", columns, ["bib"], false)).toContain(
      `${q}>thead>tr>th:nth-child(3)>[data-column-resize]{right:0}`,
    );
    expect(hiddenColumnsCss("registrations", columns, ["email"], false)).not.toContain("data-column-resize");
  });

  it("marks the essential columns on the server's <col>s and draws no menu before JavaScript runs", () => {
    const html = render();
    const essential = [...html.matchAll(/<col[^>]*data-column="([^"]+)"[^>]*>/g)]
      .filter((m) => m[0].includes("data-column-essential"))
      .map((m) => m[1]);
    expect(essential).toEqual(["name", "state"]);
    expect(html).not.toContain("admin-table-columns");
    expect(html).not.toContain("menuitemcheckbox");
  });

  it("hands the menu strings and flags, never a row, and every list marks its state essential", () => {
    const table = read("src", "modules", "staff-identity", "ui", "AdminTable.tsx");
    expect(table).toMatch(/<ColumnVisibility tableId=\{tableId\} columns=\{menuColumns\} \/>/);
    expect(table).toMatch(/const menuColumns = columns\.map\(\(column, index\) => \(\{\s+key: column\.key,\s+label: column\.label,\s+essential: isEssentialColumn\(column, index\),\s+\}\)\);/);
    const source = read("src", "modules", "staff-identity", "ui", "ColumnVisibility.tsx");
    const props = source.match(/type Props = \{([\s\S]*?)\n\};/)?.[1] ?? "";
    expect(props.replace(/\/\*\*.*\*\//g, "").replace(/\s+/g, " ").trim()).toBe(
      "tableId: string; columns: readonly { key: string; label: string; essential: boolean }[];",
    );
    // A checkbox per hideable column, labelled by the menu item; the trigger is named and 44 px.
    expect(source).toContain('role="menuitemcheckbox"');
    expect(source).toContain('aria-label={t("columns.menu")}');
    expect(source).toMatch(/minWidth: 44, minHeight: 44/);
    expect(source).toContain('from "@mui/icons-material/ViewColumn"');
    for (const parts of [
      ["src", "app", "[locale]", "admin", "(list)", "page.tsx"],
      ["src", "app", "[locale]", "admin", "pages", "(list)", "page.tsx"],
      ["src", "app", "[locale]", "admin", "gallery", "(list)", "page.tsx"],
      ["src", "app", "[locale]", "admin", "staff", "page.tsx"],
      ["src", "app", "[locale]", "admin", "registrations", "(list)", "page.tsx"],
      ["src", "app", "[locale]", "admin", "legal", "(list)", "page.tsx"],
    ]) {
      expect(read(...parts), parts.join("/")).toMatch(/key: "(?:status|state)",\n\s+label: [^\n]+\n\s+essential: true,/);
    }
  });
});

describe("§650 no row crosses to the client (§14.5)", () => {
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
    expect(table).toMatch(/<ColumnWidthsScript tableId=\{tableId\} \/>/);
    const scriptSource = read("src", "modules", "staff-identity", "ui", "ColumnWidthsScript.tsx");
    expect(scriptSource).toContain("export default function ColumnWidthsScript({ tableId }: { tableId: string })");
  });
});

describe("§650 every list names its table", () => {
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

describe("§650 the widths in this browser's storage", () => {
  type Fake = { store: Map<string, string>; events: Event[] };
  function stub(options: { throws?: boolean } = {}): Fake {
    const fake: Fake = { store: new Map(), events: [] };
    const fail = () => {
      throw new Error("SecurityError: storage is blocked");
    };
    const localStorage = {
      getItem: options.throws ? fail : (key: string) => fake.store.get(key) ?? null,
      setItem: options.throws ? fail : (key: string, value: string) => void fake.store.set(key, value),
      removeItem: options.throws ? fail : (key: string) => void fake.store.delete(key),
    };
    vi.stubGlobal("window", { localStorage, dispatchEvent: (event: Event) => fake.events.push(event) });
    return fake;
  }
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("round-trips a write and a read under br.table.<id>.widths", () => {
    const fake = stub();
    writeWidths("registrations", { name: 240, event: 180 });
    expect([...fake.store.keys()]).toEqual(["br.table.registrations.widths"]);
    expect(readWidths("registrations")).toEqual({ name: 240, event: 180 });
    expect(readWidths("events")).toEqual({});
  });

  it("removes the entry when nothing is left to keep", () => {
    const fake = stub();
    writeWidths("registrations", { name: 240 });
    writeWidths("registrations", {});
    expect(fake.store.has("br.table.registrations.widths")).toBe(false);
    expect(readWidths("registrations")).toEqual({});
  });

  it("reads nothing and throws nothing when storage is blocked, and keeps this page's changes", () => {
    const fake = stub({ throws: true });
    expect(readWidths("registrations")).toEqual({});
    expect(() => writeWidths("registrations", { name: 240 })).not.toThrow();
    // The drag still worked on this page, and the reset control still hears of it.
    expect(fake.events).toHaveLength(1);
    // A second change starts from the first, as the handle's commit does, rather than from nothing.
    writeWidths("registrations", { ...readWidths("registrations"), state: 180 });
    expect(readWidths("registrations")).toEqual({ name: 240, state: 180 });
    expect(readWidths("events")).toEqual({});
    writeWidths("registrations", {});
    expect(readWidths("registrations")).toEqual({});
  });

  it("keeps this page's changes when storage reads but refuses to write", () => {
    const fake = stub();
    (window.localStorage as { setItem: unknown }).setItem = () => {
      throw new Error("QuotaExceededError");
    };
    writeWidths("registrations", { name: 240 });
    expect(fake.store.has("br.table.registrations.widths")).toBe(false);
    // The page keeps what it was told, ahead of what storage still says.
    expect(readWidths("registrations")).toEqual({ name: 240 });
    writeWidths("registrations", { ...readWidths("registrations"), state: 180 });
    expect(readWidths("registrations")).toEqual({ name: 240, state: 180 });
    expect(readWidths("events")).toEqual({});
  });

  it("remembers each column's floor as its last fixed layout measured it", () => {
    const table = {};
    expect(recordedFloor(table, "name")).toBeUndefined();
    recordFloors(table, { name: 119, state: MIN_COLUMN_WIDTH });
    expect(recordedFloor(table, "name")).toBe(119);
    expect(recordedFloor({}, "name")).toBeUndefined();
  });

  it("§NNN round-trips the hidden columns under br.table.<id>.hidden, beside the widths", () => {
    const fake = stub();
    writeWidths("registrations", { email: 240 });
    writeHidden("registrations", ["email", "bib"]);
    expect([...fake.store.keys()].sort()).toEqual(["br.table.registrations.hidden", "br.table.registrations.widths"]);
    expect(readHidden("registrations")).toEqual(["email", "bib"]);
    // A hidden column keeps its width for when it returns.
    expect(readWidths("registrations")).toEqual({ email: 240 });
    expect(readHidden("events")).toEqual([]);
    writeHidden("registrations", []);
    expect(fake.store.has("br.table.registrations.hidden")).toBe(false);
    expect(fake.events.map((event) => (event as CustomEvent<string>).detail)).toEqual(["registrations", "registrations", "registrations"]);
  });

  it("§NNN keeps this page's hidden columns when storage refuses, an emptied list too", () => {
    stub({ throws: true });
    expect(readHidden("registrations")).toEqual([]);
    expect(() => writeHidden("registrations", ["email"])).not.toThrow();
    expect(readHidden("registrations")).toEqual(["email"]);
    writeHidden("registrations", []);
    expect(readHidden("registrations")).toEqual([]);
  });

  it("§NNN shows all again over what a storage that refuses to write still holds", () => {
    const fake = stub();
    fake.store.set("br.table.staff.hidden", '["email"]');
    (window.localStorage as { removeItem: unknown }).removeItem = () => {
      throw new Error("SecurityError");
    };
    writeHidden("staff", []);
    expect(readHidden("staff")).toEqual([]);
  });

  it("says which table changed, for its reset control", () => {
    const fake = stub();
    writeWidths("staff", { email: 300 });
    expect(fake.events).toHaveLength(1);
    expect(fake.events[0].type).toBe(WIDTHS_CHANGED);
    expect((fake.events[0] as CustomEvent<string>).detail).toBe("staff");
  });
});
