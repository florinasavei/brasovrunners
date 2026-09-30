import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * §NNN (amending §116, §137, §475, §549) — the month shown is the month in the address, and the
 * address names it in its path: `/ro/calendar/2026-10`, `/ro/calendar/2026-10/list`,
 * `/ro/calendar/2026`.
 *
 * The owner, 2026-09-29: «nu pot schimba luna din săgeți (deși se schimbă în query params) dar nu
 * văd evenimentele din octombrie; de asemenea s-a stricat și la swipe pe telefon». The static
 * calendar's arrows led to `?month=`, which the proxy rewrote to the live twin; Next's router took
 * the bare page's prefetched copy as the answer for every query of that address and asked the
 * server nothing, so September stayed on screen under October's address. A period's own path is a
 * page of its own to the router. These tests hold the addresses every control builds — the
 * arrows, the swipe, «Azi», the selects, the chips and the year's month headings — to the path,
 * the page's reading of it, and the proxy's redirect of the old query.
 */
let currentLocale: "ro" | "en" = "ro";

vi.mock("next-intl/server", async () => {
  const { createFormatter, createTranslator } = await import("next-intl");
  const ro = (await import("../../../messages/ro.json")).default;
  const en = (await import("../../../messages/en.json")).default;
  return {
    getTranslations: async (namespace: string) =>
      createTranslator({ locale: currentLocale, messages: currentLocale === "ro" ? ro : en, namespace: namespace as "Events" }),
    getFormatter: async () => createFormatter({ locale: currentLocale, timeZone: "Europe/Bucharest" }),
    getLocale: async () => currentLocale,
  };
});
vi.mock("@/i18n/navigation", () => ({
  getPathname: ({ locale, href }: { locale?: string; href: string | { pathname: string } }) => `/${locale ?? currentLocale}${typeof href === "string" ? href : href.pathname}`,
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode; prefetch?: boolean }) => createElement("a", { href, ...rest, prefetch: undefined }, children),
}));
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/modules/events/ui/CalendarStepLink", () => ({
  default: ({ href, direction }: { href: string; direction: string }) => createElement("a", { "data-stub": `step-${direction}`, href }),
}));
vi.mock("@/modules/events/ui/ChipLink", () => ({
  default: ({ href, label }: { href: string; label: string }) => createElement("a", { "data-chip": label, href }),
}));
vi.mock("@/shared/ui/ChipLink", () => ({
  default: ({ href, label }: { href: string; label: string }) => createElement("a", { "data-chip": label, href }),
}));
vi.mock("@/modules/events/ui/CalendarSwipe", () => ({
  default: ({ previousHref, nextHref, children }: { previousHref: string; nextHref: string; children: ReactNode }) =>
    createElement("div", { "data-stub": "swipe", "data-previous": previousHref, "data-next": nextHref }, children),
}));
vi.mock("@/modules/events/ui/EventCalendar", () => ({
  default: () => createElement("table", { "data-stub": "grid" }),
}));

const { calendarAddress, calendarPeriodPath, calendarSegments, legacyCalendarAddress, readCalendarSegments } = await import("@/modules/events/domain/calendar-path");
const { legacyCalendarTarget } = await import("@/i18n/calendar-redirect");
const { default: CalendarHeader, calendarStepHrefs } = await import("@/modules/events/ui/CalendarHeader");
const { default: CalendarSection } = await import("@/modules/events/ui/CalendarSection");
const { default: CalendarPicker } = await import("@/modules/events/ui/CalendarPicker");
const { default: CalendarSwipe } = await import("@/modules/events/ui/CalendarSwipe");
const { default: proxy } = await import("@/proxy");

afterEach(() => {
  currentLocale = "ro";
  push.mockClear();
});

const TZ = "Europe/Bucharest";
/** A Sunday in September 2026, Brașov's morning. */
const NOW = new Date("2026-09-27T09:00:00.000Z");
const SEPTEMBER = { year: 2026, month: 9 };
const month = (m: number, year = 2026) => ({ kind: "month" as const, month: { year, month: m } });
const hrefs = (html: string, marker: string) => [...html.matchAll(new RegExp(`${marker}[^>]*?href="([^"]*)"|href="([^"]*)"[^>]*?${marker}`, "g"))].map((m) => (m[1] ?? m[2]).replace(/&amp;/g, "&"));
const hrefOf = (html: string, marker: string) => hrefs(html, marker)[0];

describe("a period's path (§NNN)", () => {
  it("spells a month, a month as a list and a year", () => {
    expect(calendarSegments(month(10), "grid")).toEqual(["2026-10"]);
    expect(calendarSegments(month(10), "list")).toEqual(["2026-10", "list"]);
    // A year has no layout: it is always its agenda.
    expect(calendarSegments({ kind: "year", year: 2027 }, "list")).toEqual(["2027"]);
  });

  it("reads the month the path names — the one a direct link to October shows", () => {
    expect(readCalendarSegments(["2026-10"], NOW, TZ)).toEqual({ view: month(10), layout: "grid" });
    expect(readCalendarSegments(["2026-10", "list"], NOW, TZ)).toEqual({ view: month(10), layout: "list" });
    expect(readCalendarSegments(["2027"], NOW, TZ)).toEqual({ view: { kind: "year", year: 2027 }, layout: "grid" });
  });

  it("reads nothing else: a 404, not this month under another month's address", () => {
    for (const segments of [[], ["2026-13"], ["2026-1"], ["october"], ["2026-10", "grid"], ["2026", "list"], ["2026-10", "list", "x"], ["2029-01"], ["2023"]]) {
      expect(readCalendarSegments(segments, NOW, TZ), segments.join("/")).toBeNull();
    }
    // Two years either way, as the selects offer.
    expect(readCalendarSegments(["2028-12"], NOW, TZ)).not.toBeNull();
    expect(readCalendarSegments(["2024-01"], NOW, TZ)).not.toBeNull();
  });

  it("keeps the bare calendar for this month as a grid with nothing filtered, and spells every other period", () => {
    const base = "/ro/calendar";
    expect(calendarAddress(base, { view: month(9), layout: "grid", thisMonth: SEPTEMBER })).toBe("/ro/calendar");
    expect(calendarAddress(base, { view: month(10), layout: "grid", thisMonth: SEPTEMBER })).toBe("/ro/calendar/2026-10");
    expect(calendarAddress(base, { view: month(9), layout: "list", thisMonth: SEPTEMBER })).toBe("/ro/calendar/2026-09/list");
    expect(calendarAddress(base, { view: { kind: "year", year: 2026 }, layout: "grid", thisMonth: SEPTEMBER })).toBe("/ro/calendar/2026");
  });

  it("never puts a filter on the bare path: that is the bare page's query, answered from its prefetched copy", () => {
    const base = "/ro/calendar";
    expect(calendarAddress(base, { view: month(9), layout: "grid", query: { type: "RACE" }, thisMonth: SEPTEMBER })).toBe("/ro/calendar/2026-09?type=RACE");
    // A group ticked twice is the key twice, as the filter form sends it.
    expect(calendarAddress(base, { view: month(10), layout: "list", query: { surface: ["TRAIL", "ASPHALT"] }, thisMonth: SEPTEMBER })).toBe(
      "/ro/calendar/2026-10/list?surface=TRAIL&surface=ASPHALT",
    );
    // The filter form's action is always spelled, this month included.
    expect(calendarPeriodPath(base, month(9), "grid")).toBe("/ro/calendar/2026-09");
  });
});

describe("the old addresses (§NNN)", () => {
  const legacy = (query: string) => legacyCalendarAddress("/ro/calendar", new URLSearchParams(query), NOW, TZ);

  it("sends ?month=, ?year= and ?view= to the same period's path, every filter kept", () => {
    expect(legacy("month=2026-10")).toBe("/ro/calendar/2026-10");
    expect(legacy("month=2026-10&view=list&type=RACE&type=TRAIL_RACE")).toBe("/ro/calendar/2026-10/list?type=RACE&type=TRAIL_RACE");
    expect(legacy("view=list")).toBe("/ro/calendar/2026-09/list");
    expect(legacy("year=2027&month=2026-10&view=list")).toBe("/ro/calendar/2027");
    // This month as a grid is the bare page; Next's `_rsc` is not carried.
    expect(legacy("month=2026-09&_rsc=abc")).toBe("/ro/calendar");
    // Malformed or too far away: this month, as the query always read it.
    expect(legacy("month=2031-01&partner=1")).toBe("/ro/calendar/2026-09?partner=1");
  });

  it("leaves an address that names no period alone: a filter alone is still the bare page's twin", () => {
    expect(legacy("type=RACE")).toBeNull();
    expect(legacy("")).toBeNull();
    expect(legacyCalendarTarget("/ro/calendar", new URLSearchParams("type=RACE"), NOW)).toBeNull();
    expect(legacyCalendarTarget("/ro/evenimente", new URLSearchParams("month=2026-10"), NOW)).toBeNull();
    expect(legacyCalendarTarget("/ro/calendar/2026-10", new URLSearchParams("month=2026-11"), NOW)).toBeNull();
  });

  it("is a real 308 from the proxy, in both languages, before anything renders", () => {
    const ask = (address: string, method = "GET") => proxy(new NextRequest(`http://localhost:4000${address}`, { method }));
    const october = ask("/ro/calendar?month=2026-10");
    expect(october.status).toBe(308);
    expect(new URL(october.headers.get("location") ?? "").pathname).toBe("/ro/calendar/2026-10");
    const english = ask("/en/calendar?month=2026-11&view=list&type=RACE");
    expect(english.status).toBe(308);
    const target = new URL(english.headers.get("location") ?? "");
    expect(`${target.pathname}${target.search}`).toBe("/en/calendar/2026-11/list?type=RACE");
    // A POST keeps its address (a Server Action posts to the page it is on).
    expect(ask("/ro/calendar?month=2026-10", "POST").status).not.toBe(308);
  });
});

describe("every control goes to a period's path (§NNN)", () => {
  it("steps the arrows — and so the swipe — to the next and the previous month's path", () => {
    expect(calendarStepHrefs({ view: month(9), query: {}, locale: "ro", now: NOW })).toEqual({ previous: "/ro/calendar/2026-08", next: "/ro/calendar/2026-10" });
    // Back to this month is the bare calendar again.
    expect(calendarStepHrefs({ view: month(10), query: {}, locale: "ro", now: NOW }).previous).toBe("/ro/calendar");
    // Across a year's end, with the list and a filter kept.
    expect(calendarStepHrefs({ view: month(12), layout: "list", query: { type: "RACE" }, locale: "en", now: NOW })).toEqual({
      previous: "/en/calendar/2026-11/list?type=RACE",
      next: "/en/calendar/2027-01/list?type=RACE",
    });
    // The year view steps a year.
    expect(calendarStepHrefs({ view: { kind: "year", year: 2026 }, query: {}, locale: "ro", now: NOW })).toEqual({ previous: "/ro/calendar/2025", next: "/ro/calendar/2027" });
  });

  it("draws the header's arrows, «Azi» and chips as paths, never ?month=", async () => {
    const html = renderToStaticMarkup(await CalendarHeader({ view: month(10), now: NOW, query: {}, layout: "grid" }));
    expect(hrefOf(html, 'data-stub="step-previous"')).toBe("/ro/calendar");
    expect(hrefOf(html, 'data-stub="step-next"')).toBe("/ro/calendar/2026-11");
    expect(hrefOf(html, 'data-chip="Lună"')).toBe("/ro/calendar/2026-10");
    expect(hrefOf(html, 'data-chip="An"')).toBe("/ro/calendar/2026");
    expect(hrefOf(html, 'data-chip="Listă"')).toBe("/ro/calendar/2026-10/list");
    expect(html).toMatch(/href="\/ro\/calendar"[^>]*>Azi<\/a>/);
    expect(html).not.toMatch(/[?&](month|year|view)=/);
  });

  it("keeps a filter on every control, and on «Azi» spells this month rather than the bare path", async () => {
    currentLocale = "en";
    const html = renderToStaticMarkup(await CalendarHeader({ view: month(10), now: NOW, query: { type: "RACE" }, layout: "list" }));
    expect(hrefOf(html, 'data-stub="step-next"')).toBe("/en/calendar/2026-11/list?type=RACE");
    expect(html).toMatch(/href="\/en\/calendar\/2026-09\/list\?type=RACE"[^>]*>Today<\/a>/);
    expect(hrefOf(html, 'data-chip="Calendar"')).toBe("/en/calendar/2026-10?type=RACE");
  });

  it("hands the swipe the arrows' own paths", async () => {
    // The section's tree, walked rather than rendered: the header inside it is an async Server Component.
    const tree = await CalendarSection({ locale: "ro", view: month(9), layout: "grid", query: {}, now: NOW, events: [] });
    const find = (node: unknown): ReactElement<{ previousHref: string; nextHref: string }> | null => {
      if (Array.isArray(node)) return node.map(find).find(Boolean) ?? null;
      if (!node || typeof node !== "object" || !("props" in node)) return null;
      const element = node as ReactElement<{ children?: unknown; previousHref?: string }>;
      if (element.type === CalendarSwipe) return element as ReactElement<{ previousHref: string; nextHref: string }>;
      return find(element.props.children);
    };
    const swipe = find(tree);
    expect(swipe?.props.previousHref).toBe("/ro/calendar/2026-08");
    expect(swipe?.props.nextHref).toBe("/ro/calendar/2026-10");
  });

  it("sends a choice in the selects to the chosen period's path", () => {
    const tree = CalendarPicker({
      basePath: "/ro/calendar",
      query: { partner: "1" },
      view: "month",
      layout: "grid",
      thisMonth: SEPTEMBER,
      year: 2026,
      month: 9,
      years: [2024, 2025, 2026, 2027, 2028],
      monthNames: Array.from({ length: 12 }, (_, i) => `m${i + 1}`),
      labels: { month: "Luna", year: "Anul" },
    }) as ReactElement<{ children: (ReactElement<{ onChange: (event: { target: { value: string } }) => void }> | false)[] }>;
    const [monthSelect, yearSelect] = tree.props.children;
    if (!monthSelect || !yearSelect) throw new Error("both selects are drawn in the month view");
    monthSelect.props.onChange({ target: { value: "10" } });
    expect(push).toHaveBeenLastCalledWith("/ro/calendar/2026-10?partner=1#calendar");
    yearSelect.props.onChange({ target: { value: "2027" } });
    expect(push).toHaveBeenLastCalledWith("/ro/calendar/2027-09?partner=1#calendar");
  });
});
