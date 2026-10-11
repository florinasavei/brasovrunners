import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToReadableStream, renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * §714 — the home page, phase 3 part A (`docs/REDESIGN.md`, decision 3): what it shows from the
 * upcoming events, the hero's two lines, and the components drawn from the design page's fixture —
 * one `h1`, one `main`, the hero's picture the one eager one and its empty slot, never a stock
 * picture. Since §726 the run sections draw the listing's own cards (`home-listing-cards.test.ts`
 * holds that they are the very same markup); here, that the page around them still holds.
 */
let currentLocale: "ro" | "en" = "ro";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: { href: unknown; children: ReactNode } & Record<string, unknown>) => {
    delete rest.prefetch;
    return createElement("a", { href: typeof href === "string" ? href : `${(href as { pathname: string }).pathname}|${JSON.stringify((href as { params?: unknown }).params ?? {})}`, ...rest }, children);
  },
  getPathname: ({ href }: { href: { params?: { slug?: string } } }) => `/${currentLocale}/evenimente/${href.params?.slug ?? ""}`,
}));
vi.mock("@/shared/ui/ButtonLink", () => ({
  default: ({ href, children, ...rest }: { href: unknown; children: ReactNode } & Record<string, unknown>) =>
    createElement("a", { href: typeof href === "string" ? href : (href as { pathname: string }).pathname, "data-testid": rest["data-testid"] }, children),
}));
vi.mock("next-intl/server", async () => {
  const { createFormatter, createTranslator } = await import("next-intl");
  const ro = (await import("../../../messages/ro.json")).default;
  const en = (await import("../../../messages/en.json")).default;
  return {
    getTranslations: async (arg: string | { namespace: string }) =>
      createTranslator({ locale: currentLocale, messages: currentLocale === "ro" ? ro : en, namespace: (typeof arg === "string" ? arg : arg.namespace) as "Event" }),
    getFormatter: async () => createFormatter({ locale: currentLocale, timeZone: "Europe/Bucharest" }),
    getLocale: async () => currentLocale,
  };
});

afterEach(() => {
  currentLocale = "ro";
});

/** A Server Component tree with async parts (the listing's cards), as the page renders it; Emotion's own `<style>` elements out. */
async function render(element: ReactElement): Promise<string> {
  const stream = await renderToReadableStream(element);
  await stream.allReady;
  return (await new Response(stream).text()).replace(/<style[^>]*>[^<]*<\/style>/g, "");
}

const { homeSections, HOME_SECTION_LIMIT, RUN_TYPES } = await import("@/modules/home/domain/sections");
const { DEFAULT_HOME_PAGE_SETTING, heroLines, parseHomePage, postedPair, splitHeadline } = await import("@/modules/appearance/domain/home-page");
const { sampleHome } = await import("@/modules/design/home-fixtures");
const { default: HomePage } = await import("@/modules/home/ui/HomePage");
const { default: HomePicture } = await import("@/modules/home/ui/HomePicture");
const ro = (await import("../../../messages/ro.json")).default;
const en = (await import("../../../messages/en.json")).default;

type Row = { id: string; type: string; title: string; startsAt: Date; eventStatus: string; seriesCadence: string | null };
let counter = 0;
const row = (type: string, title: string, startsAt: string, overrides: Partial<Row> = {}): Row => ({
  id: `row-${(counter += 1)}`,
  type,
  title,
  startsAt: new Date(startsAt),
  eventStatus: "SCHEDULED",
  seriesCadence: null,
  ...overrides,
});
const weekly = (startsAt: string, overrides: Partial<Row> = {}) => row("GROUP_RUN", "Alergare de probă", startsAt, { seriesCadence: "WEEKLY", ...overrides });

describe("§714 what the home page shows from the upcoming events", () => {
  it("leads with the soonest run still going ahead — a group run or a race, never a hike or a cancelled date", () => {
    const hike = row("HIKE", "Tură de probă", "2026-10-12T06:00:00Z");
    const cancelled = weekly("2026-10-13T15:30:00Z", { eventStatus: "CANCELLED" });
    const run = weekly("2026-10-20T15:30:00Z");
    const race = row("RACE", "Cursa de probă", "2026-11-21T08:00:00Z");
    expect(homeSections([race, hike, cancelled, run]).next).toBe(run);
    expect(homeSections([hike]).next).toBeNull();
    expect([...RUN_TYPES].sort()).toEqual(["GROUP_RUN", "RACE"]);
  });

  it("splits the series by their kind, one card each, shown by the next date still going ahead", () => {
    const first = weekly("2026-10-13T15:30:00Z", { eventStatus: "CANCELLED" });
    const second = weekly("2026-10-20T15:30:00Z");
    const monthly = row("GROUP_RUN", "Alergare lunară de probă", "2026-10-15T15:30:00Z", { seriesCadence: "MONTHLY" });
    const race = row("RACE", "Cursa de probă", "2026-11-21T08:00:00Z");
    const allCancelled = row("COFFEE", "Cafea de probă", "2026-10-14T15:00:00Z", { eventStatus: "CANCELLED" });
    const sections = homeSections([race, first, monthly, second, allCancelled]);
    expect(sections.weekly.map((card) => card.shown)).toEqual([second]);
    expect(sections.weekly[0].members).toEqual([first, second]);
    // A series every month is special (decision 9), and soonest first; a series all cancelled is no card.
    expect(sections.special.map((card) => card.shown)).toEqual([monthly, race]);
    expect(sections.special.every((card) => card.kind === "special")).toBe(true);
  });

  it("shows at most six of a kind and counts the rest, which the listing holds", () => {
    const races = Array.from({ length: HOME_SECTION_LIMIT + 2 }, (_, index) => row("RACE", `Cursa de probă ${index}`, `2026-11-${10 + index}T08:00:00Z`));
    const sections = homeSections(races);
    expect(sections.special).toHaveLength(HOME_SECTION_LIMIT);
    expect(sections.moreSpecial).toBe(2);
    expect(sections.moreWeekly).toBe(0);
  });
});

describe("§714 the hero's two lines", () => {
  it("reads the club's lines in one language, or none for the platform's own, never the other language's", () => {
    const setting = parseHomePage({ on: true, hero: null, headline: { ro: "Alergăm împreună", en: "We run together" }, subline: null });
    expect(heroLines(setting, "en")).toEqual({ headline: "We run together", subline: null });
    expect(heroLines(DEFAULT_HOME_PAGE_SETTING, "ro")).toEqual({ headline: null, subline: null });
  });

  it("draws the last word in the accent, and a one-word headline in one tone", () => {
    expect(splitHeadline("Alergăm împreună prin Brașov")).toEqual({ lead: "Alergăm împreună prin", accent: "Brașov" });
    expect(splitHeadline("  Alergăm  ")).toEqual({ lead: "Alergăm", accent: null });
  });

  it("takes both languages or neither, naming the empty side", () => {
    expect(postedPair({ ro: " Unu ", en: "One" })).toEqual({ ro: "Unu", en: "One" });
    expect(postedPair({ ro: "", en: " " })).toBeNull();
    expect(postedPair({ ro: "Unu", en: "" })).toEqual({ missing: "en" });
    expect(postedPair({ ro: undefined, en: "One" })).toEqual({ missing: "ro" });
  });

  it("reads a film's poster as an empty slot and anything unreadable as off", () => {
    const poster = { assetId: "00000000-0000-4000-8000-000000000001", keyPrefix: "yt-abc", width: 1280, height: 720, crop: null };
    expect(parseHomePage({ on: true, hero: poster, headline: null, subline: null })).toEqual({ ...DEFAULT_HOME_PAGE_SETTING, on: true });
    expect(parseHomePage({ on: "yes" })).toEqual(DEFAULT_HOME_PAGE_SETTING);
    expect(parseHomePage({ on: true })).toEqual({ ...DEFAULT_HOME_PAGE_SETTING, on: true });
    // A field a later release wrote never turns the page off after a rollback.
    expect(parseHomePage({ on: true, steps: { later: 1 } }).on).toBe(true);
  });
});

describe("§714 the home page's components, drawn from the design page's fixture", () => {
  const words = (catalogue: Record<string, unknown>) => (key: string, values: Record<string, string> = {}) => {
    const text = key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], catalogue) as string;
    return text.replace(/\{(\w+)\}/g, (_, name: string) => values[name] ?? `{${name}}`);
  };
  const markup = async (locale: "ro" | "en") => {
    currentLocale = locale;
    const catalogue = locale === "ro" ? ro : en;
    return render(createElement(HomePage, sampleHome(locale, words(catalogue.Home))));
  };

  it("has one main and one h1, the hero's, with its last word in the accent", async () => {
    const html = await markup("ro");
    expect(html.match(/<main\b/g)).toHaveLength(1);
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    // A streamed render marks the text's two pieces with an empty comment; a browser's DOM holds no such node.
    expect(html.replace(/<!-- -->/g, "")).toMatch(/<h1[^>]*id="home-hero-title"[^>]*>Alergăm împreună prin <span[^>]*data-testid="home-hero-accent"[^>]*>Brașov<\/span><\/h1>/);
    // The three run sections' headings, each naming its section; the cards' titles are the listing's own.
    for (const id of ["next-run", "weekly", "special"]) expect(html, id).toMatch(new RegExp(`<h2[^>]*id="home-${id}-title"`));
  });

  it("leads «Vino cu noi» and the calendar as pill links with their arrows, in both languages", async () => {
    expect(await markup("ro")).toMatch(/data-testid="home-hero-primary">Vino cu noi<svg/);
    expect(await markup("en")).toMatch(/data-testid="home-hero-secondary">See the calendar<svg/);
  });

  it("starts from the hero's empty photo slot: the mountain mark, no picture, nothing eager", async () => {
    const html = await markup("ro");
    expect(html).not.toContain("<img");
    expect(html).toContain('data-testid="home-hero-picture-empty"');
    // The hero's slot alone: the cards are the listing's, with no slot of the home page's (§726).
    expect(html.match(/data-testid="mountain-mark"/g)).toHaveLength(1);
  });

  it("draws the run sections with the listing's cards, each a list item of the listing's grid, and the link to the listing", async () => {
    const html = await markup("ro");
    for (const id of ["next-run", "weekly", "special"]) expect(html, id).toMatch(new RegExp(`<ul[^>]*data-testid="home-${id}-cards"[^>]*><li`));
    // Every card's door, as on «Alergări»; no round arrow and no kind tag of the home page's own.
    expect(html.match(new RegExp(ro.Event.series.fullDescription, "g"))).toHaveLength(3);
    expect(html).not.toContain('data-testid="round-arrow"');
    expect(html).not.toContain("data-kind=");
    expect(html).toContain('href="/events/[slug]|{&quot;slug&quot;:&quot;sample-run-0&quot;}"');
    expect(html).toContain('data-testid="home-special-more"');
  });

  it("draws the hero's photograph eagerly, first and with its ladder, and a card's lazily", () => {
    const picture = { src: "/a/web.webp", srcSet: "/a/w640.webp 640w, /a/web.webp 2400w", sizes: "100vw", width: 2400, height: 1350, crop: null };
    const hero = renderToStaticMarkup(createElement(HomePicture, { picture, eager: true }));
    expect(hero).toMatch(/loading="eager"/);
    expect(hero).toMatch(/fetchPriority="high"|fetchpriority="high"/);
    expect(hero).toContain('srcSet="/a/w640.webp 640w, /a/web.webp 2400w"');
    expect(hero).toContain('alt=""');
    const card = renderToStaticMarkup(createElement(HomePicture, { picture: { ...picture, crop: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 } } }));
    expect(card).toMatch(/loading="lazy"/);
    expect(card).not.toMatch(/fetchpriority/i);
    expect(card).toContain('data-crop="set"');
  });
});

describe("§714 «Mostre» draws the same components", () => {
  it("draws the hero, the next run and both sections, the hero's heading a paragraph so the design page keeps its one h1", async () => {
    const { default: HomePageSamples } = await import("@/modules/design/ui/HomePageSamples");
    const html = await render(await HomePageSamples({ locale: "ro" }));
    expect(html).not.toMatch(/<h1\b/);
    expect(html).toMatch(/<p [^>]*id="home-hero-title"/);
    for (const testId of ["home-hero", "home-next-run", "home-weekly", "home-special"]) expect(html, testId).toContain(`data-testid="${testId}"`);
  });
});

describe("§714 the sections are components of their own, with typed props", () => {
  const ROOT = path.resolve(__dirname, "../../..");
  const source = (file: string) => readFileSync(path.join(ROOT, file), "utf8");

  it("are Server Components with no element-valued prop and no colour of their own", () => {
    for (const name of ["HomePage", "Hero", "RunSection", "HomePicture"]) {
      const text = source(`src/modules/home/ui/${name}.tsx`);
      expect(text, name).not.toMatch(/^["']use client["']/m);
      expect(text, name).not.toMatch(/:\s*(ReactNode|ReactElement|JSX\.Element)\b/);
      expect(text, name).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
    }
  });

  it("has no card of its own any more: the run sections draw the listing's (§726)", () => {
    for (const gone of ["NextRunCard.tsx", "RunCardGrid.tsx", "RunTag.tsx", "RoundArrow.tsx", "card-sx.ts"]) {
      expect(existsSync(path.join(ROOT, "src/modules/home/ui", gone)), gone).toBe(false);
    }
    expect(source("src/modules/home/ui/RunSection.tsx")).toContain('import ListingCard, { type ListingCardProps } from "@/modules/events/ui/ListingCard";');
  });
});

describe("§714 the sections the club switches, the third button and the empty section", () => {
  const words = (catalogue: Record<string, unknown>) => (key: string, values: Record<string, string> = {}) => {
    const text = key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], catalogue) as string;
    return text.replace(/\{(\w+)\}/g, (_, name: string) => values[name] ?? `{${name}}`);
  };
  const props = () => sampleHome("ro", words(ro.Home));
  const draw = (override: Record<string, unknown>) => render(createElement(HomePage, { ...props(), ...override }));

  it("defaults the first four sections on and the four reserved slots off", async () => {
    const { sectionShown, HOME_SECTION_KEYS } = await import("@/modules/appearance/domain/home-page");
    expect([...HOME_SECTION_KEYS]).toEqual(["hero", "nextRun", "weekly", "special", "steps", "why", "strip", "numbers"]);
    const shown = HOME_SECTION_KEYS.filter((key) => sectionShown(DEFAULT_HOME_PAGE_SETTING, key));
    expect(shown).toEqual(["hero", "nextRun", "weekly", "special"]);
    expect(DEFAULT_HOME_PAGE_SETTING.buttons).toEqual({ join: null, calendar: null, how: null });
  });

  it("does not draw a section the club left off", async () => {
    const html = await draw({ show: { weekly: false, special: false, nextRun: false } });
    expect(html).toContain('data-testid="home-hero"');
    for (const testId of ["home-next-run", "home-weekly", "home-special"]) expect(html, testId).not.toContain(`data-testid="${testId}"`);
  });

  it("keeps the page's one h1 with the hero off: visually hidden, first in main, the headline's own words", async () => {
    const html = await draw({ show: { hero: false } });
    expect(html).not.toContain('data-testid="home-hero"');
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toMatch(/<main[^>]*><h1[^>]*data-testid="home-h1-hidden"[^>]*>Alergăm împreună prin Brașov<\/h1>/);
    expect(await draw({})).not.toContain("home-h1-hidden");
  });

  it("does not draw a section with no cards: no heading, no sentence", async () => {
    const html = await draw({ weekly: { ...props().weekly, cards: [] } });
    expect(html).not.toContain('data-testid="home-weekly"');
    expect(html).toContain('data-testid="home-special"');
    expect(html).not.toContain("home-weekly-empty");
  });

  it("draws the third button only when its page is named", async () => {
    expect(await draw({})).not.toContain("home-hero-tertiary");
    const hero = { ...props().hero, tertiary: { label: "Cum funcționează", href: { pathname: "/pages/[slug]", params: { slug: "cum-functioneaza" } } } };
    const html = await draw({ hero });
    expect(html).toMatch(/data-testid="home-hero-tertiary">Cum funcționează<svg/);
    expect(html).toContain("/pages/[slug]");
  });
});
