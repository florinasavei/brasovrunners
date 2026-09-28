import { type ComponentProps, createElement, type ReactElement, type ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * `DECISIONS.md` §537 (after §251) — the public menu's order is the owner's: «Evenimente · Calendar · Contact
 * · Echipa · Întrebări frecvente», then the club's own pages in their own order. «Galerie» keeps
 * its slot just before «Echipa» and «Membri» its slot right after «Întrebări frecvente». One list
 * (`SECTIONS` in `SiteNav`) decides the row and the ☰ menu alike, so the rendered anchors' order is
 * the menu's order.
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
          { slug: "despre", title: "Despre" },
          { slug: "istoric", title: "Istoric" },
        ],
      }),
    );
    expect(hrefs(markup)).toEqual(["/ro/events", "/ro/calendar", "/ro/contact", "/ro/team", "/ro/faq", "/ro/pages/despre", "/ro/pages/istoric"]);
  });

  it("keeps «Galerie» just before «Echipa» and «Membri» right after «Întrebări frecvente»", async () => {
    const markup = await html(
      createElement(SiteNav, { showGallery: true, showTeam: true, showFaq: true, showMembers: true, showContact: true }),
    );
    expect(hrefs(markup)).toEqual(["/ro/events", "/ro/calendar", "/ro/contact", "/ro/gallery", "/ro/team", "/ro/faq", "/ro/members"]);
  });
});
