import { expect, type Page, test } from "@playwright/test";
import { FEATURED, hydrated, signIn } from "./support/featured-event";

/**
 * §353 — the public payload diet, walked in a browser.
 *
 * The client providers carry only the words their islands read now (`src/i18n/client-messages.ts`),
 * and `tests/unit/i18n/client-messages.test.ts` checks the lists against the source. This is the
 * render check under it: every page with a translating island opens, hydrates and shows words.
 * Locally a missing message throws (`src/i18n/errors.ts`), so an island left without its words
 * surfaces here as the error page, not as a key nobody reads.
 *
 * And the root: `/ro` is a real 308 now, answered by the proxy before anything renders, rather
 * than a 200 carrying an error document and a client-side hop.
 */

/** A catalogue key rendered in place of its sentence: "Site.nav.more", "Admin.pickers.dateTyped". */
const RAW_KEY = /\b(?:Site|Error|Event|Registrations|Admin)\.[a-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)*\b/;

async function expectWords(page: Page, path: string) {
  const response = await page.goto(path);
  expect(response?.status(), path).toBeLessThan(400);
  await hydrated(page);
  // `[locale]/error.tsx`'s heading, in either language: what a thrown missing message renders.
  await expect(page.getByRole("heading", { name: /Ceva nu a funcționat|Something went wrong/ }), path).toHaveCount(0);
  const text = await page.locator("body").innerText();
  expect(text.match(RAW_KEY)?.[0] ?? null, path).toBeNull();
}

test.describe("§353 every island finds its words, and a public page carries only those", () => {
  test("the public pages render their islands' words in both languages", async ({ page }) => {
    for (const path of [
      "/ro/evenimente",
      "/en/events",
      `/ro/evenimente/${FEATURED.slug}`,
      "/ro/calendar",
      "/ro/contact",
      "/en/contact",
      "/ro/galerie",
      "/ro/termeni",
      "/ro/inscrieri/ale-mele",
    ]) {
      await expectWords(page, path);
    }
    // The header's islands, by what they say rather than by their keys.
    await page.goto("/ro/evenimente");
    await expect(page.getByRole("button", { name: /Temă întunecată|Temă luminoasă/ })).toBeVisible();
  });

  test("a public page's payload carries none of the backoffice's words", async ({ request }) => {
    for (const path of ["/ro/evenimente", `/ro/evenimente/${FEATURED.slug}`]) {
      const html = await (await request.get(path)).text();
      // Keys only the backoffice namespaces (`Admin`, `Devs`) have: the whole catalogue would bring both.
      expect(html, path).not.toContain("legalNotice");
      expect(html, path).not.toContain("botCheck");
    }
  });

  test("every backoffice page with an island renders its words", async ({ page }) => {
    test.setTimeout(180_000);
    await signIn(page, "Dev Superadministrator");
    for (const path of [
      "/ro/admin",
      "/ro/admin/events/new",
      "/ro/admin/registrations",
      "/ro/admin/registrations/new",
      "/ro/admin/checkin",
      "/ro/admin/emails",
      "/ro/admin/tasks",
      "/ro/admin/staff",
      "/ro/admin/legal",
      "/ro/admin/legal/new",
      "/ro/admin/pages",
      "/ro/admin/pages/new",
      "/ro/admin/gallery",
      "/ro/admin/gallery/new",
      "/ro/admin/gallery/pictures",
      "/ro/admin/guide",
      "/ro/devs",
      "/ro/devs/theme",
    ]) {
      await expectWords(page, path);
    }
    // An existing event's editor too — the date and time boxes' words come from the nested provider.
    await page.goto("/ro/admin");
    const editor = page.locator('a[href^="/ro/admin/events/"]:not([href$="/new"])').first();
    const href = await editor.getAttribute("href");
    expect(href).toBeTruthy();
    await expectWords(page, href as string);
  });

  test("the site root is a real redirect to the listing, the query kept", async ({ request }) => {
    const ro = await request.get("/ro?from=qr", { maxRedirects: 0 });
    expect(ro.status()).toBe(308);
    expect(ro.headers()["location"]).toMatch(/\/ro\/evenimente\?from=qr$/);
    // No page behind it: the old answer was a 300 KB error document.
    expect((await ro.body()).length).toBeLessThan(200);

    const en = await request.get("/en", { maxRedirects: 0 });
    expect(en.status()).toBe(308);
    expect(en.headers()["location"]).toMatch(/\/en\/events$/);

    // `/` in one hop, with next-intl's own locale and temporary status.
    const root = await request.get("/", { maxRedirects: 0 });
    expect(root.status()).toBe(307);
    expect(root.headers()["location"]).toMatch(/\/ro\/evenimente$/);
  });
});
