import { type ComponentProps, createElement, type ReactElement, type ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicTeamPage } from "@/modules/content/team/repository";

/**
 * §NNN — «Echipa» as the server sends it: the menu offers the page only when the header says so
 * (`showTeam`, which `SiteHeader` sets from a published page with a card on it), the page is a
 * 404 while a DRAFT, a published page with nobody on it answers a sentence and asks not to be
 * indexed, and a page with cards draws them two to a row on a phone, with the person's link.
 *
 * The catalogue is the real Romanian one; the public cache and Next's navigation are stubbed.
 */
let page: PublicTeamPage = { published: false, intro: null, members: [] };

vi.mock("@/modules/public-cache/reads", () => ({ cachedTeamPage: async () => page }));
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const messages = (await import("../../../messages/ro.json")).default;
  const translator = (namespace: string) => createTranslator({ locale: "ro", messages, namespace: namespace as "Team" });
  return {
    getTranslations: async (arg: string | { namespace: string }) => translator(typeof arg === "string" ? arg : arg.namespace),
    setRequestLocale: () => undefined,
    getLocale: async () => "ro",
  };
});
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  unstable_rethrow: () => undefined,
  useSelectedLayoutSegments: () => ["team"],
  usePathname: () => "/ro/echipa",
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: { href: string | { pathname: string }; children: ReactNode }) =>
    createElement("a", { href: `/ro${typeof href === "string" ? href : href.pathname}`, ...rest }, children),
  getPathname: ({ href }: { href: string }) => `/ro${href}`,
}));
vi.mock("@/shared/ui/ContactLink", () => ({ default: ({ children }: { children: ReactNode }) => createElement("a", { href: "/ro/contact" }, children) }));

const { NextIntlClientProvider } = await import("next-intl");
const messages = (await import("../../../messages/ro.json")).default;
const { default: SiteNav } = await import("@/shared/ui/SiteNav");
const { default: TeamPage, generateMetadata } = await import("@/app/[locale]/team/page");

async function html(element: ReactElement): Promise<string> {
  const stream = await renderToReadableStream(
    createElement(NextIntlClientProvider, { locale: "ro", messages } as unknown as ComponentProps<typeof NextIntlClientProvider>, element),
  );
  await stream.allReady;
  return new Response(stream).text();
}

const params = Promise.resolve({ locale: "ro" });
const member = (name: string, link: string | null = null) => ({ id: name, name, role: "Antrenor", bio: null, link, photo: null });

describe("§NNN the team page and its menu entry", () => {
  beforeEach(() => {
    page = { published: false, intro: null, members: [] };
  });

  it("offers «Echipa» in the menu only when the header says the page is on the site", async () => {
    const without = await html(createElement(SiteNav, { showTeam: false, showContact: true }));
    const withTeam = await html(createElement(SiteNav, { showTeam: true, showContact: true }));
    expect(without).not.toContain('href="/ro/team"');
    expect(withTeam).toContain('href="/ro/team"');
    expect(withTeam).toContain(">Echipa<");
  });

  it("is a 404 while the page is a draft, whatever the cards say", async () => {
    page = { published: false, intro: null, members: [] };
    await expect(TeamPage({ params })).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("answers a sentence and asks not to be indexed while published with nobody on it", async () => {
    page = { published: true, intro: null, members: [] };
    const markup = await html((await TeamPage({ params })) as ReactElement);
    expect(markup).toContain(messages.Team.empty);
    expect(markup).not.toContain('data-testid="team-grid"');
    expect((await generateMetadata({ params })).robots).toEqual({ index: false, follow: true });
  });

  it("draws the cards two to a row on a phone, with the club's introduction and the person's link", async () => {
    page = { published: true, intro: "Cine suntem.", members: [member("Ana Popescu", "https://www.strava.com/athletes/1"), member("Mihai Ionescu")] };
    const markup = await html((await TeamPage({ params })) as ReactElement);
    expect(markup).toContain('data-testid="team-grid"');
    expect(markup).toContain("Cine suntem.");
    expect(markup).toMatch(/grid-template-columns:repeat\(2, minmax\(0, 1fr\)\)/);
    expect(markup).toMatch(/grid-template-columns:repeat\(4, minmax\(0, 1fr\)\)/);
    expect(markup).toContain('href="https://www.strava.com/athletes/1"');
    expect(markup).toContain('rel="noopener noreferrer"');
    expect(markup).toContain(">strava.com<");
    expect((await generateMetadata({ params })).robots).toBeUndefined();
  });
});
