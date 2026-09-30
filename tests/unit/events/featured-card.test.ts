import { existsSync, readFileSync } from "node:fs";
import { createElement, type ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PublicEvent } from "@/modules/events/repository";

/**
 * §470 — the featured event is the first card of the listing's grid, at the grid's one width.
 *
 * The owner, 2026-09-26, of the hero that stood across the page above the cards: "vreau doar sa
 * fie primul, nu neaparat mai lat pe desktop, e ok sa afisam 2 sau 3 carduri, dar toate cardurile
 * trebuie sa aiba aceeasi latime". So the lead is `EventCard` with `featured`: the card's own
 * structure, told apart by its frame and background and the «Evenimentul principal» chip — and, in
 * the club's race week (§78), the countdown and the desk's sentence once registration has closed.
 * The page draws it as the first `<li>` of the one grid the other cards are in.
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

const { default: EventCard } = await import("@/modules/events/ui/EventCard");

afterEach(() => {
  currentLocale = "ro";
});

const NOW = new Date("2026-09-24T09:00:00.000Z");

/**
 * The club's race three days out — Sunday 27 September, 10:00 in Brașov — its registration closed
 * a moment ago, so no availability is read (only an open internal event costs a read, §409).
 */
function race(overrides: Partial<PublicEvent> = {}): PublicEvent {
  return {
    id: "55555555-5555-5555-5555-555555555555",
    type: "RACE",
    surface: "TRAIL",
    eventStatus: "SCHEDULED",
    startsAt: new Date("2026-09-27T07:00:00Z"),
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
    featured: true,
    isSpecial: false,
    distanceMeters: 10000,
    elevationGainMeters: 300,
    registrationMode: "INTERNAL",
    registrationOpensAt: null,
    registrationClosesAt: new Date(NOW.getTime() - 1),
    externalRegistrationUrl: null,
    externalProvider: null,
    minAge: 14,
    slug: "crosul-aniversar",
    title: "Crosul aniversar",
    excerpt: "Cursa aniversară a clubului.",
    excerptJson: null,
    locationName: "Poiana Brașov",
    locationAddress: null,
    locationToBeAnnounced: false,
    difficultyLevel: 5,
    costType: "FREE",
    costAmount: null,
    costUrl: null,
    publishedAt: new Date("2026-09-01T10:00:00Z"),
    ...overrides,
  } as PublicEvent;
}

async function markup(node: ReactNode): Promise<string> {
  const stream = await renderToReadableStream(node);
  await stream.allReady;
  return new Response(stream).text();
}

const RACE_WEEK = { raceWeekDays: 7 };
const card = (event: PublicEvent, featured?: { raceWeekDays: number }) => markup(createElement(EventCard, { event, index: 0, now: NOW, featured }));

// `[\s\S]` rather than the `s` flag: `next build` type-checks the tests against an older target.
const withoutStyles = (html: string) => html.replace(/<style[^>]*>[\s\S]*?<\/style>/g, "");
const chipLabels = (html: string) => [...withoutStyles(html).matchAll(/class="MuiChip-label[^"]*"[^>]*>(?:<span aria-hidden="true">)?([^<]*)</g)].map((match) => match[1]);
/** The `<li>`'s own Emotion class, and every rule Emotion emitted for it. */
function cardRules(html: string): string {
  const cls = /<li\b[^>]*class="[^"]*\b(css-[\w-]+)"/.exec(html)?.[1] ?? "";
  expect(cls).not.toBe("");
  return [...html.matchAll(new RegExp(`\\.${cls}([^{]*)\\{([^}]*)\\}`, "g"))].map(([, selector, body]) => `${selector}{${body}}`).join("\n");
}

describe("§470 the featured event is a card like the others", () => {
  it("wears the «Evenimentul principal» chip first, and is a region named by its title", async () => {
    const html = withoutStyles(await card(race(), RACE_WEEK));
    expect(chipLabels(html)[0]).toBe("Evenimentul principal");
    expect(html).toMatch(/<li\b[^>]*data-featured="true"/);
    expect(html).toMatch(/<section\b[^>]*aria-labelledby="featured-event-title"/);
    expect(html).toMatch(/<h2\b[^>]*id="featured-event-title"[^>]*>\s*<a href="\/ro\/evenimente\/crosul-aniversar">Crosul aniversar<\/a>/);
    currentLocale = "en";
    expect(chipLabels(await card(race(), RACE_WEEK))[0]).toBe("Featured event");
  });

  it("is the card's own structure: the same facts, door and markup as the same event unfeatured, save the frame, the chip and race week", async () => {
    // Out of race week (three weeks out), the one difference is the frame and the chip.
    const later = race({ startsAt: new Date("2026-10-18T07:00:00Z") });
    const plain = withoutStyles(await card(later));
    const lead = withoutStyles(await card(later, RACE_WEEK));
    const strip = (html: string) =>
      html
        .replace(/ class="[^"]*"/g, "")
        .replace(/ data-featured="true"/, "")
        .replace(/<section aria-labelledby="featured-event-title"/, "<div")
        .replace(/<\/section>/, "</div>")
        .replace(/ id="featured-event-title"/, "");
    const fromTitle = (html: string) => strip(html).slice(strip(html).indexOf("<h2"));
    expect(lead).not.toContain('data-testid="race-week-countdown"');
    expect(chipLabels(lead)).toEqual(["Evenimentul principal", ...chipLabels(plain)]);
    expect(fromTitle(lead)).toBe(fromTitle(plain));
  });

  it("counts down in race week and sends the registered to the desk once registration has closed (§78)", async () => {
    const html = withoutStyles(await card(race(), RACE_WEEK));
    const countdown = /data-testid="race-week-countdown"[^>]*>([^<]*)</.exec(html)?.[1] ?? "";
    expect(countdown).toMatch(/^În 3 zile, duminică, 27 sept\. 2026/);
    expect(html).toContain("Înscrierile s-au închis — vino la masă cu QR-ul din email.");
    // The same race, not the lead: no countdown, and the plain closed sentence.
    const plain = withoutStyles(await card(race()));
    expect(plain).not.toContain("race-week-countdown");
    expect(plain).not.toContain("vino la masă");
    expect(plain).toContain("Înscrierile s-au închis");
  });

  it("frames the lead in the club's blue with the hero's gradient, and one frame per card — special says so by its chip", async () => {
    const rules = cardRules(await card(race({ isSpecial: true }), RACE_WEEK));
    // Two pixels of blue without a pixel of the card's width: the border recoloured, and a ring
    // outside it that takes no room — the lead is exactly as wide as every other card, inside too.
    expect(rules).not.toMatch(/border-width/);
    expect(rules).toContain("box-shadow:0 0 0 1px var(--mui-palette-primary-main)");
    expect(rules).toMatch(/border-color:var\(--mui-palette-primary-main\)|border-color:#1976d2/);
    expect(rules).toContain("linear-gradient");
    expect(rules).not.toContain("--mui-palette-secondary-main");
    expect(chipLabels(withoutStyles(await card(race({ isSpecial: true }), RACE_WEEK)))).toContain("Ediție specială");
  });
});

describe("§470 the listing draws the lead as the first card of its one grid", () => {
  const page = readFileSync("src/app/[locale]/events/page.tsx", "utf8");
  const body = page.slice(page.indexOf("async function ListingBody"));

  it("puts the featured card first in the same `<ul>` as every other card, with no span of its own", () => {
    const grid = body.indexOf('<Box component="ul" sx={CARD_GRID_SX}');
    const lead = body.indexOf("featured={{ raceWeekDays }}");
    const rest = body.indexOf("{cards.map(");
    expect(grid).toBeGreaterThan(0);
    expect(lead).toBeGreaterThan(grid);
    expect(rest).toBeGreaterThan(lead);
    // Same width: nothing on the page or the card lets one card take more than its column.
    expect(page).not.toMatch(/gridColumn|span \d/);
    expect(readFileSync("src/modules/events/ui/EventCard.tsx", "utf8")).not.toMatch(/gridColumn|span \d/);
  });

  it("has no hero and no «Toate evenimentele» fold any more", () => {
    expect(existsSync("src/modules/events/ui/FeaturedEventHero.tsx")).toBe(false);
    expect(page).not.toContain("FeaturedEventHero");
    expect(page).not.toContain('data-testid="other-events"');
    expect(page).not.toContain("othersCount");
  });

  it("gives the upcoming grid, the «Data se anunță» section (§533) and the past fold one grid (`CARD_GRID_SX`): one to three equal columns", () => {
    expect(page.match(/sx=\{CARD_GRID_SX\}/g)).toHaveLength(3);
    // The grid itself lives beside the card's shape since §579, where the editor's preview draws it too.
    expect(page).toContain('import { CARD_GRID_SX } from "@/modules/events/ui/card-layout";');
    expect(readFileSync("src/modules/events/ui/card-layout.ts", "utf8")).toContain('gridTemplateColumns: { xs: "1fr", md: "repeat(2, minmax(0, 1fr))", xl: "repeat(3, minmax(0, 1fr))" }');
  });
});
