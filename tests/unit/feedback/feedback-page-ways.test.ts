import { type ComponentProps, createElement, type ReactElement, type ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * BR-REQ-070-04, `DECISIONS.md` §NNN — «Spune-ne ceva» after the owner's round of 2026-10-10: «I need
 * this to be wider», «the back link to have an icon and be bigger», «"alt tip de mesaj" is not clear
 * what it does, not clearly visible». The page as the server draws it, with the real catalogues:
 * - the page is `md` wide, not `sm`;
 * - «Înapoi la Contact» is a button with its arrow, and «Schimbă tipul mesajului» a button with its
 *   glyph beside the branch's name — only when another branch is on;
 * - «Cum a fost» asks «Ce ți-a plăcut, ce nu?», its five faces stand in five columns, and «Dacă nu mai
 *   vii…» is a closed fold that a refusal bringing a tick back opens;
 * - the sent page offers another message.
 */
let locale: "ro" | "en" = "ro";
let draft: Record<string, string> | null = null;
let branches = { howItWent: true, suggestion: true };

vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const catalogues = {
    ro: (await import("../../../messages/ro.json")).default,
    en: (await import("../../../messages/en.json")).default,
  };
  return {
    getTranslations: async (arg: string | { namespace: string }) =>
      createTranslator({ locale, messages: catalogues[locale] as typeof catalogues.ro, namespace: (typeof arg === "string" ? arg : arg.namespace) as "Tell" }),
    getLocale: async () => locale,
    setRequestLocale: () => undefined,
  };
});
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound");
  },
  unstable_rethrow: () => undefined,
  usePathname: () => "/ro/contact/spune-ne",
  useRouter: () => ({ push: () => undefined }),
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement("a", { href: `/${locale}${href}`, ...rest }, children),
  getPathname: ({ href }: { href: string | { pathname: string } }) => `/${locale}${typeof href === "string" ? href : href.pathname}`,
}));
vi.mock("@/modules/public-cache/reads", () => ({
  cachedBotCheckSiteKey: async () => null,
  cachedContactFormReaches: async () => true,
  cachedFeedbackFormsDescribed: async () => true,
  cachedFeedbackFormsNamedDescribed: async () => false,
  cachedFeedbackOffer: async () => ({
    howItWent: { on: branches.howItWent, to: "club@example.org" },
    suggestion: { on: branches.suggestion, to: "club@example.org" },
    complaint: { on: false, to: null },
    safety: { on: false, to: null, name: null },
  }),
  cachedPublishedEventsBetween: async () => [],
}));
vi.mock("@/modules/contact/delivery", () => ({ contactSmtpRoadExists: () => true }));
vi.mock("@/modules/registrations/form-draft", () => ({ readFormDraft: async () => draft }));
vi.mock("@/modules/registrations/ui/BotCheck", () => ({ default: () => null }));
vi.mock("@/app/[locale]/contact/feedback/actions", () => ({ submitFeedbackAction: async () => undefined }));

const { NextIntlClientProvider } = await import("next-intl");
const catalogues = {
  ro: (await import("../../../messages/ro.json")).default,
  en: (await import("../../../messages/en.json")).default,
};
const { default: FeedbackPage } = await import("@/app/[locale]/contact/feedback/page");

async function render(search: Record<string, string>): Promise<string> {
  const page = (await FeedbackPage({ params: Promise.resolve({ locale }), searchParams: Promise.resolve(search) })) as ReactElement;
  const stream = await renderToReadableStream(
    createElement(NextIntlClientProvider, { locale, messages: catalogues[locale] } as unknown as ComponentProps<typeof NextIntlClientProvider>, page),
  );
  await stream.allReady;
  return (await new Response(stream).text()).replace(/<!-- -->/g, "");
}

/** The opening tag of the element carrying `data-testid="<id>"`, and what it holds up to its first close. */
function element(html: string, id: string): string {
  const at = html.indexOf(`data-testid="${id}"`);
  expect(at, id).toBeGreaterThan(-1);
  const start = html.lastIndexOf("<", at);
  return html.slice(start, html.indexOf("</a>", at) + 4);
}

afterEach(() => {
  locale = "ro";
  draft = null;
  branches = { howItWent: true, suggestion: true };
});

describe("BR-REQ-070-04 «Spune-ne ceva», wider and clearer (§NNN)", () => {
  it("is md wide, and «Înapoi la Contact» is a button with its arrow", async () => {
    const html = await render({});
    expect(html).toContain("MuiContainer-maxWidthMd");
    expect(html).not.toContain("MuiContainer-maxWidthSm");
    const back = element(html, "feedback-back");
    expect(back).toMatch(/^<a[^>]*href="\/ro\/contact"/);
    expect(back).toContain("MuiButton-root");
    expect(back).toContain('data-testid="ArrowBackIcon"');
    expect(back).toContain("Înapoi la Contact");
  });

  it.each([
    ["ro", "Schimbă tipul mesajului"],
    ["en", "Change the kind of message"],
  ] as const)("puts «change the kind» as a button beside the branch's name, before the form (%s)", async (lang, words) => {
    locale = lang;
    const html = await render({ tip: "cum-a-fost" });
    const other = element(html, "feedback-other-branches");
    expect(other).toContain("MuiButton-outlined");
    expect(other).toContain('data-testid="SwapHorizIcon"');
    expect(other).toContain(words);
    expect(html.indexOf('data-testid="feedback-other-branches"')).toBeLessThan(html.indexOf("<form"));
  });

  it("draws no «change the kind» button when one branch is on", async () => {
    branches = { howItWent: true, suggestion: false };
    const html = await render({});
    expect(html).toContain('data-testid="feedback-form-cum-a-fost"');
    expect(html).not.toContain('data-testid="feedback-other-branches"');
  });

  it("asks «Ce ți-a plăcut, ce nu?» on «Cum a fost», and draws the five faces in five columns", async () => {
    const html = await render({ tip: "cum-a-fost" });
    expect(html).toContain("Ce ți-a plăcut, ce nu?");
    expect(html).not.toContain("Ce s-a întâmplat?");
    expect(html).toContain("grid-template-columns:repeat(5, minmax(0, 1fr))");
  });

  it("folds «Dacă nu mai vii…» closed, with its boxes inside", async () => {
    const html = await render({ tip: "cum-a-fost" });
    const fold = /<details[^>]*data-testid="feedback-reasons"[^>]*>([\s\S]*?)<\/details>/.exec(html);
    expect(fold, "the fold").not.toBeNull();
    expect(fold![0]).not.toMatch(/<details[^>]*\sopen/);
    expect(fold![1]).toMatch(/<summary[^>]*>[\s\S]*Dacă nu mai vii, ne spui de ce\?<\/summary>/);
    expect(fold![1].match(/name="reasons"/g)).toHaveLength(6);
    expect(fold![1]).toContain('name="reasonOther"');
  });

  it("opens the fold when a refusal brings a tick back", async () => {
    draft = { reasons: "time", message: "" };
    const html = await render({ tip: "cum-a-fost", error: "VALIDATION_ERROR", fields: "message" });
    expect(html).toMatch(/<details[^>]*\sopen=""[^>]*data-testid="feedback-reasons"|<details[^>]*data-testid="feedback-reasons"[^>]*\sopen=""/);
  });

  it.each([
    ["ro", "Trimite alt mesaj"],
    ["en", "Send another message"],
  ] as const)("offers another message on the sent page (%s)", async (lang, words) => {
    locale = lang;
    const html = await render({ sent: "sugestie" });
    expect(html).toContain('data-testid="feedback-sent"');
    const another = element(html, "feedback-send-another");
    expect(another).toMatch(/^<a[^>]*href="\/\w+\/contact\/feedback"/);
    expect(another).toContain(words);
  });
});
