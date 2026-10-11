import { type ComponentProps, createElement, type ReactElement, type ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * §NNN — the nav's trailing group, where «Aspectul nou» puts «Vino cu noi» and the socials: drawn
 * before the ☰ on a public page, and not drawn at all inside the backoffice shell (`/admin`,
 * `/devs`), so a staff page carries none of the look's hidden markup and its ☰ keeps `ml: auto`.
 */
const route = vi.hoisted(() => ({ segments: [] as string[] }));

vi.mock("next/navigation", () => ({
  useSelectedLayoutSegments: () => route.segments,
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

async function html(element: ReactElement): Promise<string> {
  const stream = await renderToReadableStream(
    createElement(NextIntlClientProvider, { locale: "ro", messages } as unknown as ComponentProps<typeof NextIntlClientProvider>, element),
  );
  await stream.allReady;
  return new Response(stream).text();
}

const withTrailing = () => createElement(SiteNav, null, createElement("span", { "data-testid": "trailing-child" }, "Vino cu noi"));

describe("§NNN the nav's trailing group", () => {
  it("is drawn before the ☰ on a public page", async () => {
    route.segments = ["events"];
    const markup = await html(withTrailing());
    expect(markup).toContain('data-testid="trailing-child"');
    expect(markup.indexOf('data-testid="trailing-child"')).toBeLessThan(markup.indexOf('id="site-nav-more"'));
  });

  it.each([["admin"], ["devs"]])("is not drawn at all under /%s, the backoffice shell", async (segment) => {
    route.segments = [segment, "settings"];
    const markup = await html(withTrailing());
    expect(markup).not.toContain("trailing-child");
    expect(markup).not.toContain("Vino cu noi");
  });
});
