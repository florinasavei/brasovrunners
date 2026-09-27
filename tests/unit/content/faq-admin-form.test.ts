import { type ComponentProps, createElement, type ReactElement, type ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminFaqItem } from "@/modules/content/faq/repository";
import type { ConfirmSpec } from "@/shared/feedback/notice";

/**
 * §NNN — «Întrebări frecvente» in the backoffice, as the server draws its one form:
 *
 * - the form's default button — the one Enter in any box presses, the first submit button in
 *   tree order — is the plain save, never a card's ↑/↓ (the review of 2026-09-28: Enter in card 1
 *   moved the question down);
 * - the spare card's «Pe site» asks first only when a question is typed on it.
 *
 * The catalogue is the real Romanian one; the session, the rows, the editors and the form island
 * are stubbed — the island records the dialogs it was handed and draws a plain `<form>`.
 */
const ITEMS: AdminFaqItem[] = [1, 2].map((n) => ({
  id: `00000000-0000-4000-8000-00000000000${n}`,
  questionRo: `Întrebarea ${n}?`,
  questionEn: `Question ${n}?`,
  categoryRo: null,
  categoryEn: null,
  answerRo: null,
  answerEn: null,
  position: n,
  visible: false,
  version: 1,
  updatedAt: new Date("2026-09-28T10:00:00Z"),
}));

const forms = vi.hoisted(() => [] as Array<{ testId?: string; confirm?: ConfirmSpec | ConfirmSpec[] }>);

vi.mock("@/modules/staff-identity/session", () => ({ requireStaff: async () => ({ id: "staff", role: "ADMIN" }) }));
vi.mock("@/db/client", () => ({ getDb: () => ({}) }));
vi.mock("@/modules/content/faq/repository", () => ({ listFaqItemsForAdmin: async () => ITEMS }));
vi.mock("@/modules/content/faq/page-settings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/content/faq/page-settings")>()),
  readFaqPageSettings: async () => ({ status: "DRAFT", version: 3, introRo: null, introEn: null, introRoJson: null, introEnJson: null }),
}));
vi.mock("@/app/[locale]/admin/pages/faq/actions", () => ({ saveFaqPageAction: async () => undefined, setFaqPagePublishedAction: async () => undefined }));
vi.mock("@/modules/content/rich-text/ui/LazyRichTextEditor", () => ({ default: () => null }));
vi.mock("@/modules/translate/ui/TranslateAllButton", () => ({ default: () => null }));
vi.mock("@/modules/content/pages/ui/PagesSubNav", () => ({ default: () => null }));
vi.mock("@/shared/forms/ActionForm", () => ({
  default: ({ children, confirm, "data-testid": testId }: { children: ReactNode; confirm?: ConfirmSpec | ConfirmSpec[]; "data-testid"?: string }) => {
    forms.push({ testId, confirm });
    return createElement("form", { "data-testid": testId }, children);
  },
}));
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const messages = (await import("../../../messages/ro.json")).default;
  const translator = (namespace: string) => createTranslator({ locale: "ro", messages, namespace: namespace as "Admin" });
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
  usePathname: () => "/ro/admin/pages/faq",
  useRouter: () => ({ push: () => undefined, refresh: () => undefined }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children }: { href: string; children: ReactNode }) => createElement("a", { href: `/ro${href}` }, children),
  getPathname: ({ href }: { href: string }) => `/ro${href}`,
  usePathname: () => "/admin/pages/faq",
  useRouter: () => ({ push: () => undefined, refresh: () => undefined }),
}));

const { NextIntlClientProvider } = await import("next-intl");
const messages = (await import("../../../messages/ro.json")).default;
const { default: AdminFaqPage } = await import("@/app/[locale]/admin/pages/faq/page");
const { pickConfirm } = await import("@/shared/feedback/notice");

async function html(element: ReactElement): Promise<string> {
  const stream = await renderToReadableStream(
    createElement(NextIntlClientProvider, { locale: "ro", messages } as unknown as ComponentProps<typeof NextIntlClientProvider>, element),
  );
  await stream.allReady;
  return new Response(stream).text();
}

async function renderPage(): Promise<string> {
  const element = await AdminFaqPage({ params: Promise.resolve({ locale: "ro" }), searchParams: Promise.resolve({}) });
  return html(element);
}

describe("§NNN the FAQ page's one form in the backoffice", () => {
  beforeEach(() => {
    forms.length = 0;
  });

  it("makes the plain save the form's default button, ahead of every card's arrow", async () => {
    const markup = await renderPage();
    const start = markup.indexOf('data-testid="faq-page-form"');
    expect(start).toBeGreaterThan(-1);
    const form = markup.slice(start, markup.indexOf("</form>", start));
    const submits = [...form.matchAll(/<button[^>]*type="submit"[^>]*>/g)].map((match) => match[0]);
    // The default save, then card 1's ↓, card 2's ↑, then «Salvează» at the bottom.
    expect(submits.length).toBeGreaterThanOrEqual(3);
    expect(submits[0]).toContain('data-testid="faq-default-save"');
    expect(submits[0]).not.toContain('name="move"');
    expect(submits.slice(1).some((button) => button.includes('name="move"'))).toBe(true);
  });

  it("asks before putting the spare card's question on the site only when one is typed", async () => {
    await renderPage();
    const confirm = forms.find((form) => form.testId === "faq-page-form")?.confirm;
    const posted = (values: Record<string, string>) => (field: string) => values[field] ?? null;
    const spare = ITEMS.length;
    expect(pickConfirm(confirm, posted({ [`faq[${spare}].visible`]: "on", [`faq[${spare}].questionRo`]: "" }))).toBeNull();
    expect(pickConfirm(confirm, posted({ [`faq[${spare}].visible`]: "on", [`faq[${spare}].questionRo`]: "Ce aduc?" }))?.confirmLabel).toBe(
      messages.Admin.faq.showConfirm,
    );
  });
});
