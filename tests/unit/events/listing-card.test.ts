import { createElement, type ReactNode } from "react";
import { renderToReadableStream, renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PublicEvent } from "@/modules/events/repository";

/**
 * BR-REQ-041-01 (§NNN) — the listing's two cards, rendered on the server as the page renders them.
 *
 * The owner, 2026-09-24, with a screenshot of the listing's two-column grid: "There is too much
 * whitespace on these cards, it needs to be better spaced". What it showed: the door pushed to the
 * foot of a stretched card with a hole above it; a series card's title a bare, visited-purple,
 * underlined link beside a single card's black one; the surface on a chip at the top and the facts
 * as a line of middle dots; a ninety-character registration address wrapped over two lines of a
 * summary. Each is asserted here on the markup, and `listing-cards.spec.ts` measures the same cards
 * in a browser at 320 pixels and on a desktop.
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

/** The locale-aware link, as a plain anchor: the cards hand it `/events/[slug]` and a slug. */
vi.mock("@/i18n/navigation", () => {
  const path = (href: { params?: { slug?: string } }) => `/${currentLocale}/evenimente/${href.params?.slug ?? ""}`;
  return {
    getPathname: ({ href }: { href: { params?: { slug?: string } } }) => path(href),
    Link: ({ href, children }: { href: { params?: { slug?: string } }; children: ReactNode }) => createElement("a", { href: path(href) }, children),
  };
});

const { default: EventCard } = await import("@/modules/events/ui/EventCard");
const { default: SeriesCard } = await import("@/modules/events/ui/SeriesCard");
const { default: RichText } = await import("@/modules/content/rich-text/ui/RichText");
const { shortenUrls } = await import("@/modules/content/rich-text/domain/short-url");
const { CARD_STRETCHED_TITLE_SX, CARD_TITLE_SX } = await import("@/modules/events/ui/card-layout");

afterEach(() => {
  currentLocale = "ro";
});

const NOW = new Date("2026-09-24T09:00:00.000Z");
const HAKU = "https://register.hakuapp.com/?event=c9a8e7f6d5c4b3a2a1b0c9d8e7f6a5b4-happy-monday-2026";

/** The owner's screenshot, as rows: a Monday run at 18:30 in Brașov, 8 km, 250 m, moderate, free. */
function event(overrides: Partial<PublicEvent> = {}): PublicEvent {
  return {
    id: "22222222-2222-2222-2222-222222222222",
    type: "GROUP_RUN",
    surface: "ASPHALT",
    eventStatus: "SCHEDULED",
    startsAt: new Date("2026-09-28T15:30:00Z"),
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
    elevationGainMeters: 250,
    registrationMode: "NONE",
    registrationOpensAt: null,
    registrationClosesAt: null,
    externalRegistrationUrl: null,
    externalProvider: null,
    minAge: 14,
    slug: "happy-monday-0",
    title: "Happy Monday",
    excerpt: null,
    excerptJson: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "O oră de alergare ușoară. Tricoul se comandă aici: " },
            { type: "text", text: HAKU, marks: [{ type: "link", attrs: { href: HAKU } }] },
            { type: "text", text: ". Detalii " },
            { type: "text", text: "pe pagina clubului", marks: [{ type: "link", attrs: { href: "https://club.example.test/detalii" } }] },
            { type: "text", text: "." },
          ],
        },
      ],
    },
    locationName: "Parcul Titulescu, la fântâna arteziană",
    locationAddress: null,
    locationToBeAnnounced: false,
    difficulty: "MODERATE",
    costType: "FREE",
    costAmount: null,
    costUrl: null,
    publishedAt: NOW,
    ...overrides,
  } as PublicEvent;
}

/** Eight Mondays at 18:30 in Brașov, the first on 28 September — "Happy Monday", one card (§113). */
function series(): PublicEvent[] {
  const mondays = ["2026-09-28T15:30:00Z", "2026-10-05T15:30:00Z", "2026-10-12T15:30:00Z"];
  return mondays.map((startsAt, index) => event({ id: `3333333${index}-3333-3333-3333-333333333333`, slug: `happy-monday-${index}`, startsAt: new Date(startsAt) }));
}

const withoutStyles = (html: string) => html.replace(/<style[^>]*>[\s\S]*?<\/style>/g, "");
const text = (fragment: string) => fragment.replace(/<[^>]+>/g, "");
const anchors = (html: string) => [...withoutStyles(html).matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/g)].map(([tag, inner]) => ({ tag, text: text(inner) }));
/** The words of every chip, in order. */
const chipLabels = (html: string) => [...withoutStyles(html).matchAll(/class="MuiChip-label[^"]*"[^>]*>([^<]*)</g)].map((match) => match[1]);

/**
 * A card's markup. The cards are async Server Components holding other async ones (the chips, the
 * facts), which the synchronous `renderToStaticMarkup` cannot wait for; the streaming renderer
 * can, and `allReady` is the moment everything has resolved.
 */
async function markup(node: ReactNode): Promise<string> {
  const stream = await renderToReadableStream(node);
  await stream.allReady;
  return new Response(stream).text();
}

const single = async (overrides: Partial<PublicEvent> = {}) => markup(createElement(EventCard, { event: event(overrides), index: 0, now: NOW }));
const repeated = async () => markup(createElement(SeriesCard, { members: series(), index: 0, now: NOW }));

describe("BR-REQ-041-01 a web address on a card is its host (§NNN)", () => {
  it("shortens an address to its host, and says there is more", () => {
    expect(shortenUrls(`aici: ${HAKU}`)).toBe("aici: register.hakuapp.com/…");
    expect(shortenUrls("https://www.example.ro")).toBe("example.ro");
    expect(shortenUrls("https://example.ro/")).toBe("example.ro");
    expect(shortenUrls("https://example.ro/traseu.gpx")).toBe("example.ro/…");
  });

  it("keeps the sentence's own punctuation, and every word that is not an address", () => {
    expect(shortenUrls(`Înscrieri: ${HAKU}. Vă așteptăm!`)).toBe("Înscrieri: register.hakuapp.com/…. Vă așteptăm!");
    expect(shortenUrls("(vezi https://example.ro/a)")).toBe("(vezi example.ro/…)");
    expect(shortenUrls("Nimic de scurtat aici, doar 10 km.")).toBe("Nimic de scurtat aici, doar 10 km.");
    expect(shortenUrls("a https://one.ro/x and https://two.ro")).toBe("a one.ro/… and two.ro");
  });

  it("renders a summary without links on a card, and with them everywhere else", () => {
    const doc = event().excerptJson;
    const card = withoutStyles(renderToStaticMarkup(createElement(RichText, { body: doc, links: false })));
    expect(card).not.toContain("<a ");
    expect(text(card)).toBe("O oră de alergare ușoară. Tricoul se comandă aici: register.hakuapp.com/…. Detalii pe pagina clubului.");
    const page = withoutStyles(renderToStaticMarkup(createElement(RichText, { body: doc })));
    expect(page).toContain(`href="${HAKU}"`);
    expect(text(page)).toContain(HAKU);
  });
});

describe("BR-REQ-041-01 the single-date card (§NNN)", () => {
  it("is two links — the title and the door — to the same page, and nothing is a link inside a link", async () => {
    const html = await single();
    const links = anchors(html);
    expect(links.map((link) => link.text)).toEqual(["Happy Monday", "Descrierea completă a evenimentului"]);
    for (const link of links) expect(link.tag).toContain('href="/ro/evenimente/happy-monday-0"');
    // No anchor opens before the one before it has closed.
    expect(withoutStyles(html)).not.toMatch(/<a\b(?:(?!<\/a>)[\s\S])*<a\b/);
  });

  it("makes the title the card's one press: its box is stretched over the card, and the door stands above it", async () => {
    expect(CARD_STRETCHED_TITLE_SX["& a"]["&::after"]).toEqual({ content: '""', position: "absolute", inset: 0 });
    const html = await single();
    // The card is the box the title's `::after` fills.
    expect(html).toMatch(/position:relative/);
    expect(html).toMatch(/z-index:1/);
  });

  it("says the surface once, as a pill with the facts, and keeps the type's chip at the top", async () => {
    const html = await single();
    expect(chipLabels(html)).toEqual(["Alergare de grup", "8 km", "250 m D+", "Mediu", "Asfalt", "Gratuit"]);
    expect(chipLabels(html).filter((label) => label === "Asfalt")).toHaveLength(1);
  });

  it("carries its marks at the top: special, cancelled", async () => {
    const html = await single({ isSpecial: true, eventStatus: "CANCELLED" });
    expect(chipLabels(html).slice(0, 3)).toEqual(["Alergare de grup", "Ediție specială", "Anulat"]);
  });

  it("prints the summary with no link and the address as its host", async () => {
    const html = withoutStyles(await single());
    const summary = /<div\b[^>]*data-testid="card-excerpt"[^>]*>([\s\S]*?)<\/div>/.exec(html)?.[1] ?? "";
    expect(summary).not.toContain("<a ");
    expect(text(summary)).toContain("register.hakuapp.com/…");
    expect(html).not.toContain("https://register.hakuapp.com");
  });

  it("puts the pin and the place in one line", async () => {
    const html = withoutStyles(await single());
    const where = /<div\b[^>]*data-fact="where"[^>]*>([\s\S]*?)<\/div><\/div>/.exec(html)?.[1] ?? "";
    expect(where).toContain('data-testid="PlaceIcon"');
    expect(text(where)).toBe("Parcul Titulescu, la fântâna arteziană");
  });

  it("in English too", async () => {
    currentLocale = "en";
    const html = await single();
    expect(chipLabels(html)).toEqual(["Group run", "8 km", "250 m climb", "Moderate", "Asphalt", "Free"]);
    expect(anchors(html).at(-1)?.text).toBe("Full event description");
  });
});

describe("BR-REQ-041-01 the series card (§NNN)", () => {
  it("reads, in order: the chips, the title, the rhythm, the summary, «Următoarea:» with the date on one line, the place, the pills, the dates, the door", async () => {
    const words = text(withoutStyles(await repeated()));
    const order = [
      "Alergare de grup",
      "Săptămânal",
      "Happy Monday",
      "În fiecare luni, la 18:30",
      "O oră de alergare ușoară",
      "Următoarea:Luni, 28 sept. 2026·18:30",
      "Parcul Titulescu, la fântâna arteziană",
      "8 km",
      "Gratuit",
      "Următoarele date (3)",
      "Descrierea completă a evenimentului",
    ];
    const positions = order.map((piece) => words.indexOf(piece));
    for (const [index, piece] of order.entries()) expect(positions[index], piece).toBeGreaterThanOrEqual(0);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    // «Următoarea» is not a line of its own any more.
    const when = /<div\b[^>]*data-fact="when"[^>]*>([\s\S]*?)<\/div><\/div>/.exec(withoutStyles(await repeated()))?.[1] ?? "";
    expect(text(when)).toBe("Următoarea:Luni, 28 sept. 2026·18:30");
  });

  it("says the surface once, as a pill, and the rhythm on its chip", async () => {
    const labels = chipLabels(await repeated());
    expect(labels.slice(0, 2)).toEqual(["Alergare de grup", "Săptămânal"]);
    expect(labels.filter((label) => label === "Asfalt")).toHaveLength(1);
  });

  it("titles itself exactly as the single card does — one size, one weight, the text's colour, underlined only under a pointer or the keyboard", async () => {
    // The stretched title is the plain one plus its `::after`, and nothing else.
    const { "&::after": after, ...link } = CARD_STRETCHED_TITLE_SX["& a"];
    expect(after).toBeDefined();
    expect(link).toEqual(CARD_TITLE_SX["& a"]);
    const heading = (sx: object) => Object.fromEntries(Object.entries(sx).filter(([key]) => key !== "& a"));
    expect(heading(CARD_STRETCHED_TITLE_SX)).toEqual(heading(CARD_TITLE_SX));
    expect(CARD_TITLE_SX["& a"]).toMatchObject({ color: "text.primary", textDecoration: "none", minHeight: 44 });
    expect(CARD_TITLE_SX["& a"]["&:hover"]).toEqual({ textDecoration: "underline" });
    expect(CARD_TITLE_SX["& a"]["&:focus-visible"]).toMatchObject({ textDecoration: "underline" });
    // …and both cards wear it: the series card the plain one, in an h2 around its one title link.
    const html = await repeated();
    expect(withoutStyles(html)).toMatch(/<h2\b[^>]*><a href="\/ro\/evenimente\/happy-monday-0">Happy Monday<\/a><\/h2>/);
    expect(html).toMatch(/color:rgba\(0, 0, 0, 0\.87\)/);
    expect(html).toMatch(/text-decoration:none/);
  });

  it("offers every date as its own link inside the fold, and no link inside a link", async () => {
    const html = await repeated();
    const links = anchors(html).map((link) => link.text);
    expect(links[0]).toBe("Happy Monday");
    expect(links.at(-1)).toBe("Descrierea completă a evenimentului");
    expect(links).toContain("Lun., 5 oct. 2026");
    expect(withoutStyles(html)).not.toMatch(/<a\b(?:(?!<\/a>)[\s\S])*<a\b/);
  });
});
