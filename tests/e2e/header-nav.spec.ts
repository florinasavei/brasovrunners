import { expect, test, type Browser, type Page } from "@playwright/test";
import { confirmDialog } from "./support/confirm";
import { FEATURED, signIn } from "./support/featured-event";
import { openFold } from "./support/fold";

/**
 * BR-REQ-041-01 criterion 1, `DECISIONS.md` §262 — the header row of a phone.
 *
 * The owner, with a screenshot of his own phone showing "Evenimente" and "Calendar" on the row
 * and Contact folded into the ☰: "ar putea oare încăpea 'evenimente, calendar, contact' în
 * toolbarul de sus pe mobil? ar fi fain să le avem pe toate, eventual mutăm selectorul de limbi
 * în dreapta jos". So the language switcher moved to the footer's bottom-right corner on a
 * phone, and the sections took the width it was using.
 *
 * The widths are the point of this spec, so it sets its own viewports rather than riding the
 * project's: 393 is a Pixel 5 and roughly the phone the owner was holding, and 320 is the
 * narrowest width the requirement names — where three sections genuinely do not fit and the
 * menu is the right answer. Both are asserted, because "it fits on my phone" and "nothing
 * overflows at 320" are two different promises.
 */
const SECTIONS = ["Alergări", "Calendar"] as const;

test.describe("§262 the sections on a phone's header row", () => {
  test("shows Events, Calendar and Contact on the row at a phone's width", async ({ page }) => {
    await page.setViewportSize({ width: 393, height: 780 });
    await page.goto("/ro/evenimente");

    const nav = page.getByRole("navigation", { name: "Navigare principală" });
    for (const label of [...SECTIONS, "Contact"]) {
      // A folded entry is `visibility: hidden`, so Playwright's own visibility check is the
      // assertion — no measuring needed to tell the row from the menu.
      await expect(nav.getByRole("link", { name: label, exact: true })).toBeVisible();
    }
  });

  test("orders the sections Alergări, Calendar, Contact, then the rest (§537)", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/ro/evenimente");

    // Every entry is in the DOM, folded or not, in the one list's order; the first three are the
    // owner's, whatever else the seed puts on the site after them.
    const names = await page
      .getByRole("navigation", { name: "Navigare principală" })
      .locator("a")
      .evaluateAll((links) => links.map((link) => link.textContent?.trim() ?? ""));
    expect(names.slice(0, 3)).toEqual([...SECTIONS, "Contact"]);
    const team = names.indexOf("Echipa");
    const faq = names.indexOf("Întrebări");
    if (team >= 0 && faq >= 0) expect(team).toBeLessThan(faq);
  });

  test("keeps the row to one line at 320px, whatever it has to fold", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    await page.goto("/ro/evenimente");

    // The first section is on the row at 320px, and nothing overflows the document sideways.
    await expect(page.getByRole("navigation", { name: "Navigare principală" }).getByRole("link", { name: "Alergări", exact: true })).toBeVisible();
    const overflow = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(overflow.scroll).toBeLessThanOrEqual(overflow.client + 1);

    // The overflow button sits flush at the navigation's right edge (the owner, 2026-10-10).
    // Wait for SiteNav's client measurement: the server render has the whole row and no button.
    await expect(page.getByRole("navigation", { name: "Navigare principală" })).toHaveAttribute("data-measured", "true");
    // The button exists only when some section folds; where nothing does (the desktop project), it stays hidden by design.
    if (await page.locator("#site-nav-more").isVisible()) {
      const nav = await page.getByRole("navigation", { name: "Navigare principală" }).boundingBox();
      const more = await page.locator("#site-nav-more").boundingBox();
      expect(nav).not.toBeNull();
      expect(more).not.toBeNull();
      expect(nav!.x + nav!.width - (more!.x + more!.width)).toBeLessThanOrEqual(1);
    }
  });

  test("puts the language switcher in the footer on a phone and in the header on a desktop", async ({ page }) => {
    await page.setViewportSize({ width: 393, height: 780 });
    await page.goto("/ro/evenimente");

    // Exactly one, wherever it is: the other copy is `display: none` and out of the tree.
    const switcher = page.getByRole("navigation", { name: "Limbă" });
    await expect(switcher).toHaveCount(1);
    await expect(switcher).toBeVisible();
    await expect(page.locator("footer").getByRole("navigation", { name: "Limbă" })).toHaveCount(1);
    await expect(page.locator("header").getByRole("navigation", { name: "Limbă" })).toHaveCount(0);
    // Still a working switch from down there (BR-REQ-040-01 criterion 5).
    await expect(switcher.getByRole("link", { name: "English" })).toBeVisible();

    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(page.locator("header").getByRole("navigation", { name: "Limbă" })).toHaveCount(1);
    await expect(page.locator("footer").getByRole("navigation", { name: "Limbă" })).toHaveCount(0);
  });
});

/**
 * §708, the facelift's phase 1 gate — the header with «Aspectul nou» on, measured. «Vino cu noi»
 * joins the row (§699's ☰ stays its right edge: the button sits before it, inside the nav's
 * trailing group), and the row must still be one row at 320px with «Alergări» on it (§262, §569)
 * and no sideways overflow. The setting is switched through «Setări» → «Aspect», as the club does
 * (a direct write would not expire the public cache's copy), and put back whatever happens.
 * Desktop project only: one shared `platform_settings` row.
 */
async function setLook(browser: Browser, choice: "on" | "off"): Promise<void> {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await signIn(page, "Dev Administrator");
    await page.goto("/ro/admin/settings/appearance");
    const panel = page.locator("#main").getByTestId("site-look");
    // The tab's cards are plain sections today (a `<section>` has no summary to press); a fold is opened.
    if (await panel.evaluate((element) => element.tagName === "DETAILS")) await openFold(panel);
    await panel.getByTestId(`site-look-option-${choice}`).click();
    await panel.getByRole("button", { name: "Salvează aspectul" }).click();
    await confirmDialog(page, "Schimbi aspectul site-ului?");
    // The page's own alert (the toast repeats the same words).
    await expect(page.locator("#admin-alert").getByText("Aspectul site-ului a fost salvat", { exact: false })).toBeVisible();
  } finally {
    await context.close();
  }
}

test.describe("§708 the header under «Aspectul nou»", () => {
  // One shared `platform_settings` row: 'off' must never run while 'on' has it switched on.
  test.describe.configure({ mode: "serial" });
  test.beforeEach(() => {
    test.skip(test.info().project.name !== "desktop", "one shared platform_settings row");
  });

  test("off: no attribute, no button, no socials, no watermark", async ({ page, browser }) => {
    test.slow();
    // Saved off through the screen first, so a run stopped mid-'on' cannot leave this one reading the new look.
    await setLook(browser, "off");
    await page.setViewportSize({ width: 320, height: 720 });
    await page.goto("/ro/evenimente");
    await expect(page.locator("html")).not.toHaveAttribute("data-look", /.*/);
    for (const testId of ["header-cta", "header-socials", "look-watermark", "floating-language"]) await expect(page.getByTestId(testId)).toHaveCount(0);
  });

  test("on: one row at 320px, Alergări on it, «Vino cu noi» with its arrow before the ☰ at the right edge; the language floats bottom-right and «Urmărește-ne» ends the desktop row", async ({ page, browser }) => {
    test.slow();
    await setLook(browser, "on");
    try {
      await page.setViewportSize({ width: 320, height: 720 });
      await page.goto("/ro/evenimente");
      await expect(page.locator("html")).toHaveAttribute("data-look", "2026");

      const nav = page.getByRole("navigation", { name: "Navigare principală" });
      await expect(nav).toHaveAttribute("data-measured", "true");
      const cta = page.getByTestId("header-cta");
      await expect(cta).toBeVisible();
      // The arrow is kept on a phone (§521).
      await expect(cta.locator("svg")).toBeVisible();
      await expect(nav.getByRole("link", { name: "Alergări", exact: true })).toBeVisible();

      const overflow = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
      expect(overflow.scroll).toBeLessThanOrEqual(overflow.client + 1);

      // One row: the header is no taller than a single 44px target plus its padding.
      const header = await page.locator("header").boundingBox();
      expect(header).not.toBeNull();
      expect(header!.height).toBeLessThanOrEqual(72);

      const ctaBox = await cta.boundingBox();
      expect(ctaBox).not.toBeNull();
      if (await page.locator("#site-nav-more").isVisible()) {
        const more = await page.locator("#site-nav-more").boundingBox();
        expect(more).not.toBeNull();
        // Same row, the button before the ☰, and the ☰ at the row's right edge (the container's gutter).
        expect(Math.abs(ctaBox!.y + ctaBox!.height / 2 - (more!.y + more!.height / 2))).toBeLessThanOrEqual(8);
        expect(ctaBox!.x + ctaBox!.width).toBeLessThanOrEqual(more!.x + 1);
        expect(320 - (more!.x + more!.width)).toBeLessThanOrEqual(24);
      } else {
        expect(320 - (ctaBox!.x + ctaBox!.width)).toBeLessThanOrEqual(24);
      }

      await expectFloatingLanguage(page, 320, 720);
      // The footer's Instagram paints with a gradient of its own, never the header's hidden one (§NNN).
      const ownGradient = await page
        .locator("footer")
        .locator('a[href*="instagram"] svg')
        .first()
        .evaluate((svg) => {
          const id = /url\(#(.+)\)/.exec(svg.getAttribute("fill") ?? "")?.[1];
          const gradient = id ? document.getElementById(id) : null;
          return Boolean(gradient && svg.contains(gradient));
        });
      expect(ownGradient).toBe(true);

      // §NNN: on a computer, «Urmărește-ne» with Instagram, Facebook and Strava is the header row's last item.
      await page.setViewportSize({ width: 1280, height: 800 });
      await expect(nav).toHaveAttribute("data-measured", "true");
      const socials = page.getByRole("navigation", { name: "Urmărește-ne" });
      await expect(socials).toBeVisible();
      await expect(socials.getByTestId("header-socials-label")).toHaveText("Urmărește-ne");
      expect(await socials.locator("a").evaluateAll((links) => links.map((link) => link.getAttribute("data-network")))).toEqual(["instagram", "facebook", "strava"]);
      for (const link of await socials.locator("a").all()) {
        const box = await link.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.width).toBeGreaterThanOrEqual(44);
        expect(box!.height).toBeGreaterThanOrEqual(44);
      }
      const navBox = await nav.boundingBox();
      const socialsBox = await socials.boundingBox();
      const headerBox = await page.locator("header").boundingBox();
      expect(navBox).not.toBeNull();
      expect(socialsBox).not.toBeNull();
      // After the nav (and its ☰), on the same row, and the header still one row.
      expect(socialsBox!.x).toBeGreaterThanOrEqual(navBox!.x + navBox!.width - 1);
      expect(Math.abs(socialsBox!.y + socialsBox!.height / 2 - (navBox!.y + navBox!.height / 2))).toBeLessThanOrEqual(8);
      expect(headerBox!.height).toBeLessThanOrEqual(80);
      const hrefs = await socials.locator("a").evaluateAll((links) => links.map((link) => link.getAttribute("href")));
      expect(hrefs).toEqual([
        process.env.CLUB_INSTAGRAM_URL || "https://www.instagram.com/e2e-club",
        process.env.CLUB_FACEBOOK_URL || "https://www.facebook.com/e2e-club",
        process.env.CLUB_STRAVA_URL || "https://www.strava.com/clubs/e2e-club",
      ]);
      await expectFloatingLanguage(page, 1280, 800);

      // An event page, the longest content and the registration call to action, at a phone's width.
      await page.setViewportSize({ width: 320, height: 720 });
      await page.goto(`/ro/evenimente/${FEATURED.slug}`);
      await expectFloatingLanguage(page, 320, 720);
    } finally {
      await setLook(browser, "off");
    }
  });
});

/**
 * §NNN — under «Aspectul nou» the language is one round button in the bottom-right corner: the only
 * «Limbă» navigation at this width (the header's and the footer's copies are hidden), a 44-pixel target
 * just above the footer's bar, still on screen after a scroll to the page's end, and covering none of
 * the page's own controls there.
 */
async function expectFloatingLanguage(page: Page, width: number, height: number): Promise<void> {
  const language = page.getByRole("navigation", { name: "Limbă" });
  await expect(language).toHaveCount(1);
  await expect(language).toHaveAttribute("data-testid", "floating-language");
  const english = language.getByRole("link", { name: "English" });
  await expect(english).toBeVisible();
  await expect(english).toHaveAttribute("href", /^\/api\/locale\?to=en&from=%2Fro%2Fevenimente/);

  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect(english).toBeInViewport();
  const box = await english.boundingBox();
  const bar = await page.locator("footer").boundingBox();
  expect(box).not.toBeNull();
  expect(bar).not.toBeNull();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
  // The bottom-right corner: within the gutter of the right edge (a desktop scrollbar included), above the bar.
  expect(width - (box!.x + box!.width)).toBeLessThanOrEqual(36);
  expect(box!.y + box!.height).toBeLessThanOrEqual(bar!.y);
  expect(box!.y + box!.height).toBeLessThanOrEqual(height);

  // Nothing the page offers is under it at the page's end.
  const covered = await english.evaluate((button) => {
    const own = button.getBoundingClientRect();
    return [...document.querySelectorAll("a, button, summary, input, select, textarea")]
      .filter((element) => element !== button && !button.contains(element))
      .filter((element) => {
        const style = getComputedStyle(element);
        if (style.visibility === "hidden" || style.display === "none") return false;
        const rect = element.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return false;
        return rect.left < own.right && rect.right > own.left && rect.top < own.bottom && rect.bottom > own.top;
      })
      .map((element) => element.outerHTML.slice(0, 120));
  });
  expect(covered).toEqual([]);
  await page.evaluate(() => window.scrollTo(0, 0));
}
