import { describe, expect, it } from "vitest";
import { legalPageMetadata, type LegalInForce } from "@/modules/legal-documents/public-page";

/**
 * BR-REQ-070-02 criterion 1 — a legal page's own head: `noindex` with no alternates where this
 * locale has no approved text, a self-canonical plus `hreflang` only to the locales that do
 * have one, and a title alone when the read itself failed (§NNN).
 *
 * `legalPageMetadata` is a pure function of `inForce` — `alternates.test.ts`'s own pattern —
 * so a fixed base and a fixed `inForce` hold it to an exact `Metadata` without a database. The
 * sitemap has its own test of the same "approved in one language only" rule
 * (`tests/integration/seo/sitemap.test.ts`); this is the page's own head, which nothing before
 * this test read at all — the one place the en/terms-vs-en/privacy "not published yet" twin
 * pages (the bug `public-page.ts`'s own comment describes) could regress silently.
 */
const BASE = "https://example.test";
const NOW = new Date("2026-09-24T10:00:00.000Z");

describe("BR-REQ-070-02 criterion 1 — legalPageMetadata", () => {
  it("is noindex, with no alternates, when this locale has no approved text", () => {
    const inForce: LegalInForce = { ro: { title: "Termeni de concurs", effectiveAt: NOW } };

    const metadata = legalPageMetadata({
      baseUrl: BASE,
      key: "TERMS",
      locale: "en",
      inForce,
      fallbackTitle: "Terms",
    });

    expect(metadata).toEqual({ title: "Terms", robots: { index: false, follow: true } });
    expect(metadata.alternates).toBeUndefined();
  });

  it("is its own canonical, with hreflang to the approved locales only, when this locale has one", () => {
    const inForce: LegalInForce = { ro: { title: "Termeni de concurs", effectiveAt: NOW } };

    const metadata = legalPageMetadata({
      baseUrl: BASE,
      key: "TERMS",
      locale: "ro",
      inForce,
      fallbackTitle: "Terms",
    });

    expect(metadata).toEqual({
      title: "Termeni de concurs",
      robots: { index: true, follow: true },
      alternates: {
        canonical: `${BASE}/ro/termeni`,
        languages: { ro: `${BASE}/ro/termeni`, "x-default": `${BASE}/ro/termeni` },
      },
    });
    // The point of the fixture: no English text is approved, so no `en` alternate either.
    expect(metadata.alternates?.languages).not.toHaveProperty("en");
  });

  it("is the fallback title alone when the read itself failed — no guess at alternates", () => {
    const metadata = legalPageMetadata({
      baseUrl: BASE,
      key: "TERMS",
      locale: "ro",
      inForce: null,
      fallbackTitle: "Terms",
    });

    expect(metadata).toEqual({ title: "Terms" });
    expect(metadata.robots).toBeUndefined();
    expect(metadata.alternates).toBeUndefined();
  });
});
