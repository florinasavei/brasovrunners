import { type ComponentProps, createElement, type ReactElement, type ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { RichTextDoc } from "@/modules/content/rich-text/domain/schema";

/**
 * §NNN — «Membri» in the menu: offered only while «Beneficiile membrilor» is published **and** its
 * benefits are written (`offersMembersEntry`, which `SiteHeader` and the sitemap both ask), so a
 * published page with no words never puts the platform's placeholder sentence in every visitor's
 * menu. `SiteNav` draws the entry exactly when the header says so (`showMembers`).
 */
vi.mock("next/navigation", () => ({
  useSelectedLayoutSegments: () => [],
  usePathname: () => "/ro",
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
const { offersMembersEntry } = await import("@/modules/content/members/page-settings");

async function html(element: ReactElement): Promise<string> {
  const stream = await renderToReadableStream(
    createElement(NextIntlClientProvider, { locale: "ro", messages } as unknown as ComponentProps<typeof NextIntlClientProvider>, element),
  );
  await stream.allReady;
  return new Response(stream).text();
}

const benefits: RichTextDoc = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Reducere la magazin." }] }] };

describe("§NNN «Membri» in the menu", () => {
  it("is offered only for a published page whose benefits are written", () => {
    expect(offersMembersEntry({ published: false, benefits: null })).toBe(false);
    expect(offersMembersEntry({ published: false, benefits })).toBe(false);
    expect(offersMembersEntry({ published: true, benefits: null })).toBe(false);
    expect(offersMembersEntry({ published: true, benefits })).toBe(true);
  });

  it("is drawn by the navigation exactly when the header says so", async () => {
    const without = await html(createElement(SiteNav, { showMembers: false, showContact: true }));
    const withMembers = await html(createElement(SiteNav, { showMembers: true, showContact: true }));
    expect(without).not.toContain('href="/ro/members"');
    expect(withMembers).toContain('href="/ro/members"');
    expect(withMembers).toContain(`>${messages.Site.nav.members}<`);
  });
});
