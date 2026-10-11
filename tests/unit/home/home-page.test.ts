import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * §NNN — the home page, phase 3 part A (`docs/REDESIGN.md`, decision 3): what it shows from the
 * upcoming events, the hero's two lines, and the components drawn from the design page's fixture —
 * one `h1`, one `main`, the hero's picture the one eager one, empty photo slots and never a stock
 * picture, the kind told in words, the round arrow inside the card's one link.
 */
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: { href: unknown; children: ReactNode } & Record<string, unknown>) =>
    createElement("a", { href: typeof href === "string" ? href : `${(href as { pathname: string }).pathname}|${JSON.stringify((href as { params?: unknown }).params ?? {})}`, ...rest }, children),
}));
vi.mock("@/shared/ui/ButtonLink", () => ({
  default: ({ href, children, ...rest }: { href: unknown; children: ReactNode } & Record<string, unknown>) =>
    createElement("a", { href: typeof href === "string" ? href : (href as { pathname: string }).pathname, "data-testid": rest["data-testid"] }, children),
}));
vi.mock("next-intl/server", () => ({ getLocale: async () => "ro", getTranslations: async () => (key: string) => key }));

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

describe("§NNN what the home page shows from the upcoming events", () => {
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

describe("§NNN the hero's two lines", () => {
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

describe("§NNN the home page's components, drawn from the design page's fixture", () => {
  const words = (catalogue: Record<string, unknown>) => (key: string, values: Record<string, string> = {}) => {
    const text = key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], catalogue) as string;
    return text.replace(/\{(\w+)\}/g, (_, name: string) => values[name] ?? `{${name}}`);
  };
  const markup = (locale: "ro" | "en") => {
    const catalogue = locale === "ro" ? ro : en;
    // Emotion's own `<style>` elements out, so the assertions read the markup a visitor's DOM holds.
    return renderToStaticMarkup(createElement(HomePage, sampleHome(locale, words(catalogue.Home), words(catalogue.Event)))).replace(/<style[^>]*>[^<]*<\/style>/g, "");
  };

  it("has one main and one h1, the hero's, with its last word in the accent", () => {
    const html = markup("ro");
    expect(html.match(/<main\b/g)).toHaveLength(1);
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toMatch(/<h1[^>]*id="home-hero-title"[^>]*>Alergăm împreună prin <span[^>]*data-testid="home-hero-accent"[^>]*>Brașov<\/span><\/h1>/);
    expect(html.match(/<h2\b/g)).toHaveLength(3);
  });

  it("leads «Vino cu noi» and the calendar as pill links with their arrows, in both languages", () => {
    expect(markup("ro")).toMatch(/data-testid="home-hero-primary">Vino cu noi<svg/);
    expect(markup("en")).toMatch(/data-testid="home-hero-secondary">See the calendar<svg/);
  });

  it("starts from empty photo slots: the mountain mark, no picture, nothing eager", () => {
    const html = markup("ro");
    expect(html).not.toContain("<img");
    expect(html).toContain('data-testid="home-hero-picture-empty"');
    expect(html.match(/data-testid="mountain-mark"/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it("tells each card's kind in words beside its glyph, and its one link is the title over the whole card", () => {
    const html = markup("ro");
    expect(html).toContain('data-kind="weekly"');
    expect(html).toContain(">Săptămânal</span>");
    expect(html).toContain('data-kind="special"');
    expect(html).toContain(">Eveniment special</span>");
    // The round arrow is a picture inside the press, never a second link.
    expect(html).toMatch(/<span class="[^"]*" aria-hidden="true" data-testid="round-arrow">/);
    expect(html).not.toMatch(/<a [^>]*data-testid="round-arrow"/);
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

describe("§NNN «Mostre» draws the same components", () => {
  it("draws the hero, the next run and both sections, the hero's heading a paragraph so the design page keeps its one h1", async () => {
    const { default: HomePageSamples } = await import("@/modules/design/ui/HomePageSamples");
    const html = renderToStaticMarkup(await HomePageSamples({ locale: "ro" }));
    expect(html).not.toMatch(/<h1\b/);
    expect(html).toMatch(/<p [^>]*id="home-hero-title"/);
    for (const testId of ["home-hero", "home-next-run", "home-weekly", "home-special"]) expect(html, testId).toContain(`data-testid="${testId}"`);
  });
});

describe("§NNN the sections are components of their own, with typed props", () => {
  const ROOT = path.resolve(__dirname, "../../..");
  const source = (file: string) => readFileSync(path.join(ROOT, file), "utf8");

  it("are Server Components with no element-valued prop and no colour of their own", () => {
    for (const name of ["HomePage", "Hero", "NextRunCard", "RunCardGrid", "HomePicture", "RunTag", "RoundArrow"]) {
      const text = source(`src/modules/home/ui/${name}.tsx`);
      expect(text, name).not.toMatch(/^["']use client["']/m);
      expect(text, name).not.toMatch(/:\s*(ReactNode|ReactElement|JSX\.Element)\b/);
      expect(text, name).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
    }
  });
});

describe("§NNN the sections the club switches, the third button, the empty section and the tag's colours", () => {
  const words = (catalogue: Record<string, unknown>) => (key: string, values: Record<string, string> = {}) => {
    const text = key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], catalogue) as string;
    return text.replace(/\{(\w+)\}/g, (_, name: string) => values[name] ?? `{${name}}`);
  };
  const props = () => sampleHome("ro", words(ro.Home), words(ro.Event));
  const draw = (override: Record<string, unknown>) =>
    renderToStaticMarkup(createElement(HomePage, { ...props(), ...override })).replace(/<style[^>]*>[^<]*<\/style>/g, "");

  it("defaults the first four sections on and the four reserved slots off", async () => {
    const { sectionShown, HOME_SECTION_KEYS } = await import("@/modules/appearance/domain/home-page");
    expect([...HOME_SECTION_KEYS]).toEqual(["hero", "nextRun", "weekly", "special", "steps", "why", "strip", "numbers"]);
    const shown = HOME_SECTION_KEYS.filter((key) => sectionShown(DEFAULT_HOME_PAGE_SETTING, key));
    expect(shown).toEqual(["hero", "nextRun", "weekly", "special"]);
    expect(DEFAULT_HOME_PAGE_SETTING.buttons).toEqual({ join: null, calendar: null, how: null });
  });

  it("does not draw a section the club left off", () => {
    const html = draw({ show: { weekly: false, special: false, nextRun: false } });
    expect(html).toContain('data-testid="home-hero"');
    for (const testId of ["home-next-run", "home-weekly", "home-special"]) expect(html, testId).not.toContain(`data-testid="${testId}"`);
  });

  it("keeps the page's one h1 with the hero off: visually hidden, first in main, the headline's own words", () => {
    const html = draw({ show: { hero: false } });
    expect(html).not.toContain('data-testid="home-hero"');
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toMatch(/<main[^>]*><h1[^>]*data-testid="home-h1-hidden"[^>]*>Alergăm împreună prin Brașov<\/h1>/);
    expect(draw({})).not.toContain("home-h1-hidden");
  });

  it("does not draw a section with no cards: no heading, no sentence", () => {
    const html = draw({ weekly: { ...props().weekly, cards: [] } });
    expect(html).not.toContain('data-testid="home-weekly"');
    expect(html).toContain('data-testid="home-special"');
    expect(html).not.toContain("home-weekly-empty");
  });

  it("draws the third button only when its page is named", () => {
    expect(draw({})).not.toContain("home-hero-tertiary");
    const hero = { ...props().hero, tertiary: { label: "Cum funcționează", href: { pathname: "/pages/[slug]", params: { slug: "cum-functioneaza" } } } };
    const html = draw({ hero });
    expect(html).toMatch(/data-testid="home-hero-tertiary">Cum funcționează<svg/);
    expect(html).toContain("/pages/[slug]");
  });

  it("gives the tag its pink and green only under «Aspectul nou»: today's neutral otherwise", () => {
    const text = readFileSync(path.resolve(__dirname, "../../../src/modules/home/ui/RunTag.tsx"), "utf8");
    expect(text).toContain("UNDER_LOOK");
    expect(text).toMatch(/bgcolor: "action\.selected"/);
    // The plain (look-off) rule has no brand colour of its own: the tokens sit only inside the scope's selectors.
    expect(text).not.toMatch(/^\s*bgcolor: COLOR\./m);
  });
});
