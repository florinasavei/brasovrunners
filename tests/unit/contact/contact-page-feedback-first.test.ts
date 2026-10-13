import { type ComponentProps, createElement, type ReactElement, type ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * BR-REQ-070-04, `DECISIONS.md` §NNN (amending §721, §698) — the owner, 2026-10-13: «on the contact page
 * the feedback form (if active) should come first». Rendered on the server with the real catalogues:
 * with the feedback forms offered the order is «Spune-ne ceva», «Trimite-ne un mesaj», «Contact direct»;
 * without, the form is first and no «Spune-ne ceva» is drawn; one `h1`. The rules are pinned at source
 * level in `tests/unit/newsletter/contact-page-order.test.ts`.
 */
let locale: "ro" | "en" = "ro";
let offered = true;

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
  cachedContactFormReaches: async () => true,
  cachedShownContactAddresses: async () => ["club@mail.example.test"],
  cachedPublishedEventBySlug: async () => null,
  cachedPublicPhone: async () => null,
  cachedNewsletterOffered: async () => false,
  cachedFeedbackFormsDescribed: async () => true,
  cachedFeedbackOffer: async () => ({
    howItWent: { on: offered, to: "club@mail.example.test" },
    suggestion: { on: false, to: null },
    complaint: { on: false, to: null },
    safety: { on: false, to: null, name: null },
  }),
}));
vi.mock("@/modules/contact/delivery", () => ({ contactSmtpRoadExists: () => true }));
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
  offered = true;
});

describe("BR-REQ-070-04 «Spune-ne ceva» first when it is offered (§NNN)", () => {
  it.each(["ro", "en"] as const)("draws «Spune-ne ceva», the form, «Contact direct», in that order (%s)", async (lang) => {
    locale = lang;
    const html = await render();
    const feedback = html.indexOf('data-testid="feedback-section"');
    const form = html.indexOf('data-testid="contact-form-section"');
    const ways = html.indexOf('data-testid="contact-ways"');
    for (const [name, at] of Object.entries({ feedback, form, ways })) expect(at, name).toBeGreaterThan(-1);
    expect(feedback).toBeLessThan(form);
    expect(form).toBeLessThan(ways);
    // The intro stays above everything, and there is one h1.
    expect(html.indexOf("<h1")).toBeLessThan(feedback);
    expect(html.match(/<h1\b/g)).toHaveLength(1);
  });

  it("keeps today's order, the form first and no «Spune-ne ceva», when the forms are not offered", async () => {
    offered = false;
    const html = await render();
    expect(html).not.toContain('data-testid="feedback-section"');
    expect(html.indexOf('data-testid="contact-form-section"')).toBeLessThan(html.indexOf('data-testid="contact-ways"'));
  });
});
