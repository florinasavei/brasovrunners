import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { contrastRatio } from "@/modules/appearance/domain/tint-contrast";
import { dayKey, onPastDay } from "@/modules/events/domain/calendar";
import { PAST_ENTRY_SX } from "@/modules/events/ui/calendar-tone-sx";
import { COLOR, COLOR_DARK } from "@/theme/brand";
import { UNDER_LOOK, UNDER_LOOK_DARK } from "@/theme/look";

/**
 * «Tema v2», the calendar's head and its entries (§NNN, amending §292, §413, §487): the visible
 * «Calendar» title and the wordmark's band go (one `h1` stays, hidden), the «?» stands under the
 * controls, «Filtre» is on the chips' line, and a date on a day gone is faded. The page itself needs
 * a database, so its structure is read from the source and the pieces are rendered; the computed
 * styles are `tests/e2e/calendar-look.spec.ts`.
 */
vi.mock("next-intl/server", async () => {
  const { createFormatter, createTranslator } = await import("next-intl");
  const ro = (await import("../../../messages/ro.json")).default;
  return {
    getTranslations: async (namespace: string) => createTranslator({ locale: "ro", messages: ro, namespace: namespace as "Events" }),
    getFormatter: async () => createFormatter({ locale: "ro", timeZone: "Europe/Bucharest" }),
    getLocale: async () => "ro",
  };
});
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode; prefetch?: boolean }) => {
    const { prefetch, ...attributes } = rest;
    void prefetch;
    return createElement("a", { href, ...attributes }, children);
  },
}));
vi.mock("@/modules/events/ui/CalendarHeader", () => ({
  default: () => createElement("div", { "data-stub": "header" }),
  calendarStepHrefs: () => ({ previous: "/p", next: "/n" }),
}));
vi.mock("@/modules/events/ui/CalendarSwipe", () => ({ default: ({ children }: { children: ReactNode }) => createElement("div", null, children) }));
vi.mock("@/modules/events/ui/EventCalendar", () => ({
  default: ({ fadePast }: { fadePast?: boolean }) => createElement("div", { "data-stub": "calendar", "data-fade-past": String(Boolean(fadePast)) }),
}));
// An async Server Component cannot be rendered to static markup inside another: its own test is calendar-compact-head.test.ts.
vi.mock("@/modules/events/ui/CalendarIntroFold", async (importActual) => ({
  ...(await importActual<typeof import("@/modules/events/ui/CalendarIntroFold")>()),
  default: () => createElement("details", { "data-testid": "calendar-intro-help" }),
}));
vi.mock("@/modules/events/ui/CalendarAddress", () => ({ default: () => createElement("span", { "data-stub": "address" }) }));
vi.mock("@/modules/events/ui/CalendarLegend", () => ({ default: () => null, calendarLegendWords: () => ({}) }));

const ROOT = path.resolve(__dirname, "../../..");
const source = (file: string) => readFileSync(path.join(ROOT, file), "utf8").replace(/\r\n/g, "\n");

describe("the past rule: by the day in the club's zone", () => {
  const today = "2026-10-13";
  const at = (iso: string) => ({ startsAt: new Date(iso), timezone: "Europe/Bucharest" });

  it("calls a date on an earlier day past, and today's and later days' not", () => {
    expect(onPastDay(at("2026-10-12T16:00:00Z"), today)).toBe(true);
    expect(onPastDay(at("2026-10-13T16:00:00Z"), today)).toBe(false);
    expect(onPastDay(at("2026-10-14T05:00:00Z"), today)).toBe(false);
  });

  it("never fades an event earlier today: the page is static for the day, so it is faded from tomorrow's page", () => {
    // 07:00 in Brașov on the 13th, long before the page's «now» of the evening: still today.
    expect(onPastDay(at("2026-10-13T04:00:00Z"), today)).toBe(false);
  });

  it("reads the event's day in its own zone: 00:30 on the 13th in Brașov is the 12th in UTC and is not past", () => {
    expect(dayKey(new Date("2026-10-12T21:30:00Z"), "Europe/Bucharest")).toBe("2026-10-13");
    expect(onPastDay(at("2026-10-12T21:30:00Z"), today)).toBe(false);
    expect(onPastDay(at("2026-10-12T20:30:00Z"), today)).toBe(true);
  });
});

describe("the faded entry's style", () => {
  it("is written under the look's scope only, light and dark, from the theme's tokens: no colour literal, no blur", () => {
    expect(Object.keys(PAST_ENTRY_SX)).toEqual([UNDER_LOOK, UNDER_LOOK_DARK]);
    const written = JSON.stringify(PAST_ENTRY_SX);
    expect(written).not.toMatch(/#[0-9a-f]{3,8}|rgb|hsl|blur|filter/i);
    expect(PAST_ENTRY_SX[UNDER_LOOK]).toMatchObject({ bgcolor: "action.hover", color: "text.secondary" });
    expect(PAST_ENTRY_SX[UNDER_LOOK_DARK]).toMatchObject({ bgcolor: "action.hover", color: "text.secondary" });
  });

  it("keeps the words at AA for large text (3 : 1) on the fill, light and dark", () => {
    // MUI's `action.hover`: 4 % of black over the cell by day, 8 % of white after dark.
    const over = (cell: [number, number, number], ink: number, alpha: number) =>
      `#${cell.map((value) => Math.round(value * (1 - alpha) + ink * alpha).toString(16).padStart(2, "0")).join("")}`;
    const rgb = (hex: string) => [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16)) as [number, number, number];
    const lightFill = over(rgb(COLOR.surface), 0, 0.04);
    const darkFill = over(rgb(COLOR_DARK.surface), 255, 0.08);
    expect(contrastRatio(COLOR.inkMuted, lightFill)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(COLOR_DARK.inkMuted, darkFill)).toBeGreaterThanOrEqual(3);
  });
});

describe("the entry, past or not", () => {
  const props = { href: "/ro/events/x", time: "09:00", title: "Alergare", glyphs: [], filled: false, cancelled: false, note: null, partner: null, dense: false } as const;

  it("marks a past date and says «a trecut» after its name, and marks no other", async () => {
    const { default: CalendarEventChip } = await import("@/modules/events/ui/CalendarEventChip");
    const past = renderToStaticMarkup(createElement(CalendarEventChip, { ...props, past: "a trecut" }));
    expect(past).toContain("data-past");
    expect(past).toMatch(/aria-label="09:00 Alergare\. a trecut"/);
    const ahead = renderToStaticMarkup(createElement(CalendarEventChip, { ...props }));
    expect(ahead).not.toContain("data-past");
    expect(ahead).not.toContain("a trecut");
  });
});

describe("the head under each theme", () => {
  it("draws the «?» under the controls under Tema v2 only, and the faded entries with it", async () => {
    const { default: CalendarSection } = await import("@/modules/events/ui/CalendarSection");
    const draw = async (lookOn: boolean) =>
      renderToStaticMarkup(
        await CalendarSection({ locale: "ro", view: { kind: "month", month: { year: 2026, month: 10 } }, layout: "grid", query: {}, now: new Date("2026-10-13T09:00:00Z"), events: [], lookOn }),
      );
    const on = await draw(true);
    expect(on).toContain('data-testid="calendar-help-row"');
    expect(on).toContain('data-testid="calendar-intro-help"');
    expect(on).toContain('data-fade-past="true"');
    // After the controls, before the month.
    expect(on.indexOf('data-stub="header"')).toBeLessThan(on.indexOf('data-testid="calendar-help-row"'));
    expect(on.indexOf('data-testid="calendar-help-row"')).toBeLessThan(on.indexOf('data-stub="calendar"'));
    const off = await draw(false);
    expect(off).not.toContain("calendar-help-row");
    expect(off).not.toContain('data-testid="calendar-intro-help"');
    expect(off).toContain('data-fade-past="false"');
  });

  it("hides the page's one h1 under Tema v2 and draws the head's fold, title and sentence only under Tema v1; the band is gone", () => {
    const page = source("src/app/[locale]/calendar/page.tsx");
    // One `h1`: hidden when the setting is on, the rule-underlined title when it is off, with the «?» beside it only then.
    expect(page.match(/variant="h1"/g)).toHaveLength(1);
    expect(page).toContain("sx={look.on ? VISUALLY_HIDDEN : headingRule}");
    expect(page).toMatch(/\{!look\.on && \(\s*<Box sx=\{\{ display: \{ xs: "block", sm: "none" \} \}\}>\s*<CalendarIntroFold/);
    expect(page.match(/<CalendarIntroFold/g)).toHaveLength(1);
    // No eyebrow drawn from the title any more (the «CALENDAR» band under the wordmark), and no rule left for it.
    expect(page).not.toContain("TITLE_UNDER_LOOK");
    expect(page).not.toMatch(/letterSpacing: \{ sm: "0\.2em" \}/);
    // The wordmark stays, in the accent's hot shade under the look; the section carries the «?» then.
    expect(page).toContain("<Wordmark />");
    expect(page).toContain("lookOn={look.on}");
  });

  it("puts «Filtre» on the chips' line, outside the scroller, its panel hung from the line", () => {
    const page = source("src/app/[locale]/calendar/page.tsx");
    const line = page.slice(page.indexOf('data-testid="calendar-chips-line"'), page.indexOf("</CalendarFilterSlot>"));
    expect(line.indexOf("<KindChips")).toBeGreaterThan(-1);
    expect(line.indexOf("<KindChips")).toBeLessThan(line.indexOf("<CalendarFilterSlot"));
    expect(source("src/modules/events/ui/KindChips.tsx")).not.toContain("ListingFilterPanel");
    const css = page.slice(page.indexOf("const CHIPS_LINE_SX"));
    expect(css).toContain('"& [data-testid=\'listing-filters\'] > form": { position: "absolute", left: 0, right: 0, top: "100%"');
    // The slot and the panel's box step aside under the look only.
    expect(source("src/modules/events/ui/CalendarFilterSlot.tsx")).toContain('display: "contents"');
    expect(source("src/modules/events/ui/ListingFilterPanel.tsx")).toContain('[UNDER_LOOK]: { display: "contents" }');
  });
});

describe("the selectors under Tema v2", () => {
  it("are written under the look's scope only, with no colour literal", async () => {
    const { PICKER_UNDER_LOOK } = await import("@/modules/events/ui/CalendarPicker");
    expect(Object.keys(PICKER_UNDER_LOOK)).toEqual([UNDER_LOOK]);
    const written = JSON.stringify(PICKER_UNDER_LOOK[UNDER_LOOK]);
    expect(written).not.toContain("#");
    expect(written).not.toContain("rgb");
  });
});
