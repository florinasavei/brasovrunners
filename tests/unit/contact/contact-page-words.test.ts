import { type ComponentProps, createElement, type ReactElement, type ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * §546 — the contact page says less. The owner, 2026-09-28: «AI slop cleanup, spre exemplu pe
 * partea de contact sunt multe texte».
 *
 * The page is rendered on the server with the real catalogues, the form working, the anti-bot check
 * on, the FAQ on the site and the newsletter offered — every sentence it can draw at rest — and its
 * words are counted as a visitor reads them, in each language:
 * - the intro, at most two short sentences of 15 words in all;
 * - everything above the form (the title, the intro, the FAQ's line): at most 120 words;
 * - everything down to the send button (the labels, the one helper left, Cloudflare's line, the
 *   privacy sentence, the button and its line): at most 120 words too.
 *
 * Before this pass the page read 35 (RO) and 44 (EN) words above the form and 109 and 120 down to
 * the send button; after it, 21 and 26, and 90 and 97. What stays is what a rule asks for: the
 * privacy sentence (GDPR art. 13), Cloudflare's line (§323), the newsletter's consent (in its
 * dialog, not counted here).
 */
let locale: "ro" | "en" = "ro";

vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const catalogues = {
    ro: (await import("../../../messages/ro.json")).default,
    en: (await import("../../../messages/en.json")).default,
  };
  return {
    // A name, or `{ locale, namespace }` as the anti-bot island asks for its words.
    getTranslations: async (arg: string | { namespace: string }) =>
      createTranslator({
        locale,
        messages: catalogues[locale] as typeof catalogues.ro,
        namespace: (typeof arg === "string" ? arg : arg.namespace) as "Contact",
      }),
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
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) =>
    createElement("a", { href: `/ro${href}`, ...rest }, children),
  getPathname: ({ href }: { href: string }) => `/ro${href}`,
}));
vi.mock("@/modules/public-cache/reads", () => ({
  cachedBotCheckSiteKey: async () => "site-key-for-the-test",
  cachedContactFormReaches: async () => true,
  cachedShownContactAddresses: async () => ["club@mail.example.test"],
  cachedPublishedEventBySlug: async () => null,
  cachedNewsletterOffered: async () => true,
  cachedEmailWaitMinutes: async () => null,
}));
vi.mock("@/modules/content/faq/on-site", () => ({ faqOnSite: async () => true }));
vi.mock("@/modules/registrations/form-draft", () => ({ readFormDraft: async () => null }));
vi.mock("@/app/[locale]/contact/actions", () => ({
  submitContactAction: async () => undefined,
  submitNewsletterAction: async () => undefined,
  requestNewsletterManageLinkAction: async () => undefined,
}));
vi.mock("@/shared/ui/Wordmark", () => ({ default: () => null }));

const { NextIntlClientProvider } = await import("next-intl");
const catalogues = {
  ro: (await import("../../../messages/ro.json")).default,
  en: (await import("../../../messages/en.json")).default,
};
const { default: ContactPage } = await import("@/app/[locale]/contact/page");

async function renderContactPage(): Promise<string> {
  const page = (await ContactPage({ params: Promise.resolve({ locale }), searchParams: Promise.resolve({}) })) as ReactElement;
  const stream = await renderToReadableStream(
    createElement(NextIntlClientProvider, { locale, messages: catalogues[locale] } as unknown as ComponentProps<typeof NextIntlClientProvider>, page),
  );
  await stream.allReady;
  return (
    (await new Response(stream).text())
      .replace(/<style[^>]*>[\s\S]*?<\/style>/g, "")
      .replace(/<script[^>]*>[\s\S]*?<\/script>/g, "")
      // What nobody sees: an outlined box's notch repeats its label, hidden; a closed `<dialog>`.
      .replace(/<fieldset aria-hidden="true"[\s\S]*?<\/fieldset>/g, "")
      .replace(/<dialog(?![^>]*\sopen)[\s\S]*?<\/dialog>/g, "")
      .replace(/<!-- -->/g, "")
  );
}

/** The words a reader reads in a piece of markup: its text, entities decoded, split on space. */
function words(html: string): string[] {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;|&gt;|&nbsp;/g, " ")
    .split(/\s+/)
    .filter((word) => /[\p{L}\p{N}]/u.test(word));
}

describe("§546 the contact page says what it must and little else", () => {
  for (const lang of ["ro", "en"] as const) {
    it(`keeps the intro to at most two short sentences, 15 words in all (${lang})`, () => {
      const intro = catalogues[lang].Contact.intro;
      expect(words(intro).length, intro).toBeLessThanOrEqual(15);
      expect(intro.split(/[.!?](\s|$)/).filter((part) => part && part.trim()).length, intro).toBeLessThanOrEqual(2);
    });

    it(`reads at most 120 words above the form, and at most 120 down to the send button (${lang})`, async () => {
      locale = lang;
      try {
        const html = await renderContactPage();
        const main = html.slice(html.indexOf('id="main"'));
        const formAt = main.indexOf("<form");
        expect(formAt, "the form is drawn").toBeGreaterThan(0);
        const above = words(main.slice(0, formAt));
        expect(above.length, above.join(" ")).toBeLessThanOrEqual(120);
        const buttonEnd = main.indexOf("</button>", main.indexOf('type="submit"', formAt));
        const toTheButton = words(main.slice(0, buttonEnd));
        expect(toTheButton.length, toTheButton.join(" ")).toBeLessThanOrEqual(120);
        // What a rule asks for is still there: the privacy line and the notice's link (§NNN).
        // Cloudflare's line is not, at rest: it comes with the widget, on the first touch (§NNN).
        const text = words(main).join(" ");
        const contact = catalogues[lang].Contact;
        expect(text).toContain(words(`${contact.privacy} ${contact.privacyLinkLabel}`).join(" "));
        expect(text).not.toContain(words(catalogues[lang].Legal.botCheckNotice).join(" "));
        // The newsletter's box at rest: its heading, one short sentence and the button.
        const box = words(main.slice(main.indexOf('data-testid="newsletter-open"') - 2000, main.indexOf('data-testid="newsletter-open"')));
        const newsletter = catalogues[lang].Newsletter;
        const atRest = [newsletter.heading, newsletter.intro, newsletter.open].flatMap((sentence) => words(sentence));
        expect(box.join(" ")).toContain(words(newsletter.intro).join(" "));
        expect(atRest.length, atRest.join(" ")).toBeLessThanOrEqual(25);
      } finally {
        locale = "ro";
      }
    });
  }

  it("says the privacy line and Cloudflare's line in one short sentence each (§NNN)", () => {
    expect(catalogues.ro.Contact.privacy).toBe("Îți răspundem pe e-mail (Gmail). Păstrăm mesajul cel mult 12 luni.");
    expect(catalogues.en.Contact.privacy).toBe("We answer by e-mail (Gmail). We keep the message for at most 12 months.");
    expect(catalogues.ro.Contact.privacyLinkLabel).toBe("Nota de confidențialitate");
    expect(catalogues.en.Contact.privacyLinkLabel).toBe("Privacy notice");
    expect(catalogues.ro.Legal.botCheckNotice).toBe("Verificarea „nu sunt robot” e făcută de Cloudflare (vede IP-ul și date tehnice ale browserului).");
    expect(catalogues.en.Legal.botCheckNotice).toBe("The “not a robot” check is done by Cloudflare (it sees the IP and technical browser data).");
  });

  it("keeps the words the page lost out of both catalogues", () => {
    for (const catalogue of [catalogues.ro, catalogues.en]) {
      const contact = catalogue.Contact as Record<string, unknown>;
      const newsletter = catalogue.Newsletter as Record<string, unknown>;
      expect(contact.requiredLegend, "Contact.requiredLegend is orphaned").toBeUndefined();
      expect(contact.emailHelp, "Contact.emailHelp is orphaned").toBeUndefined();
      expect(contact.privacyDetails, "Contact.privacyDetails is orphaned").toBeUndefined();
      expect(newsletter.emailHelp, "Newsletter.emailHelp is orphaned").toBeUndefined();
    }
  });
});
