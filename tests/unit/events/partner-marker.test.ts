import { readFileSync } from "node:fs";
import { createTranslator } from "next-intl";
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import type { PublicEvent } from "@/modules/events/repository";
import { partnerPhrase } from "@/modules/events/ui/counted-phrases";

/**
 * BR-REQ-020-01 criteria 18 and 19 (`DECISIONS.md` §NNN) — the partner marker, and one tooltip per
 * calendar entry.
 *
 * The owner, 2026-09-24: "I would like to have a special marker with this partnered event, so that
 * people know this is not a regular Brașov Runners group run — show like a handshake icon on the
 * card and in the calendar." And, of a month-grid entry showing two tooltips at once — the entry's
 * own and the ⚠'s inside it — one tooltip, carrying the time, the title, the date's note and now
 * the partner.
 *
 * `Tooltip` is replaced by a stub that writes its title into the markup, so what a tooltip would
 * say, and how many there are, can be read from a static render — the real one draws nothing until
 * it opens.
 */
let currentLocale: "ro" | "en" = "ro";

vi.mock("next-intl/server", async () => {
  const { createFormatter, createTranslator: translator } = await import("next-intl");
  const roMessages = (await import("../../../messages/ro.json")).default;
  const enMessages = (await import("../../../messages/en.json")).default;
  return {
    getTranslations: async (namespace: string) =>
      translator({ locale: currentLocale, messages: currentLocale === "ro" ? roMessages : enMessages, namespace: namespace as "Event" }),
    getFormatter: async () => createFormatter({ locale: currentLocale, timeZone: "Europe/Bucharest" }),
    getLocale: async () => currentLocale,
  };
});

vi.mock("@mui/material/Tooltip", async () => {
  const react = await import("react");
  return {
    default: ({ title, children }: { title: ReactNode; children: ReactElement }) =>
      react.createElement("span", { "data-tooltip": "" }, react.createElement("span", { "data-tooltip-title": "" }, title), children),
  };
});

const { default: PartnerChip } = await import("@/modules/events/ui/PartnerChip");
const { default: CalendarEventChip } = await import("@/modules/events/ui/CalendarEventChip");
const { default: EventCalendar } = await import("@/modules/events/ui/EventCalendar");

afterEach(() => {
  currentLocale = "ro";
});

function say(locale: "ro" | "en") {
  return createTranslator({ locale, messages: (locale === "ro" ? ro : en).Event, namespace: undefined }) as unknown as (
    key: string,
    values?: Record<string, string | number>,
  ) => string;
}

const partners = (...names: string[]) => names.map((name) => ({ name, links: [] }));
const noPartner = { coHosts: null, coHostName: null, coHostUrl: null };

describe("§NNN partnerPhrase — the marker's words, in each language", () => {
  it("names one partner, two partners, and the first of three with the rest counted", () => {
    expect(partnerPhrase(say("ro"), "ro", ["Brașov Running Festival"])).toBe("În parteneriat cu Brașov Running Festival");
    expect(partnerPhrase(say("ro"), "ro", ["Brașov Running Festival", "Salvamont"])).toBe("În parteneriat cu Brașov Running Festival și Salvamont");
    expect(partnerPhrase(say("ro"), "ro", ["Brașov Running Festival", "Salvamont", "Clubul Alpin"])).toBe(
      "În parteneriat cu Brașov Running Festival și încă 2 parteneri",
    );
    expect(partnerPhrase(say("en"), "en", ["Brașov Running Festival"])).toBe("With Brașov Running Festival");
    expect(partnerPhrase(say("en"), "en", ["Brașov Running Festival", "Salvamont"])).toBe("With Brașov Running Festival and Salvamont");
    expect(partnerPhrase(say("en"), "en", ["Brașov Running Festival", "Salvamont", "Clubul Alpin"])).toBe(
      "With Brașov Running Festival and 2 more partners",
    );
  });

  it("counts in Romanian's own forms, 'de' from twenty", () => {
    const many = ["A", ...Array.from({ length: 20 }, (_, index) => `P${index}`)];
    expect(partnerPhrase(say("ro"), "ro", many)).toBe("În parteneriat cu A și încă 20 de parteneri");
  });

  it("says nothing for an event with no partner", () => {
    expect(partnerPhrase(say("ro"), "ro", [])).toBeNull();
    expect(partnerPhrase(say("en"), "en", [])).toBeNull();
  });
});

describe("§NNN the listing card's chip", () => {
  it("is a small outlined chip with the handshake and the partner's name, in both languages", async () => {
    currentLocale = "ro";
    const romanian = renderToStaticMarkup(await PartnerChip({ event: { ...noPartner, coHosts: partners("Brașov Running Festival") } }));
    expect(romanian).toContain('data-testid="HandshakeIcon"');
    expect(romanian).toContain("În parteneriat cu Brașov Running Festival");
    expect(romanian).toContain("MuiChip-sizeSmall");
    expect(romanian).toContain("MuiChip-outlined");
    currentLocale = "en";
    const english = renderToStaticMarkup(await PartnerChip({ event: { ...noPartner, coHosts: partners("Brașov Running Festival") } }));
    expect(english).toContain("With Brașov Running Festival");
    expect(english).not.toContain("În parteneriat");
  });

  it("says two partners by name and the third as a count", async () => {
    const two = renderToStaticMarkup(await PartnerChip({ event: { ...noPartner, coHosts: partners("Brașov Running Festival", "Salvamont") } }));
    expect(two).toContain("În parteneriat cu Brașov Running Festival și Salvamont");
    const three = renderToStaticMarkup(await PartnerChip({ event: { ...noPartner, coHosts: partners("Brașov Running Festival", "Salvamont", "Clubul Alpin") } }));
    expect(three).toContain("În parteneriat cu Brașov Running Festival și încă 2 parteneri");
    expect(three).not.toContain("Clubul Alpin");
  });

  it("reads the partners the one way every surface does — the legacy columns too", async () => {
    const legacy = renderToStaticMarkup(await PartnerChip({ event: { coHosts: null, coHostName: "Salvamont", coHostUrl: null } }));
    expect(legacy).toContain("În parteneriat cu Salvamont");
  });

  it("is nothing at all for an event with no partner, or one whose partners were all removed", async () => {
    expect(renderToStaticMarkup(await PartnerChip({ event: noPartner }))).toBe("");
    expect(renderToStaticMarkup(await PartnerChip({ event: { coHosts: [], coHostName: "Removed", coHostUrl: null } }))).toBe("");
  });

  it("wraps rather than cutting the partner's name off at 320 pixels", () => {
    const source = readFileSync("src/modules/events/ui/PartnerChip.tsx", "utf8");
    expect(source).toMatch(/whiteSpace: "normal"/);
    expect(source).toMatch(/height: "auto"/);
  });

  it("stands in the chips row of the event card, the series card and the featured hero", () => {
    // The listing's own card is a function of the page; its chips row is the one Stack before the title.
    const listing = readFileSync("src/app/[locale]/events/page.tsx", "utf8");
    const card = listing.slice(listing.indexOf("async function EventCard"));
    expect(card.indexOf("<PartnerChip event={event} />")).toBeGreaterThan(card.indexOf("<EventKindChips"));
    expect(card.indexOf("<PartnerChip event={event} />")).toBeLessThan(card.indexOf("</Stack>"));
    const series = readFileSync("src/modules/events/ui/SeriesCard.tsx", "utf8");
    expect(series.indexOf("<PartnerChip event={next} />")).toBeGreaterThan(series.indexOf("<EventKindChips"));
    expect(series.indexOf("<PartnerChip event={next} />")).toBeLessThan(series.indexOf("</Stack>"));
    const hero = readFileSync("src/modules/events/ui/FeaturedEventHero.tsx", "utf8");
    expect(hero.indexOf("<PartnerChip event={event} />")).toBeGreaterThan(hero.indexOf("<EventKindChips"));
    expect(hero.indexOf("<PartnerChip event={event} />")).toBeLessThan(hero.indexOf("</Stack>"));
  });
});

describe("§NNN the event page's overline", () => {
  it("carries the handshake and the partner's words beside the type, and wraps on a phone", () => {
    const page = readFileSync("src/app/[locale]/events/[slug]/page.tsx", "utf8");
    const overline = page.slice(page.indexOf('<Typography variant="overline"'), page.indexOf("</Typography>", page.indexOf('<Typography variant="overline"')));
    expect(overline).toContain("<TypeGlyph");
    expect(overline).toContain("<PartnerGlyph />");
    expect(overline).toContain("{partner}");
    expect(overline).toContain('flexWrap: "wrap"');
    expect(page).toContain("partnerPhrase(t, locale, readCoHosts(event).map((host) => host.name))");
    // The glyph by name from the one registry, never a second import of its own.
    expect(page).toContain("GLYPHS.partner");
  });
});

/** A calendar entry as the grid (dense) or the agenda draws it. */
function chip(values: Partial<Parameters<typeof CalendarEventChip>[0]> = {}) {
  return renderToStaticMarkup(
    createElement(CalendarEventChip, {
      href: "/ro/evenimente/happy-monday",
      time: "18:30",
      title: "Happy Monday – alergare ușoară cu Brașov Runners",
      glyphs: ["type:GROUP_RUN", "surface:ASPHALT"],
      filled: false,
      cancelled: false,
      note: null,
      partner: null,
      dense: true,
      ...values,
    }),
  );
}

const MOVED = { kind: "moved" as const, text: "Nu în locul obișnuit: Stația de telecabină Tâmpa" };
const PARTNER = "În parteneriat cu Brașov Running Festival";
const count = (html: string, needle: string) => html.split(needle).length - 1;

describe("§NNN one tooltip per calendar entry", () => {
  it("gives a grid entry one tooltip: the time and the title, then the note, then the partner, each its own line", () => {
    const html = chip({ note: MOVED, partner: PARTNER });
    expect(count(html, "data-tooltip=")).toBe(1);
    const tooltip = html.slice(html.indexOf("data-tooltip-title"), html.indexOf("<a "));
    const lines = [...tooltip.matchAll(/<span class="[^"]*">([^<]+)<\/span>/g)].map((match) => match[1]);
    expect(lines).toEqual(["18:30 Happy Monday – alergare ușoară cu Brașov Runners", MOVED.text, PARTNER]);
  });

  it("draws the grid entry's marks bare — no tooltip, no name of their own inside it", () => {
    const html = chip({ note: MOVED, partner: PARTNER });
    const link = html.slice(html.indexOf("<a "));
    expect(count(link, "data-tooltip=")).toBe(0);
    expect(link).not.toContain('role="img"');
    expect(link).toContain('data-testid="HandshakeIcon"');
    expect(link).toContain('data-testid="WarningAmberIcon"');
  });

  it("has no title attribute anywhere, so the browser adds no tooltip of its own", () => {
    for (const html of [chip({ note: MOVED, partner: PARTNER }), chip({ dense: false, note: MOVED, partner: PARTNER }), chip()]) {
      expect(html).not.toMatch(/\stitle="/);
    }
  });

  it("names every line on the link itself, dense or not, for a screen reader", () => {
    for (const dense of [true, false]) {
      const html = chip({ dense, note: MOVED, partner: PARTNER });
      const anchor = html.match(/<a [^>]*>/)?.[0] ?? "";
      expect(anchor).toContain(
        'aria-label="18:30 Happy Monday – alergare ușoară cu Brașov Runners. Nu în locul obișnuit: Stația de telecabină Tâmpa. În parteneriat cu Brașov Running Festival"',
      );
      expect(anchor).not.toContain("aria-labelledby");
    }
    // Nothing to add, nothing added.
    expect(chip().match(/<a [^>]*>/)?.[0]).toContain('aria-label="18:30 Happy Monday – alergare ușoară cu Brașov Runners"');
  });

  it("keeps the agenda free of the entry's tooltip (§261); there each mark has its own, side by side", () => {
    const html = chip({ dense: false, note: MOVED, partner: PARTNER });
    // The link is the outermost element: no tooltip around it.
    expect(html.startsWith("<a ")).toBe(true);
    expect(count(html, "data-tooltip=")).toBe(2);
    expect(html).toContain(`aria-label="${PARTNER}"`);
    expect(html).toContain(`aria-label="${MOVED.text}"`);
    // The handshake before the ⚠, at the end of the row.
    expect(html.indexOf("HandshakeIcon")).toBeLessThan(html.indexOf("WarningAmberIcon"));
    expect(html.indexOf("HandshakeIcon")).toBeGreaterThan(html.indexOf("Happy Monday"));
  });

  it("draws no handshake for an event with no partner", () => {
    expect(chip()).not.toContain("HandshakeIcon");
    expect(chip({ dense: false })).not.toContain("HandshakeIcon");
  });
});

const NOW = new Date("2026-09-24T09:00:00Z");

function row(values: Partial<PublicEvent>): PublicEvent {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    type: "GROUP_RUN",
    surface: "ASPHALT",
    eventStatus: "SCHEDULED",
    startsAt: new Date("2026-09-27T07:00:00Z"),
    timezone: "Europe/Bucharest",
    slug: "trail-to-road",
    title: "Trail to Road cu Brașov Running Festival",
    locationName: "Piața Sfatului",
    mapUrl: null,
    isSpecial: false,
    ...noPartner,
    ...values,
  } as PublicEvent;
}

describe("§NNN the calendar, grid and agenda, wears the handshake beside a partnered event", () => {
  const rows = [
    row({ coHosts: partners("Brașov Running Festival") }),
    row({ id: "22222222-2222-2222-2222-222222222222", slug: "happy-monday", title: "Happy Monday", startsAt: new Date("2026-09-28T15:30:00Z") }),
  ];

  for (const layout of ["grid", "list"] as const) {
    it(`names the partner on the partnered entry and nowhere else (${layout})`, async () => {
      currentLocale = "ro";
      const html = renderToStaticMarkup(await EventCalendar({ view: { kind: "month", month: { year: 2026, month: 9 } }, events: rows, now: NOW, layout }));
      const anchors = [...html.matchAll(/<a [^>]*aria-label="([^"]*)"[^>]*>/g)].map((match) => match[1]);
      expect(anchors).toContain("10:00 Trail to Road cu Brașov Running Festival. În parteneriat cu Brașov Running Festival");
      expect(anchors).toContain("18:30 Happy Monday");
      expect(count(html, 'data-testid="HandshakeIcon"')).toBe(1);
    });
  }

  it("says it in English on the English calendar, two partners by name", async () => {
    currentLocale = "en";
    const html = renderToStaticMarkup(
      await EventCalendar({
        view: { kind: "month", month: { year: 2026, month: 9 } },
        events: [row({ coHosts: partners("Brașov Running Festival", "Salvamont") })],
        now: NOW,
        layout: "grid",
      }),
    );
    expect(html).toContain("10:00 Trail to Road cu Brașov Running Festival. With Brașov Running Festival and Salvamont");
    expect(html).not.toContain("În parteneriat");
  });
});
