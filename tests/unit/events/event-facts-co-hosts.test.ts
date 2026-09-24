import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PublicEvent } from "@/modules/events/repository";

/**
 * BR-REQ-011-01 criterion 16 (`DECISIONS.md` §168, extended by §NNN) — a partner's own links,
 * on the surfaces drawn from a public row: the event page's own "Împreună cu" (a card of links
 * per partner) and the listing card's mention (one sentence, one link per partner — its site,
 * or its first link).
 *
 * The reading rule and the label/host helpers are proven directly in `co-hosts.test.ts`; these
 * cases are the block itself, the way `event-links.test.ts` proves "Linkuri și fișiere".
 */
let currentLocale: "ro" | "en" = "ro";

vi.mock("next-intl/server", async () => {
  const { createFormatter, createTranslator } = await import("next-intl");
  const ro = (await import("../../../messages/ro.json")).default;
  const en = (await import("../../../messages/en.json")).default;
  const messagesFor = (locale: "ro" | "en") => (locale === "ro" ? ro : en);
  return {
    getTranslations: async (namespace: string) =>
      createTranslator({ locale: currentLocale, messages: messagesFor(currentLocale), namespace: namespace as "Event" }),
    getFormatter: async () => createFormatter({ locale: currentLocale, timeZone: "Europe/Bucharest" }),
    getLocale: async () => currentLocale,
  };
});

const { default: EventFacts } = await import("@/modules/events/ui/EventFacts");

// However a test fails, the next one starts in Romanian — never leaked from a thrown assertion.
afterEach(() => {
  currentLocale = "ro";
});

const NOW = new Date("2026-10-01T09:00:00.000Z");

function event(overrides: Partial<PublicEvent> = {}): PublicEvent {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    type: "RACE",
    surface: "ROAD",
    eventStatus: "SCHEDULED",
    startsAt: new Date("2026-11-21T07:00:00Z"),
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
    distanceMeters: 10000,
    elevationGainMeters: null,
    registrationMode: "NONE",
    registrationOpensAt: null,
    registrationClosesAt: null,
    externalRegistrationUrl: null,
    externalProvider: null,
    slug: "crosul-de-iarna",
    title: "Crosul de iarnă",
    excerpt: "Zece kilometri.",
    locationName: "Parcul Tractorul",
    locationAddress: null,
    locationToBeAnnounced: false,
    difficulty: null,
    costType: null,
    publishedAt: NOW,
    ...overrides,
  } as PublicEvent;
}

const TWO_PARTNERS = [
  {
    name: "Brașov Marathon",
    links: [
      { kind: "SITE", url: "https://bm.example.test" },
      { kind: "FACEBOOK", url: "https://facebook.com/bm", labelRo: "Pagina noastră" },
    ],
  },
  { name: "Salvamont", links: [] },
];

describe("BR-REQ-011-01 criterion 16 the partners' cards on the event page", () => {
  it("shows each partner's name and every one of its links, with the kind's word, the host and a new tab", async () => {
    currentLocale = "ro";
    const html = renderToStaticMarkup(await EventFacts({ event: event({ coHosts: TWO_PARTNERS }), now: NOW, stacked: true }));
    expect(html).toContain("Împreună cu");
    // The label is said once, not once per partner.
    expect(html.match(/Împreună cu/g)).toHaveLength(1);
    expect(html).toContain("Brașov Marathon");
    expect(html).toContain("Salvamont");
    // The club's own label for the Facebook link, the kind's default word for the untitled site.
    expect(html).toContain("Site-ul partenerului");
    expect(html).toContain("Pagina noastră");
    // Where each link goes, in small text under the label.
    expect(html).toContain("bm.example.test");
    expect(html).toContain("facebook.com");
    // Both links, opening in a new tab that cannot reach back.
    const anchors = [...html.matchAll(/<a\b[^>]*>/g)].map((match) => match[0]);
    expect(anchors).toHaveLength(2);
    for (const anchor of anchors) {
      expect(anchor).toContain('target="_blank"');
      expect(anchor).toContain('rel="noopener noreferrer"');
    }
    expect(anchors[0]).toContain('href="https://bm.example.test"');
    expect(anchors[1]).toContain('href="https://facebook.com/bm"');
  });

  it("shows just the name for a partner with no links, beside one that has them", async () => {
    const html = renderToStaticMarkup(await EventFacts({ event: event({ coHosts: TWO_PARTNERS }), now: NOW, stacked: true }));
    // "Salvamont" carries no anchor of its own — only Brașov Marathon's two links do.
    const afterSalvamont = html.slice(html.indexOf("Salvamont"));
    expect(afterSalvamont.indexOf("<a ") === -1 || afterSalvamont.indexOf("<a ") > afterSalvamont.indexOf("</dd>")).toBe(true);
  });

  it("shows the kind's own word in the reader's language when the club wrote no label", async () => {
    currentLocale = "en";
    const html = renderToStaticMarkup(
      await EventFacts({ event: event({ coHosts: [{ name: "Brașov Marathon", links: [{ kind: "SITE", url: "https://bm.example.test" }] }] }), now: NOW, stacked: true }),
    );
    // React escapes the apostrophe in text content.
    expect(html).toContain("Partner&#x27;s site");
    expect(html).not.toContain("Site-ul partenerului");
  });

  it("renders no partners' line at all for an event with none", async () => {
    const html = renderToStaticMarkup(await EventFacts({ event: event({ coHosts: [] }), now: NOW, stacked: true }));
    expect(html).not.toContain("Împreună cu");
  });
});

describe("BR-REQ-011-01 criterion 16 the listing card's mention", () => {
  it("keeps the plain sentence, each name its own link to the partner's site (or its first link)", async () => {
    const html = renderToStaticMarkup(
      await EventFacts({
        event: event({
          coHosts: [
            { name: "Brașov Marathon", links: [{ kind: "FACEBOOK", url: "https://facebook.com/bm" }, { kind: "SITE", url: "https://bm.example.test" }] },
            { name: "Salvamont", links: [{ kind: "STRAVA", url: "https://strava.com/clubs/1" }] },
          ],
        }),
        now: NOW,
        variant: "compact",
      }),
    );
    expect(html).toContain("Împreună cu");
    // A sentence, not a block of rows: no "small text" host caption under either name.
    expect(html).not.toContain("bm.example.test<");
    const anchors = [...html.matchAll(/<a\b[^>]*>/g)].map((match) => match[0]);
    expect(anchors.some((anchor) => anchor.includes('href="https://bm.example.test"'))).toBe(true);
    expect(anchors.some((anchor) => anchor.includes('href="https://strava.com/clubs/1"'))).toBe(true);
  });

  it("names a partner as plain text when it carries no link at all", async () => {
    const html = renderToStaticMarkup(
      await EventFacts({ event: event({ coHosts: [{ name: "Salvamont", links: [] }] }), now: NOW, variant: "compact" }),
    );
    expect(html).toContain("Salvamont");
    expect(html).not.toContain("<a ");
  });
});
