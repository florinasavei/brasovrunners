import { type ComponentProps, createElement, type ReactElement, type ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * BR-REQ-070-04, `DECISIONS.md` §NNN — the contact page's ways on: the club's public phone (§565) on the
 * page itself, not only in the footer's fold, as a `tel:` link in «Contact direct», above the form; the
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
    ["ro", "Sună-ne la"],
    ["en", "Call us at"],
  ] as const)("shows the club's phone as a tel: link above the form (%s)", async (lang, lead) => {
    locale = lang;
    const html = await render();
    const line = /<p[^>]*data-testid="contact-phone"[^>]*>([\s\S]*?)<\/p>/.exec(html);
    expect(line, "the phone's line").not.toBeNull();
    expect(line![1]).toContain(lead);
    expect(line![1]).toContain(`href="tel:+40700000000"`);
    expect(line![1]).toContain(PHONE);
    // Above the form (§NNN; the owner: yes to the ways above the form), under the intro.
    expect(html.indexOf('data-testid="contact-phone"')).toBeLessThan(html.indexOf("<form"));
    expect(html.indexOf('data-testid="contact-phone"')).toBeGreaterThan(html.indexOf('data-testid="contact-calendar-link"'));
  });

  it.each([
    ["ro", "Contact direct", "Scrie-ne la", "Trimite-ne un mesaj"],
    ["en", "Reach us directly", "Write to us at", "Send us a message"],
  ] as const)("draws «Contact direct» above the form, then the form as its own section with its heading (%s)", async (lang, title, lead, formTitle) => {
    locale = lang;
    const html = await render();
    const section = /<section[^>]*data-testid="contact-ways"[^>]*>([\s\S]*?)<\/section>/.exec(html);
    expect(section, "the section").not.toBeNull();
    expect(section![0]).toMatch(/^<section[^>]*aria-labelledby="contact-ways-heading"/);
    expect(section![1]).toMatch(new RegExp(`<h2[^>]*id="contact-ways-heading"[^>]*>[\\s\\S]*?data-testid="ContactPhoneOutlinedIcon"[\\s\\S]*?${title}</h2>`));
    expect(section![1]).toContain('data-testid="EmailOutlinedIcon"');
    expect(section![1]).toContain('data-testid="PhoneOutlinedIcon"');
    expect(section![1]).toContain(lead);
    expect(section![1]).toContain('href="mailto:club@mail.example.test"');
    // Above the form, which is its own section under its own heading and glyph.
    expect(html.indexOf('data-testid="contact-ways"')).toBeLessThan(html.indexOf("<form"));
    const form = /<section[^>]*data-testid="contact-form-section"[^>]*>([\s\S]*?)<\/section>/.exec(html);
    expect(form, "the form's section").not.toBeNull();
    expect(form![0]).toMatch(/^<section[^>]*aria-labelledby="contact-form-heading"/);
    expect(form![1]).toMatch(new RegExp(`^<h2[^>]*id="contact-form-heading"[^>]*>[\\s\\S]*?data-testid="SendOutlinedIcon"[\\s\\S]*?${formTitle}</h2>`));
    expect(form![1]).toContain("<form");
  });

  it("gives every section's heading a glyph, the page's title too", async () => {
    const html = await render();
    expect(html).toMatch(/<h1[^>]*>[\s\S]*?data-testid="ForumOutlinedIcon"[\s\S]*?Scrie-ne<\/h1>/);
  });

  it("with no form, «Contact direct» gives the address and the phone, and the form's section says there is none", async () => {
    formReaches = false;
    const html = await render();
    expect(html).toContain('data-testid="contact-phone"');
    expect(html).toContain('href="mailto:club@mail.example.test"');
    expect(html).toContain(catalogues.ro.Contact.off.none);
    // No form, no heading for it.
    expect(html).not.toContain('id="contact-form-heading"');
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
  ] as const)("after a send, offers an empty form again under «Contact direct», which stays (%s)", async (lang, words) => {
    locale = lang;
    const html = await render({ sent: "1" });
    expect(html).not.toContain("<form action");
    expect(html).toMatch(new RegExp(`<a[^>]*href="/${lang}/contact"[^>]*data-testid="contact-send-another"[^>]*>[\\s\\S]*?${words}</a>`));
    expect(html).toContain('data-testid="contact-phone"');
    expect(html).not.toContain('id="contact-form-heading"');
  });
});
