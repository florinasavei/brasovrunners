import { expect, test, type Browser, type Page } from "@playwright/test";
import { CLUB_NAME } from "../../src/theme/brand";
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
 * §708, the facelift's phase 1 gate — the header with «Aspectul nou» on, measured. Since §NNN
 * (amending §708 and §722) the header carries no «Vino cu noi» at any width, the phone too: the ☰
 * is the row's right edge on a phone (§699), «Urmărește-ne» — a label, then Instagram, Facebook
 * and Strava — the row's last item on a computer, and the row must still be one row at 320px with
 * «Alergări» on it (§262, §569) and no sideways overflow. The language is the footer's, both
 * languages on its bar at every width. The setting is switched through «Setări» → «Aspect», as the
 * club does (a direct write would not expire the public cache's copy), and put back whatever
 * happens. Desktop project only: one shared `platform_settings` row.
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

  test("on: one row at 320px, Alergări on it, no «Vino cu noi» and the ☰ at the right edge; «Urmărește-ne» a label ending the desktop row; both languages on the footer's bar", async ({ page, browser }) => {
    test.slow();
    await setLook(browser, "on");
    try {
      await page.setViewportSize({ width: 320, height: 720 });
      await page.goto("/ro/evenimente");
      await expect(page.locator("html")).toHaveAttribute("data-look", "2026");

      const nav = page.getByRole("navigation", { name: "Navigare principală" });
      await expect(nav).toHaveAttribute("data-measured", "true");
      // §NNN: no call to action in the header at any width, the phone too.
      await expect(page.getByTestId("header-cta")).toHaveCount(0);
      await expect(page.locator("header").getByRole("link", { name: "Vino cu noi" })).toHaveCount(0);
      await expect(nav.getByRole("link", { name: "Alergări", exact: true })).toBeVisible();

      const overflow = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
      expect(overflow.scroll).toBeLessThanOrEqual(overflow.client + 1);

      // One row: the header is no taller than a single 44px target plus its padding.
      const header = await page.locator("header").boundingBox();
      expect(header).not.toBeNull();
      expect(header!.height).toBeLessThanOrEqual(72);

      if (await page.locator("#site-nav-more").isVisible()) {
        // The ☰ at the row's right edge (the container's gutter), nothing after it.
        const more = await page.locator("#site-nav-more").boundingBox();
        expect(more).not.toBeNull();
        expect(320 - (more!.x + more!.width)).toBeLessThanOrEqual(24);
      }

      await expectFooterLanguages(page, 320);
      // The footer's Instagram paints with a gradient of its own, never the header's hidden one (§722).
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

      // §722: on a computer, «Urmărește-ne» with Instagram, Facebook and Strava is the header row's last item.
      await page.setViewportSize({ width: 1280, height: 800 });
      await expect(nav).toHaveAttribute("data-measured", "true");
      await expect(page.getByTestId("header-cta")).toHaveCount(0);
      const socials = page.getByRole("navigation", { name: "Urmărește-ne" });
      await expect(socials).toBeVisible();
      const label = socials.getByTestId("header-socials-label");
      await expect(label).toHaveText("Urmărește-ne");
      // §NNN: the words are a label — not a link, not a button, not focusable, no pointer.
      const labelFacts = await label.evaluate((element) => ({
        inTarget: Boolean(element.closest("a, button, [role=button], [tabindex]")),
        tabIndex: (element as HTMLElement).tabIndex,
        cursor: getComputedStyle(element).cursor,
      }));
      expect(labelFacts).toEqual({ inTarget: false, tabIndex: -1, cursor: "default" });
      expect(await socials.locator("a").evaluateAll((links) => links.map((link) => link.getAttribute("data-network")))).toEqual(["instagram", "facebook", "strava"]);
      // Each mark says whose profile it is and where, in the page's language (`Site.followOn`, §722), never the network alone.
      expect(await socials.locator("a").evaluateAll((links) => links.map((link) => link.getAttribute("aria-label")))).toEqual([
        `${CLUB_NAME} pe Instagram`,
        `${CLUB_NAME} pe Facebook`,
        `${CLUB_NAME} pe Strava`,
      ]);
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
      await expectFooterLanguages(page, 1280);

      // An event page, the longest content and the registration call to action, at a phone's width.
      await page.setViewportSize({ width: 320, height: 720 });
      await page.goto(`/ro/evenimente/${FEATURED.slug}`);
      await expectFooterLanguages(page, 320, `/ro/evenimente/${FEATURED.slug}`);
    } finally {
      await setLook(browser, "off");
    }
  });
});

/**
 * §NNN (amending §722) — under «Aspectul nou» the language is the footer's own switcher, both
 * languages on the bar at every width: the only «Limbă» navigation (the header's copy is hidden,
 * §722's floating button is gone), Romanian stated as the current one and English a link through
 * `/api/locale`, the bar's last item at its bottom right, on screen after a scroll to the page's end,
 * each a target of the bar's size (24 pixels below 360, 28 from 360, 44 from `sm`).
 */
async function expectFooterLanguages(page: Page, width: number, path = "/ro/evenimente"): Promise<void> {
  await expect(page.getByTestId("floating-language")).toHaveCount(0);
  const language = page.getByRole("navigation", { name: "Limbă" });
  await expect(language).toHaveCount(1);
  await expect(page.locator("footer").getByRole("navigation", { name: "Limbă" })).toHaveCount(1);
  const romanian = language.locator('[aria-current="true"]');
  await expect(romanian).toBeVisible();
  await expect(romanian).toHaveAttribute("title", "Română");
  const english = language.getByRole("link", { name: "English" });
  await expect(english).toBeVisible();
  await expect(english).toHaveAttribute("href", new RegExp(`^/api/locale\\?to=en&from=${encodeURIComponent(path).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));

  if (width < 600) {
    // The bar stays one row under the look: «GDPR», the marks, the rule, RO and EN share a centre line.
    const centre = (b: { y: number; height: number }) => b.y + b.height / 2;
    const gdpr = await page.locator("footer").getByRole("link", { name: /GDPR/ }).first().boundingBox();
    const lang = await language.boundingBox();
    expect(gdpr).not.toBeNull();
    expect(lang).not.toBeNull();
    expect(Math.abs(centre(gdpr!) - centre(lang!))).toBeLessThanOrEqual(2);
  }
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect(english).toBeInViewport();
  const target = width < 360 ? 24 : width < 600 ? 28 : 44;
  for (const item of [romanian, english]) {
    const box = await item.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(target);
    expect(box!.height).toBeGreaterThanOrEqual(target);
  }
  // On the footer's bar, and its bottom-right end: within the gutter of the right edge (a desktop scrollbar included).
  const box = await language.boundingBox();
  const bar = await page.locator("footer").boundingBox();
  expect(box).not.toBeNull();
  expect(bar).not.toBeNull();
  expect(box!.y).toBeGreaterThanOrEqual(bar!.y - 1);
  expect(width - (box!.x + box!.width)).toBeLessThanOrEqual(36);
  await page.evaluate(() => window.scrollTo(0, 0));
}
