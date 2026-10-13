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
 * The root, which §353 made a real 308 from the proxy, is the home page's now (§714): its answer is
 * `home-page.spec.ts`'s to check.
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
      // «Importă un eveniment (JSON)» (§751): the one island whose words arrive as props.
      "/ro/admin/events/import",
      "/ro/admin/registrations",
      "/ro/admin/registrations/new",
      "/ro/admin/checkin",
      "/ro/admin/settings/emails",
      // «Setări»'s other tabs (§516): the forms that moved, with their islands.
      "/ro/admin/settings/deadlines",
      "/ro/admin/settings/appearance",
      // «Sistemul de design» (§692): the backoffice buttons it draws are islands with their own words.
      "/ro/admin/design",
      "/ro/admin/settings/costs",
      "/ro/admin/settings/platform",
      "/ro/admin/newsletter",
      // «Magazin» (§687, §697): the product list, the orders with their confirm dialogs, the settings with
      // the translate button, and the new product's page with its rich-text editors and the photo field.
      "/ro/admin/shop",
      "/ro/admin/shop/orders",
      "/ro/admin/shop/settings",
      "/ro/admin/shop/products/new",
      "/ro/admin/tasks",
      "/ro/admin/staff",
      "/ro/admin/legal",
      "/ro/admin/legal/new",
      "/ro/admin/pages",
      // «Pagini» → «Contact»: the two cards that were «Setări» → «Contact», with their islands.
      "/ro/admin/pages/contact",
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
    const editor = page.locator('a[href^="/ro/admin/events/"]:not([href$="/new"]):not([href$="/import"])').first();
    const href = await editor.getAttribute("href");
    expect(href).toBeTruthy();
    await expectWords(page, href as string);
    // An existing product's page too — the only one drawing the picture field with its crop box (§697).
    await page.goto("/ro/admin/shop");
    const products = page.locator('a[href^="/ro/admin/shop/products/"]:not([href$="/new"])');
    // A database without the sample product (the seed makes one) has nothing to open.
    if ((await products.count()) > 0) {
      const productHref = await products.first().getAttribute("href");
      expect(productHref).toBeTruthy();
      await expectWords(page, productHref as string);
    }
  });

  /*
    The site's root moved to `home-page.spec.ts` (§714, amending §353): it is the home page or a
    temporary redirect to the listing as «Pagina principală» says, and that spec switches the one
    shared setting serially, which a check here running beside it could not survive.
  */
});
