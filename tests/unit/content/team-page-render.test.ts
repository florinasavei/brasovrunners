import { type ComponentProps, createElement, type ReactElement, type ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RichTextDoc } from "@/modules/content/rich-text/domain/schema";
import type { PublicTeamLink, PublicTeamMember, PublicTeamPage } from "@/modules/content/team/repository";

/**
 * §459 — «Echipa» as the server sends it: the menu offers the page only when the header says so
 * (`showTeam`, which `SiteHeader` sets from a published page with a card on it), the page is a
 * 404 while a DRAFT, a published page with nobody on it answers a sentence and asks not to be
 * indexed, and a page with cards draws them two to a row on a phone, with the person's link.
 *
 * The catalogue is the real Romanian one; the public cache and Next's navigation are stubbed.
 */
let page: PublicTeamPage = { published: false, intro: null, introText: null, members: [] };

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
const doc = (...paragraphs: string[]): RichTextDoc => ({
  type: "doc",
  content: paragraphs.map((text) => ({ type: "paragraph" as const, content: [{ type: "text" as const, text }] })),
});
const member = (name: string, links: PublicTeamLink[] = [], bio: RichTextDoc | null = null): PublicTeamMember => ({
  id: name,
  name,
  role: "Antrenor",
  bio,
  links,
  photo: null,
});

describe("§459 the team page and its menu entry", () => {
  beforeEach(() => {
    page = { published: false, intro: null, introText: null, members: [] };
  });

  it("offers «Echipa» in the menu only when the header says the page is on the site", async () => {
    const without = await html(createElement(SiteNav, { showTeam: false, showContact: true }));
    const withTeam = await html(createElement(SiteNav, { showTeam: true, showContact: true }));
    expect(without).not.toContain('href="/ro/team"');
    expect(withTeam).toContain('href="/ro/team"');
    expect(withTeam).toContain(">Echipa<");
  });

  it("is a 404 while the page is a draft, whatever the cards say", async () => {
    page = { published: false, intro: null, introText: null, members: [] };
    await expect(TeamPage({ params })).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("answers a sentence and asks not to be indexed while published with nobody on it", async () => {
    page = { published: true, intro: null, introText: null, members: [] };
    const markup = await html((await TeamPage({ params })) as ReactElement);
    expect(markup).toContain(messages.Team.empty);
    expect(markup).not.toContain('data-testid="team-grid"');
    expect((await generateMetadata({ params })).robots).toEqual({ index: false, follow: true });
  });

  it("draws the cards two to a row on a phone, with the club's introduction and the person's link", async () => {
    page = {
      published: true,
      intro: doc("Cine suntem."),
      introText: "Cine suntem.",
      members: [member("Ana Popescu", [{ kind: "STRAVA", url: "https://www.strava.com/athletes/1", label: null }]), member("Mihai Ionescu")],
    };
    const markup = await html((await TeamPage({ params })) as ReactElement);
    expect(markup).toContain('data-testid="team-grid"');
    expect(markup).toContain("Cine suntem.");
    expect(markup).toMatch(/grid-template-columns:repeat\(2, minmax\(0, 1fr\)\)/);
    expect(markup).toMatch(/grid-template-columns:repeat\(4, minmax\(0, 1fr\)\)/);
    expect(markup).toContain('href="https://www.strava.com/athletes/1"');
    expect(markup).toContain('rel="noopener noreferrer"');
    // A Strava link the club gave no label reads as the network's name, beside its mark (§NNN).
    expect(markup).toContain(">Strava<");
    expect((await generateMetadata({ params })).robots).toBeUndefined();
    expect((await generateMetadata({ params })).description).toBe("Cine suntem.");
  });
});

describe("§NNN the words about a person as rich text, and their links", () => {
  it("draws the club's introduction and each bio through the renderer, with its list and its link", async () => {
    const bio: RichTextDoc = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Aleargă pe " }, { type: "text", text: "Tâmpa", marks: [{ type: "bold" }] }] },
        { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "maraton" }] }] }] },
      ],
    };
    page = { published: true, intro: doc("Cine suntem.", "Ce facem."), introText: "Cine suntem. Ce facem.", members: [member("Ana Popescu", [], bio)] };
    const markup = await html((await TeamPage({ params })) as ReactElement);
    expect(markup).toContain('data-testid="team-intro"');
    expect(markup).toContain("Ce facem.");
    expect(markup).toContain('data-testid="team-bio"');
    expect(markup).toMatch(/<strong[^>]*>Tâmpa<\/strong>/);
    expect(markup).toMatch(/<ul[^>]*>[\s\S]*maraton[\s\S]*<\/ul>/);
    // Without an introduction of the club's, the platform's sentence stands.
    page = { published: true, intro: null, introText: null, members: [member("Ana Popescu")] };
    const plain = await html((await TeamPage({ params })) as ReactElement);
    expect(plain).not.toContain('data-testid="team-intro"');
  });

  it("lists every link in the club's order: its label, else the network's name, else the site's host — each 44 pixels tall", async () => {
    page = {
      published: true,
      intro: null,
      introText: null,
      members: [
        member("Ana Popescu", [
          { kind: "INSTAGRAM", url: "https://instagram.com/ana", label: null },
          { kind: "WEBSITE", url: "https://www.ana-alearga.example/despre", label: null },
          { kind: "OTHER", url: "https://example.org/x", label: "Rezultatele mele" },
        ]),
      ],
    };
    const markup = await html((await TeamPage({ params })) as ReactElement);
    const list = /<ul[^>]*data-testid="team-links"[^>]*>([\s\S]*?)<\/ul>/.exec(markup)?.[1] ?? "";
    expect(markup).toContain('aria-label="Linkuri: Ana Popescu"');
    expect([...list.matchAll(/data-link-kind="([A-Z]+)"/g)].map((match) => match[1])).toEqual(["INSTAGRAM", "WEBSITE", "OTHER"]);
    expect(list).toContain(">Instagram<");
    expect(list).toContain(">ana-alearga.example<");
    expect(list).toContain(">Rezultatele mele<");
    expect(list.match(/target="_blank"/g)).toHaveLength(3);
    expect(list.match(/rel="noopener noreferrer"/g)).toHaveLength(3);
    expect(markup).toMatch(/min-height:44px/);
  });
});
