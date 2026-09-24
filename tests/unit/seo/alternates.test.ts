import { describe, expect, it } from "vitest";
import {
  hreflangLanguages,
  pageAlternates,
  slugRouteUrls,
  staticRouteUrl,
  staticRouteUrls,
} from "@/modules/seo/alternates";

/**
 * BR-REQ-070-02 criterion 1 — a canonical URL and `hreflang` alternates for every public page
 * (§NNN).
 *
 * The pilot's Search Console report ("4 pages with redirect", "1 duplicate without
 * user-selected canonical") named the calendar's own current month against its bare address —
 * neither declared a canonical, and the "Lună" pill linked from one to the other. These
 * builders are what both the page metadata and the sitemap (`sitemap.test.ts`) now read from,
 * so the two cannot disagree about which address a page lives at.
 */
const BASE = "https://example.test";

describe("BR-REQ-070-02 criterion 1 — staticRouteUrl(s)", () => {
  it("is absolute, under the base, on the locale's own pathname", () => {
    expect(staticRouteUrl(BASE, "/events", "ro")).toBe("https://example.test/ro/evenimente");
    expect(staticRouteUrl(BASE, "/events", "en")).toBe("https://example.test/en/events");
  });

  it("carries every locale unless told otherwise", () => {
    expect(staticRouteUrls(BASE, "/calendar")).toEqual({
      ro: "https://example.test/ro/calendar",
      en: "https://example.test/en/calendar",
    });
  });

  it("carries only the locales it is asked for — a legal text approved in one language only", () => {
    expect(staticRouteUrls(BASE, "/legal/terms", ["ro"])).toEqual({
      ro: "https://example.test/ro/termeni",
    });
  });
});

describe("BR-REQ-070-02 criterion 1 — slugRouteUrls", () => {
  it("puts each locale at that locale's own slug, never this slug under another prefix", () => {
    const urls = slugRouteUrls(BASE, "/events/[slug]", [
      { locale: "ro", slug: "tura-pe-tampa" },
      { locale: "en", slug: "tampa-trail" },
    ]);
    expect(urls).toEqual({
      ro: "https://example.test/ro/evenimente/tura-pe-tampa",
      en: "https://example.test/en/events/tampa-trail",
    });
  });

  it("omits a locale with no translation — BR-REQ-040-02, never advertise a 404", () => {
    const urls = slugRouteUrls(BASE, "/events/[slug]", [{ locale: "ro", slug: "tura-pe-tampa" }]);
    expect(urls).toEqual({ ro: "https://example.test/ro/evenimente/tura-pe-tampa" });
    expect(urls.en).toBeUndefined();
  });

  it("returns nothing for an unpublished-everywhere page", () => {
    expect(slugRouteUrls(BASE, "/events/[slug]", [])).toEqual({});
  });
});

describe("BR-REQ-070-02 criterion 1 — hreflangLanguages", () => {
  it("lists ro, en, then x-default pointing at the Romanian URL", () => {
    const languages = hreflangLanguages({
      ro: "https://example.test/ro/evenimente",
      en: "https://example.test/en/events",
    });
    expect(languages).toEqual({
      ro: "https://example.test/ro/evenimente",
      en: "https://example.test/en/events",
      "x-default": "https://example.test/ro/evenimente",
    });
  });

  it("has no en key when the translation is missing, and still gives x-default", () => {
    const languages = hreflangLanguages({ ro: "https://example.test/ro/evenimente" });
    expect(languages.en).toBeUndefined();
    expect(languages["x-default"]).toBe("https://example.test/ro/evenimente");
  });

  it("has no x-default when there is no Romanian version — an English-only standing page", () => {
    const languages = hreflangLanguages({ en: "https://example.test/en/pages/about" });
    expect(languages["x-default"]).toBeUndefined();
    expect(languages.ro).toBeUndefined();
    expect(languages.en).toBe("https://example.test/en/pages/about");
  });
});

describe("BR-REQ-070-02 criterion 1 — pageAlternates", () => {
  it("is this locale's own URL as the canonical, with every language's alternate", () => {
    const urls = staticRouteUrls(BASE, "/events");
    expect(pageAlternates("ro", urls)).toEqual({
      canonical: "https://example.test/ro/evenimente",
      languages: {
        ro: "https://example.test/ro/evenimente",
        en: "https://example.test/en/events",
        "x-default": "https://example.test/ro/evenimente",
      },
    });
  });

  it("carries no query string — a filtered or paged view is the same canonical", () => {
    // The builders never see a request, so there is nothing for a `?type=` or `?month=` to
    // leak into; this is the whole fix, proven by construction rather than by a stripping step.
    const { canonical } = pageAlternates("ro", staticRouteUrls(BASE, "/events"))!;
    expect(canonical).not.toContain("?");
  });

  it("is undefined for a locale the page does not exist in — a legal text not yet approved there", () => {
    expect(pageAlternates("en", staticRouteUrls(BASE, "/legal/terms", ["ro"]))).toBeUndefined();
  });
});
