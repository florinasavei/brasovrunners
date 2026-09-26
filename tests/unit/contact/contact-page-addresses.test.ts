import { type ComponentProps, createElement, type ReactElement, type ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * §442 — «Adresa de contact afișată» on the contact page: on a deployment where the form has no
 * way out, the page shows every address in force as its own `mailto:` link, the Gmail first and
 * «sau» between them — the setting's list, not `EMAIL_REPLY_TO` alone.
 *
 * The page rendered on the server with the real Romanian catalogue; the public-cache reads, the
 * draft cookie and the navigation are stubbed (the `site-footer.test.ts` shape).
 */
const MAILBOX = "contact@mail.example.test";
const GMAIL = "club@gmail.example.test";

vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const messages = (await import("../../../messages/ro.json")).default;
  return {
    getTranslations: async (namespace: string) => createTranslator({ locale: "ro", messages, namespace: namespace as "Contact" }),
    getLocale: async () => "ro",
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
  cachedBotCheckSiteKey: async () => null,
  // The form has no way out on this deployment: the page shows the addresses instead.
  cachedContactFormReaches: async () => false,
  cachedShownContactAddresses: async () => [GMAIL, MAILBOX],
  cachedPublishedEventBySlug: async () => null,
}));
vi.mock("@/modules/registrations/form-draft", () => ({ readFormDraft: async () => null }));
vi.mock("@/app/[locale]/contact/actions", () => ({ submitContactAction: async () => undefined }));
vi.mock("@/shared/ui/Wordmark", () => ({ default: () => null }));

const { NextIntlClientProvider } = await import("next-intl");
const messages = (await import("../../../messages/ro.json")).default;
const { default: ContactPage } = await import("@/app/[locale]/contact/page");

async function renderContactPage(): Promise<string> {
  const page = (await ContactPage({ params: Promise.resolve({ locale: "ro" }), searchParams: Promise.resolve({}) })) as ReactElement;
  const stream = await renderToReadableStream(
    createElement(NextIntlClientProvider, { locale: "ro", messages } as unknown as ComponentProps<typeof NextIntlClientProvider>, page),
  );
  await stream.allReady;
  return (await new Response(stream).text()).replace(/<style[^>]*>[\s\S]*?<\/style>/g, "").replace(/<!-- -->/g, "");
}

describe("§442 the contact page shows the addresses in force", () => {
  it("links each address with mailto:, the Gmail first and «sau» between them", async () => {
    const html = await renderContactPage();
    const gmailAt = html.indexOf(`href="mailto:${GMAIL}"`);
    const mailboxAt = html.indexOf(`href="mailto:${MAILBOX}"`);
    expect(gmailAt, "the Gmail's mailto link").toBeGreaterThan(-1);
    expect(mailboxAt, "the mailbox's mailto link").toBeGreaterThan(gmailAt);
    expect(html.slice(gmailAt, mailboxAt)).toContain(" sau ");
  });
});
