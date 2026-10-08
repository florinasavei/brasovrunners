import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";

/**
 * §674 — the calendar's address, to copy, and what to do when Google says it already has it
 * (amending §107 and §195).
 *
 * The owner, 2026-10-08: «Why can't I add the event back to my Google calendar after I removed it?»
 * and «Still can't re-import the Brașov Runners calendar». Google keeps a hidden or removed calendar
 * by its address and a deleted event in the Bin by its UID, so the quick-add button can do nothing;
 * calendar.google.com → «Din URL» with the plain address (and `?v=2`) always works. So the calendar
 * page's «?» fold, its «Adaugă în calendarul tău» row and the event page's calendar row draw the
 * address from `APP_BASE_URL` in a read-only box with «Copiază», and the sentences under it.
 *
 * Rendered for real with the real catalogues. The calendar section's month (async server
 * components of their own, and islands that need Next's router) is stubbed: the test is about the
 * row under it.
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
vi.mock("@/modules/events/ui/CalendarHeader", () => ({
  default: () => createElement("div", { "data-stub": "header" }),
  calendarStepHrefs: () => ({ previous: "/ro/calendar/2026-09", next: "/ro/calendar/2026-11" }),
}));
vi.mock("@/modules/events/ui/CalendarSwipe", () => ({
  default: ({ children }: { children: ReactNode }) => createElement("div", { "data-stub": "swipe" }, children),
}));
vi.mock("@/modules/events/ui/EventCalendar", () => ({
  default: () => createElement("div", { "data-stub": "month" }),
}));

const { env } = await import("@/shared/config/env");
const { default: CalendarIntroFold } = await import("@/modules/events/ui/CalendarIntroFold");
const { default: CalendarSection } = await import("@/modules/events/ui/CalendarSection");
const { default: ShareLinks } = await import("@/modules/events/ui/ShareLinks");
const { eventCalendarFileUrl } = await import("@/modules/events/ui/CalendarAddress");
const { copyText } = await import("@/modules/content/member-codes/ui/copy-text");

afterEach(() => {
  currentLocale = "ro";
});

const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const withoutStyles = (html: string) => html.replace(/<style[^>]*>[\s\S]*?<\/style>/g, "");
const catalogues = { ro, en } as const;

/** The read-only box with its address, and the «Copiază» island beside it, inside `html`. */
function expectAddressBox(html: string, { id, address, locale }: { id: string; address: string; locale: "ro" | "en" }) {
  const box = new RegExp(`<input[^>]*id="${id}"[^>]*>`).exec(html)?.[0];
  expect(box, `the box #${id}`).toBeDefined();
  expect(box).toContain(`value="${escape(address)}"`);
  expect(box).toMatch(/readOnly=""|readonly=""/);
  expect(box).toContain('type="text"');
  // The island: a real button, its word the catalogue's, and nothing else passed to it but strings.
  const button = /<button[^>]*data-testid="copy-code"[^>]*>[\s\S]*?<\/button>/.exec(html.slice(html.indexOf(box!)))?.[0];
  expect(button, "the «Copiază» button after the box").toBeDefined();
  expect(button).toContain('type="button"');
  const words = catalogues[locale];
  expect(button).toContain(escape(id.startsWith("event") ? words.Event.share.copy : words.Events.calendar.copy));
}

describe("the calendar page draws the feed's address to copy (§674)", () => {
  it.each(["ro", "en"] as const)("in the «?» fold on a phone, from APP_BASE_URL and the locale (%s)", async (locale) => {
    currentLocale = locale;
    const html = withoutStyles(renderToStaticMarkup(await CalendarIntroFold({ locale, baseUrl: env.APP_BASE_URL })));
    const address = `${env.APP_BASE_URL}/${locale}/events/calendar.ics`;
    expect(address).toMatch(/^https?:\/\//);
    expectAddressBox(html, { id: "calendar-feed-address-head", address, locale });
    const words = catalogues[locale].Events.calendar;
    for (const hint of [words.googleHintWhy, words.googleHintHow, words.phoneAppHint]) expect(html).toContain(escape(hint));
    // The two doors stay: the quick-add link works the first time, and the box joins it.
    expect(html).toContain(`>${escape(words.subscribeGoogle)}</a>`);
    expect(html).toContain(`>${escape(words.subscribeApple)}</a>`);
  });

  it.each(["ro", "en"] as const)("in «Adaugă în calendarul tău», in the fold under the three buttons (%s)", async (locale) => {
    currentLocale = locale;
    const now = new Date("2026-10-08T09:00:00.000Z");
    const html = withoutStyles(
      renderToStaticMarkup(
        await CalendarSection({ locale, view: { kind: "month", month: { year: 2026, month: 10 } }, layout: "grid", query: {}, now, events: [] }),
      ),
    );
    const address = `${env.APP_BASE_URL}/${locale}/events/calendar.ics`;
    const words = catalogues[locale].Events.calendar;
    const fold = html.slice(html.indexOf("<details"));
    expect(fold).toContain(`${escape(words.feedAddress)}</summary>`);
    expectAddressBox(fold, { id: "calendar-feed-address", address, locale });
    for (const hint of [words.googleHintWhy, words.googleHintHow, words.phoneAppHint]) expect(fold).toContain(escape(hint));
    // The ids differ from the head's: both are in one page's HTML (the head's is hidden from `sm`).
    expect(html).not.toContain('id="calendar-feed-address-head"');
  });
});

describe("the event page draws its own file's address (§674)", () => {
  const props = (fileAddress?: string) => ({
    url: `${env.APP_BASE_URL}/ro/evenimente/crosul`,
    title: "Crosul",
    imageHref: "/ro/events/crosul/share-image",
    fileName: "crosul.png",
    calendar: { icsHref: "/ro/events/crosul/calendar.ics", googleUrl: "https://calendar.google.com/calendar/render?action=TEMPLATE", fileAddress },
  });

  it.each(["ro", "en"] as const)("in a fold under the calendar row, with the Bin's sentence (%s)", async (locale) => {
    currentLocale = locale;
    const address = eventCalendarFileUrl(env.APP_BASE_URL, locale, "crosul");
    expect(address).toBe(`${env.APP_BASE_URL}/${locale}/events/crosul/calendar.ics`);
    const html = withoutStyles(renderToStaticMarkup(await ShareLinks(props(address))));
    const words = catalogues[locale].Event.share;
    const fold = html.slice(html.indexOf('data-testid="event-calendar-address"'));
    expect(fold).toContain(`${escape(words.fileAddress)}</summary>`);
    expectAddressBox(fold, { id: "event-calendar-file-address", address, locale });
    expect(fold).toContain(escape(words.binHint));
  });

  it("draws no fold without an address (a members' event, whose file needs a session)", async () => {
    const html = renderToStaticMarkup(await ShareLinks(props(undefined)));
    expect(html).not.toContain("event-calendar-address");
    expect(html).not.toContain("<input");
  });
});

describe("the words (§674)", () => {
  const keys = {
    Events: ["calendar.feedAddress", "calendar.addressLabel", "calendar.copy", "calendar.copied", "calendar.googleHintWhy", "calendar.googleHintHow", "calendar.phoneAppHint"],
    Event: ["share.fileAddress", "share.fileAddressLabel", "share.copy", "share.copied", "share.binHint"],
  } as const;

  it.each(["ro", "en"] as const)("are in the catalogue, each under 200 characters (%s)", (locale) => {
    const catalogue = catalogues[locale] as unknown as Record<string, Record<string, Record<string, string>>>;
    for (const [namespace, list] of Object.entries(keys)) {
      for (const key of list) {
        const [group, name] = key.split(".");
        const text = catalogue[namespace][group][name];
        expect(typeof text, `${locale} ${namespace}.${key}`).toBe("string");
        expect(text.length, `${locale} ${namespace}.${key}`).toBeGreaterThan(0);
        expect(text.length, `${locale} ${namespace}.${key}`).toBeLessThan(200);
      }
    }
  });

  it("say the way that works: the web, «Din URL», and ?v=2 — in both languages", () => {
    expect(ro.Events.calendar.googleHintHow).toContain("„Din URL”");
    expect(ro.Events.calendar.googleHintHow).toContain("?v=2");
    expect(en.Events.calendar.googleHintHow).toContain("“From URL”");
    expect(en.Events.calendar.googleHintHow).toContain("?v=2");
    expect(ro.Event.share.binHint).toContain("30 de zile");
    expect(en.Event.share.binHint).toContain("30 days");
  });
});

describe("«Copiază» without a clipboard selects the text (§674)", () => {
  const box = () => {
    const calls: string[] = [];
    return { calls, focus: () => calls.push("focus"), select: () => calls.push("select") };
  };

  it("copies when the browser lends the clipboard, and selects nothing", async () => {
    const written: string[] = [];
    const target = box();
    expect(await copyText("https://site.test/ro/events/calendar.ics", target, { writeText: async (text) => void written.push(text) })).toBe("copied");
    expect(written).toEqual(["https://site.test/ro/events/calendar.ics"]);
    expect(target.calls).toEqual([]);
  });

  it("selects the box's text when there is no clipboard (plain HTTP, an old browser)", async () => {
    // This file runs in Node: there is no `navigator.clipboard`, which is the default argument's case.
    expect(globalThis.navigator?.clipboard).toBeUndefined();
    const target = box();
    expect(await copyText("https://site.test/ro/events/calendar.ics", target)).toBe("selected");
    expect(target.calls).toEqual(["focus", "select"]);
  });

  it("selects the box's text when the clipboard refuses", async () => {
    const target = box();
    const refusing = { writeText: async () => Promise.reject(new DOMException("denied", "NotAllowedError")) };
    expect(await copyText("x", target, refusing)).toBe("selected");
    expect(target.calls).toEqual(["focus", "select"]);
  });

  it("says nothing and throws nothing with neither a clipboard nor a box", async () => {
    expect(await copyText("x", null, undefined)).toBe("none");
  });
});
