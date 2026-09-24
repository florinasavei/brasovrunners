import { existsSync, readFileSync } from "node:fs";
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
const { default: PartnerOverline } = await import("@/modules/events/ui/PartnerOverline");

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

  it("says two partners by name and the third as a count, in both languages", async () => {
    const two = renderToStaticMarkup(await PartnerChip({ event: { ...noPartner, coHosts: partners("Brașov Running Festival", "Salvamont") } }));
    expect(two).toContain("În parteneriat cu Brașov Running Festival și Salvamont");
    const three = renderToStaticMarkup(await PartnerChip({ event: { ...noPartner, coHosts: partners("Brașov Running Festival", "Salvamont", "Clubul Alpin") } }));
    expect(three).toContain("În parteneriat cu Brașov Running Festival și încă 2 parteneri");
    expect(three).not.toContain("Clubul Alpin");
    currentLocale = "en";
    const twoEn = renderToStaticMarkup(await PartnerChip({ event: { ...noPartner, coHosts: partners("Brașov Running Festival", "Salvamont") } }));
    expect(twoEn).toContain("With Brașov Running Festival and Salvamont");
    const threeEn = renderToStaticMarkup(await PartnerChip({ event: { ...noPartner, coHosts: partners("Brașov Running Festival", "Salvamont", "Clubul Alpin") } }));
    expect(threeEn).toContain("With Brașov Running Festival and 2 more partners");
    expect(threeEn).not.toContain("Clubul Alpin");
    // One chip, one handshake, whatever the count.
    for (const html of [two, three, twoEn, threeEn]) {
      expect(count(html, 'data-testid="HandshakeIcon"')).toBe(1);
      expect(count(html, 'class="MuiChip-root ')).toBe(1);
    }
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
    // Each card's chips row is the first thing in it: the chip comes after the type's chip and
    // before the title (`variant="h2"`, or the hero's `h1`/`h2`). The listing's own card lives in
    // the page or, once it has a file of its own, in `EventCard.tsx` — either is read.
    const cardFile = existsSync("src/modules/events/ui/EventCard.tsx") ? "src/modules/events/ui/EventCard.tsx" : "src/app/[locale]/events/page.tsx";
    const listing = readFileSync(cardFile, "utf8");
    const card = listing.slice(listing.indexOf("async function EventCard"));
    const within = (source: string, chipTag: string) => {
      const at = source.indexOf(chipTag);
      expect(at).toBeGreaterThan(source.indexOf("<EventKindChips"));
      expect(at).toBeLessThan(source.search(/<Typography[^>]*variant="h[12]"/));
    };
    within(card, "<PartnerChip event={event} />");
    within(readFileSync("src/modules/events/ui/SeriesCard.tsx", "utf8"), "<PartnerChip event={next} />");
    within(readFileSync("src/modules/events/ui/FeaturedEventHero.tsx", "utf8"), "<PartnerChip event={event} />");
  });
});

describe("§NNN the event page's overline", () => {
  const overline = async (locale: "ro" | "en", ...names: string[]) => {
    currentLocale = locale;
    const element = await PartnerOverline({ event: { ...noPartner, coHosts: partners(...names) } });
    return element ? renderToStaticMarkup(element) : "";
  };

  it("carries the handshake and one, two or three partners' words, in both languages", async () => {
    const cases: [locale: "ro" | "en", names: string[], words: string][] = [
      ["ro", ["Brașov Running Festival"], "În parteneriat cu Brașov Running Festival"],
      ["ro", ["Brașov Running Festival", "Salvamont"], "În parteneriat cu Brașov Running Festival și Salvamont"],
      ["ro", ["Brașov Running Festival", "Salvamont", "Clubul Alpin"], "În parteneriat cu Brașov Running Festival și încă 2 parteneri"],
      ["en", ["Brașov Running Festival"], "With Brașov Running Festival"],
      ["en", ["Brașov Running Festival", "Salvamont"], "With Brașov Running Festival and Salvamont"],
      ["en", ["Brașov Running Festival", "Salvamont", "Clubul Alpin"], "With Brașov Running Festival and 2 more partners"],
    ];
    for (const [locale, names, words] of cases) {
      const html = await overline(locale, ...names);
      expect(html).toContain('data-testid="overline-partner"');
      expect(html).toContain(`<span>${words}</span>`);
      expect(count(html, 'data-testid="HandshakeIcon"')).toBe(1);
      // Decorative beside its words, the overline's own size, the "·" before it unread.
      expect(html).toMatch(/<svg[^>]*aria-hidden="true"[^>]*data-testid="HandshakeIcon"/);
      expect(html.startsWith('<span aria-hidden="true">·</span>')).toBe(true);
    }
  });

  it("is nothing at all for an event with no partner", async () => {
    currentLocale = "ro";
    expect(await PartnerOverline({ event: noPartner })).toBeNull();
    currentLocale = "en";
    expect(await PartnerOverline({ event: { coHosts: [], coHostName: null, coHostUrl: null } })).toBeNull();
  });

  it("stands on the page's overline after the type, and the overline wraps on a phone", () => {
    const page = readFileSync("src/app/[locale]/events/[slug]/page.tsx", "utf8");
    const start = page.indexOf('<Typography variant="overline"');
    const line = page.slice(start, page.indexOf("</Typography>", start));
    expect(line.indexOf("<PartnerOverline event={event} />")).toBeGreaterThan(line.indexOf("<TypeGlyph"));
    expect(line).toContain('flexWrap: "wrap"');
    // The glyph by name from the one registry, never a second import of its own.
    expect(readFileSync("src/modules/events/ui/PartnerOverline.tsx", "utf8")).toContain("GLYPHS.partner");
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
    // Named images a screen reader can reach — not MUI's default `aria-hidden="true"` — and no SVG
    // `<title>`, which would be the browser's own tooltip over MUI's.
    const marks = [...html.matchAll(/<svg [^>]*role="img"[^>]*>/g)].map((match) => match[0]);
    expect(marks).toHaveLength(2);
    for (const mark of marks) expect(mark).toContain('aria-hidden="false"');
    expect(html).not.toContain("<title>");
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

  it("names the first of three partners and counts the rest, in both languages", async () => {
    const three = [row({ coHosts: partners("Brașov Running Festival", "Salvamont", "Clubul Alpin") })];
    for (const [locale, words] of [
      ["ro", "În parteneriat cu Brașov Running Festival și încă 2 parteneri"],
      ["en", "With Brașov Running Festival and 2 more partners"],
    ] as const) {
      currentLocale = locale;
      for (const layout of ["grid", "list"] as const) {
        const html = renderToStaticMarkup(await EventCalendar({ view: { kind: "month", month: { year: 2026, month: 9 } }, events: three, now: NOW, layout }));
        expect(html).toContain(`aria-label="10:00 Trail to Road cu Brașov Running Festival. ${words}"`);
        expect(html).not.toContain("Clubul Alpin");
        expect(count(html, 'data-testid="HandshakeIcon"')).toBe(1);
      }
    }
  });
});

/**
 * BR-REQ-020-01 criterion 13, amended (§NNN), on the calendar the owner looked at: production's
 * Happy Monday name with ", Brasov" and the map link beside QA's name without either is one place,
 * so no date wears the ⚠; a date at another place still does, its note one line of the one tooltip.
 */
describe("§NNN the calendar marks no Happy Monday date for ', Brasov'", () => {
  const TRACTORUL = "Parcul Sportiv Tractorul – intrarea dinspre Patinoarul Olimpic";
  const MAP = ["https:/", "maps.example.test", "vuCwrzFtgLTDE5H68"].join("/");
  const monday = (day: string, id: string, values: Partial<PublicEvent> = {}) =>
    row({ id, slug: `happy-monday-${day}`, title: "Happy Monday", startsAt: new Date(`2026-09-${day}T15:30:00Z`), locationName: TRACTORUL, ...values });

  it("draws no mark when the dates only spell the place two ways", async () => {
    currentLocale = "ro";
    const rows = [
      monday("07", "30000000-0000-0000-0000-000000000007"),
      monday("14", "30000000-0000-0000-0000-000000000014"),
      monday("21", "30000000-0000-0000-0000-000000000021", { locationName: `${TRACTORUL}, Brasov`, mapUrl: MAP }),
      monday("28", "30000000-0000-0000-0000-000000000028", { locationName: `${TRACTORUL}, Brasov`, mapUrl: MAP }),
    ];
    const html = renderToStaticMarkup(await EventCalendar({ view: { kind: "month", month: { year: 2026, month: 9 } }, events: rows, now: NOW, layout: "grid" }));
    expect(html).not.toContain("Nu în locul obișnuit");
    expect(html).not.toContain("WarningAmberIcon");
  });

  it("still marks a date at another place, in the entry's one tooltip and its name", async () => {
    currentLocale = "ro";
    const rows = [
      monday("07", "30000000-0000-0000-0000-000000000007"),
      monday("14", "30000000-0000-0000-0000-000000000014", { locationName: `${TRACTORUL}, Brasov`, mapUrl: MAP }),
      monday("21", "30000000-0000-0000-0000-000000000021", { locationName: "Stația de telecabină Tâmpa" }),
    ];
    const html = renderToStaticMarkup(await EventCalendar({ view: { kind: "month", month: { year: 2026, month: 9 } }, events: rows, now: NOW, layout: "grid" }));
    expect(count(html, "WarningAmberIcon")).toBe(1);
    expect(html).toContain('aria-label="18:30 Happy Monday. Nu în locul obișnuit: Stația de telecabină Tâmpa"');
    expect(count(html, "data-tooltip=")).toBe(3);
  });
});
