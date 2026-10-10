import { type ComponentProps, createElement, type ReactElement, type ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RichTextDoc } from "@/modules/content/rich-text/domain/schema";
import type { PublicTeamLink, PublicTeamMember, PublicTeamPage, TeamPhoto } from "@/modules/content/team/repository";
import { ladderKeyPrefixOf, pictureSizes } from "@/modules/media/ladder";

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
  level: null,
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

describe("§NNN «Echipa» as a canvas with levels, each card opening in place, with the page's boxes (amending §691)", () => {
  const card = (name: string, extra: Partial<PublicTeamMember> = {}): PublicTeamMember => ({ ...member(name), ...extra });
  const text = (...paragraphs: string[]) => doc(...paragraphs);
  const boxes = [
    { id: "b1", title: "Responsabilitate colectivă", body: text("Proiectul A.") },
    { id: "b2", title: "Parteneriate", body: text("Partener 1.", "Partener 2.") },
  ];
  const variants = (markup: string) => [...markup.matchAll(/data-testid="team-canvas-card" data-variant="(\w+)"/g)].map((match) => match[1]);

  it("draws the grid, not the canvas, while no shown card has a level — and the boxes under the grid", async () => {
    page = { published: true, intro: null, boxes, introText: null, members: [card("Președinte"), card("Rol A", { subtitle: "Linia a doua" })] };
    const markup = await html((await TeamPage({ params })) as ReactElement);
    expect(markup).toContain('data-testid="team-grid"');
    expect(markup).not.toContain('data-testid="team-canvas"');
    expect(markup.match(/data-testid="team-card"/g)).toHaveLength(2);
    expect(markup).toContain(">Linia a doua<");
    // The boxes under the grid, in order, a heading and the club's text through the renderer (§691).
    expect(markup).toContain('data-testid="team-boxes"');
    expect(markup).toContain(`aria-label="${messages.Team.boxesLabel}"`);
    expect(markup.match(/data-testid="team-box"/g)).toHaveLength(2);
    expect(markup.indexOf('data-testid="team-grid"')).toBeLessThan(markup.indexOf('data-testid="team-boxes"'));
    expect(markup.indexOf("Responsabilitate colectivă")).toBeLessThan(markup.indexOf(">Parteneriate<"));
    expect(markup).toContain("Partener 2.");
  });

  it("draws the canvas once a card has a level: the president wide, the counsellor small beside her, the team tall under, the rest in the grid", async () => {
    const bio: RichTextDoc = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Aleargă de douăzeci de ani." }] }] };
    page = {
      published: true,
      intro: null,
      boxes,
      introText: null,
      members: [
        card("Președinte", {
          level: 1,
          subtitle: "Linia a doua",
          responsibilities: ["Strategia", "Partenerii", "Bugetul", "Voluntarii"],
          bio,
          links: [{ kind: "STRAVA", url: "https://www.strava.com/athletes/1", label: null }],
        }),
        card("Sfătuitor", { level: 1.5, responsibilities: ["Comunicarea"] }),
        card("Rol A", { level: 2 }),
        card("Rol B", { level: 2 }),
        card("Rol C", { level: 2.5 }),
        card("Rol D"),
      ],
    };
    const markup = await html((await TeamPage({ params })) as ReactElement);
    expect(markup).toContain('data-testid="team-canvas"');
    // The canvas is «Oamenii echipei»; the grid under it is a second list with a name of its own.
    expect(markup.match(new RegExp(`aria-label="${messages.Team.listLabel}"`, "g"))).toHaveLength(1);
    expect(markup).toMatch(new RegExp(`<ul[^>]*aria-label="${messages.Team.othersLabel}"[^>]*data-testid="team-grid"`));
    // Two rows, by whole number; the shapes by the level's step.
    expect([...markup.matchAll(/data-testid="team-canvas-row" data-level="(\d)"/g)].map((match) => match[1])).toEqual(["1", "2"]);
    expect(variants(markup)).toEqual(["wide", "small", "tall", "tall", "small"]);
    // The club's order within a row and down the canvas, then the grid with the card that has no level.
    const order = ["Președinte", "Sfătuitor", "Rol A", "Rol B", "Rol C", "Rol D"].map((name) => markup.indexOf(`>${name}<`));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(markup).toContain('data-testid="team-grid"');
    expect(markup.match(/data-testid="team-card"/g)).toHaveLength(1);
    expect(markup.indexOf('data-testid="team-canvas"')).toBeLessThan(markup.indexOf('data-testid="team-grid"'));
    // Closed, the president's card shows the sub-role, the role title and the first three responsibilities.
    expect(markup).toContain('data-testid="team-subtitle"');
    expect(markup).toContain(">Linia a doua<");
    expect(markup).toContain(`>${messages.Team.responsibilities}<`);
    expect(markup).toMatch(/data-testid="team-responsibilities"[\s\S]*?<li>Strategia<\/li><li>Partenerii<\/li><li>Bugetul<\/li><\/ul>/);
    // «Mai multe»: a closed fold on the card, no script, the person's name in its accessible name, 44 pixels tall.
    const fold = /<details[^>]*data-testid="team-more"[^>]*>([\s\S]*?)<\/details>/.exec(markup)?.[1] ?? "";
    expect(fold).toContain(`aria-label="Mai multe despre Președinte"`);
    expect(fold).toContain(`${messages.Team.more}</summary>`);
    expect(markup).not.toMatch(/<details[^>]*\sopen/);
    expect(markup).not.toContain("<script");
    // Open, the fourth responsibility continues the list, then the words about the person and the links.
    expect(fold).toMatch(/data-testid="team-responsibilities-rest"[\s\S]*?<li>Voluntarii<\/li>/);
    expect(fold).toContain('data-testid="team-bio"');
    expect(fold).toContain("Aleargă de douăzeci de ani.");
    expect(fold).toContain('href="https://www.strava.com/athletes/1"');
    expect(fold).toContain('rel="noopener noreferrer"');
    expect(markup).toMatch(/min-height:44px/);
    // A card with nothing beyond its three lines has no fold at all.
    expect(markup.match(/data-testid="team-more"/g)).toHaveLength(1);
    // The boxes at the bottom of the canvas, three across from `md`, and nowhere else.
    expect(markup.match(/data-testid="team-boxes"/g)).toHaveLength(1);
    expect(markup.indexOf('data-testid="team-boxes"')).toBeLessThan(markup.indexOf('data-testid="team-grid"'));
    expect(markup.match(/data-testid="team-box"/g)).toHaveLength(2);
    expect(markup).toContain("Partener 2.");
    // The canvas's rows: the top row a wrapping flex row from `md`, the rows under a grid of three from `md`.
    expect([...markup.matchAll(/data-testid="team-canvas-row" data-level="\d" data-layout="(\w+)"/g)].map((match) => match[1])).toEqual(["wide", "grid"]);
    expect(markup).toMatch(/grid-template-columns:repeat\(3, minmax\(0, 1fr\)\)/);
  });

  it("draws the wide shape only for a single lead on the top row: two leads are tall in the grid, and three small cards wrap beside one wide card", async () => {
    // Every card set to level 2 while the president's is hidden: five leads on the top row, none wide.
    page = { published: true, intro: null, boxes: [], introText: null, members: ["Rol A", "Rol B", "Rol C", "Rol D", "Rol E"].map((name) => card(name, { level: 2 })) };
    const five = await html((await TeamPage({ params })) as ReactElement);
    expect(variants(five)).toEqual(["tall", "tall", "tall", "tall", "tall"]);
    expect(five).toMatch(/data-testid="team-canvas-row" data-level="2" data-layout="grid"/);
    // Two presidents at level 1: still the grid, neither crushed against the other.
    page = { ...page, members: [card("Președinte", { level: 1 }), card("Vicepreședinte", { level: 1 }), card("Sfătuitor", { level: 1.5 })] };
    const two = await html((await TeamPage({ params })) as ReactElement);
    expect(variants(two)).toEqual(["tall", "tall", "small"]);
    expect(two).toMatch(/data-testid="team-canvas-row" data-level="1" data-layout="grid"/);
    expect(two).not.toMatch(/flex-wrap:wrap/);
    // One president and three counsellors: the wide card keeps its 480-pixel floor from `md`, the
    // small cards their 280-pixel column, and the row wraps rather than overflowing the canvas.
    page = { ...page, members: [card("Președinte", { level: 1 }), card("Sfătuitor A", { level: 1.5 }), card("Sfătuitor B", { level: 1.5 }), card("Sfătuitor C", { level: 1.5 })] };
    const three = await html((await TeamPage({ params })) as ReactElement);
    expect(variants(three)).toEqual(["wide", "small", "small", "small"]);
    expect(three).toMatch(/data-testid="team-canvas-row" data-level="1" data-layout="wide"/);
    expect(three).toMatch(/flex-wrap:wrap/);
    expect(three).toMatch(/@media \(min-width:900px\)\{[^}]*flex-basis:480px/);
    expect(three).toMatch(/@media \(min-width:900px\)\{[^}]*min-width:480px/);
    expect(three).toMatch(/@media \(min-width:900px\)\{[^}]*flex:0 0 280px/);
  });

  it("sizes each shape's photo for the column it is drawn in (§414): cover for tall, the 240/280 column for wide, the thumbnail for small", async () => {
    const prefix = ladderKeyPrefixOf("3f2a1b4c-0000-4abc-8def-000000000002");
    const photo: TeamPhoto = {
      webUrl: `https://pub-example.r2.dev/production/${prefix}/web.webp`,
      thumbUrl: `https://pub-example.r2.dev/production/${prefix}/thumb.webp`,
      width: 1600,
      height: 1600,
      crop: null,
    };
    page = {
      published: true,
      intro: null,
      boxes: [],
      introText: null,
      members: [card("Președinte", { level: 1, photo }), card("Sfătuitor", { level: 1.5, photo }), card("Rol A", { level: 2, photo })],
    };
    const markup = await html((await TeamPage({ params })) as ReactElement);
    const sizesByVariant = [...markup.matchAll(/data-variant="(\w+)"[^]*?<img[^>]*\ssizes="([^"]+)"/g)].map((match) => [match[1], match[2]]);
    expect(sizesByVariant).toEqual([
      ["wide", pictureSizes("aside")],
      ["small", pictureSizes("thumb")],
      ["tall", pictureSizes("cover")],
    ]);
    // On a phone a tall card is the canvas's whole width — never half of it, as a tile would say.
    expect(pictureSizes("cover")).toMatch(/calc\(100vw - 32px\)$/);
    expect(markup).toContain(`srcSet="https://pub-example.r2.dev/production/${prefix}/`);
  });

  it("draws a lone 1.5 as a row of one small card, and the grid under it, with no boxes when there are none", async () => {
    page = { published: true, intro: null, boxes: [], introText: null, members: [card("Sfătuitor", { level: 1.5 }), card("Rol A")] };
    const markup = await html((await TeamPage({ params })) as ReactElement);
    expect(variants(markup)).toEqual(["small"]);
    expect(markup).toContain('data-testid="team-grid"');
    expect(markup).not.toContain('data-testid="team-boxes"');
    // Row 2's `.5` alone: small, in the grid of the rows under the top.
    page = { ...page, members: [card("Președinte", { level: 1 }), card("Rol C", { level: 2.5 })] };
    const two = await html((await TeamPage({ params })) as ReactElement);
    expect(variants(two)).toEqual(["wide", "small"]);
    expect(two).not.toContain('data-testid="team-grid"');
  });
});
