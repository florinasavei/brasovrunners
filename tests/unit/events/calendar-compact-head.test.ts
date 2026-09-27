import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * §NNN — the calendar page's head on a phone: the H1 and a «?» fold with the intro sentence and the two calendar links,
 * one row of the two small selects with ‹ Azi ›, and one row of the two chip pairs with the rule
 * between them. From `sm` the sentence and the period's heading are drawn as before.
 *
 * The header is rendered for real with the real catalogues; the two client islands that need
 * Next's router (`CalendarPicker`, `CalendarStepLink`) are stubbed to marked elements so the test
 * can read where they sit. The page itself needs a database to render; its «?» is its own component,
 * `CalendarIntroFold`, rendered here.
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
  Link: ({ href, children, ...rest }: { href: string | { pathname: string }; children: ReactNode }) =>
    createElement("a", { href: `/${currentLocale}${typeof href === "string" ? href : href.pathname}`, ...rest }, children),
  getPathname: ({ href }: { href: string | { pathname: string; query?: Record<string, string> } }) =>
    typeof href === "string" ? `/${currentLocale}${href}` : `/${currentLocale}${href.pathname}?${new URLSearchParams(href.query ?? {}).toString()}`,
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement("a", { href, ...rest }, children),
}));
vi.mock("@/modules/events/ui/CalendarPicker", () => ({
  default: ({ view }: { view: string }) => createElement("span", { "data-stub": "picker", "data-view": view }),
}));
vi.mock("@/modules/events/ui/CalendarStepLink", () => ({
  default: ({ label, direction }: { label: string; direction: string }) => createElement("a", { "data-stub": `step-${direction}`, "aria-label": label }),
}));

const { default: CalendarHeader } = await import("@/modules/events/ui/CalendarHeader");

afterEach(() => {
  currentLocale = "ro";
});

const NOW = new Date("2026-09-27T09:00:00.000Z");
const month = { kind: "month" as const, month: { year: 2026, month: 9 } };

/** The markup between an element's opening tag carrying `marker` and the matching close, for a flat check of what is inside. */
function inside(html: string, marker: string): string {
  const start = html.indexOf(marker);
  expect(start, `${marker} is rendered`).toBeGreaterThan(-1);
  const open = html.lastIndexOf("<", start);
  const tag = /^<(\w+)/.exec(html.slice(open))?.[1] ?? "div";
  let depth = 0;
  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, "g");
  re.lastIndex = open;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return html.slice(open, m.index + m[0].length);
  }
  return html.slice(open);
}

const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const ro = (await import("../../../messages/ro.json")).default;
const en = (await import("../../../messages/en.json")).default;

const withoutStyles = (html: string) => html.replace(/<style[^>]*>[\s\S]*?<\/style>/g, "");

describe("the calendar's compact head on a phone (§NNN)", () => {
  it("puts the selects and ‹ Azi › in one row that never wraps", async () => {
    const html = withoutStyles(renderToStaticMarkup(await CalendarHeader({ view: month, now: NOW })));
    const row = inside(html, 'data-testid="calendar-period-row"');
    expect(row).toContain('data-stub="picker"');
    expect(row).toContain('data-stub="step-previous"');
    expect(row).toContain(">Azi</a>");
    expect(row).toContain('data-stub="step-next"');
    // No chip in the period row: the pairs have a row of their own.
    expect(row).not.toContain(">Lună<");
    expect(row.indexOf('data-stub="picker"')).toBeLessThan(row.indexOf('data-stub="step-previous"'));
  });

  it("puts the two chip pairs, and the rule between them, in the second row", async () => {
    const html = withoutStyles(renderToStaticMarkup(await CalendarHeader({ view: month, now: NOW })));
    const row = inside(html, 'data-testid="calendar-chip-row"');
    for (const word of ["Lună", "An", "Calendar", "Listă"]) expect(row).toContain(`>${word}<`);
    expect(row).toContain('aria-hidden="true"');
  });

  it("keeps the period's heading as the section's name, in both languages", async () => {
    let html = renderToStaticMarkup(await CalendarHeader({ view: month, now: NOW }));
    expect(html).toMatch(/<h2[^>]*id="calendar-title"[^>]*>septembrie 2026<\/h2>/);
    currentLocale = "en";
    html = renderToStaticMarkup(await CalendarHeader({ view: month, now: NOW }));
    expect(html).toMatch(/<h2[^>]*id="calendar-title"[^>]*>September 2026<\/h2>/);
    expect(html).toContain(">Today</a>");
  });

  it("hides the heading from sight on a phone only, and names every rule's sm value", async () => {
    const { TITLE_ON_A_PHONE_SX } = await import("@/modules/events/ui/CalendarHeader");
    expect(TITLE_ON_A_PHONE_SX.position).toEqual({ xs: "absolute", sm: "static" });
    expect(TITLE_ON_A_PHONE_SX.clip).toEqual({ xs: "rect(0 0 0 0)", sm: "auto" });
    for (const [key, value] of Object.entries(TITLE_ON_A_PHONE_SX)) expect(value, key).toHaveProperty("sm");
  });

  it("draws the rule between the two pairs in the chip row", async () => {
    const html = withoutStyles(renderToStaticMarkup(await CalendarHeader({ view: month, now: NOW })));
    const row = inside(html, 'data-testid="calendar-chip-row"');
    expect(row).toMatch(/<div class="[^"]+" aria-hidden="true"><\/div>/);
  });

  it("the year view keeps the period row and the Lună / An pair, without the layout pair", async () => {
    const html = withoutStyles(renderToStaticMarkup(await CalendarHeader({ view: { kind: "year", year: 2026 }, now: NOW })));
    expect(inside(html, 'data-testid="calendar-period-row"')).toContain('data-view="year"');
    const chips = inside(html, 'data-testid="calendar-chip-row"');
    expect(chips).toContain(">An<");
    expect(chips).not.toContain(">Listă<");
  });
});

describe("the calendar page's intro behind a «?» fold on a phone (§NNN)", () => {
  it.each(["ro", "en"] as const)("holds the sentence and both calendar links in a native fold (%s)", async (locale) => {
    currentLocale = locale;
    const { default: CalendarIntroFold } = await import("@/modules/events/ui/CalendarIntroFold");
    const html = withoutStyles(renderToStaticMarkup(await CalendarIntroFold({ locale, baseUrl: "https://example.test" })));
    const messages = locale === "ro" ? ro : en;
    // A <details> the server renders, so it opens with scripts off; the summary has its own name.
    expect(html).toMatch(/^<details[^>]*data-testid="calendar-intro-help"/);
    expect(html).toContain(`<summary aria-label="${escape(messages.Events.calendar.introHelp)}">`);
    expect(html).toContain(escape(messages.Events.calendar.pageIntro));
    const webcal = `webcal://example.test/${locale}/events/calendar.ics`;
    expect(html).toContain(`href="https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}"`);
    expect(html).toContain(`href="${webcal}"`);
    expect(html).toContain(`>${escape(messages.Events.calendar.subscribeGoogle)}</a>`);
    expect(html).toContain(`>${escape(messages.Events.calendar.subscribeApple)}</a>`);
  });
});

describe("the period selects on a desktop (§NNN)", () => {
  it("gives every phone-only select rule an sm value, so nothing reaches the desktop", async () => {
    const { PHONE_SELECT_SX } = await vi.importActual<typeof import("@/modules/events/ui/CalendarPicker")>("@/modules/events/ui/CalendarPicker");
    for (const [key, value] of Object.entries(PHONE_SELECT_SX)) {
      expect(value, key).toHaveProperty("xs");
      expect(value, key).toHaveProperty("sm");
    }
  });
});
