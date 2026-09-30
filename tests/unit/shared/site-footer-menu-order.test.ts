import { type ComponentProps, createElement, type ReactElement, type ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * §571 (amending §406, §525) — the footer's fold carries two of the menu's entries, «Întrebări
 * frecvente» and «Contact», and draws them in the club's one order («Pagini» → «Ordinea
 * meniului»), the header's: «Întrebări frecvente» on the first line after the terms and «Înscrierile
 * mele» while it comes first, as before; placed after «Contact», it follows the contact line.
 *
 * The same stubs as `site-footer.test.ts`, with the FAQ on the site and the stored order ours.
 */
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const messages = (await import("../../../messages/ro.json")).default;
  return {
    getTranslations: async (namespace: string) => createTranslator({ locale: "ro", messages, namespace: namespace as "Site" }),
    getLocale: async () => "ro",
  };
});
vi.mock("next/navigation", () => ({
  usePathname: () => "/ro/evenimente",
  useRouter: () => ({ push: () => undefined }),
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement("a", { href: `/ro${href}`, ...rest }, children),
  getPathname: ({ href }: { href: string }) => `/ro${href}`,
}));
vi.mock("@/modules/public-cache/reads", () => ({
  cachedShownContactAddresses: async () => ["contact@example.org"],
  cachedPublicPhone: async () => null,
}));
vi.mock("@/modules/content/faq/on-site", () => ({ faqOnSite: async () => true }));
let storedOrder: string[] = [];
vi.mock("@/modules/content/menu/on-site", () => ({ menuOrderOnSite: async () => storedOrder }));

const { NextIntlClientProvider } = await import("next-intl");
const messages = (await import("../../../messages/ro.json")).default;
const { default: SiteFooter } = await import("@/shared/ui/SiteFooter");

async function renderFooter(): Promise<string> {
  const footer = (await SiteFooter()) as ReactElement;
  const stream = await renderToReadableStream(
    createElement(NextIntlClientProvider, { locale: "ro", messages } as unknown as ComponentProps<typeof NextIntlClientProvider>, footer),
  );
  await stream.allReady;
  return (await new Response(stream).text()).replace(/<style[^>]*>[\s\S]*?<\/style>/g, "");
}

/** The fold's links to the two menu entries, in the order the markup has them. */
function menuLinks(markup: string): string[] {
  return [...markup.matchAll(/<a[^>]*href="\/ro\/(faq|contact)"/g)].map((match) => match[1]!);
}

describe("§571 the footer's menu entries follow the club's one order", () => {
  it("keeps «Întrebări frecvente» before «Contact» with no stored order, as it always was", async () => {
    storedOrder = [];
    const markup = await renderFooter();
    expect(menuLinks(markup)).toEqual(["faq", "contact"]);
    expect(markup.split('data-testid="footer-faq"').length - 1).toBe(1);
  });

  it("puts «Întrebări frecvente» after «Contact» when the club placed it there, once", async () => {
    storedOrder = ["events", "contact", "calendar", "faq"];
    const markup = await renderFooter();
    expect(menuLinks(markup)).toEqual(["contact", "faq"]);
    expect(markup.split('data-testid="footer-faq"').length - 1).toBe(1);
  });

  it("keeps it first when the club placed it before «Contact»", async () => {
    storedOrder = ["faq", "events", "contact"];
    expect(menuLinks(await renderFooter())).toEqual(["faq", "contact"]);
  });
});
