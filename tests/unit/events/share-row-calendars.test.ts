import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { googleCalendarDetails, googleCalendarUrl, isoInZone, outlookCalendarUrl, type CalendarEvent, type CalendarLabels } from "@/modules/events/ical";
import { CALENDAR_TARGET_NAMESPACE, CALENDAR_TARGETS } from "@/modules/events/ui/calendar-targets";
import { CALENDAR_PILL_LEFT_VAR, DROPDOWN_PANEL_SURFACE_SX, SHARE_PILL_BAND, SHARE_PILL_SX, SHARE_ROW_GAP } from "@/modules/events/ui/share-pill";

/**
 * The event page's «Adaugă în calendar» row names the five doors of the subscription panel, and
 * both rows of the share block are small pills (§767, amending §140, §170 and §733; the owner,
 * 2026-10-14: «These buttons are way too big, and I am missing Google Calendar, Apple, Outlook like
 * on the other calendar»). BR-REQ-020-01 (the calendar), BR-REQ-052-02 criterion 8 (the share row).
 *
 * Nothing here can open an Outlook link — outlook.com refuses automated requests (HTTP 417) — so
 * the two compose addresses are pinned, character for character, to the add-to-calendar-button
 * library's format.
 */
let currentLocale: "ro" | "en" = "ro";

vi.mock("next-intl/server", async () => {
  const { createFormatter, createTranslator } = await import("next-intl");
  const roMessages = (await import("../../../messages/ro.json")).default;
  const enMessages = (await import("../../../messages/en.json")).default;
  return {
    getTranslations: async (namespace: string) =>
      createTranslator({ locale: currentLocale, messages: currentLocale === "ro" ? roMessages : enMessages, namespace: namespace as "Events" }),
    getFormatter: async () => createFormatter({ locale: currentLocale, timeZone: "Europe/Bucharest" }),
    getLocale: async () => currentLocale,
  };
});

const { default: ShareLinks } = await import("@/modules/events/ui/ShareLinks");
const { default: SubscribeBox } = await import("@/modules/events/ui/SubscribeBox");

afterEach(() => {
  currentLocale = "ro";
});

const ROOT = path.resolve(__dirname, "../../..");
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");
const unescape = (html: string) => html.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;/g, "'");

/** The catalogue's own words, as a calendar file reads them (the same translator the page hands it). */
function translator(catalogue: { Event: Record<string, unknown> }): CalendarLabels["t"] {
  return (key, values) => {
    const message = key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], catalogue.Event);
    if (typeof message !== "string") throw new Error(`missing Event.${key}`);
    return Object.entries(values ?? {}).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), message);
  };
}
const labelsRo: CalendarLabels = { locale: "ro", t: translator(ro) };
const labelsEn: CalendarLabels = { locale: "en", t: translator(en) };

/** Summer time in Bucharest on the day (the clocks go back on 25 October 2026): +03:00. */
const event: CalendarEvent = {
  id: "11111111-1111-1111-1111-111111111111",
  title: "Crosul aniversar; ediția a 3-a, Brașov",
  startsAt: new Date("2026-10-11T06:00:00.000Z"),
  endsAt: new Date("2026-10-11T09:00:00.000Z"),
  locationName: "Parcul Tractorul, intrarea principală",
  excerpt: "Cursa clubului.",
  scheduleJson: null,
  url: "https://example.test/ro/evenimente/crosul-aniversar",
  updatedAt: new Date("2026-09-19T10:00:00.000Z"),
};

describe("the event's wall clock with its offset (isoInZone)", () => {
  it("reads the zone's own rules for the day: summer time, winter time, and the night the clocks move", () => {
    expect(isoInZone(new Date("2026-10-11T06:00:00Z"), "Europe/Bucharest")).toBe("2026-10-11T09:00:00+03:00");
    expect(isoInZone(new Date("2026-11-21T06:00:00Z"), "Europe/Bucharest")).toBe("2026-11-21T08:00:00+02:00");
    expect(isoInZone(new Date("2026-03-29T00:30:00Z"), "Europe/Bucharest")).toBe("2026-03-29T02:30:00+02:00");
    expect(isoInZone(new Date("2026-03-29T01:00:00Z"), "Europe/Bucharest")).toBe("2026-03-29T04:00:00+03:00");
    expect(isoInZone(new Date("2026-10-25T00:59:59Z"), "Europe/Bucharest")).toBe("2026-10-25T03:59:59+03:00");
    expect(isoInZone(new Date("2026-10-25T01:00:00Z"), "Europe/Bucharest")).toBe("2026-10-25T03:00:00+02:00");
  });

  it("writes a negative offset, a half-hour one and UTC", () => {
    expect(isoInZone(new Date("2026-01-15T12:00:00Z"), "America/New_York")).toBe("2026-01-15T07:00:00-05:00");
    expect(isoInZone(new Date("2026-01-01T00:00:00Z"), "Asia/Kolkata")).toBe("2026-01-01T05:30:00+05:30");
    expect(isoInZone(new Date("2026-06-01T23:59:59Z"), "UTC")).toBe("2026-06-01T23:59:59+00:00");
  });
});

describe("Outlook's compose address for one event", () => {
  const body = encodeURIComponent(googleCalendarDetails(event, labelsRo));

  it("is the add-to-calendar-button's format, pinned character for character, for a personal account", () => {
    expect(outlookCalendarUrl(event, labelsRo, "personal")).toBe(
      "https://outlook.live.com/calendar/0/deeplink/compose?path=/calendar/action/compose&rru=addevent" +
        "&startdt=2026-10-11T09%3A00%3A00%2B03%3A00&enddt=2026-10-11T12%3A00%3A00%2B03%3A00" +
        "&subject=Crosul%20aniversar%3B%20edi%C8%9Bia%20a%203-a%2C%20Bra%C8%99ov" +
        `&body=${body}` +
        "&location=Parcul%20Tractorul%2C%20intrarea%20principal%C4%83",
    );
  });

  it("is the same on outlook.office.com for a work or school account, and nothing else differs", () => {
    const personal = outlookCalendarUrl(event, labelsRo, "personal");
    const work = outlookCalendarUrl(event, labelsRo, "work");
    expect(work).toBe(personal.replace("https://outlook.live.com/", "https://outlook.office.com/"));
    expect(new URL(work).host).toBe("outlook.office.com");
  });

  it("decodes back to the event's title, both instants in its zone, the description Google gets, and the place", () => {
    const url = new URL(outlookCalendarUrl(event, labelsRo, "work"));
    expect(url.pathname).toBe("/calendar/0/deeplink/compose");
    expect(url.searchParams.get("path")).toBe("/calendar/action/compose");
    expect(url.searchParams.get("rru")).toBe("addevent");
    expect(url.searchParams.get("subject")).toBe(event.title);
    // The `+` of the offset is %2B: left bare it would read as a space and Outlook would refuse the date.
    expect(url.searchParams.get("startdt")).toBe("2026-10-11T09:00:00+03:00");
    expect(url.searchParams.get("enddt")).toBe("2026-10-11T12:00:00+03:00");
    expect(url.searchParams.get("body")).toBe(googleCalendarDetails(event, labelsRo));
    expect(url.searchParams.get("body")).toContain(`<a href="${event.url}">`);
    expect(url.searchParams.get("location")).toBe("Parcul Tractorul, intrarea principală");
  });

  it("takes the event's own zone, a point in time for an event with no end, and no place when there is none", () => {
    const url = new URL(outlookCalendarUrl({ ...event, timezone: "Europe/London", endsAt: null, locationName: null }, labelsEn, "personal"));
    expect(url.searchParams.get("startdt")).toBe("2026-10-11T07:00:00+01:00");
    expect(url.searchParams.get("enddt")).toBe("2026-10-11T07:00:00+01:00");
    expect(url.searchParams.has("location")).toBe(false);
  });

  it("never carries a raw ampersand, hash or space from a typed title", () => {
    const url = outlookCalendarUrl({ ...event, title: "A & B #1 + C" }, labelsRo, "personal");
    expect(url).toContain("&subject=A%20%26%20B%20%231%20%2B%20C&");
    expect(new URL(url).searchParams.get("subject")).toBe("A & B #1 + C");
  });

  it("goes with Google's add link: the same title and place, UTC instants there, the zone's here", () => {
    const google = new URL(googleCalendarUrl(event, labelsRo));
    const outlook = new URL(outlookCalendarUrl(event, labelsRo, "personal"));
    expect(google.searchParams.get("text")).toBe(outlook.searchParams.get("subject"));
    expect(google.searchParams.get("details")).toBe(outlook.searchParams.get("body"));
    expect(google.searchParams.get("location")).toBe(outlook.searchParams.get("location"));
    expect(google.searchParams.get("dates")).toBe("20261011T060000Z/20261011T090000Z");
  });
});

describe("the event page's calendar row", () => {
  const calendar = {
    icsHref: "/ro/events/crosul/calendar.ics",
    googleUrl: googleCalendarUrl(event, labelsRo),
    outlookUrl: outlookCalendarUrl(event, labelsRo, "personal"),
    outlookWorkUrl: outlookCalendarUrl(event, labelsRo, "work"),
  };
  const props = {
    url: "https://example.test/ro/evenimente/crosul",
    title: "Crosul",
    imageHref: "/ro/events/crosul/share-image",
    fileName: "crosul.png",
    calendar,
  };
  /** Every `<a …>…</a>` of the doors inside the fold «Adaugă în calendar» (§772), as attributes and text. */
  const row = (rendered: string) => {
    const html = rendered.replace(/<style[^>]*>[\s\S]*?<\/style>/g, "");
    const from = html.indexOf('data-testid="event-calendar-doors"');
    const tail = from < 0 ? "" : html.slice(from, html.indexOf("</div>", from));
    return [...tail.matchAll(/<a ([^>]*)>([\s\S]*?)<\/a>/g)].map((match) => ({
      attributes: unescape(match[1]),
      text: match[2].replace(/<svg[\s\S]*?<\/svg>/g, "").replace(/<[^>]+>/g, ""),
      markup: match[2],
    }));
  };

  it.each(["ro", "en"] as const)("names the five doors in the subscription panel's order and words (%s)", async (locale) => {
    currentLocale = locale;
    const html = renderToStaticMarkup(await ShareLinks(props));
    const words = (locale === "ro" ? ro : en).Events.calendar.look.subscribe;
    expect(row(html).map((link) => link.text)).toEqual([words.google, words.apple, words.outlook, words.outlookWork, words.ics]);
  });

  it("draws a mark before every door's words: the app's own logo, the arrow for the file", async () => {
    const links = row(renderToStaticMarkup(await ShareLinks(props)));
    expect(links).toHaveLength(5);
    for (const link of links) expect(link.markup.trimStart().startsWith("<svg"), link.text).toBe(true);
    // Google's «G» in its four colours, and Outlook's mark for both accounts.
    expect((links[0].markup.match(/<path/g) ?? []).length).toBe(4);
    expect(links[2].markup.slice(0, links[2].markup.indexOf("</svg>"))).toBe(links[3].markup.slice(0, links[3].markup.indexOf("</svg>")));
    expect(links[4].markup).toContain("data-row-glyph");
  });

  it("sends each door where it belongs: Google and the two Outlooks in a new tab, the file to Apple in place, and only the last saves it", async () => {
    const links = row(renderToStaticMarkup(await ShareLinks(props)));
    expect(links[0].attributes).toContain(`href="${calendar.googleUrl}"`);
    expect(links[2].attributes).toContain(`href="${calendar.outlookUrl}"`);
    expect(links[3].attributes).toContain(`href="${calendar.outlookWorkUrl}"`);
    for (const index of [0, 2, 3]) {
      expect(links[index].attributes).toContain('target="_blank"');
      expect(links[index].attributes).toContain('rel="noopener noreferrer"');
      expect(links[index].attributes).not.toContain("download");
    }
    // Apple Calendar: the event's file, no `download` — a phone from Apple opens it in Calendar.
    expect(links[1].attributes).toContain(`href="${calendar.icsHref}"`);
    expect(links[1].attributes).not.toContain("download");
    expect(links[1].attributes).not.toContain("_blank");
    expect(links[4].attributes).toContain(`href="${calendar.icsHref}"`);
    expect(links[4].attributes).toContain("download");
  });

  /** The rendered page without the styles, from the fold's opening tag. */
  const fold = (rendered: string) => {
    const html = rendered.replace(/<style[^>]*>[\s\S]*?<\/style>/g, "");
    const from = html.search(/<details[^>]*data-testid="event-calendar"/);
    return { html, from, tag: html.slice(from, html.indexOf(">", from) + 1), summary: html.slice(html.indexOf("<summary", from), html.indexOf("</summary>", from)) };
  };

  it.each(["ro", "en"] as const)("puts the five doors behind ONE pill, a native fold closed on arrival, that says «Adaugă în calendar» (%s, §772)", async (locale) => {
    currentLocale = locale;
    const html = renderToStaticMarkup(await ShareLinks(props));
    const { tag, summary, from } = fold(html);
    expect(from).toBeGreaterThan(-1);
    // A `<details>`, so it opens with a click, Enter or Space and with scripts off — and no `open`: closed.
    expect(tag).toMatch(/^<details /);
    expect(tag).not.toMatch(/\sopen(=|\s|>)/);
    const words = (locale === "ro" ? ro : en).Event.share.calendarTitle;
    expect(words).toBe(locale === "ro" ? "Adaugă în calendar" : "Add to calendar");
    // The pill is the summary: a glyph, the words, the chevron — three marks of one control, nothing else in it.
    expect(summary).toMatch(/^<summary [^>]*data-testid="event-calendar-toggle"/);
    expect(summary.replace(/<svg[\s\S]*?<\/svg>/g, "").replace(/<[^>]+>/g, "")).toBe(words);
    expect(summary.match(/<svg/g)).toHaveLength(2);
    expect(summary.trimStart().indexOf("<svg", summary.indexOf(">"))).toBeGreaterThan(-1);
    expect(summary).toContain('aria-hidden="true"');
  });

  it("holds all five doors, the file's note and nothing else of the calendar inside the fold, after its summary", async () => {
    const html = renderToStaticMarkup(await ShareLinks({ ...props, calendar: { ...calendar, fileAddress: "https://example.test/ro/events/crosul/calendar.ics" } }));
    const { from, html: page } = fold(html);
    const closing = page.indexOf("</details>", page.indexOf('data-testid="event-calendar-address"'));
    const inside = page.slice(from, closing);
    expect(inside.indexOf("<summary")).toBeLessThan(inside.indexOf('data-testid="event-calendar-doors"'));
    expect(inside.match(/<a /g)).toHaveLength(5);
    expect(inside).toContain('data-testid="event-calendar-snapshot"');
    expect(inside).toContain('data-testid="event-calendar-address"');
    // No door outside it: the share row above carries the networks only.
    const before = page.slice(0, from);
    for (const door of [calendar.googleUrl, calendar.icsHref]) expect(before).not.toContain(door);
  });

  /** The share row's markup: from its opening tag to the end of the rendered block. */
  const shareRow = (rendered: string) => {
    const html = rendered.replace(/<style[^>]*>[\s\S]*?<\/style>/g, "");
    const from = html.indexOf('data-testid="event-share-row"');
    return { html, from, row: from < 0 ? "" : html.slice(from) };
  };

  it("draws ONE row: the caption, the networks and the calendar pill last, in that order (§781)", async () => {
    const { html, from } = shareRow(renderToStaticMarkup(await ShareLinks(props)));
    expect(from).toBeGreaterThan(-1);
    // One row element, the only one: the old second row is gone.
    expect(html.match(/data-testid="event-share-row"/g)).toHaveLength(1);
    const at = (needle: string) => html.indexOf(needle, from);
    const order = ["Dă mai departe:", "Facebook", "WhatsApp", "Descarcă poza", 'data-testid="event-calendar"'].map(at);
    for (const position of order) expect(position).toBeGreaterThan(from);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // The row wraps, eight pixels between pills; the calendar fold is its last child, nothing after it.
    const tag = html.slice(html.lastIndexOf("<", from), html.indexOf(">", from) + 1);
    expect(tag).toMatch(/^<div /);
    const fold = fold_(html);
    expect(html.slice(fold.closing + "</details>".length).replace(/<\/div>\s*$/, "")).toBe("");
  });

  /** The calendar fold, from its opening tag to its closing one (the address fold inside it is a second `<details>`). */
  const fold_ = (html: string) => {
    const opening = html.search(/<details[^>]*data-testid="event-calendar"/);
    // The fold's own closing tag is the last one on the page: nothing follows it but the row's `</div>`.
    const closing = html.lastIndexOf("</details>");
    return { opening, closing, markup: html.slice(opening, closing + "</details>".length) };
  };

  it("puts the panel INSIDE the details, after its summary, and keeps it out of the flow (§781)", async () => {
    const html = renderToStaticMarkup(
      await ShareLinks({ ...props, calendar: { ...calendar, fileAddress: "https://example.test/ro/events/crosul/calendar.ics" } }),
    ).replace(/<style[^>]*>[\s\S]*?<\/style>/g, "");
    const { markup } = fold_(html);
    expect(markup.indexOf("<summary")).toBeGreaterThan(-1);
    expect(markup.indexOf("</summary>")).toBeLessThan(markup.indexOf('data-testid="event-calendar-panel"'));
    for (const inner of ['data-testid="event-calendar-doors"', 'data-testid="event-calendar-snapshot"', 'data-testid="event-calendar-address"']) {
      expect(markup.indexOf('data-testid="event-calendar-panel"'), inner).toBeLessThan(markup.indexOf(inner));
    }
    // Only the summary is in the row's flow; the panel is out of it, so opening the fold moves no pill.
    const source = read("src/modules/events/ui/ShareLinks.tsx");
    const panel = source.slice(source.indexOf("const CALENDAR_PANEL_WIDTH"), source.indexOf("export default async function ShareLinks"));
    expect(panel).toMatch(/position: "absolute"/);
    // 26rem at most, never wider than the row; its left edge the pill's, pulled back inside the row's width.
    expect(panel).toMatch(/const CALENDAR_PANEL_WIDTH = "min\(26rem, 100%\)"/);
    expect(panel).toMatch(/width: CALENDAR_PANEL_WIDTH/);
    expect(panel).toMatch(/left: `min\(var\(\$\{CALENDAR_PILL_LEFT_VAR\}, 0px\), calc\(100% - \$\{CALENDAR_PANEL_WIDTH\}\)\)`/);
    expect(panel).toMatch(/boxSizing: "border-box"/);
    // Its own surface, border and shadow from theme tokens, above what follows; no colour literal.
    expect(panel).toMatch(/\.\.\.DROPDOWN_PANEL_SURFACE_SX/);
    expect(DROPDOWN_PANEL_SURFACE_SX).toMatchObject({ bgcolor: "background.paper", borderColor: "divider" });
    expect(read("src/modules/events/ui/CalendarIntroFold.tsx")).toContain("...DROPDOWN_PANEL_SURFACE_SX");
    expect(panel).toMatch(/boxShadow: 3/);
    expect(panel).toMatch(/zIndex: 1001/);
    expect(panel).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/);
    // The row is its containing block: the panel cannot pass the row's width.
    expect(source).toMatch(/data-testid="event-share-row" sx=\{\{ position: "relative", flexWrap: "wrap"/);
  });

  it("closes on Escape and a press outside through one tiny island that draws nothing, the fold working without it (§781)", async () => {
    const island = read("src/modules/events/ui/CalendarFoldClose.tsx");
    expect(island).toMatch(/^"use client";/);
    expect(island).toContain('event.key !== "Escape"');
    expect(island).toContain('document.addEventListener("click"');
    // Not `pointerdown`: the first touch of a scroll swipe would close the panel.
    expect(island).not.toContain(`Listener("pointerdown"`);
    expect(island).toMatch(/return null;/);
    // The pill's offset goes into the custom property the panel's CSS reads, and is kept up to date.
    expect(island).toContain("CALENDAR_PILL_LEFT_VAR");
    expect(island).toContain("ResizeObserver");
    expect(CALENDAR_PILL_LEFT_VAR).toBe("--calendar-pill-left");
    // It is wired by the fold's id, and the fold itself has no `open` and no handler: a native details.
    const html = renderToStaticMarkup(await ShareLinks(props));
    expect(html).toContain('id="event-calendar"');
    expect(read("src/modules/events/ui/ShareLinks.tsx")).toContain("<CalendarFoldClose foldId={CALENDAR_FOLD_ID} />");
  });

  it("wears the share row's own small pill on the summary: 28 pixels and the tap band, no 44", () => {
    const source = read("src/modules/events/ui/ShareLinks.tsx");
    expect(source).toContain("...SHARE_PILL_SX");
    expect(source).toMatch(/const CALENDAR_PILL_SX = \{[\s\S]*?\.\.\.SHARE_PILL_SX/);
    expect(SHARE_PILL_SX.minHeight).toBe(28);
    expect(SHARE_PILL_SX["&::after"]).toMatchObject({ content: '""' });
    // The marker is the pill's chevron, not the browser's, and the chevron turns when the fold opens.
    expect(source).toMatch(/"&::-webkit-details-marker": \{ display: "none" \}/);
    // A bare summary is content-box where MUI's button is border-box: said, so its 28 pixels stay 28 (§781).
    expect(source).toMatch(/const CALENDAR_PILL_SX = \{[\s\S]*?boxSizing: "border-box"/);
    expect(source).toMatch(/"details\[open\] > & \[data-chevron\]": \{ transform: "rotate\(180deg\)" \}/);
    expect(source).not.toMatch(/MuiMenu|<Menu\b|useState|"use client"/);
  });

  it("keeps Facebook and WhatsApp, and the picture's download, in the row above", async () => {
    const html = renderToStaticMarkup(await ShareLinks(props));
    for (const word of ["Dă mai departe:", "Facebook", "WhatsApp", "Descarcă poza"]) expect(html).toContain(word);
    // The share row is the one it was: outside the fold, before it.
    expect(html.indexOf("Dă mai departe:")).toBeLessThan(html.indexOf('data-testid="event-calendar"'));
    expect(html.indexOf("Facebook")).toBeLessThan(html.indexOf('data-testid="event-calendar"'));
  });

  it("draws no calendar row without a date, and leaves a members' event its calendar with no network buttons", async () => {
    const without = renderToStaticMarkup(await ShareLinks({ ...props, calendar: undefined }));
    expect(without).not.toContain("Adaugă în calendar");
    expect(without).not.toContain("event-calendar");
    const members = renderToStaticMarkup(await ShareLinks({ ...props, shareable: false }));
    expect(members).not.toContain("Facebook");
    expect(members).toContain("Adaugă în calendar");
    expect(members).not.toContain("Dă mai departe:");
    expect(row(members)).toHaveLength(5);
  });
});

describe("one source for the five names (calendar-targets.tsx)", () => {
  it("lists the five in the panel's order, each with its words in both catalogues", () => {
    expect([...CALENDAR_TARGETS]).toEqual(["google", "apple", "outlook", "outlookWork", "ics"]);
    expect(CALENDAR_TARGET_NAMESPACE).toBe("Events.calendar.look.subscribe");
    for (const catalogue of [ro, en]) for (const id of CALENDAR_TARGETS) expect(catalogue.Events.calendar.look.subscribe[id].length, id).toBeGreaterThan(0);
  });

  it("is read by the panel and by the event page's row, and the two keep no name of their own", () => {
    for (const file of ["src/modules/events/ui/SubscribeBox.tsx", "src/modules/events/ui/ShareLinks.tsx"]) {
      // Comments name the apps; the code must not.
      const source = read(file).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      expect(source, file).toContain("calendar-targets");
      expect(source, file).toContain("CALENDAR_TARGET_NAMESPACE");
      expect(source, file).toContain("calendarTargetMark");
      expect(source, file).not.toMatch(/["`>]\s*(Google Calendar|Apple Calendar|Outlook)/);
    }
    expect(read("src/modules/events/ui/SubscribeBox.tsx")).not.toMatch(/calendar-app-logos/);
    expect(read("src/modules/events/ui/ShareLinks.tsx")).not.toMatch(/calendar-app-logos/);
    for (const catalogue of [ro, en]) {
      expect(catalogue.Event.share).not.toHaveProperty("googleCalendar");
      expect(catalogue.Event.share).not.toHaveProperty("ics");
    }
  });

  it.each(["ro", "en"] as const)("shows the same five words on the panel and on the row (%s)", async (locale) => {
    currentLocale = locale;
    const panel = renderToStaticMarkup(await SubscribeBox({ locale, baseUrl: "https://example.test" }));
    const row = renderToStaticMarkup(
      await ShareLinks({
        url: "https://example.test/x",
        title: "x",
        imageHref: "/x",
        fileName: "x.png",
        calendar: { icsHref: "/x.ics", googleUrl: "https://g", outlookUrl: "https://o", outlookWorkUrl: "https://w" },
      }),
    );
    const words = (locale === "ro" ? ro : en).Events.calendar.look.subscribe;
    for (const id of CALENDAR_TARGETS) {
      expect(panel, `${id} on the panel`).toContain(`${words[id]}`);
      expect(row, `${id} on the row`).toContain(`${words[id]}`);
    }
  });
});

describe("the small pill", () => {
  it("is the house's small size at every width: over WCAG 2.2's 24, never the old 44", () => {
    expect(SHARE_PILL_SX.minHeight).toBeGreaterThanOrEqual(24);
    expect(SHARE_PILL_SX.minHeight).toBeLessThanOrEqual(32);
    expect(JSON.stringify(SHARE_PILL_SX)).not.toMatch(/44/);
    // The tap area is an invisible band, not a taller pill (§767).
    expect(SHARE_PILL_SX["&::after"]).toMatchObject({ top: -(SHARE_PILL_BAND + 1), bottom: -(SHARE_PILL_BAND + 1) }); // + the outlined button's 1-pixel border, inside which the band is measured
    expect(SHARE_PILL_SX.minHeight + 2 * SHARE_PILL_BAND).toBeGreaterThanOrEqual(24);
  });

  it("never lets a band reach a visible neighbour: it is at most half the gap beside it", () => {
    // Spacing unit is 8 pixels. Two bands of neighbouring lines then meet inside the gap, never on a pill.
    expect(SHARE_PILL_BAND * 2).toBeLessThanOrEqual(SHARE_ROW_GAP * 8);
    const share = read("src/modules/events/ui/ShareLinks.tsx");
    // The ONE row (§781: the caption, the networks and the calendar pill), its wrapped lines and the five
    // doors' lines inside the panel all keep that one gap; the panel's own stack too.
    expect(share).toContain("<Stack spacing={SHARE_ROW_GAP} data-testid=\"event-calendar-panel\"");
    expect(share.match(/gap: SHARE_ROW_GAP/g)).toHaveLength(2);
    expect(share).not.toContain("<Stack spacing={SHARE_ROW_GAP}>");
  });

  it("is worn by every pill of both rows, the islands included", () => {
    for (const file of ["ShareLinks.tsx", "NativeShareButton.tsx", "InstagramShareButton.tsx"]) {
      expect(read(`src/modules/events/ui/${file}`), file).toContain("SHARE_PILL_SX");
    }
    const share = read("src/modules/events/ui/ShareLinks.tsx");
    expect(share).toContain('size="small"');
    // The caption beside the pills is no taller than they are.
    expect(share).not.toMatch(/minHeight: \{ xs: 44/);
  });
});
