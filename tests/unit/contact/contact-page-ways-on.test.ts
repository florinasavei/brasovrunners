import { type ComponentProps, createElement, type ReactElement, type ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * BR-REQ-070-04, `DECISIONS.md` §NNN — the contact page's ways on: the club's public phone (§565) on the
 * page itself, not only in the footer's fold, as a `tel:` link under the form or the address; the
 * calendar named in the intro, for the newcomer's «when and where do you run?»; and after a send, a
 * button back to an empty form. The page rendered on the server with the real catalogues (the
 * `contact-page-addresses.test.ts` shape).
 */
const PHONE = "+40 700 000 000";

let locale: "ro" | "en" = "ro";
let phone: string | null = PHONE;
let formReaches = true;

vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const catalogues = {
    ro: (await import("../../../messages/ro.json")).default,
    en: (await import("../../../messages/en.json")).default,
  };
  return {
    getTranslations: async (namespace: string) =>
      createTranslator({ locale, messages: catalogues[locale] as typeof catalogues.ro, namespace: namespace as "Contact" }),
    getLocale: async () => locale,
    setRequestLocale: () => undefined,
  };
});
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound");
  },
  unstable_rethrow: () => undefined,
  usePathname: () => "/ro/contact",
  useRouter: () => ({ push: () => undefined }),
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement("a", { href: `/${locale}${href}`, ...rest }, children),
  getPathname: ({ href }: { href: string }) => `/${locale}${href}`,
}));
vi.mock("@/modules/public-cache/reads", () => ({
  cachedBotCheckSiteKey: async () => null,
  cachedContactFormReaches: async () => formReaches,
  cachedShownContactAddresses: async () => ["club@mail.example.test"],
  cachedPublishedEventBySlug: async () => null,
  cachedPublicPhone: async () => phone,
}));
vi.mock("@/modules/content/faq/on-site", () => ({ faqOnSite: async () => false }));
vi.mock("@/modules/registrations/form-draft", () => ({ readFormDraft: async () => null }));
vi.mock("@/app/[locale]/contact/actions", () => ({ submitContactAction: async () => undefined }));
vi.mock("@/shared/ui/Wordmark", () => ({ default: () => null }));
vi.mock("@/shared/feedback/PublicFlash", () => ({ default: () => null }));

const { NextIntlClientProvider } = await import("next-intl");
const catalogues = {
  ro: (await import("../../../messages/ro.json")).default,
  en: (await import("../../../messages/en.json")).default,
};
const { default: ContactPage } = await import("@/app/[locale]/contact/page");

async function render(search: Record<string, string> = {}): Promise<string> {
  const page = (await ContactPage({ params: Promise.resolve({ locale }), searchParams: Promise.resolve(search) })) as ReactElement;
  const stream = await renderToReadableStream(
    createElement(NextIntlClientProvider, { locale, messages: catalogues[locale] } as unknown as ComponentProps<typeof NextIntlClientProvider>, page),
  );
  await stream.allReady;
  return (await new Response(stream).text()).replace(/<style[^>]*>[\s\S]*?<\/style>/g, "").replace(/<!-- -->/g, "");
}

afterEach(() => {
  locale = "ro";
  phone = PHONE;
  formReaches = true;
});

describe("BR-REQ-070-04 the contact page's ways on (§NNN)", () => {
  it.each([
    ["ro", "Sau sună-ne la"],
    ["en", "Or call us at"],
  ] as const)("shows the club's phone as a tel: link under the form (%s)", async (lang, lead) => {
    locale = lang;
    const html = await render();
    const line = /<p[^>]*data-testid="contact-phone"[^>]*>([\s\S]*?)<\/p>/.exec(html);
    expect(line, "the phone's line").not.toBeNull();
    expect(line![1]).toContain(lead);
    expect(line![1]).toContain(`href="tel:+40700000000"`);
    expect(line![1]).toContain(PHONE);
    // Under the form, and above «Spune-ne ceva» and the newsletter wherever they are drawn.
    expect(html.indexOf('data-testid="contact-phone"')).toBeGreaterThan(html.indexOf("</form>"));
  });

  it("shows the phone where there is no form too, and no line when no number is set", async () => {
    formReaches = false;
    expect(await render()).toContain('data-testid="contact-phone"');
    phone = null;
    expect(await render()).not.toContain('data-testid="contact-phone"');
  });

  it("names the calendar in the intro, in both languages", async () => {
    for (const lang of ["ro", "en"] as const) {
      locale = lang;
      const html = await render();
      expect(html).toMatch(new RegExp(`<a[^>]*href="/${lang}/calendar"[^>]*data-testid="contact-calendar-link"[^>]*>Calendar</a>`));
      // Before the form: it answers the question before anybody types it.
      expect(html.indexOf('data-testid="contact-calendar-link"')).toBeLessThan(html.indexOf("<form"));
    }
  });

  it.each([
    ["ro", "Scrie alt mesaj"],
    ["en", "Write another message"],
  ] as const)("after a send, offers an empty form again and leaves the phone out (%s)", async (lang, words) => {
    locale = lang;
    const html = await render({ sent: "1" });
    expect(html).not.toContain("<form action");
    expect(html).toMatch(new RegExp(`<a[^>]*href="/${lang}/contact"[^>]*data-testid="contact-send-another"[^>]*>[\\s\\S]*?${words}</a>`));
    expect(html).not.toContain('data-testid="contact-phone"');
  });
});
