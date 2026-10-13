import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * §708 — «Tema v2» in the header, rendered: with the setting off (or no row at all) the header
 * is the markup it was, with no button, no social marks and no watermark; with it on, «Urmărește-ne»
 * with the footer's three marks is the row's last item after the nav (§722), its words a label, and the
 * header carries no «Vino cu noi» at any width (§724, amending §708 and §722). The client islands and the
 * data reads are stubbed; the Server Components under test render for real.
 */
const state = vi.hoisted(() => ({
  look: { on: false } as { on: boolean },
  home: { on: false } as { on: boolean },
  upcoming: [] as unknown[],
  upcomingReads: 0,
}));

vi.mock("next-intl/server", () => ({
  getLocale: async () => "ro",
  // A message's key, and after it the club's name where the message takes one: enough to see what was asked for.
  getTranslations: async () => (key: string, values?: { club?: string }) => (values?.club ? `${key}:${values.club}` : key),
}));
vi.mock("@/modules/content/menu/on-site", () => ({
  menuSectionsOnSite: async () => ({ gallery: false, team: false, faq: false, contact: false }),
  menuOrderOnSite: async () => [],
}));
vi.mock("@/modules/public-cache/reads", () => ({
  cachedPublishedPages: async () => [],
  cachedSiteLook: async () => state.look,
  cachedHomePage: async () => state.home,
  cachedUpcomingEvents: async () => {
    state.upcomingReads += 1;
    return state.upcoming;
  },
}));
vi.mock("@/modules/resilience/last-good", () => ({
  readWithLastGood: async (_key: string, read: () => Promise<unknown>) => ({ value: await read() }),
}));
vi.mock("@/shared/ui/club-socials", () => ({
  clubSocialLinks: async () => [
    { network: "facebook", href: "https://facebook.example/club", label: "Facebook" },
    { network: "instagram", href: "https://instagram.example/club", label: "Instagram" },
    { network: "strava", href: "https://strava.example/club", label: "Strava" },
  ],
}));
// The client islands: stubs that keep what the header hands them visible in the markup.
vi.mock("@/shared/ui/SiteNav", () => ({
  default: ({ children }: { children?: ReactNode }) => createElement("nav", { "data-testid": "nav" }, children),
}));
vi.mock("@/shared/ui/LogoLink", () => ({
  default: ({ children, href }: { children: ReactNode; href?: string }) => createElement("a", { href: href ?? "/events", "data-testid": "logo" }, children),
}));
vi.mock("@/shared/ui/LocaleSwitcher", () => ({ default: () => createElement("span", { "data-testid": "locale-switcher" }, "locale") }));
vi.mock("@/shared/ui/NewBuildNotice", () => ({ default: () => null }));
vi.mock("@/shared/ui/ButtonLink", () => ({
  default: ({ href, children, ...rest }: { href: unknown; children: ReactNode } & Record<string, unknown>) =>
    createElement("a", { href: typeof href === "string" ? href : `${(href as { pathname: string }).pathname}|${JSON.stringify((href as { params: unknown }).params)}`, "data-testid": rest["data-testid"] }, children),
}));

import { HEADER_SOCIAL_ORDER } from "@/shared/ui/HeaderSocials";
import SiteHeader from "@/shared/ui/SiteHeader";
import LookWatermark from "@/shared/ui/LookWatermark";
import SocialIcon from "@/shared/ui/SocialIcon";
import { CLUB_NAME } from "@/theme/brand";
import { LOOK_PREVIEW, LOOK_ROOT } from "@/theme/look";

const weekly = (date: string) => ({
  type: "GROUP_RUN",
  title: "Alergare de probă",
  startsAt: new Date(date),
  slug: `alergare-${date.slice(0, 10)}`,
  timezone: "Europe/Bucharest",
  eventStatus: "SCHEDULED",
});

const header = async () => renderToStaticMarkup(await SiteHeader());

/**
 * The box Emotion drew around `marker`, its class and every rule it wrote for that class: the server writes a
 * `<style>` beside each element, so the markup carries the `display` the box has at each width and the one it
 * has inside the look's scope.
 */
function boxAround(markup: string, marker: string): { className: string; css: string } {
  const at = markup.indexOf(marker);
  const className = /\b(css-[\w-]+)"/.exec(markup.slice(markup.lastIndexOf("<div", at), at))?.[1] ?? "";
  const css = [...markup.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)]
    .map((match) => match[1])
    .filter((rules) => className !== "" && rules.includes(`.${className}`))
    .join("");
  return { className, css };
}

beforeEach(() => {
  state.look = { on: false };
  state.home = { on: false };
  state.upcoming = [];
  state.upcomingReads = 0;
});

describe("§714 the logo leads to the home page while «Pagina principală» is on", () => {
  it("leads to the listing while it is off, and to the site's root while it is on — never a menu entry", async () => {
    expect(await header()).toContain('<a href="/events" data-testid="logo">');
    state.home = { on: true };
    const on = await header();
    expect(on).toContain('<a href="/" data-testid="logo">');
    // The nav is handed nothing new: the home page is reached from the logo alone.
    expect(on).toContain('<nav data-testid="nav"></nav>');
  });
});

describe("§708 the header while «Tema v2» is off", () => {
  it("draws no button, no social marks and nothing else new, and hands the nav no children at all", async () => {
    state.upcoming = [weekly("2026-10-13T16:00:00.000Z"), weekly("2026-10-20T16:00:00.000Z")];
    const off = await header();
    for (const testId of ["header-cta", "header-socials", "look-watermark"]) expect(off).not.toContain(testId);
    expect(off).not.toContain("Facebook");
    /*
      The nav receives nothing: any truthy child (an empty fragment included) would set its
      `hasTrailing`, draw the trailing group and take `ml: auto` off the ☰ — today's header
      changed while the look is off. (The layout's `data-look` expression is pinned by
      `site-look.test.ts`'s source assertion.)
    */
    expect(off).toContain('<nav data-testid="nav"></nav>');
  });
});

describe("§708 the header while «Tema v2» is on", () => {
  it("§724 draws no «Vino cu noi» at any width, the phone too: the nav is handed nothing and no weekly run is read", async () => {
    state.look = { on: true };
    state.upcoming = [weekly("2026-10-20T16:00:00.000Z"), weekly("2026-10-13T16:00:00.000Z")];
    const on = await header();
    expect(on).not.toContain("header-cta");
    expect(on).not.toContain("cta.join");
    expect(on).not.toContain("/events/[slug]");
    // No child for the nav's trailing group, so the ☰ keeps `ml: auto` and is the phone's right edge (§699).
    expect(on).toContain('<nav data-testid="nav"></nav>');
    // The header no longer asks for the listing to find a weekly run: no read the look adds to every page.
    expect(state.upcomingReads).toBe(0);
  });

  it("§724 draws «Urmărește-ne» as a label: a span hidden from a screen reader, never a link, a button or a focusable element", async () => {
    state.look = { on: true };
    const on = await header();
    const label = /<span[^>]*data-testid="header-socials-label"[^>]*>followUs<\/span>/.exec(on);
    expect(label, "the words, drawn").not.toBeNull();
    expect(label![0]).toContain('aria-hidden="true"');
    expect(label![0]).not.toMatch(/tabindex|role=|href=/i);
    // Not inside a mark: the words close before the first link opens.
    const socials = on.slice(on.indexOf('data-testid="header-socials"'));
    expect(socials.indexOf("followUs</span>")).toBeLessThan(socials.indexOf("<a "));
    // Every link of the group is a mark of a network: the words are not one of them.
    const links = [...socials.slice(0, socials.indexOf("</nav>")).matchAll(/<a [^>]*>/g)].map((match) => match[0]);
    expect(links).toHaveLength(HEADER_SOCIAL_ORDER.length);
    for (const link of links) expect(link).toMatch(/data-network="(instagram|facebook|strava)"/);
  });

  it("§722 draws «Urmărește-ne» with Instagram, Facebook and Strava, in that order, after the nav — the row's last item", async () => {
    state.look = { on: true };
    const on = await header();
    const navEnd = on.indexOf("</nav>");
    const socials = on.indexOf('data-testid="header-socials"');
    expect(socials).toBeGreaterThan(navEnd);
    // A navigation named by the indicator's words, which are drawn too (hidden from a screen reader, which hears the name).
    const tag = on.slice(on.lastIndexOf("<nav", socials), on.indexOf(">", socials));
    expect(tag).toContain('aria-label="followUs"');
    expect(on).toContain('data-testid="header-socials-label">followUs</span>');
    const group = on.slice(socials);
    const order = ["instagram", "facebook", "strava"].map((network) => group.indexOf(`data-network="${network}"`));
    for (const at of order) expect(at).toBeGreaterThan(-1);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // Each mark says whose profile it is and where (`Site.followOn`, the club's name from `CLUB_NAME`), never the network alone.
    for (const network of HEADER_SOCIAL_ORDER) {
      expect(group).toContain(`aria-label="followOn.${network}:${CLUB_NAME}"`);
      expect(group).toContain(`title="followOn.${network}:${CLUB_NAME}"`);
    }
    // The language switcher's header copy is still rendered — the backoffice, outside the look's scope, shows it from `sm` —
    // and its box is hidden inside the scope (`notUnderLook`): a public page's one «Limbă» is the footer's bar (§724).
    expect(on).toContain('<span data-testid="locale-switcher">locale</span>');
    const { className, css } = boxAround(on, 'data-testid="locale-switcher"');
    expect(className, "the switcher sits in a styled box").not.toBe("");
    expect(css, "shown from sm outside the scope").toMatch(/@media \(min-width:600px\)\{[^{]+\{[^}]*display:flex;/);
    expect(css, "hidden inside the scope").toContain(`${LOOK_ROOT} .${className},${LOOK_PREVIEW} .${className}{display:none;}`);
  });

  it("§722 names each mark by the club and the network, in both languages, from the catalogues", async () => {
    const { createTranslator } = await import("next-intl");
    const ro = createTranslator({ locale: "ro", messages: (await import("../../../messages/ro.json")).default, namespace: "Site" });
    const en = createTranslator({ locale: "en", messages: (await import("../../../messages/en.json")).default, namespace: "Site" });
    for (const network of HEADER_SOCIAL_ORDER) {
      const name = network[0].toUpperCase() + network.slice(1);
      expect(ro(`followOn.${network}`, { club: CLUB_NAME })).toBe(`${CLUB_NAME} pe ${name}`);
      expect(en(`followOn.${network}`, { club: CLUB_NAME })).toBe(`${CLUB_NAME} on ${name}`);
    }
  });

  it("§722 gives each Instagram mark a gradient of its own, so the footer's never points at the header's hidden one", () => {
    const html = renderToStaticMarkup(
      createElement("div", null, createElement(SocialIcon, { network: "instagram" }), createElement(SocialIcon, { network: "instagram" })),
    );
    const ids = [...html.matchAll(/<linearGradient id="([^"]+)"/g)].map((match) => match[1]);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    for (const id of ids) {
      expect(id).toMatch(/^social-mark-instagram-[A-Za-z0-9_-]+$/);
      expect(html).toContain(`fill="url(#${id})"`);
    }
  });

  it("draws the watermark, which the layout renders only while on", () => {
    expect(renderToStaticMarkup(createElement(LookWatermark))).toContain('data-testid="look-watermark"');
  });
});
