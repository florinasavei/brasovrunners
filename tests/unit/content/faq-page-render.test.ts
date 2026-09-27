import { type ComponentProps, createElement, type ReactElement, type ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicFaqItem, PublicFaqPage } from "@/modules/content/faq/repository";
import type { RichTextDoc } from "@/modules/content/rich-text/domain/schema";

/**
 * §NNN — «Întrebări frecvente» as the server sends it: the menu offers the page only when the
 * header says so (`showFaq`), the page is a 404 while a DRAFT, a published page with no question
 * answers a sentence and asks not to be indexed, and a page with questions draws each as a native
 * fold — working with JavaScript off — with the same questions as an `FAQPage` in JSON-LD.
 *
 * The catalogue is the real Romanian one; the public cache and Next's navigation are stubbed.
 */
let page: PublicFaqPage = { published: false, items: [] };

vi.mock("@/modules/public-cache/reads", () => ({ cachedFaqPage: async () => page }));
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const messages = (await import("../../../messages/ro.json")).default;
  const translator = (namespace: string) => createTranslator({ locale: "ro", messages, namespace: namespace as "Faq" });
  return {
    getTranslations: async (arg: string | { namespace: string }) => translator(typeof arg === "string" ? arg : arg.namespace),
    setRequestLocale: () => undefined,
    getLocale: async () => "ro",
  };
});
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  unstable_rethrow: () => undefined,
  useSelectedLayoutSegments: () => ["faq"],
  usePathname: () => "/ro/intrebari-frecvente",
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
const { default: FaqPage, generateMetadata } = await import("@/app/[locale]/faq/page");

async function html(element: ReactElement): Promise<string> {
  const stream = await renderToReadableStream(
    createElement(NextIntlClientProvider, { locale: "ro", messages } as unknown as ComponentProps<typeof NextIntlClientProvider>, element),
  );
  await stream.allReady;
  return new Response(stream).text();
}

const params = Promise.resolve({ locale: "ro" });
const doc = (text: string): RichTextDoc => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
const item = (id: string, question: string, answer: string): PublicFaqItem => ({ id, question, answer: doc(answer), answerText: answer });

describe("§NNN the FAQ page and its menu entry", () => {
  beforeEach(() => {
    page = { published: false, items: [] };
  });

  it("offers «Întrebări» in the menu only when the header says the page is on the site", async () => {
    const without = await html(createElement(SiteNav, { showFaq: false, showContact: true }));
    const withFaq = await html(createElement(SiteNav, { showFaq: true, showContact: true }));
    expect(without).not.toContain('href="/ro/faq"');
    expect(withFaq).toContain('href="/ro/faq"');
    expect(withFaq).toContain(`>${messages.Site.nav.faq}<`);
  });

  it("is a 404 while the page is a draft", async () => {
    await expect(FaqPage({ params })).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("answers a sentence, no JSON-LD, and asks not to be indexed while published with no question on it", async () => {
    page = { published: true, items: [] };
    const markup = await html((await FaqPage({ params })) as ReactElement);
    expect(markup).toContain(messages.Faq.empty);
    expect(markup).not.toContain("application/ld+json");
    expect((await generateMetadata({ params })).robots).toEqual({ index: false, follow: true });
  });

  it("draws each question as a closed native fold over its answer, and the same questions as an FAQPage", async () => {
    page = {
      published: true,
      items: [item("11111111-aaaa", "Cum mă înscriu?", "Din pagina evenimentului."), item("22222222-bbbb", "Ce aduc?", "Apă și o frontală.")],
    };
    const markup = await html((await FaqPage({ params })) as ReactElement);
    const folds = markup.match(/<details[^>]*>/g) ?? [];
    expect(folds).toHaveLength(2);
    // Closed until pressed, each addressable by `#q-…` for a link to one question.
    for (const fold of folds) expect(fold).not.toMatch(/\sopen(=|\s|>)/);
    expect(markup).toContain('id="q-11111111"');
    expect(markup).toMatch(/<summary[^>]*>[\s\S]*?Cum mă înscriu\?[\s\S]*?<\/summary>/);
    expect(markup).toContain("Din pagina evenimentului.");
    // The fold's summary is a 44-pixel target (BR-REQ-041-01 criterion 6).
    expect(markup).toMatch(/min-height:44px/);

    const json = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(markup)?.[1];
    expect(json).toBeTruthy();
    const data = JSON.parse(json!.replace(/\\u003c/g, "<"));
    expect(data["@type"]).toBe("FAQPage");
    expect(data.mainEntity.map((entry: { name: string }) => entry.name)).toEqual(["Cum mă înscriu?", "Ce aduc?"]);
    expect(data.mainEntity[1].acceptedAnswer).toEqual({ "@type": "Answer", text: "Apă și o frontală." });
    expect((await generateMetadata({ params })).robots).toBeUndefined();
  });
});
