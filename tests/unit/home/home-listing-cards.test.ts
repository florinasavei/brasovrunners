import { readFileSync } from "node:fs";
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PublicEvent } from "@/modules/events/repository";

/**
 * BR-REQ-041-01 (§726, amending §717 and the redesign plan's decision 10) — the home page's three run
 * sections draw the listing's own cards. The owner, comparing the two on QA: «totuși aici pe homepage
 * ar trebui să văd fix tipul de carduri din alergări, ca să reutilizăm...».
 *
 * Held here: a card of «Următoarea alergare», «Alergările săptămânale» and «Evenimente speciale» is
 * the very markup `SeriesCard` or `EventCard` draws on «Alergări» from the same row — not a look-alike;
 * the listing and the home page go through one component (`ListingCard`); and the home page hands the
 * cards what the listing hands them — a series' dates, the forecast at the first one's start from one
 * call for every card, and for a date alone the series it belongs to — from the cached read it already
 * had, asking nothing new.
 */
let currentLocale: "ro" | "en" = "ro";

vi.mock("next-intl/server", async () => {
  const { createFormatter, createTranslator } = await import("next-intl");
  const ro = (await import("../../../messages/ro.json")).default;
  const en = (await import("../../../messages/en.json")).default;
  return {
    getTranslations: async (arg: string | { locale?: string; namespace: string }) =>
      createTranslator({ locale: currentLocale, messages: currentLocale === "ro" ? ro : en, namespace: (typeof arg === "string" ? arg : arg.namespace) as "Event" }),
    getFormatter: async () => createFormatter({ locale: currentLocale, timeZone: "Europe/Bucharest" }),
    getLocale: async () => currentLocale,
  };
});
vi.mock("@/i18n/navigation", () => {
  const path = (href: string | { params?: { slug?: string } }) => (typeof href === "string" ? `/${currentLocale}${href}` : `/${currentLocale}/evenimente/${href.params?.slug ?? ""}`);
  return {
    getPathname: ({ href }: { href: string | { params?: { slug?: string } } }) => path(href),
    Link: ({ href, children, ...rest }: { href: string | { params?: { slug?: string } }; children: ReactNode } & Record<string, unknown>) => {
      delete rest.prefetch;
      return createElement("a", { href: path(href), ...rest }, children);
    },
  };
});

// What `readHomeContent` reads: the listing's cached upcoming events, the forecast and «Vin!»'s two cached reads — nothing else of the database.
const upcoming: PublicEvent[] = [];
const forecastCalls: string[][] = [];
/** «N vin» (§NNN): the notice flag and the counts the cache would answer, and every ask made of them. */
const rsvp = { described: true, counts: {} as Record<string, number>, describedCalls: 0, countCalls: [] as string[][] };
vi.mock("@/modules/public-cache/reads", () => ({
  cachedUpcomingEvents: async () => upcoming,
  cachedPublishedPages: async () => [],
  cachedRsvpDescribed: async () => {
    rsvp.describedCalls += 1;
    return rsvp.described;
  },
  cachedRsvpCounts: async (ids: readonly string[]) => {
    rsvp.countCalls.push([...ids]);
    return Object.fromEntries(ids.map((id) => [id, rsvp.counts[id] ?? 0]));
  },
}));
vi.mock("@/modules/resilience/last-good", () => ({
  readWithLastGood: async <T,>(_key: string, read: () => Promise<T>) => ({ value: await read(), freshness: "live", takenAt: new Date(0), restingUntil: null }),
}));
vi.mock("@/modules/weather/source", () => ({
  forecastsForEvents: async (events: readonly { id: string }[]) => {
    forecastCalls.push(events.map((event) => event.id));
    return new Map();
  },
}));
vi.mock("@/shared/ui/club-socials", () => ({ clubSocialLinks: async () => [] }));

const { default: EventCard } = await import("@/modules/events/ui/EventCard");
const { default: SeriesCard } = await import("@/modules/events/ui/SeriesCard");
const { default: ListingCard } = await import("@/modules/events/ui/ListingCard");
const { default: RunSection } = await import("@/modules/home/ui/RunSection");
const { readHomeContent } = await import("@/modules/home/home-content");
const { DEFAULT_HOME_PAGE_SETTING } = await import("@/modules/appearance/domain/home-page");
const { SAMPLE_NOW, SAMPLE_WEATHER, sampleRace, sampleSeries } = await import("@/modules/design/fixtures");

afterEach(() => {
  currentLocale = "ro";
  upcoming.length = 0;
  forecastCalls.length = 0;
  Object.assign(rsvp, { described: true, counts: {}, describedCalls: 0, countCalls: [] });
});

/** Rendered as the server renders it, async parts and all; Emotion's `<style>` elements out. */
async function html(element: ReactElement): Promise<string> {
  const stream = await renderToReadableStream(element);
  await stream.allReady;
  return (await new Response(stream).text()).replace(/<style[^>]*>[^<]*<\/style>/g, "");
}

const weeklySeries = (): PublicEvent[] => sampleSeries(currentLocale).map((row) => ({ ...row, seriesCadence: "WEEKLY" }));

describe("§726 the home page's run sections draw the listing's own cards", () => {
  it("draws a series as the listing's series card, the very same markup", async () => {
    for (const locale of ["ro", "en"] as const) {
      currentLocale = locale;
      const series = weeklySeries();
      const section = await html(
        createElement(RunSection, { id: "weekly", title: "Weekly", intro: "Intro", cards: [{ key: "w", members: series, weather: SAMPLE_WEATHER }], now: SAMPLE_NOW, more: null }),
      );
      const listing = await html(createElement(SeriesCard, { members: series, index: 0, now: SAMPLE_NOW, weather: SAMPLE_WEATHER, titleAs: "h3" }));
      expect(listing.startsWith("<li")).toBe(true);
      expect(section, locale).toContain(listing);
    }
  });

  it("draws a date as the listing's single-date card, its series' repeat chip included", async () => {
    const series = weeklySeries();
    const race = sampleRace("ro");
    const section = await html(
      createElement(RunSection, {
        id: "next-run",
        title: "Next",
        intro: null,
        cards: [
          { key: "n", members: [series[0]], weather: SAMPLE_WEATHER, seriesDates: series },
          { key: "r", members: [race] },
        ],
        now: SAMPLE_NOW,
        more: null,
      }),
    );
    const next = await html(createElement(EventCard, { event: series[0], index: 0, now: SAMPLE_NOW, weather: SAMPLE_WEATHER, seriesDates: series, titleAs: "h3" }));
    const special = await html(createElement(EventCard, { event: race, index: 1, now: SAMPLE_NOW, titleAs: "h3" }));
    expect(section).toContain(next);
    expect(section).toContain(special);
    // The date of a weekly series says so with the series card's chip, as on «Alergări» (§486).
    expect(next).toContain('data-series="true"');
  });

  it("is the component the listing draws its grid with, so the two pages cannot drift apart", async () => {
    const series = weeklySeries();
    expect(await html(createElement(ListingCard, { members: series, index: 2, now: SAMPLE_NOW }))).toBe(await html(createElement(SeriesCard, { members: series, index: 2, now: SAMPLE_NOW })));
    const race = sampleRace("ro");
    expect(await html(createElement(ListingCard, { members: [race], index: 0, now: SAMPLE_NOW }))).toBe(await html(createElement(EventCard, { event: race, index: 0, now: SAMPLE_NOW })));
    // The section's cards title themselves one level under the section's own `h2`; the listing's stay `h2`.
    const under = await html(createElement(ListingCard, { members: series, index: 2, now: SAMPLE_NOW, titleAs: "h3" }));
    expect(under).toContain("<h3");
    expect(under).not.toContain("<h2");
    expect(await html(createElement(ListingCard, { members: series, index: 2, now: SAMPLE_NOW }))).toContain("<h2");
    const listing = readFileSync("src/app/[locale]/events/page.tsx", "utf8");
    expect(listing).toContain('import ListingCard from "@/modules/events/ui/ListingCard";');
    expect(listing).toMatch(/\{cards\.map\(\(series, index\) => \(\s*<ListingCard/);
  });

  it("keeps the keyboard's ring on a card whose title is an h3, as on the home page (§486)", async () => {
    const { CARD_TAP_SX } = await import("@/modules/events/ui/card-layout");
    const keys = Object.keys(CARD_TAP_SX).filter((key) => key.includes("a:focus-visible"));
    expect(keys).toEqual(["&:has(:is(h2, h3) a:focus-visible)"]);
    const section = await html(createElement(RunSection, { id: "weekly", title: "Weekly", intro: null, cards: [{ key: "w", members: weeklySeries() }], now: SAMPLE_NOW, more: null }));
    expect(section).toContain("<h3");
    expect(section).not.toMatch(/<h2[^>]*>[^<]*<a/);
  });

  it("draws nothing for a section with no card: no heading over an empty row", async () => {
    expect(await html(createElement("div", null, createElement(RunSection, { id: "weekly", title: "Weekly", intro: null, cards: [], now: SAMPLE_NOW, more: null })))).toBe("<div></div>");
  });
});

describe("§726 the home page hands the cards what the listing hands them, from the read it already had", () => {
  it("gives the next run the listing's card for its series, the weekly section the series, the special one the race, and reads the forecast once for all", async () => {
    const series = weeklySeries();
    const race = sampleRace("ro");
    upcoming.push(...series, race);
    const { props } = await readHomeContent("ro", SAMPLE_NOW, { ...DEFAULT_HOME_PAGE_SETTING, on: true });

    expect(props.nextRun?.id).toBe("next-run");
    expect(props.nextRun?.cards).toHaveLength(1);
    // A date of a weekly series is drawn as the listing draws it: the series' card, every date.
    expect(props.nextRun?.cards[0].members).toEqual(series);
    expect(props.nextRun?.cards[0].seriesDates).toBeUndefined();

    expect(props.weekly.cards).toHaveLength(1);
    expect(props.weekly.cards[0].members).toEqual(series);
    expect(props.special.cards.map((card) => card.members)).toEqual([[race]]);
    expect(props.special.cards[0].seriesDates).toBeUndefined();
    for (const section of [props.nextRun!, props.weekly, props.special]) expect(section.now).toBe(SAMPLE_NOW);

    // One forecast call for every card, the next run's first: the listing's own way (§416).
    expect(forecastCalls).toEqual([[series[0].id, series[0].id, race.id]]);
  });

  it("draws no «Următoarea alergare» with no run ahead, and keeps the sections' words in the reader's language", async () => {
    currentLocale = "en";
    const { props } = await readHomeContent("en", SAMPLE_NOW, { ...DEFAULT_HOME_PAGE_SETTING, on: true });
    expect(props.nextRun).toBeNull();
    expect(props.weekly).toMatchObject({ id: "weekly", title: "Weekly runs", cards: [] });
    expect(props.special.more).toEqual({ label: "See all events" });
  });
});

/**
 * §NNN («Vin!» everywhere else; amends §815) — the home page's run cards wear «N vin»: the counts and the notice flag are read ONCE for the
 * page, through the listing's own gate (`readPublicComing`), and handed to the cards of a date alone; a series card never wears one; and a page
 * with no ticked event ahead reads neither.
 */
describe("§NNN the home page's cards say how many come", () => {
  const ticked = (event: PublicEvent): PublicEvent => ({ ...event, rsvpEnabled: true }) as PublicEvent;

  it("reads the gate and the counts once for the page and gives each date alone its count — the next run's card and its section's alike", async () => {
    const race = ticked(sampleRace("ro"));
    upcoming.push(race);
    rsvp.counts[race.id] = 4;
    const { props } = await readHomeContent("ro", SAMPLE_NOW, { ...DEFAULT_HOME_PAGE_SETTING, on: true });

    expect(props.nextRun?.cards[0].comingCount).toBe(4);
    expect(props.special.cards[0].comingCount).toBe(4);
    // One read of each for the whole page, never one per card: the two cards above share it.
    expect(rsvp.describedCalls).toBe(1);
    expect(rsvp.countCalls).toEqual([[race.id]]);
  });

  it("puts the count on the right card only: the offered date, not a date that is not ticked", async () => {
    const race = ticked(sampleRace("ro"));
    const other = { ...sampleSeries("ro")[0], id: "00000000-0000-4000-8000-000000000099", slug: "alone", startsAt: new Date("2026-11-30T15:30:00Z"), isSpecial: true } as PublicEvent;
    upcoming.push(race, other);
    rsvp.counts[race.id] = 2;
    rsvp.counts[other.id] = 9;
    const { props } = await readHomeContent("ro", SAMPLE_NOW, { ...DEFAULT_HOME_PAGE_SETTING, on: true });

    const byId = new Map([...props.special.cards, ...props.weekly.cards].map((card) => [card.members[0].id, card.comingCount]));
    expect(byId.get(race.id)).toBe(2);
    // Not ticked: not in the gate's map, so no count is even asked for it, whatever the cache holds.
    expect(byId.get(other.id)).toBe(0);
    expect(rsvp.countCalls).toEqual([[race.id]]);
  });

  it("never gives a series card a count, whatever its dates say (§815): its dates do", async () => {
    const series = weeklySeries().map(ticked);
    upcoming.push(...series);
    for (const date of series) rsvp.counts[date.id] = 5;
    const { props } = await readHomeContent("ro", SAMPLE_NOW, { ...DEFAULT_HOME_PAGE_SETTING, on: true });

    expect(props.weekly.cards[0].members).toHaveLength(3);
    expect(props.weekly.cards[0].comingCount).toBe(0);
    expect(props.nextRun?.cards[0].comingCount).toBe(0);
  });

  it("reads nothing, and shows nothing, while no event ahead is ticked", async () => {
    upcoming.push(...weeklySeries(), sampleRace("ro"));
    const { props } = await readHomeContent("ro", SAMPLE_NOW, { ...DEFAULT_HOME_PAGE_SETTING, on: true });

    for (const card of [...(props.nextRun?.cards ?? []), ...props.weekly.cards, ...props.special.cards]) expect(card.comingCount).toBe(0);
    expect(rsvp.describedCalls).toBe(0);
    expect(rsvp.countCalls).toEqual([]);
  });

  it("says nothing before the privacy notice describes «Vin!», and then asks for no count", async () => {
    const race = ticked(sampleRace("ro"));
    upcoming.push(race);
    rsvp.described = false;
    rsvp.counts[race.id] = 4;
    const { props } = await readHomeContent("ro", SAMPLE_NOW, { ...DEFAULT_HOME_PAGE_SETTING, on: true });

    expect(props.special.cards[0].comingCount).toBe(0);
    expect(rsvp.describedCalls).toBe(1);
    expect(rsvp.countCalls).toEqual([]);
  });

  it("draws the chip on the card that was given a count, as the listing does, in both languages", async () => {
    for (const [locale, words] of [["ro", /5 vin</], ["en", /5 coming</]] as const) {
      currentLocale = locale;
      const race = ticked(sampleRace(locale));
      upcoming.length = 0;
      upcoming.push(race);
      rsvp.counts[race.id] = 5;
      const { props } = await readHomeContent(locale, SAMPLE_NOW, { ...DEFAULT_HOME_PAGE_SETTING, on: true });
      const section = await html(createElement(RunSection, { ...props.special }));
      expect(section, locale).toContain('data-testid="coming-chip"');
      expect(section, locale).toMatch(words);
    }
  });
});
