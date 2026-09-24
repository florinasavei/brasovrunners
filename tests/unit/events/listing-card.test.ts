import { readFileSync } from "node:fs";
import { createTheme } from "@mui/material/styles";
import { createElement, type ReactNode } from "react";
import { renderToReadableStream, renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PublicEvent } from "@/modules/events/repository";

/**
 * BR-REQ-041-01 (§366) — the listing's two cards, rendered on the server as the page renders them.
 *
 * The owner, 2026-09-24, with a screenshot of the listing's two-column grid: "There is too much
 * whitespace on these cards, it needs to be better spaced"; then, of the one-off "Trail to Road cu
 * Brașov Running Festival" beside two series cards: "I do not see the google maps link for this
 * event, although I've put the maps URL", "for the time I would like a clock icon as well", "I am
 * missing the blue link for this event, why?", and of the card's facts line beside the event page's
 * pills: "this is currently pretty ugly!". What the screenshot showed: the one-off card one `<a>`
 * wrapping everything, its title a black heading, its place no link, a pin alone on a line, the
 * route as a line of middle dots with the partner's sentence among the numbers, the door pinned to
 * the foot of a stretched card with a hole above it. Each is asserted here on the markup, and
 * `listing-cards.spec.ts` measures the same cards in a browser at 320 pixels and on a desktop.
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
const { CARD_TITLE_SX, LINE_GAP } = await import("@/modules/events/ui/card-layout");
const { CARD_EXCERPT_SX } = await import("@/modules/events/ui/EventExcerpt");

afterEach(() => {
  currentLocale = "ro";
});

const NOW = new Date("2026-09-24T09:00:00.000Z");
const HAKU = "https://register.hakuapp.com/?event=c9a8e7f6d5c4b3a2a1b0c9d8e7f6a5b4-happy-monday-2026";
const MAP = "https://maps.app.goo.gl/TrailToRoadPiata";
/** The primary colour a test render resolves to: MUI's default theme, since no provider wraps it. */
const PRIMARY = createTheme().palette.primary.main;

/** A group run's row, the fields the cards read. */
function row(overrides: Partial<PublicEvent> = {}): PublicEvent {
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

/**
 * The owner's one-off card: "Trail to Road cu Brașov Running Festival", Sunday 27 September at
 * 10:00 on Piața Sfatului, with the Google Maps link the club pasted, held with the festival, 8 km,
 * 250 m of climb, moderate, on mixed ground, free.
 */
function trailToRoad(overrides: Partial<PublicEvent> = {}): PublicEvent {
  return row({
    id: "44444444-4444-4444-4444-444444444444",
    slug: "trail-to-road",
    title: "Trail to Road cu Brașov Running Festival",
    startsAt: new Date("2026-09-27T07:00:00Z"),
    locationName: "Piața Sfatului, Brașov",
    mapUrl: MAP,
    surface: "MIXED",
    coHosts: [{ name: "Brașov Running Festival", links: [{ kind: "SITE", url: "https://festival.example.test" }] }],
    ...overrides,
  });
}

/** Mondays at 18:30 in Brașov, the first on 28 September — "Happy Monday", one card (§113). */
function series(): PublicEvent[] {
  const mondays = ["2026-09-28T15:30:00Z", "2026-10-05T15:30:00Z", "2026-10-12T15:30:00Z"];
  return mondays.map((startsAt, index) =>
    row({ id: `3333333${index}-3333-3333-3333-333333333333`, slug: `happy-monday-${index}`, startsAt: new Date(startsAt), mapUrl: "https://maps.example.test/titulescu" }),
  );
}

// `[\s\S]` rather than the `s` flag: `next build` type-checks the tests against an older target.
const withoutStyles = (html: string) => html.replace(/<style[^>]*>[\s\S]*?<\/style>/g, "");
const text = (fragment: string) => fragment.replace(/<[^>]+>/g, "");
const anchors = (html: string) =>
  [...withoutStyles(html).matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map(([, attributes, inner]) => ({
    href: /href="([^"]*)"/.exec(attributes)?.[1],
    attributes,
    text: text(inner),
  }));
/** The words of every chip, in order. */
const chipLabels = (html: string) => [...withoutStyles(html).matchAll(/class="MuiChip-label[^"]*"[^>]*>([^<]*)</g)].map((match) => match[1]);
/** Where the facts end: the series card's fold, or the door to the page. */
const AFTER_FACTS = /<details\b|<a\b[^>]*>(?:<svg\b[\s\S]*?<\/svg>)?(?:Descrierea completă|Full event description)/;
/** One fact line of the card (`data-fact`), from its opening tag up to the next line or the end of the facts. */
function fact(html: string, key: string): string {
  const markup = withoutStyles(html);
  const open = new RegExp(`<[^<>]*\\bdata-fact="${key}"[^>]*>`).exec(markup);
  if (!open) throw new Error(`no fact ${key}`);
  const rest = markup.slice(open.index + open[0].length);
  const stop = rest.search(new RegExp(`<[^<>]*\\bdata-fact="|${AFTER_FACTS.source}`));
  return open[0] + (stop < 0 ? rest : rest.slice(0, stop));
}
/** The facts block: from its start to the first thing after it (the fold or the door). */
function facts(html: string): string {
  const markup = withoutStyles(html);
  const start = markup.indexOf('data-testid="card-facts"');
  expect(start).toBeGreaterThan(0);
  const rest = markup.slice(start);
  return rest.slice(0, rest.search(AFTER_FACTS));
}
/** The CSS rules Emotion emitted for a class, joined — `.css-x a{…}`, `.css-x a:hover{…}` and so on. */
function rulesFor(html: string, cls: string): string {
  return [...html.matchAll(new RegExp(`\\.${cls}([^{]*)\\{([^}]*)\\}`, "g"))].map(([, selector, body]) => `${selector}{${body}}`).join("\n");
}
/** The Emotion class of the `<h2>` that holds a card's title. */
const titleClass = (html: string) => /<h2\b[^>]*class="[^"]*\b(css-[\w-]+)"/.exec(withoutStyles(html))?.[1] ?? "";

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

const single = async (overrides: Partial<PublicEvent> = {}) => markup(createElement(EventCard, { event: trailToRoad(overrides), index: 0, now: NOW }));
const repeated = async () => markup(createElement(SeriesCard, { members: series(), index: 0, now: NOW }));

describe("BR-REQ-041-01 a web address on a card is its host (§366)", () => {
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
    const doc = row().excerptJson;
    const card = withoutStyles(renderToStaticMarkup(createElement(RichText, { body: doc, links: false })));
    expect(card).not.toContain("<a ");
    expect(text(card)).toBe("O oră de alergare ușoară. Tricoul se comandă aici: register.hakuapp.com/…. Detalii pe pagina clubului.");
    const page = withoutStyles(renderToStaticMarkup(createElement(RichText, { body: doc })));
    expect(page).toContain(`href="${HAKU}"`);
    expect(text(page)).toContain(HAKU);
  });
});

describe("BR-REQ-041-01 the one-off card is the series card's structure (§366)", () => {
  it("is no whole-card link: the title, the place and the door are three links side by side, none inside another", async () => {
    const html = withoutStyles(await single());
    const links = anchors(html);
    expect(links.map((link) => link.text)).toEqual(["Trail to Road cu Brașov Running Festival", "Piața Sfatului, Brașov", "Descrierea completă a evenimentului"]);
    expect(links.map((link) => link.href)).toEqual(["/ro/evenimente/trail-to-road", MAP, "/ro/evenimente/trail-to-road"]);
    // No anchor opens before the one before it has closed, and none holds the heading.
    expect(html).not.toMatch(/<a\b(?:(?!<\/a>)[\s\S])*<a\b/);
    expect(html).not.toMatch(/<a\b(?:(?!<\/a>)[\s\S])*<h2\b/);
    // The card itself is the list item, not a link, and nothing is stretched over it.
    expect(html).toMatch(/^<li\b/);
    expect(await single()).not.toMatch(/::after\{[^}]*position:absolute/);
  });

  it("makes the title the link, in the heading, in the theme's blue visited or not, underlined only under a pointer or the keyboard", async () => {
    const html = await single();
    expect(withoutStyles(html)).toMatch(/<h2\b[^>]*><a href="\/ro\/evenimente\/trail-to-road">Trail to Road cu Brașov Running Festival<\/a><\/h2>/);
    const rules = rulesFor(html, titleClass(html));
    expect(rules).toMatch(new RegExp(` a\\{[^}]*color:${PRIMARY}`));
    expect(rules).toMatch(/ a\{[^}]*text-decoration:none/);
    expect(rules).toMatch(new RegExp(` a:visited\\{color:${PRIMARY}`));
    expect(rules).toMatch(/ a:hover\{[^}]*;text-decoration:underline/);
    expect(rules).toMatch(/ a:focus-visible\{[^}]*;text-decoration:underline/);
    // 44 pixels to a thumb, given back as margin so the line is as tall as its words: ten above the
    // words, and below them a line's gap and no more (§366) — the nearest anything sits under a title.
    // The 44 includes the padding, said on the link: inside the listing's fold everything is
    // content-box, and there the link was 62 pixels and the heading 44 tall rather than 26 (§366).
    expect(rules).toMatch(/ a\{[^}]*box-sizing:border-box/);
    expect(rules).toMatch(/ a\{[^}]*min-height:44px/);
    expect(rules).toMatch(/ a\{[^}]*padding-top:10px/);
    expect(rules).toMatch(/ a\{[^}]*margin-top:-10px/);
    expect(rules).toMatch(/ a\{[^}]*padding-bottom:8px/);
    expect(rules).toMatch(/ a\{[^}]*margin-bottom:-8px/);
    expect(CARD_TITLE_SX["& a"]).toMatchObject({ color: "primary.main", textDecoration: "none", minHeight: 44, pb: LINE_GAP, mb: -LINE_GAP });
  });

  it("puts nothing nearer under the title than its link reaches: the summary a line's gap below, the facts a group's (§366)", async () => {
    // Whatever follows the title paints over it and takes a press on the pixels they share, so the
    // gap under the title's words is never less than the link's reach below them.
    expect(CARD_EXCERPT_SX.mt).toBe(LINE_GAP);
    const html = await single({ excerptJson: null, excerpt: null });
    // With no summary the facts follow, a group's gap below.
    const markup = withoutStyles(html);
    const after = markup.slice(markup.indexOf("</h2>") + "</h2>".length);
    const facts = /^<div\b[^>]*class="[^"]*\b(css-[\w-]+)"/.exec(after)?.[1] ?? "";
    expect(rulesFor(html, facts)).toContain("margin-top:12px");
  });

  it("titles itself exactly as the series card does — one class, one size, one weight, one blue", async () => {
    const one = await single();
    const many = await repeated();
    expect(titleClass(one)).not.toBe("");
    expect(titleClass(one)).toBe(titleClass(many));
    expect(withoutStyles(many)).toMatch(/<h2\b[^>]*><a href="\/ro\/evenimente\/happy-monday-0">Happy Monday<\/a><\/h2>/);
  });

  it("puts the pin and the place in one line element, the place a link to the map the club pasted", async () => {
    const where = fact(await single(), "where");
    // The glyph and the words are the two children of one flex row: the pin stays on the words'
    // first line, never alone on a line of its own.
    expect(where).toMatch(/^<div\b[^>]*data-fact="where"[^>]*><svg\b[^>]*data-testid="PlaceIcon"[^>]*>[\s\S]*?<\/svg><div\b[^>]*><a\b/);
    const [place] = anchors(where);
    expect(place?.href).toBe(MAP);
    expect(place?.text).toBe("Piața Sfatului, Brașov");
    expect(place?.attributes).toContain('target="_blank"');
    expect(place?.attributes).toContain('rel="noopener noreferrer"');
  });

  it("says the place in words, with its pin, when the club pasted no map — and only the sentence while it is to be announced", async () => {
    const plain = fact(await single({ mapUrl: null }), "where");
    expect(plain).not.toContain("<a ");
    expect(text(plain)).toBe("Piața Sfatului, Brașov");
    const later = fact(await single({ locationToBeAnnounced: true, locationName: null, mapUrl: null }), "where");
    expect(text(later)).toBe("Locația se anunță în curând");
  });

  it("puts a clock beside the time, on the date's line: «Duminică, 27 sept. 2026 · [clock] 10:00»", async () => {
    const when = fact(await single(), "when");
    expect(when).toContain('data-testid="CalendarMonthIcon"');
    expect(when).toContain('data-testid="ScheduleIcon"');
    // The clock comes after the date and before the time.
    expect(when.indexOf("2026")).toBeLessThan(when.indexOf('data-testid="ScheduleIcon"'));
    expect(when.indexOf('data-testid="ScheduleIcon"')).toBeLessThan(when.indexOf("10:00"));
    // The event is within the coming twelve months of `NOW`, so the card carries both renderings
    // of the date — the full one and the year dropped (§366, amended §375) — CSS shows one at a
    // time by width; both are in the text a crude tag-strip reads.
    expect(text(when)).toContain("Duminică, 27 sept. 2026");
    expect(text(when)).toContain("10:00");
  });

  it("never wraps the when line onto a second line, except a race's two named times (§366, amended §375 — the owner: \"This should be on a single line on a phone\")", () => {
    // `flow`'s row is `nowrap` only for a card, and only while it is not a race's two named
    // times (`card.wrap`, which stays `wrap` so a race's start time cannot be clipped, §366
    // amended §375) — and its glyphs and pieces never shrink, so the row cannot break inside a
    // piece, only between whole ones.
    const source = readFileSync("src/modules/events/ui/EventFacts.tsx", "utf8");
    expect(source).toMatch(/flexWrap:\s*card\s*&&\s*!card\.wrap\s*\?\s*"nowrap"\s*:\s*"wrap"/);
    expect(source).toContain("flexShrink: 0");
  });

  it("wraps the when line rather than clip it, for a date more than a year out that keeps its year (a review, 2026-09-24)", async () => {
    // More than 365 days ahead of `NOW`: the card keeps the year («Sâmbătă, 26 sept. 2027 · 08:00»)
    // and, kept whole under `nowrap`, would run past the card's width and be cut by its own
    // `overflow: hidden`. `wrap: !!event.raceStartsAt || (compact && !dateShort)` catches it too,
    // not only a race's two named times.
    const html = await single({ startsAt: new Date("2027-09-26T05:00:00Z") });
    const when = fact(html, "when");
    expect(text(when)).toContain("2027");
    // The flow row's own class — the second `MuiBox-root` inside the fact, the first being the
    // `minWidth: 0` wrapper `cardLine` gives every value: `flex-wrap:wrap`, not `nowrap`.
    const rowClass = [...when.matchAll(/class="MuiBox-root (css-[\w-]+)"/g)][1]?.[1];
    expect(rowClass, "the flow row's own emotion class").toBeTruthy();
    expect(rulesFor(html, rowClass!)).toContain("flex-wrap:wrap");
    expect(rulesFor(html, rowClass!)).not.toContain("flex-wrap:nowrap");
  });

  it("wraps a past event's when line too: a past date keeps its year, and «Duminică, 20 sept. 2026 · 07:00» does not fit a 320-pixel card (a review, 2026-09-24)", async () => {
    // A date before `NOW` also carries its year (`dateWithinYear` requires a non-negative
    // difference). Measured in Chromium: "Duminică, 27 sept. 2026 · [clock] 18:30" is 227 pixels
    // against the 226 a 320-pixel card leaves the row, and with a series' lead in front 310
    // against a 360-pixel card's 266 — so every year-carrying card may wrap between whole pieces.
    // Flex wrapping breaks the line only when the row does not fit, so one that fits stays one line.
    const html = await single({ startsAt: new Date("2026-08-30T05:00:00Z") });
    const when = fact(html, "when");
    expect(text(when)).toContain("Duminică, 30 aug. 2026");
    // One rendering only: no year-less copy for a past date.
    expect([...when.matchAll(/Duminică, 30 aug\./g)]).toHaveLength(1);
    const rowClass = [...when.matchAll(/class="MuiBox-root (css-[\w-]+)"/g)][1]?.[1];
    expect(rowClass, "the flow row's own emotion class").toBeTruthy();
    expect(rulesFor(html, rowClass!)).toContain("flex-wrap:wrap");
    expect(rulesFor(html, rowClass!)).not.toContain("flex-wrap:nowrap");
  });

  it("draws the route and the cost as the page's pills, in order — surface, difficulty, distance, climb, cost — and says the surface once, not also a chip at the top", async () => {
    const html = await single();
    // The partner's handshake chip sits among the marks at the top (§367); the facts are the pills.
    expect(chipLabels(html)).toEqual(["Alergare de grup", "Eveniment în parteneriat", "Mixt", "Mediu", "8 km", "250 m D+", "Gratuit"]);
    expect(chipLabels(fact(html, "pills"))).toEqual(["Mixt", "Mediu", "8 km", "250 m D+", "Gratuit"]);
    // No middle dot between them and none of the old line's long words.
    expect(text(fact(html, "pills"))).not.toContain("·");
    expect(html).not.toContain("diferență de nivel");
  });

  it("keeps the partner out of the facts: no «Împreună cu» between the place and the kilometres", async () => {
    const block = facts(await single());
    expect(block).not.toContain("Împreună cu");
    expect(block).not.toContain("Brașov Running Festival");
    expect(block).not.toContain("festival.example.test");
    expect(block).not.toContain('data-testid="HandshakeIcon"');
  });

  it("carries its marks at the top: special, cancelled, the partner marker never a name (§367, amended §375)", async () => {
    const html = await single({ isSpecial: true, eventStatus: "CANCELLED" });
    expect(chipLabels(html).slice(0, 4)).toEqual(["Alergare de grup", "Ediție specială", "Eveniment în parteneriat", "Anulat"]);
  });

  it("prints the summary with no link and the address as its host", async () => {
    const html = withoutStyles(await single({ excerptJson: row().excerptJson }));
    const summary = /<div\b[^>]*data-testid="card-excerpt"[^>]*>([\s\S]*?)<\/div>/.exec(html)?.[1] ?? "";
    expect(summary).not.toContain("<a ");
    expect(text(summary)).toContain("register.hakuapp.com/…");
    expect(html).not.toContain("https://register.hakuapp.com");
  });

  it("ends its facts with the state of registration, after the pills, on an event that takes registrations (BR-REQ-011-01 criterion 18)", async () => {
    const html = await single({ type: "RACE", registrationMode: "INTERNAL", registrationOpensAt: new Date("2026-10-01T15:00:00Z") });
    const block = facts(html);
    const keys = [...block.matchAll(/data-fact="(\w+)"/g)].map((match) => match[1]);
    expect(keys).toEqual(["when", "where", "pills", "registration"]);
    expect(text(fact(html, "registration"))).toBe("Înscrierile se deschid pe joi, 1 oct. 2026, 18:00");
  });

  it("in English too", async () => {
    currentLocale = "en";
    const html = await single();
    expect(chipLabels(html)).toEqual(["Group run", "Partnered event", "Mixed", "Moderate", "8 km", "250 m climb", "Free"]);
    expect(anchors(html).map((link) => link.text)).toEqual(["Trail to Road cu Brașov Running Festival", "Piața Sfatului, Brașov", "Full event description"]);
    // ICU versions disagree on September's abbreviation in English ("Sep" / "Sept"); the rest is fixed.
    expect(text(fact(html, "when"))).toMatch(/^Sunday, 27 Sept? 2026Sunday, 27 Sept?·10:00$/);
    expect(fact(html, "when")).toContain('data-testid="ScheduleIcon"');
  });
});

describe("BR-REQ-041-01 the series card (§366)", () => {
  it("reads, in order: the chips, the title, the rhythm, the summary, «Următoarea:» with the date and the time on one line, the place, the pills, the dates, the door", async () => {
    const html = await repeated();
    const words = text(withoutStyles(html));
    const order = [
      "Alergare de grup",
      "Săptămânal",
      "Happy Monday",
      "În fiecare luni, la 18:30",
      "O oră de alergare ușoară",
      // The date is within the coming twelve months of `NOW`, so both renderings are in the
      // markup — the full one, then the year dropped (§366, amended §375) — CSS shows one at a
      // time by width.
      "Următoarea:Luni, 28 sept. 2026Luni, 28 sept.·18:30",
      "Parcul Titulescu, la fântâna arteziană",
      "8 km",
      "Gratuit",
      "Următoarele date (3)",
      "Descrierea completă a evenimentului",
    ];
    const positions = order.map((piece) => words.indexOf(piece));
    for (const [index, piece] of order.entries()) expect(positions[index], piece).toBeGreaterThanOrEqual(0);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    // «Următoarea» is not a line of its own any more: it leads the date's line, and the clock the time.
    const when = fact(html, "when");
    expect(text(when)).toBe("Următoarea:Luni, 28 sept. 2026Luni, 28 sept.·18:30");
    expect(when).toContain('data-testid="ScheduleIcon"');
    // The row never wraps: nowrap, and every glyph and piece kept whole (§366, amended §375).
    expect(when).toContain("white-space:nowrap");
  });

  it("sets the rhythm a line's gap under the title — no nearer than the title's link reaches, so the line never sits on it (§366)", async () => {
    const html = await repeated();
    const rhythm = /<p\b[^>]*class="[^"]*\b(css-[\w-]+)"[^>]*>În fiecare luni, la 18:30<\/p>/.exec(withoutStyles(html))?.[1] ?? "";
    expect(rhythm).not.toBe("");
    // Eight pixels: `LINE_GAP`, one of the card's two gaps, and the title link's reach below its words.
    expect(rulesFor(html, rhythm)).toContain("margin-top:8px");
    expect(rulesFor(html, titleClass(html))).toMatch(/ a\{[^}]*margin-bottom:-8px/);
  });

  it("links its place to the map, with the pin on the same line", async () => {
    const where = fact(await repeated(), "where");
    expect(where).toContain('data-testid="PlaceIcon"');
    expect(anchors(where).map((link) => link.href)).toEqual(["https://maps.example.test/titulescu"]);
  });

  it("says the surface once, as a pill, and the rhythm on its chip", async () => {
    const labels = chipLabels(await repeated());
    expect(labels.slice(0, 2)).toEqual(["Alergare de grup", "Săptămânal"]);
    expect(labels.filter((label) => label === "Asfalt")).toHaveLength(1);
  });

  it("offers every date as its own link inside the fold, and no link inside a link", async () => {
    const html = await repeated();
    const links = anchors(html).map((link) => link.text);
    expect(links[0]).toBe("Happy Monday");
    expect(links[1]).toBe("Parcul Titulescu, la fântâna arteziană");
    expect(links.at(-1)).toBe("Descrierea completă a evenimentului");
    expect(links).toContain("Lun., 5 oct. 2026");
    expect(withoutStyles(html)).not.toMatch(/<a\b(?:(?!<\/a>)[\s\S])*<a\b/);
  });

  it("gives every date in the fold a link at least 44 by 44 around its small pill, not the 24-pixel pill as the link (BR-REQ-041-01 criterion 6, §366)", async () => {
    const html = await repeated();
    const markup = withoutStyles(html);
    const fold = markup.slice(markup.indexOf("<details"), markup.indexOf("</details>"));
    const dates = [...fold.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)];
    expect(dates.map(([, , inner]) => text(inner))).toEqual(["Lun., 28 sept. 2026", "Lun., 5 oct. 2026", "Lun., 12 oct. 2026"]);
    for (const [, attributes, inner] of dates) {
      // The pill is a picture inside the link — a `<span>` — and the link is not a chip itself.
      expect(attributes).not.toContain("MuiChip");
      expect(inner).toMatch(/^<span\b[^>]*class="[^"]*\bMuiChip-root\b[^"]*\bMuiChip-sizeSmall\b/);
      const rules = rulesFor(html, /class="[^"]*\b(css-[\w-]+)"/.exec(attributes)?.[1] ?? "none");
      expect(rules).toContain("min-height:44px");
      expect(rules).toContain("min-width:44px");
      // No negative margin: in a wrapping row it would lay one row's target on the next's.
      expect(rules).not.toMatch(/margin[^:;]*:-/);
    }
  });
});
