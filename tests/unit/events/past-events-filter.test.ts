import { createElement, type ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  listingFilterRows,
  matchingPastEvents,
  NO_FILTER,
  offeredFilters,
  parseListingFilter,
  type FilterFacts,
} from "@/modules/events/domain/listing-filter";
import type { PublicEvent } from "@/modules/events/repository";

/**
 * BR-REQ-041-01 — the listing's filters reach the past section (`DECISIONS.md` §602, amending §413;
 * the owner, 2026-10-01: «Mi-ar trebui aceleași filtre și pentru evenimentele din trecut»). One parsed
 * address, one predicate (`matchesListingFilter`, through `matchingPastEvents`), over the page's one
 * past window; the panel offers what the past carries too; a filtered page opens the fold and its
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

vi.mock("@/i18n/navigation", () => {
  const path = (href: { params?: { slug?: string } }) => `/${currentLocale}/evenimente/${href.params?.slug ?? ""}`;
  return {
    getPathname: ({ href }: { href: { params?: { slug?: string } } }) => path(href),
    Link: ({ href, children }: { href: { params?: { slug?: string } }; children: ReactNode }) => createElement("a", { href: path(href) }, children),
  };
});

const { default: PastEvents } = await import("@/modules/events/ui/PastEvents");

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
const facts: FilterFacts<PublicEvent> = { night: () => false, door: () => false };

async function markup(node: ReactNode): Promise<string> {
  const stream = await renderToReadableStream(node);
  await stream.allReady;
  return new Response(stream).text();
}
const withoutStyles = (html: string) => html.replace(/<style[^>]*>[\s\S]*?<\/style>/g, "");
const past = (query: Record<string, string>) =>
  markup(createElement(PastEvents, { rows: PAST, now: NOW, filter: parseListingFilter(query), facts, shownAbove: undefined })).then(withoutStyles);
const summary = (html: string) => (/<summary[^>]*>([\s\S]*?)<\/summary>/.exec(html)?.[1] ?? "").replace(/<[^>]+>/g, "");

describe("§602 the past section passes through the listing's own filter", () => {
  it("keeps the two of five past events a filter matches, newest first, and leaves out the one the lead shows", () => {
    const filter = parseListingFilter({ type: "RACE", surface: "TRAIL" });
    expect(matchingPastEvents(PAST, filter, facts).map((event) => event.title)).toEqual(["Cursa de toamnă", "Cursa de primăvară"]);
    expect(matchingPastEvents(PAST, filter, facts, PAST[1].id).map((event) => event.title)).toEqual(["Cursa de primăvară"]);
    expect(matchingPastEvents(PAST, NO_FILTER, facts)).toHaveLength(5);
  });

  it("offers a box only the past carries: no race ahead, two behind, and «Cursă» is a box", () => {
    const upcoming = [held(0, { startsAt: new Date("2026-10-05T07:00:00Z") })];
    const rows = listingFilterRows(upcoming, [], PAST);
    expect(rows).toHaveLength(6);
    // The lead between seasons is the window's first row: counted once.
    expect(listingFilterRows([PAST[0]], [], PAST)).toHaveLength(5);
    const types = offeredFilters(rows, NO_FILTER, facts).groups.find((entry) => entry.group === "type")?.values;
    expect(types).toContain("RACE");
    expect(offeredFilters(upcoming, NO_FILTER, facts).groups).toEqual([]);
  });

  it("renders only the matching past cards, opens the fold and says it is filtered — in both languages", async () => {
    const html = await past({ surface: "TRAIL", distance: "10-21" });
    expect(html).toMatch(/<details[^>]*data-testid="past-events"[^>]*open=""/);
    expect(html).toContain("Cursa de primăvară");
    expect(html).not.toContain("Cursa de toamnă");
    expect(html).not.toContain("Eveniment 1<");
    expect(summary(html)).toBe("Din trecut, după filtre (1)");
    currentLocale = "en";
    expect(summary(await past({ surface: "TRAIL", distance: "10-21" }))).toBe("Past, filtered (1)");
  });

  it("stays folded and unfiltered with nothing ticked, and draws nothing when the filter matches no past event", async () => {
    const plain = await past({});
    expect(plain).not.toMatch(/<details[^>]*open/);
    expect(summary(plain)).toBe("5 evenimente trecute");
    expect(await past({ type: "COFFEE" })).toBe("");
  });
});
