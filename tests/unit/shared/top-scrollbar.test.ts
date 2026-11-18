import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AdminTable, { type AdminColumn } from "@/modules/staff-identity/ui/AdminTable";
import { keepInStep, mirrorContentWidth, overflowsSideways, watchScrollRow } from "@/shared/ui/scroll-row";
import { frameIdFor, TOP_SCROLLBAR_SX } from "@/shared/ui/top-scrollbar";
import { ADMIN_TABLE_SURFACE } from "@/shared/ui/surface";
import { HEADER_CLEARANCE_PX } from "@/theme/brand";
import { withClientWords } from "../../helpers/client-words";

/**
 * BR-REQ-041-01, `DECISIONS.md` §NNN — the owner, 2026-11-18, of the volunteers' wide list: «vreau sa pot da scroll intr-un
 * tabel si din partea asta de sus, fara sa mai fiu nevoit sa dau scroll pana jos». A backoffice table wider than its frame
 * gets a second scrollbar right above it, kept in step with the frame's own, so it scrolls sideways without going down to
 * its end. The geometry — the bar moving the frame and the frame the bar, in a real browser — is walked in
 * `tests/e2e/admin-column-widths.spec.ts`.
 */
const ROOT = process.cwd();
const read = (...parts: string[]) => readFileSync(path.join(ROOT, ...parts), "utf8").replace(/\r\n/g, "\n");

/** A scroller and its mirror as `watchScrollRow` sees them: fakes that count the writes and hold their listeners. */
function scroller(scrollWidth: number, clientWidth: number) {
  const attrs = new Set<string>();
  const listeners = new Set<() => void>();
  let left = 0;
  const el = {
    attrs,
    listeners,
    writes: 0,
    get scrollLeft() {
      return left;
    },
    set scrollLeft(value: number) {
      el.writes++;
      // A browser clamps a scroll to what the box can reach, and says «scroll» when it moved.
      const next = Math.max(0, Math.min(value, el.scrollWidth - el.clientWidth));
      if (next === left) return;
      left = next;
      for (const listener of [...listeners]) listener();
    },
    scrollWidth,
    clientWidth,
    children: [] as unknown[],
    toggleAttribute(name: string, force?: boolean) {
      if (force) attrs.add(name);
      else attrs.delete(name);
      return !!force;
    },
    addEventListener(_type: "scroll", listener: () => void) {
      listeners.add(listener);
    },
    removeEventListener(_type: "scroll", listener: () => void) {
      listeners.delete(listener);
    },
    /** A hand on the scrollbar: the position moves and the box says «scroll», with no write counted. */
    drag(value: number) {
      left = value;
      for (const listener of [...listeners]) listener();
    },
  };
  return el;
}

function mirrorOf(frame: ReturnType<typeof scroller>, clientWidth: number) {
  const bar = scroller(0, 0);
  const props = new Map<string, string>();
  // Hidden, it has no width; shown, the one it is laid out at. Its reach follows the width the watcher gives its child.
  Object.defineProperty(bar, "clientWidth", { get: () => (bar.attrs.has("data-shown") ? clientWidth : 0) });
  Object.defineProperty(bar, "scrollWidth", { get: () => Number.parseFloat(props.get("--top-scrollbar-width") ?? "0") });
  return Object.assign(bar, {
    props,
    style: { setProperty: (name: string, value: string) => void props.set(name, value) },
    frame,
  });
}

describe("§NNN the pure part", () => {
  it("shows the bar only while the frame has more than a pixel past its edge", () => {
    expect(overflowsSideways(1400, 1000)).toBe(true);
    expect(overflowsSideways(1000, 1000)).toBe(false);
    // A rounding is not an overflow.
    expect(overflowsSideways(1001, 1000)).toBe(false);
    expect(overflowsSideways(1002, 1000)).toBe(true);
    // The phone's hidden frame measures nothing.
    expect(overflowsSideways(0, 0)).toBe(false);
  });

  it("gives the bar's child the bar's own width plus the frame's room, so both scroll exactly as far", () => {
    // A frame 1000 wide over a table of 1400, under a bar 1002 wide (no border): the bar reaches 400 too.
    expect(mirrorContentWidth(1002, 1400, 1000)).toBe(1402);
    expect(mirrorContentWidth(1002, 1402, 1002) - 1002).toBe(400);
    expect(mirrorContentWidth(900, 900, 1000)).toBe(900);
  });

  it("writes only when the two differ by a pixel or more, and says whether it wrote", () => {
    const from = { scrollLeft: 120 };
    const to = { scrollLeft: 0 };
    expect(keepInStep(from, to)).toBe(true);
    expect(to.scrollLeft).toBe(120);
    expect(keepInStep(from, to)).toBe(false);
    // A zoomed page's fractional position: close enough, no write, so no answer back.
    expect(keepInStep({ scrollLeft: 120.4 }, to)).toBe(false);
  });
});

describe("§NNN watchScrollRow keeps a mirror in step", () => {
  it("shows the mirror while the frame overflows, as far-reaching as the frame, and hides it when the table fits", () => {
    const frame = scroller(1400, 1000);
    const bar = mirrorOf(frame, 1002);
    const stop = watchScrollRow(frame, undefined, undefined, undefined, bar);
    expect(bar.attrs.has("data-shown")).toBe(true);
    expect(bar.props.get("--top-scrollbar-width")).toBe("1402px");
    // The edge cue the pinned verbs fade on (§943) is the same watcher's.
    expect(frame.attrs.has("data-more-end")).toBe(true);
    stop();

    const fits = scroller(1000, 1000);
    const hidden = mirrorOf(fits, 1002);
    watchScrollRow(fits, undefined, undefined, undefined, hidden)();
    expect(hidden.attrs.has("data-shown")).toBe(false);
    expect(hidden.props.has("--top-scrollbar-width")).toBe(false);
  });

  it("the bar moves the frame and the frame moves the bar, each written once — no ping-pong", () => {
    const frame = scroller(1400, 1000);
    const bar = mirrorOf(frame, 1000);
    const stop = watchScrollRow(frame, undefined, undefined, undefined, bar);

    bar.drag(250);
    expect(frame.scrollLeft).toBe(250);
    expect(frame.writes).toBe(1);
    // The frame's «scroll» found the bar already there: nothing written back.
    expect(bar.writes).toBe(0);

    frame.drag(400);
    expect(bar.scrollLeft).toBe(400);
    expect(bar.writes).toBe(1);
    expect(frame.writes).toBe(1);

    // After the cleanup neither listens: a drag of the bar no longer moves the frame.
    stop();
    expect(bar.listeners.size).toBe(0);
    expect(frame.listeners.size).toBe(0);
    bar.drag(0);
    expect(frame.scrollLeft).toBe(400);
  });

  it("follows the table's width: a column shown widens the bar's reach, a column hidden until it fits takes the bar away", () => {
    type Cb = () => void;
    const observers: { cb: Cb }[] = [];
    class FakeResize {
      constructor(public cb: Cb) {
        observers.push(this);
      }
      observe() {}
      disconnect() {}
    }
    const frame = scroller(1400, 1000);
    const bar = mirrorOf(frame, 1000);
    watchScrollRow(frame, FakeResize as never, undefined, undefined, bar);
    frame.scrollWidth = 1800;
    observers[0].cb();
    expect(bar.props.get("--top-scrollbar-width")).toBe("1800px");
    frame.scrollWidth = 1000;
    observers[0].cb();
    expect(bar.attrs.has("data-shown")).toBe(false);
  });
});

describe("§NNN the bar's look", () => {
  it("is nothing until the island shows it, from md up only, and never on paper", () => {
    expect(TOP_SCROLLBAR_SX.display).toBe("none");
    expect(TOP_SCROLLBAR_SX["&[data-shown]"]).toEqual({ display: { xs: "none", md: "block" } });
    expect(TOP_SCROLLBAR_SX["@media print"]).toEqual({ "&, &[data-shown]": { display: "none" } });
  });

  it("sticks under the site header, opaque on what the table stands on, above the pinned verbs and the column edges", () => {
    expect(TOP_SCROLLBAR_SX.position).toBe("sticky");
    expect(TOP_SCROLLBAR_SX.top).toBe(HEADER_CLEARANCE_PX.sm);
    expect(TOP_SCROLLBAR_SX.backgroundColor).toBe(ADMIN_TABLE_SURFACE);
    // The pinned verbs are 2 (`AdminTable`), the column edges 1; the site header is far above (1100).
    expect(TOP_SCROLLBAR_SX.zIndex).toBe(3);
    expect(TOP_SCROLLBAR_SX.overflowX).toBe("auto");
    expect(TOP_SCROLLBAR_SX.overflowY).toBe("hidden");
  });

  it("draws a grabbable track in the theme's colours, both schemes, no literal", () => {
    expect(TOP_SCROLLBAR_SX["&::-webkit-scrollbar"]).toEqual({ height: 12 });
    expect(TOP_SCROLLBAR_SX["&::-webkit-scrollbar-thumb"].backgroundColor).toBe("var(--mui-palette-text-secondary)");
    expect(TOP_SCROLLBAR_SX["&::-webkit-scrollbar-track"].backgroundColor).toBe("var(--mui-palette-divider)");
    // Firefox's, only where `::-webkit-scrollbar` is unknown: Chrome drops those rules once `scrollbar-width` is set.
    expect(TOP_SCROLLBAR_SX["@supports not selector(::-webkit-scrollbar)"]).toEqual({
      scrollbarWidth: "thin",
      scrollbarColor: "var(--mui-palette-text-secondary) var(--mui-palette-divider)",
    });
    expect(Object.keys(TOP_SCROLLBAR_SX)).not.toContain("scrollbarWidth");
    expect(JSON.stringify(TOP_SCROLLBAR_SX)).not.toMatch(/#[0-9a-fA-F]{3,8}|rgb\(|hsl\(/);
    expect(TOP_SCROLLBAR_SX["& > span"].width).toBe("var(--top-scrollbar-width, 100%)");
  });
});

type Row = { id: string; name: string };
const rows: Row[] = [
  { id: "a", name: "Alpha" },
  { id: "b", name: "Beta" },
];
const columns: AdminColumn<Row>[] = [
  { key: "name", label: "Nume", primary: true, render: (r) => r.name },
  { key: "phone", label: "Telefon", render: () => "0700" },
];

/** The markup without the styles emotion writes before each element: the structure alone. */
function render() {
  return markup().replace(/<style[\s\S]*?<\/style>/g, "");
}

function markup() {
  return renderToStaticMarkup(
    withClientWords(
      createElement(AdminTable<Row>, {
        caption: "Voluntari",
        tableId: "volunteers",
        columns,
        rows,
        rowKey: (r: Row) => r.id,
        basePath: "/ro/admin/volunteers",
        currentParams: {},
        query: { page: 1, perPage: 25, sort: "name", dir: "asc" } as never,
        total: rows.length,
        labels: { results: "2", page: "1", previous: "<", next: ">", perPage: "Pe pagină", actions: "Acțiuni", sortBy: (c: string) => c },
        rowActions: (r: Row) => `verbe ${r.id}`,
        empty: null,
      }),
    ),
  );
}

describe("§NNN AdminTable draws the bar above its desktop frame", () => {
  it("draws one island, hidden from assistive technology and the keyboard, right before the frame it names", () => {
    const html = render();
    const frameId = frameIdFor("volunteers");
    expect(frameId).toBe("table-frame-volunteers");
    expect(html.match(/data-top-scrollbar=/g)).toHaveLength(1);
    const bar = /<div[^>]*data-top-scrollbar="table-frame-volunteers"[^>]*>/.exec(html)?.[0] ?? "";
    expect(bar).toContain('aria-hidden="true"');
    expect(bar).toContain('tabindex="-1"');
    // The bar, its one empty child, then the frame by the id the island finds it by, the table inside it.
    expect(html).toMatch(/data-top-scrollbar="table-frame-volunteers"[^>]*><span><\/span><\/div><div[^>]*id="table-frame-volunteers"[^>]*><table/);
    expect(html.match(/id="table-frame-volunteers"/g)).toHaveLength(1);
  });

  it("puts nothing of it in the phone's blocks", () => {
    const html = render();
    const phone = html.slice(html.indexOf("</table>"));
    expect(phone).not.toContain("data-top-scrollbar");
    expect(phone.slice(phone.indexOf("<ul"))).not.toContain("table-frame-");
  });

  it("is an island that receives a string; the table stays the server's", () => {
    const island = read("src", "shared", "ui", "TopScrollbar.tsx");
    expect(island).toMatch(/^"use client";/);
    expect(island).toMatch(/export default function TopScrollbar\(\{ frameId \}: \{ frameId: string \}\)/);
    expect(island).toContain("document.getElementById(frameId)");
    const table = read("src", "modules", "staff-identity", "ui", "AdminTable.tsx");
    expect(table).not.toMatch(/^"use client"/);
    expect(table).toContain("<TopScrollbar frameId={frameId} />");
  });

  it("is the same bar on the other backoffice tables that scroll sideways", () => {
    for (const [file, name] of [
      [["src", "app", "[locale]", "admin", "events", "[id]", "urgente", "page.tsx"], "emergency"],
      [["src", "modules", "registrations", "ui", "SponsorListRegister.tsx"], "sponsor-register"],
      [["src", "modules", "content", "events", "ui", "boxes", "RsvpAnswersCard.tsx"], "rsvp-answers"],
    ] as const) {
      const source = read(...file);
      expect(source).toContain(`<TopScrollbar frameId={frameIdFor("${name}")} />`);
      expect(source).toContain(`id={frameIdFor("${name}")}`);
    }
  });
});
