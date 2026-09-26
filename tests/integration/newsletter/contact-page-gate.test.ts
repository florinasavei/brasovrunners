import { createTranslator } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §NNN, finding (7) of the fix round on `feat/newsletter-topics`: the page-level gate. The service
 * refuses a subscription while the privacy notice in force does not describe the newsletter
 * (`newsletter.test.ts`); this proves the contact page does not even offer it — the real
 * `cachedNewsletterOffered` over real PostgreSQL (outside a Next server the public cache reads
 * straight through, §333), and the real page rendered with it: no `newsletter-section` under a
 * notice without `{{newsletterTopics}}`, the section and its button under one that names it.
 */
const state = vi.hoisted(() => ({ db: undefined as unknown }));

vi.mock("@/db/client", () => ({ getDb: () => state.db }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
  headers: async () => new Headers(),
}));
vi.mock("next-intl/server", () => ({
  getTranslations: async (options: string | { locale?: string; namespace?: string }) => {
    const namespace = typeof options === "string" ? options : options.namespace;
    const locale = typeof options === "string" ? "ro" : (options.locale ?? "ro");
    const catalogue = (locale === "en" ? en : ro) as Record<string, object>;
    return createTranslator({ locale, messages: catalogue, namespace: namespace as never });
  },
  setRequestLocale: () => {},
}));

const { cachedNewsletterOffered } = await import("@/modules/public-cache/reads");
const { default: ContactPage } = await import("@/app/[locale]/contact/page");

const NOW = new Date();

describe("§NNN the contact page offers the newsletter only under a notice that describes it", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
    state.db = db;
  });
  afterAll(async () => close());
  beforeEach(async () => {
    await resetTables(db);
  });

  async function approveNotice(describesNewsletter: boolean) {
    const paragraph = describesNewsletter ? "Noutățile clubului: temele {{newsletterTopics}}." : "Datele tale.";
    const translations: LegalDocumentTranslationInput[] = [
      { locale: "ro", title: "Confidențialitate", body: { sections: [{ paragraphs: [paragraph] }] } },
      { locale: "en", title: "Privacy", body: { sections: [{ paragraphs: [paragraph.replace("Noutățile clubului: temele", "The club's news: topics")] }] } },
    ];
    await insertLegalDocumentVersion(db, {
      key: "PRIVACY_NOTICE",
      version: 1,
      effectiveAt: new Date("2026-01-01T00:00:00.000Z"),
      isApproved: true,
      contentSha256: computeContentHash(translations),
      translations,
      now: NOW,
    });
  }

  const render = async () =>
    renderToStaticMarkup(await ContactPage({ params: Promise.resolve({ locale: "ro" }), searchParams: Promise.resolve({}) }));

  it("renders no section and no button while the notice in force lacks {{newsletterTopics}}", async () => {
    await approveNotice(false);
    expect(await cachedNewsletterOffered(NOW)).toBe(false);
    const html = await render();
    expect(html).not.toContain('data-testid="newsletter-section"');
    expect(html).not.toContain('data-testid="newsletter-open"');
  });

  it("renders no section while no notice is approved at all", async () => {
    expect(await cachedNewsletterOffered(NOW)).toBe(false);
    expect(await render()).not.toContain('data-testid="newsletter-section"');
  });

  it("renders the section, the button and the consent tick once the notice names it", async () => {
    await approveNotice(true);
    expect(await cachedNewsletterOffered(NOW)).toBe(true);
    const html = await render();
    expect(html).toContain('data-testid="newsletter-section"');
    expect(html).toContain('data-testid="newsletter-open"');
    expect(html).toContain('name="consent"');
  });
});
