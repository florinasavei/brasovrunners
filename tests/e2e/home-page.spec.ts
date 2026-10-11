import { expect, test, type Browser } from "@playwright/test";
import { confirmDialog } from "./support/confirm";
import { signIn } from "./support/featured-event";
import { openFold } from "./support/fold";

/**
 * §NNN, the facelift's phase 3 part A (`docs/REDESIGN.md`, decision 3) — the site's root, both ways.
 *
 * Off (the default): `/ro` and `/en` answer a temporary redirect to the listing with no page behind it
 * (no longer §353's 308, which a browser keeps for good), `/` goes to `/ro` in one hop, the logo leads
 * to the listing and the sitemap has no root. On: the root is the home page — one `h1`, the hero with
 * its two pill buttons, the next run, the weekly runs and the special events — canonical to itself, in
 * the sitemap, the logo leading to it, and at 320 pixels nothing sideways and every button 44 pixels.
 *
 * The setting is switched through «Setări» → «Aspect», as the club does (a direct write would not
 * expire the static root the CDN keeps), and put back off whatever happens. Serial, desktop project
 * only: one shared `platform_settings` row, and 'off' must never run while 'on' has it switched on.
 */
async function setHome(browser: Browser, choice: "on" | "off"): Promise<void> {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await signIn(page, "Dev Administrator");
    await page.goto("/ro/admin/settings/appearance");
    const panel = page.locator("#main").getByTestId("home-page");
    if (await panel.evaluate((element) => element.tagName === "DETAILS")) await openFold(panel);
    await panel.getByTestId(`home-page-option-${choice}`).click();
    await panel.getByRole("button", { name: "Salvează pagina principală" }).click();
    await confirmDialog(page, "Salvezi pagina principală?");
    await expect(page.locator("#admin-alert").getByText("Pagina principală a fost salvată", { exact: false })).toBeVisible();
  } finally {
    await context.close();
  }
}

test.describe("§NNN the site's root and «Pagina principală»", () => {
  test.describe.configure({ mode: "serial" });
  test.beforeEach(() => {
    test.skip(test.info().project.name !== "desktop", "one shared platform_settings row");
  });

  test("off: the root is a temporary redirect to the listing with no page, and the logo leads there", async ({ page, browser, request }) => {
    test.slow();
    // Saved off through the screen first, so a run stopped mid-'on' cannot leave this one reading the page.
    await setHome(browser, "off");

    const ro = await request.get("/ro?from=qr", { maxRedirects: 0 });
    expect(ro.status()).toBe(307);
    expect(ro.headers()["location"]).toMatch(/\/ro\/evenimente$/);
    /*
      A real status line, not §353's old soft redirect (a 200 carrying a client-side hop). The body is
      Next's own document for a redirect decided in a prerender, which a browser does not show and the
      CDN keeps with the status; the home page is not in it.
    */
    expect(await ro.text()).not.toContain('data-testid="home-page"');
    const en = await request.get("/en", { maxRedirects: 0 });
    expect(en.status()).toBe(307);
    expect(en.headers()["location"]).toMatch(/\/en\/events$/);
    // `/` is next-intl's one hop to the default locale's root.
    const root = await request.get("/", { maxRedirects: 0 });
    expect(root.status()).toBe(307);
    expect(root.headers()["location"]).toMatch(/\/ro$/);

    await page.goto("/ro/calendar");
    await expect(page.getByRole("link", { name: "Brașov Runners" }).first()).toHaveAttribute("href", "/ro/evenimente");
    const sitemap = await (await request.get("/sitemap.xml")).text();
    expect(sitemap).not.toMatch(/<loc>[^<]*\/ro<\/loc>/);
  });

  test("on: the root is the home page, canonical, in the sitemap, the logo's; one h1; nothing sideways at 320px", async ({ page, browser, request }) => {
    test.slow();
    await setHome(browser, "on");
    try {
      const answer = await request.get("/ro", { maxRedirects: 0 });
      expect(answer.status()).toBe(200);

      await page.setViewportSize({ width: 320, height: 720 });
      await page.goto("/ro");
      await expect(page).toHaveURL(/\/ro$/);
      await expect(page.locator("h1")).toHaveCount(1);
      await expect(page.locator("main")).toHaveCount(1);
      const hero = page.getByTestId("home-hero");
      await expect(hero.locator("h1")).toBeVisible();
      for (const testId of ["home-hero-primary", "home-hero-secondary"]) {
        const button = page.getByTestId(testId);
        await expect(button).toBeVisible();
        await expect(button.locator("svg")).toBeVisible();
        expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      }
      // The club's photograph is not chosen in the sample data: the empty slot, never a stock picture.
      await expect(page.getByTestId("home-hero-picture-empty")).toBeVisible();
      await expect(page.getByTestId("home-weekly")).toBeVisible();
      await expect(page.getByTestId("home-special")).toBeVisible();
      // Every card's title is a link at least 44 pixels tall (BR-REQ-041-01 criterion 6).
      for (const link of await page.locator("main h3 a").all()) expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);

      const overflow = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
      expect(overflow.scroll).toBeLessThanOrEqual(overflow.client + 1);

      // Canonical to itself, with the English root as its alternate.
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/ro$/);
      await expect(page.locator('link[rel="alternate"][hreflang="en"]')).toHaveAttribute("href", /\/en$/);
      // The homepage's one SportsOrganization block (BR-REQ-052-02 criterion 1), at the root's address.
      const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
      const organizations = blocks.map((text) => JSON.parse(text) as { "@type"?: string; url?: string }).filter((block) => block["@type"] === "SportsOrganization");
      expect(organizations).toHaveLength(1);
      expect(organizations[0].url).toMatch(/\/ro$/);
      // The logo leads home; the menu has no entry for it.
      await expect(page.getByRole("link", { name: "Brașov Runners" }).first()).toHaveAttribute("href", "/ro");
      const sitemap = await (await request.get("/sitemap.xml")).text();
      expect(sitemap).toMatch(/<loc>[^<]*\/ro<\/loc>/);

      // English, the same page in its own words.
      await page.goto("/en");
      await expect(page.locator("h1")).toContainText("We run together");
    } finally {
      await setHome(browser, "off");
    }
  });

  test("on, with scripts off: the same page, its links and the strip work without a script", async ({ browser }) => {
    test.slow();
    await setHome(browser, "on");
    const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 320, height: 720 } });
    try {
      const page = await context.newPage();
      await page.goto("/ro");
      await expect(page.locator("h1")).toHaveCount(1);
      await expect(page.getByTestId("home-hero-primary")).toBeVisible();
      await expect(page.getByTestId("home-weekly")).toBeVisible();
    } finally {
      await context.close();
      await setHome(browser, "off");
    }
  });
});
