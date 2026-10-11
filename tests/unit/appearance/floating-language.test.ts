import { type ComponentProps, createElement, type ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * BR-REQ-041-01 (§722, amending §708 and §262) — under «Aspectul nou» the language is one small round
 * button floating in the bottom-right corner, drawn by the footer just above its sticky bar: one press
 * to the language the visitor is not reading, through `/api/locale` (BR-REQ-040-01 criterion 5), named
 * by that language in its own words and showing its flag and code. Off (the default) the footer draws
 * no such button and its bar is what it was. The catalogues are the real ones; Next's navigation is
 * stubbed, and the footer's reads with it.
 */
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const messages = (await import("../../../messages/ro.json")).default;
  return {
    getTranslations: async (namespace: string) => createTranslator({ locale: "ro", messages, namespace: namespace as "Site" }),
    getLocale: async () => "ro",
  };
});
let pathname = "/ro/evenimente";
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useRouter: () => ({ push: () => undefined }),
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactElement }) => createElement("a", { href: `/ro${href}`, ...rest }, children),
  getPathname: ({ href }: { href: string }) => `/ro${href}`,
}));
vi.mock("@/modules/public-cache/reads", () => ({
  cachedShownContactAddresses: async () => [],
  cachedPublicPhone: async () => null,
}));

const { NextIntlClientProvider } = await import("next-intl");
const ro = (await import("../../../messages/ro.json")).default;
const en = (await import("../../../messages/en.json")).default;
const { default: SiteFooter } = await import("@/shared/ui/SiteFooter");
const { default: FloatingLocaleSwitch, FLOATING_SWITCH_SIZE } = await import("@/shared/ui/FloatingLocaleSwitch");

async function render(element: ReactElement, locale: "ro" | "en" = "ro"): Promise<string> {
  const stream = await renderToReadableStream(
    createElement(
      NextIntlClientProvider,
      { locale, messages: locale === "ro" ? ro : en } as unknown as ComponentProps<typeof NextIntlClientProvider>,
      element,
    ),
  );
  await stream.allReady;
  return new Response(stream).text();
}

describe("§722 the language as a floating round button under «Aspectul nou»", () => {
  it("is not in the footer while the setting is off, and the phone's flags stay on the bar", async () => {
    const off = await render((await SiteFooter()) as ReactElement);
    expect(off).not.toContain('data-testid="floating-language"');
    expect(off).toContain('data-testid="footer-language-rule"');
  });

  it("is drawn by the footer while the setting is on: a «Limbă» navigation with one link to the other language", async () => {
    pathname = "/ro/evenimente/tura-pe-tampa";
    const on = await render((await SiteFooter({ newLook: true })) as ReactElement);
    const at = on.indexOf('data-testid="floating-language"');
    expect(at).toBeGreaterThan(-1);
    const tag = on.slice(on.lastIndexOf("<nav", at), on.indexOf(">", at));
    expect(tag).toContain('aria-label="Limbă"');
    const button = on.slice(at, on.indexOf("</nav>", at));
    // `/api/locale` finds the other language's address on the server, so an event's slug never 404s.
    expect(button).toContain('href="/api/locale?to=en&amp;from=%2Fro%2Fevenimente%2Ftura-pe-tampa"');
    expect(button).toContain('rel="nofollow"');
    expect(button).toMatch(/hreflang="en"/i);
    expect(button).toContain('aria-label="English"');
    expect(button).toContain('title="English"');
    expect(button).toContain("/flags/gb.svg");
    expect(button).toContain(">EN</span>");
    // Exactly one link: the current language is the page itself.
    expect(button.match(/<a /g)).toHaveLength(1);
  });

  it("offers Romanian on an English page", async () => {
    pathname = "/en/events";
    const html = await render(createElement(FloatingLocaleSwitch), "en");
    expect(html).toContain('href="/api/locale?to=ro&amp;from=%2Fen%2Fevents"');
    expect(html).toContain('aria-label="Română"');
    expect(html).toContain("/flags/ro.svg");
    expect(html).toContain(">RO</span>");
  });

  it("is a 44-pixel round target, shown only inside the look's scope", async () => {
    expect(FLOATING_SWITCH_SIZE).toBe(44);
    const html = await render(createElement(FloatingLocaleSwitch, { inline: true }));
    // Emotion's styles are in the stream: hidden by default, shown under `data-look="2026"` outside the backoffice.
    expect(html).toContain("display:none");
    expect(html).toContain('html[data-look="2026"]:not(:has([data-backoffice]))');
    expect(html).toContain("width:44px");
    expect(html).toContain("border-radius:50%");
  });
});
