import { expect, test } from "@playwright/test";
import { FEATURED } from "./support/featured-event";

/**
 * BR-REQ-070-02 criterion 1 — every public page's own canonical, and `hreflang` to the
 * languages it exists in (§NNN).
 *
 * The pilot's first Search Console report named "4 pages with redirect" (http→https, `www`→
 * apex, `/`→`/ro`, `/[locale]`→the listing — all expected, `SETUP.md` §26) and "1 duplicate
 * without user-selected canonical": the calendar's own current month against its bare address,
 * neither of which declared a canonical, with the "Lună" pill on the plain page linking one to
 * the other. `modules/seo/alternates.ts` is unit-tested (`alternates.test.ts`) and the sitemap
 * against it (`sitemap.test.ts`); this is the one render check worth an actual browser — that
 * the tag Next writes from a page's `alternates` is the one on the wire.
 *
 * The featured event's English slug is `src/db/seeds/pilot.ts`'s own — not built here, so a
 * slug rename in the seed is the one place this ever needs to follow.
 */
const FEATURED_EN_SLUG = "brasov-runners-anniversary-cross";

test.describe("BR-REQ-070-02 criterion 1 canonical and hreflang", () => {
  test("the listing is its own canonical in both languages, unmoved by the type filter", async ({ page, baseURL }) => {
    await page.goto("/ro/evenimente?type=RACE");
    await expect(page.locator('head link[rel="canonical"]')).toHaveAttribute("href", `${baseURL}/ro/evenimente`);
    await expect(page.locator('head link[rel="alternate"][hreflang="ro"]')).toHaveAttribute("href", `${baseURL}/ro/evenimente`);
    await expect(page.locator('head link[rel="alternate"][hreflang="en"]')).toHaveAttribute("href", `${baseURL}/en/events`);
    await expect(page.locator('head link[rel="alternate"][hreflang="x-default"]')).toHaveAttribute("href", `${baseURL}/ro/evenimente`);
  });

  test("an event page's canonical is its own date, with hreflang to the other locale's own slug", async ({ page, baseURL }) => {
    await page.goto(`/ro/evenimente/${FEATURED.slug}`);
    await expect(page.locator('head link[rel="canonical"]')).toHaveAttribute(
      "href",
      `${baseURL}/ro/evenimente/${FEATURED.slug}`,
    );
    await expect(page.locator('head link[rel="alternate"][hreflang="en"]')).toHaveAttribute(
      "href",
      `${baseURL}/en/events/${FEATURED_EN_SLUG}`,
    );
  });

  test("the contact page is its own canonical, whatever a submission's outcome adds to the address", async ({ page, baseURL }) => {
    // `?sent=` is what the form lands on after a message: the same page, never a second one.
    await page.goto("/ro/contact?sent=1");
    await expect(page.locator('head link[rel="canonical"]')).toHaveAttribute("href", `${baseURL}/ro/contact`);
    await expect(page.locator('head link[rel="alternate"][hreflang="en"]')).toHaveAttribute("href", `${baseURL}/en/contact`);
    await expect(page.locator('head link[rel="alternate"][hreflang="x-default"]')).toHaveAttribute("href", `${baseURL}/ro/contact`);
    await page.goto("/en/contact");
    await expect(page.locator('head link[rel="canonical"]')).toHaveAttribute("href", `${baseURL}/en/contact`);
  });

  test("the gallery listing is its own canonical in both languages, albums or none", async ({ page, baseURL }) => {
    await page.goto("/ro/galerie");
    await expect(page.locator('head link[rel="canonical"]')).toHaveAttribute("href", `${baseURL}/ro/galerie`);
    await expect(page.locator('head link[rel="alternate"][hreflang="ro"]')).toHaveAttribute("href", `${baseURL}/ro/galerie`);
    await expect(page.locator('head link[rel="alternate"][hreflang="en"]')).toHaveAttribute("href", `${baseURL}/en/gallery`);
    await page.goto("/en/gallery");
    await expect(page.locator('head link[rel="canonical"]')).toHaveAttribute("href", `${baseURL}/en/gallery`);
  });

  test("the calendar's canonical ignores the month named in the address — the reported duplicate", async ({ page, baseURL }) => {
    await page.goto("/ro/calendar?month=2027-01");
    await expect(page.locator('head link[rel="canonical"]')).toHaveAttribute("href", `${baseURL}/ro/calendar`);
    // Never the query it was just handed — a canonical carrying it would be no canonical at all.
    const href = await page.locator('head link[rel="canonical"]').getAttribute("href");
    expect(href).not.toContain("month=");
  });
});
