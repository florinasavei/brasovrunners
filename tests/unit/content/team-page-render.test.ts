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
let page: PublicTeamPage = { published: false, intro: null, boxes: [], introText: null, members: [] };

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
  subtitle: null,
  responsibilities: [],
  bio,
  links,
  photo: null,
  reportsToId: null,
  placement: "below",
});

describe("§459 the team page and its menu entry", () => {
  beforeEach(() => {
    page = { published: false, intro: null, boxes: [], introText: null, members: [] };
  });

  it("offers «Echipa» in the menu only when the header says the page is on the site", async () => {
    const without = await html(createElement(SiteNav, { showTeam: false, showContact: true }));
    const withTeam = await html(createElement(SiteNav, { showTeam: true, showContact: true }));
    expect(without).not.toContain('href="/ro/team"');
    expect(withTeam).toContain('href="/ro/team"');
    expect(withTeam).toContain(">Echipa<");
  });

  it("is a 404 while the page is a draft, whatever the cards say", async () => {
    page = { published: false, intro: null, boxes: [], introText: null, members: [] };
    await expect(TeamPage({ params })).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("answers a sentence and asks not to be indexed while published with nobody on it", async () => {
    page = { published: true, intro: null, boxes: [], introText: null, members: [] };
    const markup = await html((await TeamPage({ params })) as ReactElement);
    expect(markup).toContain(messages.Team.empty);
    expect(markup).not.toContain('data-testid="team-grid"');
    expect((await generateMetadata({ params })).robots).toEqual({ index: false, follow: true });
  });

  it("draws the cards two to a row on a phone, with the club's introduction and the person's link", async () => {
    page = {
      published: true,
      intro: doc("Cine suntem."),
      boxes: [], introText: "Cine suntem.",
      members: [member("Ana Popescu", [{ kind: "STRAVA", url: "https://www.strava.com/athletes/1", label: null }]), member("Mihai Ionescu")],
    };
    const markup = await html((await TeamPage({ params })) as ReactElement);
    expect(markup).toContain('data-testid="team-grid"');
    expect(markup).toContain("Cine suntem.");
    expect(markup).toMatch(/grid-template-columns:repeat\(2, minmax\(0, 1fr\)\)/);
    expect(markup).toMatch(/grid-template-columns:repeat\(4, minmax\(0, 1fr\)\)/);
    expect(markup).toContain('href="https://www.strava.com/athletes/1"');
    expect(markup).toContain('rel="noopener noreferrer"');
    // A Strava link the club gave no label reads as the network's name, beside its mark (§474).
    expect(markup).toContain(">Strava<");
    expect((await generateMetadata({ params })).robots).toBeUndefined();
    expect((await generateMetadata({ params })).description).toBe("Cine suntem.");
  });
});

describe("§474 the words about a person as rich text, and their links", () => {
  it("draws the club's introduction and each bio through the renderer, with its list and its link", async () => {
    const bio: RichTextDoc = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Aleargă pe " }, { type: "text", text: "Tâmpa", marks: [{ type: "bold" }] }] },
        { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "maraton" }] }] }] },
      ],
    };
    page = { published: true, intro: doc("Cine suntem.", "Ce facem."), boxes: [], introText: "Cine suntem. Ce facem.", members: [member("Ana Popescu", [], bio)] };
    const markup = await html((await TeamPage({ params })) as ReactElement);
    expect(markup).toContain('data-testid="team-intro"');
    expect(markup).toContain("Ce facem.");
    expect(markup).toContain('data-testid="team-bio"');
    expect(markup).toMatch(/<strong[^>]*>Tâmpa<\/strong>/);
    expect(markup).toMatch(/<ul[^>]*>[\s\S]*maraton[\s\S]*<\/ul>/);
    // Without an introduction of the club's, the platform's sentence stands.
    page = { published: true, intro: null, boxes: [], introText: null, members: [member("Ana Popescu")] };
    const plain = await html((await TeamPage({ params })) as ReactElement);
    expect(plain).not.toContain('data-testid="team-intro"');
  });

  it("lists every link in the club's order: its label, else the network's name, else the site's host — each 44 pixels tall", async () => {
    page = {
      published: true,
      intro: null,
      boxes: [], introText: null,
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

describe("§691 «Echipa» as an organisational chart, with the page's boxes", () => {
  const card = (name: string, extra: Partial<PublicTeamMember> = {}): PublicTeamMember => ({ ...member(name), ...extra });
  const text = (...paragraphs: string[]) => doc(...paragraphs);

  it("draws the grid, not the chart, while no shown card answers to a shown one — a hidden parent counts for nothing", async () => {
    page = {
      published: true,
      intro: null,
      boxes: [],
      introText: null,
      // «Rol B» answers to a card that is not on the site: the page is the grid it always was.
      members: [card("Președinte"), card("Rol B", { reportsToId: "hidden-card", placement: "below" })],
    };
    const markup = await html((await TeamPage({ params })) as ReactElement);
    expect(markup).toContain('data-testid="team-grid"');
    expect(markup).not.toContain('data-testid="team-chart"');
  });

  it("draws the chart tier by tier once a relation is set: the parent's children under it, a beside card at its tier, hidden cards nowhere", async () => {
    page = {
      published: true,
      intro: null,
      boxes: [],
      introText: null,
      members: [
        card("Președinte", { subtitle: "Linia a doua", responsibilities: ["Strategia", "Partenerii"] }),
        card("Consilier", { reportsToId: "Președinte", placement: "beside" }),
        card("Rol A", { reportsToId: "Președinte", placement: "below" }),
        card("Rol B", { reportsToId: "Președinte", placement: "below" }),
        card("Rol A1", { reportsToId: "Rol A", placement: "below" }),
      ],
    };
    const markup = await html((await TeamPage({ params })) as ReactElement);
    expect(markup).toContain('data-testid="team-chart"');
    expect(markup).not.toContain('data-testid="team-grid"');
    // The sub-role and «Responsabilități» as a list, under the role in the accent colour.
    expect(markup).toContain('data-testid="team-subtitle"');
    expect(markup).toContain(">Linia a doua<");
    expect(markup).toContain(`>${messages.Team.responsibilities}<`);
    expect(markup).toMatch(/<ul[^>]*>[\s\S]*<li>Strategia<\/li><li>Partenerii<\/li>[\s\S]*<\/ul>/);
    // The president's node holds the advisor beside it and the two roles under it; Rol A1 under Rol A.
    expect(markup).toContain('aria-label="Alături de Președinte"');
    expect(markup).toContain('aria-label="Răspund în fața: Președinte"');
    expect(markup).toContain('aria-label="Răspund în fața: Rol A"');
    const order = ["Președinte", "Consilier", "Rol A", "Rol A1", "Rol B"].map((name) => markup.indexOf(`>${name}<`));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // Every card once, with no hidden card: five cards, five nodes.
    expect(markup.match(/data-testid="team-card"/g)).toHaveLength(5);
    expect(markup.match(/data-testid="team-chart-node"/g)).toHaveLength(5);
    // Connectors in CSS, no script: the tier's stems are pseudo-elements on the server's own markup.
    expect(markup).toMatch(/::before/);
    expect(markup).not.toContain("<script");
  });

  it("draws the shown boxes under the chart in order, each a heading and the club's text through the renderer", async () => {
    page = {
      published: true,
      intro: null,
      boxes: [
        { id: "b1", title: "Responsabilitate colectivă", body: text("Proiectul A.") },
        { id: "b2", title: "Parteneriate", body: text("Partener 1.", "Partener 2.") },
      ],
      introText: null,
      members: [card("Președinte"), card("Rol A", { reportsToId: "Președinte", placement: "below" })],
    };
    const markup = await html((await TeamPage({ params })) as ReactElement);
    expect(markup).toContain('data-testid="team-boxes"');
    expect(markup).toContain(`aria-label="${messages.Team.boxesLabel}"`);
    expect(markup.match(/data-testid="team-box"/g)).toHaveLength(2);
    expect(markup.indexOf("Responsabilitate colectivă")).toBeLessThan(markup.indexOf(">Parteneriate<"));
    expect(markup).toContain("Partener 2.");
    // The boxes come after the chart, before the contact line.
    expect(markup.indexOf('data-testid="team-chart"')).toBeLessThan(markup.indexOf('data-testid="team-boxes"'));
    // And the grid keeps its boxes too: the boxes do not need a relation.
    page = { ...page, members: [card("Președinte")] };
    const grid = await html((await TeamPage({ params })) as ReactElement);
    expect(grid).toContain('data-testid="team-grid"');
    expect(grid).toContain('data-testid="team-boxes"');
  });
});
