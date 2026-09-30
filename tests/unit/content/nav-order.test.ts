import { type ComponentProps, createElement, type ReactElement, type ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * `DECISIONS.md` §537 (after §251) — the public menu's order is the owner's: «Evenimente · Calendar · Contact
 * · Echipa · Întrebări frecvente», then the club's own pages in their own order. «Galerie» keeps
 * its slot just before «Echipa» and «Membri» its slot right after «Întrebări frecvente». One list
 * (`SECTIONS` in `SiteNav`) decides the row and the ☰ menu alike, so the rendered anchors' order is
 * the menu's order.
 *
 * Since §571 that order is only the default: the club's one stored order («Pagini» → «Ordinea
 * meniului», the `order` prop) sorts the sections and the pages together, and the rule that stood
 * between the two groups is gone.
 */
vi.mock("next/navigation", () => ({
  useSelectedLayoutSegments: () => [],
  usePathname: () => "/ro",
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: { href: string | { pathname: string; params?: { slug: string } }; children: ReactNode }) =>
    createElement(
      "a",
      {
        href:
          typeof href === "string"
            ? `/ro${href}`
            : `/ro${href.params ? href.pathname.replace("[slug]", href.params.slug) : href.pathname}`,
        ...rest,
      },
      children,
    ),
  getPathname: ({ href }: { href: string }) => `/ro${href}`,
}));

const { NextIntlClientProvider } = await import("next-intl");
const messages = (await import("../../../messages/ro.json")).default;
const { default: SiteNav } = await import("@/shared/ui/SiteNav");

async function html(element: ReactElement): Promise<string> {
  const stream = await renderToReadableStream(
    createElement(NextIntlClientProvider, { locale: "ro", messages } as unknown as ComponentProps<typeof NextIntlClientProvider>, element),
  );
  await stream.allReady;
  return new Response(stream).text();
}

const DESPRE = "11111111-1111-4111-8111-111111111111";
const ISTORIC = "22222222-2222-4222-8222-222222222222";

function hrefs(markup: string): string[] {
  return [...markup.matchAll(/<a[^>]*href="([^"]+)"/g)].map((match) => match[1]);
}

describe("§537 the public menu's order", () => {
  it("is Evenimente, Calendar, Contact, Echipa, Întrebări frecvente, then the club's pages", async () => {
    const markup = await html(
      createElement(SiteNav, {
        showTeam: true,
        showFaq: true,
        showContact: true,
        pages: [
          { id: DESPRE, slug: "despre", title: "Despre" },
          { id: ISTORIC, slug: "istoric", title: "Istoric" },
        ],
      }),
    );
    expect(hrefs(markup)).toEqual(["/ro/events", "/ro/calendar", "/ro/contact", "/ro/team", "/ro/faq", "/ro/pages/despre", "/ro/pages/istoric"]);
  });

  it("keeps «Galerie» just before «Echipa», and no «Membri» in the menu (§591: it is the footer's)", async () => {
    const markup = await html(
      createElement(SiteNav, { showGallery: true, showTeam: true, showFaq: true, showContact: true }),
    );
    expect(hrefs(markup)).toEqual(["/ro/events", "/ro/calendar", "/ro/contact", "/ro/gallery", "/ro/team", "/ro/faq"]);
  });
});

describe("§571 the club's one menu order", () => {
  const pages = [
    { id: DESPRE, slug: "despre", title: "Despre" },
    { id: ISTORIC, slug: "istoric", title: "Istoric" },
  ];

  it("puts a custom page before «Evenimente» and «Contact» after it, where the club placed them", async () => {
    const markup = await html(
      createElement(SiteNav, {
        showTeam: true,
        showFaq: true,
        showContact: true,
        pages,
        order: [`page:${ISTORIC}`, "events", "calendar", `page:${DESPRE}`, "contact", "faq", "team"],
      }),
    );
    expect(hrefs(markup)).toEqual(["/ro/pages/istoric", "/ro/events", "/ro/calendar", "/ro/pages/despre", "/ro/contact", "/ro/faq", "/ro/team"]);
  });

  it("leaves an entry the order does not name at the end, in its default place, and skips one the menu does not offer", async () => {
    const markup = await html(
      createElement(SiteNav, {
        showContact: true,
        pages,
        // «Echipa» is placed but not offered; «Istoric» is offered but not placed.
        order: ["contact", "team", `page:${DESPRE}`, "events"],
      }),
    );
    expect(hrefs(markup)).toEqual(["/ro/contact", "/ro/pages/despre", "/ro/events", "/ro/calendar", "/ro/pages/istoric"]);
  });

  it("draws no rule between the sections and the pages: one list", async () => {
    const markup = await html(createElement(SiteNav, { showContact: true, pages }));
    expect(markup).not.toContain("<hr");
    expect(markup).not.toMatch(/key="divider"|width:1px;height:20px/);
  });
});
