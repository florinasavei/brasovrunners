import { expect, test } from "@playwright/test";

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
const SECTIONS = ["Evenimente", "Calendar"] as const;

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

  test("keeps the row to one line at 320px, whatever it has to fold", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    await page.goto("/ro/evenimente");

    // The first section is on the row at 320px, and nothing overflows the document sideways.
    await expect(page.getByRole("navigation", { name: "Navigare principală" }).getByRole("link", { name: "Evenimente", exact: true })).toBeVisible();
    const overflow = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(overflow.scroll).toBeLessThanOrEqual(overflow.client + 1);
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
