import { createElement, type ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  listingFilterQuery,
  matchesListingFilter,
  matchingPastEvents,
  NO_FILTER,
  offeredFilters,
  parseListingFilter,
  type FilterFacts,
} from "@/modules/events/domain/listing-filter";
import type { PublicEvent } from "@/modules/events/repository";

/**
 * BR-REQ-041-01 — the past section's own «Filtre» (`DECISIONS.md` §611, amending §602 and §413).
 *
 * The owner, 2026-10-01 on QA: «Mi-ar trebui aceleași filtre și pentru evenimentele din trecut»;
 * §602 answered it by sending the top panel's one state through the past section too, and the
 * owner, once it had shipped: «Am zis că vreau un filtru și la evenimentele trecute, la fel ca la
 * cele curente». So the past section carries a panel of its own, inside its fold, over the same
 * address under `past-` names: its own ticks, its own offer (the window alone), its own count — and
 * a tick in one scope never narrows the other's list. One predicate still (`matchesListingFilter`,
 * through `matchingPastEvents`), over the page's one past window; a past tick opens the fold and its
 * heading says it is filtered.
 */
let currentLocale: "ro" | "en" = "ro";

vi.mock("next-intl/server", async () => {
  const { createFormatter, createTranslator } = await import("next-intl");
  const ro = (await import("../../../messages/ro.json")).default;
  const en = (await import("../../../messages/en.json")).default;
  return {
    getTranslations: async (namespace: string) =>
      createTranslator({ locale: currentLocale, messages: currentLocale === "ro" ? ro : en, namespace: namespace as "Event" }),
    getFormatter: async () => createFormatter({ locale: currentLocale, timeZone: "Europe/Bucharest" }),
    getLocale: async () => currentLocale,
  };
});

/** The listing's own address, with the query a chip's link carries; an event card's, by its slug. */
type Href = string | { pathname?: string; params?: { slug?: string }; query?: Record<string, string | string[]> };
function path(href: Href): string {
  if (typeof href === "string") return `/${currentLocale}/evenimente`;
  if (href.params?.slug) return `/${currentLocale}/evenimente/${href.params.slug}`;
  const search = new URLSearchParams();
  for (const [name, value] of Object.entries(href.query ?? {})) for (const one of Array.isArray(value) ? value : [value]) search.append(name, one);
  return search.size > 0 ? `/${currentLocale}/evenimente?${search.toString()}` : `/${currentLocale}/evenimente`;
}

vi.mock("@/i18n/navigation", () => ({
  getPathname: ({ href }: { href: Href }) => path(href),
  Link: ({ href, children }: { href: Href; children: ReactNode }) => createElement("a", { href: path(href) }, children),
}));

// The panel's one island reads the app router, which a static render has not mounted.
vi.mock("@/modules/events/ui/FilterAutoApply", () => ({ default: () => null }));

const { default: PastEvents } = await import("@/modules/events/ui/PastEvents");
const { default: ListingFilterPanel } = await import("@/modules/events/ui/ListingFilterPanel");

afterEach(() => {
  currentLocale = "ro";
});

const NOW = new Date("2026-10-01T09:00:00.000Z");

/** A finished event, its registration closed long ago, so no availability is read (§409). */
function held(id: number, overrides: Partial<PublicEvent> = {}): PublicEvent {
  const startsAt = new Date(Date.UTC(2026, 8, 30 - id * 7, 7));
  return {
    id: `00000000-0000-0000-0000-00000000000${id}`,
    type: "GROUP_RUN",
    surface: "ASPHALT",
    eventStatus: "SCHEDULED",
    startsAt,
    endsAt: null,
    raceStartsAt: null,
    timezone: "Europe/Bucharest",
    mapUrl: null,
    routeUrl: null,
    stravaEventUrl: null,
    facebookEventUrl: null,
    coHosts: null,
    coHostName: null,
    coHostUrl: null,
    featured: false,
    isSpecial: false,
    distanceMeters: 8000,
    elevationGainMeters: null,
    registrationMode: "INTERNAL",
    registrationOpensAt: null,
    registrationClosesAt: new Date(startsAt.getTime() - 3_600_000),
    externalRegistrationUrl: null,
    externalProvider: null,
    minAge: null,
    slug: `eveniment-${id}`,
    title: `Eveniment ${id}`,
    excerpt: null,
    excerptJson: null,
    locationName: "Brașov",
    locationAddress: null,
    locationToBeAnnounced: false,
    difficultyLevel: 5,
    costType: "FREE",
    costAmount: null,
    costUrl: null,
    publishedAt: new Date("2026-01-01T10:00:00Z"),
    ...overrides,
  } as PublicEvent;
}

/** Five past events, newest first as the window is: two of them trail races. */
const PAST = [
  held(1),
  held(2, { type: "RACE", surface: "TRAIL", title: "Cursa de toamnă", slug: "cursa-de-toamna", distanceMeters: 42000 }),
  held(3),
  held(4, { type: "RACE", surface: "TRAIL", title: "Cursa de primăvară", slug: "cursa-de-primavara", distanceMeters: 12000 }),
  held(5, { type: "HIKE", surface: "TRAIL" }),
];
/** Two cards ahead, both group runs on asphalt, both with an open door. */
const AHEAD = [
  held(7, { startsAt: new Date("2026-10-05T07:00:00Z"), title: "Alergarea de luni" }),
  held(8, { startsAt: new Date("2026-10-12T07:00:00Z"), title: "Alergarea următoare" }),
];
const facts: FilterFacts<PublicEvent> = { night: () => false, door: (event) => AHEAD.includes(event) };

async function markup(node: ReactNode): Promise<string> {
  const stream = await renderToReadableStream(node);
  await stream.allReady;
  return new Response(stream).text();
}
const withoutStyles = (html: string) => html.replace(/<style[^>]*>[\s\S]*?<\/style>/g, "");
/** The section as the page draws it for an address: the past scope its filter, the upcoming scope carried. */
const past = (address: Record<string, string | string[]>) =>
  markup(
    createElement(PastEvents, {
      rows: PAST,
      now: NOW,
      filter: parseListingFilter(address, "past"),
      facts,
      shownAbove: undefined,
      locale: currentLocale,
      carry: listingFilterQuery(parseListingFilter(address, "upcoming"), "upcoming"),
    }),
  ).then(withoutStyles);
const summary = (html: string) => (/<summary[^>]*>([\s\S]*?)<\/summary>/.exec(html)?.[1] ?? "").replace(/<[^>]+>/g, "");
/** Every `<input>` of a kind, as `name=value`. */
const inputs = (html: string, type: "checkbox" | "hidden") =>
  [...html.matchAll(/<input\b[^>]*>/g)]
    .map((match) => match[0])
    .filter((tag) => tag.includes(`type="${type}"`))
    .map((tag) => `${/name="([^"]*)"/.exec(tag)?.[1]}=${/value="([^"]*)"/.exec(tag)?.[1]}`);
const cardsAhead = (address: Record<string, string | string[]>) => {
  const filter = parseListingFilter(address, "upcoming");
  return AHEAD.filter((event) => matchesListingFilter(event, filter, facts)).map((event) => event.title);
};

describe("§611 the past section's own filter, independent of the cards ahead", () => {
  it("narrows the past by the `past-` scope and leaves the cards ahead alone — and the other way round", () => {
    const pastTick = { "past-type": "RACE", "past-surface": "TRAIL" };
    expect(matchingPastEvents(PAST, parseListingFilter(pastTick, "past"), facts).map((event) => event.title)).toEqual([
      "Cursa de toamnă",
      "Cursa de primăvară",
    ]);
    expect(cardsAhead(pastTick)).toEqual(["Alergarea de luni", "Alergarea următoare"]);

    const aheadTick = { type: "RACE" };
    expect(cardsAhead(aheadTick)).toEqual([]);
    expect(matchingPastEvents(PAST, parseListingFilter(aheadTick, "past"), facts)).toHaveLength(5);
  });

  it("still leaves out the row the lead shows between seasons (§167), by its id", () => {
    const filter = parseListingFilter({ "past-type": "RACE" }, "past");
    expect(matchingPastEvents(PAST, filter, facts, PAST[1].id).map((event) => event.title)).toEqual(["Cursa de primăvară"]);
    expect(matchingPastEvents(PAST, NO_FILTER, facts)).toHaveLength(5);
  });

  it("offers the past panel what the window carries, and never «Înscrieri deschise» — no past event has a door", () => {
    const offer = offeredFilters(PAST, NO_FILTER, facts);
    expect(offer.groups.find((entry) => entry.group === "type")?.values).toEqual(["GROUP_RUN", "RACE", "HIKE"]);
    expect(offer.flags).toEqual([]);
    // The cards ahead offer nothing (one kind, every door open): the past's boxes are not theirs.
    expect(offeredFilters(AHEAD, NO_FILTER, facts)).toEqual({ groups: [], flags: [] });
  });

  it("with a past tick: the fold is open, draws only the matches, says it is filtered — in both languages", async () => {
    const html = await past({ "past-surface": "TRAIL", "past-distance": "10-21" });
    expect(html).toMatch(/<details[^>]*data-testid="past-events"[^>]*open=""/);
    expect(html).toContain("Cursa de primăvară");
    expect(html).not.toContain("Cursa de toamnă");
    expect(html).not.toContain("Eveniment 1<");
    expect(summary(html)).toBe("Din trecut, după filtre (1)");
    currentLocale = "en";
    expect(summary(await past({ "past-surface": "TRAIL", "past-distance": "10-21" }))).toBe("Past, filtered (1)");
  });

  it("with one kind ticked in the past scope, the heading names it: «Din trecut — Concurs (2)»", async () => {
    expect(summary(await past({ "past-type": "RACE" }))).toBe("Din trecut — Concurs (2)");
    currentLocale = "en";
    expect(summary(await past({ "past-type": "RACE" }))).toBe("Past — Race (2)");
  });

  it("an upcoming tick leaves the section folded and whole: its heading counts every past row", async () => {
    const html = await past({ type: "RACE", surface: "TRAIL" });
    expect(html).not.toMatch(/<details[^>]*data-testid="past-events"[^>]*open/);
    expect(html).not.toContain('data-filtered="true"');
    expect(summary(html)).toBe("5 evenimente trecute");
  });

  it("a uniform past window still draws the button, and its fold says why there is nothing to narrow — in both languages, no box", async () => {
    const uniform = [held(1), held(3)];
    const draw = () =>
      markup(createElement(PastEvents, { rows: uniform, now: NOW, filter: NO_FILTER, facts, shownAbove: undefined, locale: currentLocale })).then(withoutStyles);
    const html = await draw();
    expect(html).toContain('data-testid="past-filters"');
    expect(html).toMatch(/<summary[^>]*>[\s\S]*?Filtre[\s\S]*?<\/summary>/);
    expect(inputs(html, "checkbox")).toEqual([]);
    expect(html).not.toContain("<form");
    expect(html).toContain("Toate evenimentele trecute sunt la fel — Alergare de grup, Asfalt, Mediu (4–6), 5–10 km și Gratuit — așa că nu e nimic de filtrat aici.");
    currentLocale = "en";
    const en = await draw();
    expect(en).toContain("Every past event is the same — Group run, Asphalt, Medium (4–6), 5–10 km, and Free — so there is nothing to narrow here.");
    expect(en).not.toContain("<form");
  });

  it("the sentence names a group only where every past event shares one value", async () => {
    const html = await markup(
      createElement(PastEvents, { rows: [held(1), held(3, { surface: "TRAIL", costType: "PAID" })], now: NOW, filter: NO_FILTER, facts, shownAbove: undefined, locale: "ro" }),
    );
    // Two surfaces and two costs narrow, so the boxes are drawn and no sentence is.
    expect(html).not.toContain("sunt la fel");
    expect(inputs(withoutStyles(html), "checkbox").length).toBeGreaterThan(0);
  });

  it("a section whose only row is the lead's draws nothing; one row besides it draws the control", async () => {
    const only = [held(1)];
    expect(await markup(createElement(PastEvents, { rows: only, now: NOW, filter: NO_FILTER, facts, shownAbove: only[0].id, locale: "ro" }))).toBe("");
  });

  it("stays folded with nothing ticked, and draws nothing when there is no past at all", async () => {
    const plain = await past({});
    expect(plain).not.toMatch(/<details[^>]*data-testid="past-events"[^>]*open/);
    expect(summary(plain)).toBe("5 evenimente trecute");
    expect(await markup(createElement(PastEvents, { rows: [], now: NOW, filter: NO_FILTER, facts, shownAbove: undefined, locale: "ro" }))).toBe("");
  });

  it("with a past tick that matches nothing, the section stays — its panel names the tick and the way back — and says so", async () => {
    const html = await past({ "past-type": "COFFEE", type: "GROUP_RUN" });
    expect(html).toMatch(/<details[^>]*data-testid="past-events"[^>]*open=""/);
    expect(summary(html)).toBe("Din trecut — Cafea (0)");
    expect(html).toContain("Niciun eveniment nu se potrivește filtrelor alese.");
    expect(html).toContain('data-testid="past-filters"');
    // The tick's own link takes it away and keeps the cards ahead's tick.
    expect(html).toMatch(/aria-label="Scoate filtrul: [^"]+"[^>]*href="\/ro\/evenimente\?type=GROUP_RUN"/);
  });

  it("renders its panel inside the fold, after the heading and before the cards, its boxes named `past-…`, the cards ahead's ticks carried", async () => {
    const html = await past({ type: "RACE", surface: ["TRAIL", "MIXED"], "past-type": "RACE" });
    const summaryEnd = html.indexOf("</summary>");
    const panelAt = html.indexOf('data-testid="past-filters"');
    const cardsAt = html.indexOf("<ul");
    expect(summaryEnd).toBeGreaterThan(0);
    expect(panelAt).toBeGreaterThan(summaryEnd);
    expect(cardsAt).toBeGreaterThan(panelAt);
    expect(html).toContain('aria-label="Filtrele evenimentelor trecute"');
    expect(html).toContain('data-testid="past-active-filters"');
    expect(html).not.toContain('data-testid="listing-filters"');
    const boxes = inputs(html, "checkbox");
    expect(boxes.length).toBeGreaterThan(0);
    expect(boxes.every((box) => box.startsWith("past-"))).toBe(true);
    expect(boxes).toContain("past-type=RACE");
    expect(boxes).not.toContain("past-registration=1");
    expect(inputs(html, "hidden")).toEqual(["type=RACE", "surface=TRAIL", "surface=MIXED"]);
    // «Șterge filtrele» clears the past scope alone: the cards ahead's ticks stay in the address.
    expect(html).toMatch(/href="\/ro\/evenimente\?type=RACE&amp;surface=TRAIL&amp;surface=MIXED"/);
    currentLocale = "en";
    expect(await past({ "past-type": "RACE" })).toContain('aria-label="Filters for past events"');
  });

  it("the top panel carries the past scope as hidden inputs, and its own boxes keep §413's names", async () => {
    const pastFilter = parseListingFilter({ "past-type": ["RACE", "HIKE"], "past-night": "1" }, "past");
    const filter = parseListingFilter({ type: "GROUP_RUN" });
    const html = withoutStyles(
      await markup(
        await ListingFilterPanel({
          locale: "ro",
          pathname: "/events",
          filter,
          offer: { groups: [{ group: "type", values: ["RACE", "GROUP_RUN"] }], flags: [] },
          keep: { view: "list" },
          carry: listingFilterQuery(pastFilter, "past"),
        }),
      ),
    );
    expect(html).toContain('data-testid="listing-filters"');
    expect(html).toContain('aria-label="Filtrele evenimentelor"');
    expect(inputs(html, "checkbox")).toEqual(["type=RACE", "type=GROUP_RUN"]);
    expect(inputs(html, "hidden")).toEqual(["view=list", "past-type=RACE", "past-type=HIKE", "past-night=1"]);
    // Unticking the one box above keeps the past's ticks and the layout.
    expect(html).toMatch(/aria-label="Scoate filtrul: Alergare de grup"[^>]*href="\/ro\/evenimente\?view=list&amp;past-type=RACE&amp;past-type=HIKE&amp;past-night=1"/);
  });
});
