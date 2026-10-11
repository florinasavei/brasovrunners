import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * §NNN — «Aspectul nou» in the header, rendered: with the setting off (or no row at all) the header
 * is the markup it was, with no button, no social marks and no watermark; with it on, «Vino cu noi»
 * leads to the next weekly run (else the listing), the socials are the footer's two, and both sit in
 * the nav's children (its trailing group) so the ☰ stays the row's last item (§699). The client islands and the
 * data reads are stubbed; the Server Components under test render for real.
 */
const state = vi.hoisted(() => ({
  look: { on: false } as { on: boolean },
  upcoming: [] as unknown[],
}));

vi.mock("next-intl/server", () => ({
  getLocale: async () => "ro",
  getTranslations: async () => (key: string) => key,
}));
vi.mock("@/modules/content/menu/on-site", () => ({
  menuSectionsOnSite: async () => ({ gallery: false, team: false, faq: false, contact: false }),
  menuOrderOnSite: async () => [],
}));
vi.mock("@/modules/public-cache/reads", () => ({
  cachedPublishedPages: async () => [],
  cachedSiteLook: async () => state.look,
  cachedUpcomingEvents: async () => state.upcoming,
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
vi.mock("@/shared/ui/LogoLink", () => ({ default: ({ children }: { children: ReactNode }) => createElement("a", { href: "/" }, children) }));
vi.mock("@/shared/ui/LocaleSwitcher", () => ({ default: () => createElement("span", null, "locale") }));
vi.mock("@/shared/ui/NewBuildNotice", () => ({ default: () => null }));
vi.mock("@/shared/ui/ButtonLink", () => ({
  default: ({ href, children, ...rest }: { href: unknown; children: ReactNode } & Record<string, unknown>) =>
    createElement("a", { href: typeof href === "string" ? href : `${(href as { pathname: string }).pathname}|${JSON.stringify((href as { params: unknown }).params)}`, "data-testid": rest["data-testid"] }, children),
}));

import SiteHeader from "@/shared/ui/SiteHeader";
import LookWatermark from "@/shared/ui/LookWatermark";

const weekly = (date: string) => ({
  type: "GROUP_RUN",
  title: "Alergare de probă",
  startsAt: new Date(date),
  slug: `alergare-${date.slice(0, 10)}`,
  timezone: "Europe/Bucharest",
  eventStatus: "SCHEDULED",
});

const header = async () => renderToStaticMarkup(await SiteHeader());

beforeEach(() => {
  state.look = { on: false };
  state.upcoming = [];
});

describe("§NNN the header while «Aspectul nou» is off", () => {
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

describe("§NNN the header while «Aspectul nou» is on", () => {
  it("draws «Vino cu noi» to the next weekly run and the footer's Facebook and Instagram, inside the nav's trailing group", async () => {
    state.look = { on: true };
    state.upcoming = [weekly("2026-10-20T16:00:00.000Z"), weekly("2026-10-13T16:00:00.000Z")];
    const on = await header();
    expect(on).toContain('data-testid="header-cta"');
    expect(on).toContain("cta.join");
    expect(on).toContain("/events/[slug]");
    expect(on).toContain("alergare-2026-10-13");
    expect(on).toContain('data-testid="header-socials"');
    expect(on).toContain("Facebook");
    expect(on).toContain("Instagram");
    expect(on).not.toContain("Strava");
    // Inside the nav, so the ☰ the nav draws last stays the row's right edge.
    const nav = on.slice(on.indexOf('<nav data-testid="nav">'), on.indexOf("</nav>"));
    expect(nav).toContain('data-testid="header-cta"');
    expect(nav).toContain('data-testid="header-socials"');
  });

  it("leads to the listing when no weekly run is ahead", async () => {
    state.look = { on: true };
    const on = await header();
    expect(on).toContain('href="/events"');
    expect(on).not.toContain("/events/[slug]");
  });

  it("draws the watermark, which the layout renders only while on", () => {
    expect(renderToStaticMarkup(createElement(LookWatermark))).toContain('data-testid="look-watermark"');
  });
});
