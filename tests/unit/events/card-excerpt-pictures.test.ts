import { createElement, type ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { RichTextBlock, RichTextDoc } from "@/modules/content/rich-text/domain/schema";
import type { PublicEvent } from "@/modules/events/repository";

/**
 * BR-REQ-041-01 (§NNN) — a picture in the short description is on the listing card whatever the
 * length of the words.
 *
 * The owner, 2026-09-25: "am pus o poza pe cardul de rezumat dar nu apare si pe site". §366 clamped
 * the card's whole summary to three lines, pictures inside the clamped box, and a clamped box cuts
 * whatever comes after its third line — so a picture written under a few sentences was on the event
 * page and nowhere on the card. The card now clamps the words' box alone, and every picture and film
 * stands outside it in the order it was written: the ones before the first words above it, the rest
 * under it. The event page and the hero read the document exactly as before.
 */
vi.mock("next-intl/server", async () => {
  const { createFormatter, createTranslator } = await import("next-intl");
  const ro = (await import("../../../messages/ro.json")).default;
  return {
    getTranslations: async (namespace: string) => createTranslator({ locale: "ro", messages: ro, namespace: namespace as "Event" }),
    getFormatter: async () => createFormatter({ locale: "ro", timeZone: "Europe/Bucharest" }),
    getLocale: async () => "ro",
  };
});

/** The locale-aware link, as a plain anchor: the cards hand it `/events/[slug]` and a slug. */
vi.mock("@/i18n/navigation", () => {
  const path = (href: { params?: { slug?: string } }) => `/ro/evenimente/${href.params?.slug ?? ""}`;
  return {
    getPathname: ({ href }: { href: { params?: { slug?: string } } }) => path(href),
    Link: ({ href, children }: { href: { params?: { slug?: string } }; children: ReactNode }) => createElement("a", { href: path(href) }, children),
  };
});

const { default: EventExcerpt, splitCardExcerpt, CARD_EXCERPT_SX, CARD_EXCERPT_WORDS_SX } = await import("@/modules/events/ui/EventExcerpt");
const { default: EventCard } = await import("@/modules/events/ui/EventCard");
const { default: SeriesCard } = await import("@/modules/events/ui/SeriesCard");

const NOW = new Date("2026-09-24T09:00:00.000Z");

const words = (text: string): RichTextBlock => ({ type: "paragraph", content: [{ type: "text", text }] });
const blank: RichTextBlock = { type: "paragraph" } as RichTextBlock;
/** A picture this site stored — the only kind the schema reads (§72). */
const picture = (name: string): RichTextBlock =>
  ({
    type: "image",
    attrs: {
      src: `/api/media/${name.padEnd(8, "0").slice(0, 8)}-1111-2222-3333-444444444444/web.webp`,
      alt: name,
      caption: "",
      width: 1200,
      height: 800,
      widthPercent: 50,
      align: "right",
      crop: null,
    },
  }) as RichTextBlock;
const film: RichTextBlock = {
  type: "youtube",
  attrs: { videoId: "dQw4w9WgXcQ", caption: "Filmul cursei", widthPercent: 100, align: "block", poster: null, posterSource: null },
} as RichTextBlock;
const doc = (...content: RichTextBlock[]): RichTextDoc => ({ type: "doc", content });

/** Four sentences a card cannot hold in three lines, then the picture the owner put under them. */
const LONG = [
  "Alergăm împreună pe aleile din Parcul Titulescu, într-un ritm în care se poate vorbi, iar la final ne întindem lângă fântână.",
  "Traseul are opt kilometri, cu o buclă scurtă pentru cine vine prima dată și una lungă pentru cine vrea mai mult.",
  "Adu apă, o frontală dacă se întunecă devreme și chef de alergat; restul îl facem împreună, ca în fiecare săptămână.",
  "Ne vedem la fântâna arteziană cu zece minute înainte de start, ca să apucăm să ne încălzim.",
].map(words);

// `[\s\S]` rather than the `s` flag: `next build` type-checks the tests against an older target.
const withoutStyles = (html: string) => html.replace(/<style[^>]*>[\s\S]*?<\/style>/g, "");

async function markup(node: ReactNode): Promise<string> {
  const stream = await renderToReadableStream(node);
  await stream.allReady;
  return new Response(stream).text();
}

/** The element with this test id, whole: its opening tag to its own closing tag, nested divs counted. */
function element(html: string, testId: string): string {
  const markup = withoutStyles(html);
  const start = markup.search(new RegExp(`<div\\b[^>]*data-testid="${testId}"`));
  if (start < 0) return "";
  let depth = 0;
  const tags = /<(\/?)div\b[^>]*>/g;
  tags.lastIndex = start;
  for (let match = tags.exec(markup); match; match = tags.exec(markup)) {
    depth += match[1] ? -1 : 1;
    if (depth === 0) return markup.slice(start, match.index + match[0].length);
  }
  return markup.slice(start);
}

/** The CSS rules Emotion emitted for a class, joined. */
function rulesFor(html: string, cls: string): string {
  return [...html.matchAll(new RegExp(`\\.${cls}([^{]*)\\{([^}]*)\\}`, "g"))].map(([, selector, body]) => `${selector}{${body}}`).join("\n");
}

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
    elevationGainMeters: null,
    registrationMode: "NONE",
    registrationOpensAt: null,
    registrationClosesAt: null,
    externalRegistrationUrl: null,
    externalProvider: null,
    minAge: 14,
    slug: "happy-monday-0",
    title: "Happy Monday",
    excerpt: null,
    excerptJson: doc(...LONG, picture("aaaaaaaa")),
    locationName: "Parcul Titulescu",
    locationAddress: null,
    locationToBeAnnounced: false,
    difficulty: "EASY",
    costType: "FREE",
    costAmount: null,
    costUrl: null,
    publishedAt: NOW,
    ...overrides,
  } as PublicEvent;
}

describe("BR-REQ-041-01 the card splits the summary: the words clamped, the pictures never (§NNN)", () => {
  it("keeps every picture and film, in the order written: those before the first words above, the rest under", () => {
    const [a, b] = [picture("aaaaaaaa"), picture("bbbbbbbb")];
    const [one, two, three] = LONG;
    const split = splitCardExcerpt(doc(a, one, two, b, three, film));
    expect(split.before).toEqual([a]);
    expect(split.words).toEqual([one, two, three]);
    expect(split.after).toEqual([b, film]);
  });

  it("does not let an empty paragraph above a picture push the picture under the words", () => {
    const a = picture("aaaaaaaa");
    const split = splitCardExcerpt(doc(blank, a, LONG[0]));
    expect(split.before).toEqual([a]);
    // The empty paragraph stays among the words, where it always rendered.
    expect(split.words).toEqual([blank, LONG[0]]);
    expect(split.after).toEqual([]);
  });

  it("draws no words box for a summary that is only a picture", () => {
    const a = picture("aaaaaaaa");
    expect(splitCardExcerpt(doc(a))).toEqual({ before: [a], words: null, after: [] });
    expect(splitCardExcerpt(doc(blank, a))).toEqual({ before: [a], words: null, after: [] });
  });

  it("clamps the words' box and nothing around it", () => {
    expect(CARD_EXCERPT_WORDS_SX).toMatchObject({ display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: 3, overflow: "hidden" });
    // The outer box holds the pictures: a flex column, like the -webkit-box it replaces, so no
    // child's margin collapses into it — and no clamp, no hidden overflow.
    expect(CARD_EXCERPT_SX).toMatchObject({ display: "flex", flexDirection: "column" });
    expect(CARD_EXCERPT_SX).not.toHaveProperty("WebkitLineClamp");
    expect(CARD_EXCERPT_SX).not.toHaveProperty("overflow");
  });

  it("shows the picture written under four long sentences, outside the clamped words", async () => {
    const html = await markup(createElement(EventExcerpt, { place: "card", excerptJson: row().excerptJson, excerpt: null }));
    const summary = element(html, "card-excerpt");
    const clamped = element(html, "card-excerpt-words");
    expect(clamped).toContain("Alergăm împreună");
    expect(clamped).toContain("Ne vedem la fântâna");
    expect(clamped).not.toContain("<figure");
    expect(summary).toContain('<figure');
    expect(summary).toContain('alt="aaaaaaaa"');
    // Under the words, where it was written.
    expect(summary.indexOf("<figure")).toBeGreaterThan(summary.indexOf('data-testid="card-excerpt-words"'));
    // The clamp is on the words' box.
    const wordsClass = /<div\b[^>]*class="[^"]*\b(css-[\w-]+)"[^>]*data-testid="card-excerpt-words"/.exec(withoutStyles(html))?.[1] ?? "";
    expect(wordsClass).not.toBe("");
    expect(rulesFor(html, wordsClass)).toContain("-webkit-line-clamp:3");
  });

  it("keeps a picture written first above the words, and a film written last under them", async () => {
    const html = await markup(
      createElement(EventExcerpt, { place: "card", excerptJson: doc(picture("aaaaaaaa"), ...LONG, picture("bbbbbbbb"), film), excerpt: null }),
    );
    const summary = element(html, "card-excerpt");
    const wordsAt = summary.indexOf('data-testid="card-excerpt-words"');
    expect(summary.indexOf('alt="aaaaaaaa"')).toBeLessThan(wordsAt);
    expect(summary.indexOf('alt="bbbbbbbb"')).toBeGreaterThan(wordsAt);
    expect(summary).toContain("Filmul cursei");
    expect(summary.indexOf("Filmul cursei")).toBeGreaterThan(summary.indexOf('alt="bbbbbbbb"'));
    expect(element(html, "card-excerpt-words")).not.toContain("<figure");
  });

  it("is what both cards show: the picture under the long summary on the single-date card and on the series card", async () => {
    const one = await markup(createElement(EventCard, { event: row(), index: 0, now: NOW }));
    const mondays = ["2026-09-28T15:30:00Z", "2026-10-05T15:30:00Z"].map((startsAt, index) =>
      row({ id: `3333333${index}-3333-3333-3333-333333333333`, slug: `happy-monday-${index}`, startsAt: new Date(startsAt) }),
    );
    const many = await markup(createElement(SeriesCard, { members: mondays, index: 0, now: NOW }));
    for (const html of [one, many]) {
      expect(element(html, "card-excerpt")).toContain('alt="aaaaaaaa"');
      expect(element(html, "card-excerpt-words")).not.toContain("<figure");
    }
  });

  it("leaves the event page and the hero reading the document whole, in its own order", async () => {
    const html = withoutStyles(
      await markup(createElement(EventExcerpt, { excerptJson: doc(LONG[0], picture("aaaaaaaa"), LONG[1]), excerpt: null })),
    );
    expect(html).not.toContain("card-excerpt");
    const at = (needle: string) => html.indexOf(needle);
    expect(at("Alergăm împreună")).toBeLessThan(at('alt="aaaaaaaa"'));
    expect(at('alt="aaaaaaaa"')).toBeLessThan(at("Traseul are opt"));
  });
});
