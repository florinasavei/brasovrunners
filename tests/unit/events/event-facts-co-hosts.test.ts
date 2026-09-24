import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PublicEvent } from "@/modules/events/repository";

/**
 * BR-REQ-011-01 criterion 16 (`DECISIONS.md` §168, extended by §344) — a partner's own links,
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

/**
 * §352 — the Brașov Running Festival's card: the partner's name, what the partnership is in the
 * reader's language, and where to register with it, first among its links.
 */
const FESTIVAL = {
  name: "Brașov Running Festival",
  descriptionRo: "Alergăm împreună duminică, la festival.",
  descriptionEn: "We run together on Sunday, at the festival.",
  links: [
    { kind: "SITE", url: "https://festival.example.test" },
    { kind: "REGISTRATION", url: "https://festival.example.test/inscriere" },
  ],
};

describe("BR-REQ-011-01 criterion 16 the partnership's description and the partner's registration link (§352)", () => {
  it("shows the Romanian description on the Romanian page, between the name and the links", async () => {
    currentLocale = "ro";
    const html = renderToStaticMarkup(await EventFacts({ event: event({ coHosts: [FESTIVAL] }), now: NOW, stacked: true }));
    expect(html).toContain("Alergăm împreună duminică, la festival.");
    expect(html).not.toContain("We run together");
    const name = html.indexOf("Brașov Running Festival");
    const description = html.indexOf("Alergăm împreună");
    const firstLink = html.indexOf("<a ");
    expect(name).toBeLessThan(description);
    expect(description).toBeLessThan(firstLink);
  });

  it("shows the English description on the English page, never the Romanian one", async () => {
    currentLocale = "en";
    const html = renderToStaticMarkup(await EventFacts({ event: event({ coHosts: [FESTIVAL] }), now: NOW, stacked: true }));
    expect(html).toContain("We run together on Sunday, at the festival.");
    expect(html).not.toContain("Alergăm");
  });

  it("shows no description in either language when the stored row holds only one", async () => {
    const half = { ...FESTIVAL, descriptionEn: undefined };
    for (const locale of ["ro", "en"] as const) {
      currentLocale = locale;
      const html = renderToStaticMarkup(await EventFacts({ event: event({ coHosts: [half] }), now: NOW, stacked: true }));
      expect(html, locale).not.toContain("Alergăm");
      expect(html, locale).not.toContain('data-testid="co-host-description"');
      expect(html, locale).toContain("Brașov Running Festival");
    }
  });

  it("puts where to register first among the partner's links, named with the partner, as a link", async () => {
    currentLocale = "ro";
    const html = renderToStaticMarkup(await EventFacts({ event: event({ coHosts: [FESTIVAL] }), now: NOW, stacked: true }));
    const anchors = [...html.matchAll(/<a\b[^>]*>/g)].map((match) => match[0]);
    expect(anchors).toHaveLength(2);
    expect(anchors[0]).toContain('href="https://festival.example.test/inscriere"');
    expect(anchors[1]).toContain('href="https://festival.example.test"');
    expect(html).toContain("Înscriere la Brașov Running Festival");
    // A link like the others — no second button beside the club's own registration.
    expect(html).not.toMatch(/<button\b/);

    currentLocale = "en";
    const english = renderToStaticMarkup(await EventFacts({ event: event({ coHosts: [FESTIVAL] }), now: NOW, stacked: true }));
    expect(english).toContain("Register with Brașov Running Festival");
  });

  it("keeps the club's own label for the registration link when it wrote one, in both languages", async () => {
    const labelled = {
      ...FESTIVAL,
      links: [{ kind: "REGISTRATION", url: "https://festival.example.test/inscriere", labelRo: "Înscrie-te la 10 km", labelEn: "Sign up for the 10 km" }],
    };
    currentLocale = "en";
    const html = renderToStaticMarkup(await EventFacts({ event: event({ coHosts: [labelled] }), now: NOW, stacked: true }));
    expect(html).toContain("Sign up for the 10 km");
    expect(html).not.toContain("Register with");
  });

  it("shows a described partner with no links as its name and its description", async () => {
    currentLocale = "ro";
    const html = renderToStaticMarkup(await EventFacts({ event: event({ coHosts: [{ ...FESTIVAL, links: [] }] }), now: NOW, stacked: true }));
    expect(html).toContain("Brașov Running Festival");
    expect(html).toContain("Alergăm împreună duminică, la festival.");
    expect(html).not.toContain("<a ");
  });

  it("keeps the one-line forms — the listing card and the featured hero — to the names alone", async () => {
    currentLocale = "ro";
    const card = renderToStaticMarkup(await EventFacts({ event: event({ coHosts: [FESTIVAL] }), now: NOW, variant: "compact" }));
    const hero = renderToStaticMarkup(await EventFacts({ event: event({ coHosts: [FESTIVAL] }), now: NOW }));
    for (const html of [card, hero]) {
      expect(html).toContain("Brașov Running Festival");
      expect(html).not.toContain("Alergăm");
      expect(html).not.toContain("Înscriere la Brașov Running Festival");
    }
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

describe("BR-REQ-011-01 criterion 16 the featured hero's mention (§344 partners with many links)", () => {
  /**
   * The hero on the listing draws the full facts, but not stacked: it is a summary above the
   * fold with a button to reach, like the cards, so its partners are the cards' one sentence —
   * never the event page's column of every partner's links.
   */
  it("keeps the one-line sentence, one link per partner, no host captions and no link rows", async () => {
    const html = renderToStaticMarkup(await EventFacts({ event: event({ coHosts: TWO_PARTNERS }), now: NOW }));
    expect(html.match(/Împreună cu/g)).toHaveLength(1);
    expect(html).toContain("Brașov Marathon");
    expect(html).toContain("Salvamont");
    // Not the card of links: neither the kind's word, the club's own label, nor the host under it.
    expect(html).not.toContain("Site-ul partenerului");
    expect(html).not.toContain("Pagina noastră");
    expect(html).not.toContain("facebook.com");
    // One anchor for the partner that has links — its site, its primary link — and none for the other.
    const anchors = [...html.matchAll(/<a\b[^>]*>/g)].map((match) => match[0]);
    expect(anchors).toHaveLength(1);
    expect(anchors[0]).toContain('href="https://bm.example.test"');
    // And the two names joined the way Romanian joins a list, in one sentence.
    expect(html).toMatch(/Brașov Marathon<\/a> și Salvamont/);
  });

  it("is what FeaturedEventHero asks for: the full facts, never stacked", () => {
    const hero = readFileSync("src/modules/events/ui/FeaturedEventHero.tsx", "utf8");
    const call = /<EventFacts\b[^>]*\/>/.exec(hero)?.[0] ?? "";
    expect(call).toContain("event={event}");
    expect(call).not.toContain("stacked");
  });
});
