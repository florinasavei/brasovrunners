import { expect, test } from "@playwright/test";

/**
 * BR-REQ-053-01 — the public legal pages say which version is in force, and every section can
 * be linked (`DECISIONS.md` §323).
 *
 * A registration records the notice version it was shown; a reader comparing the two needs the
 * number and the day it took effect under the title. The section ids (`#s1`, `#s2`…) are what
 * a reply, an email or the notice itself points at when it says "section 6".
 *
 * Read-only: whichever approved version the database holds, the line and the ids are there.
 */
test.describe("BR-REQ-053-01 the legal pages' version line and section anchors", () => {
  test("the privacy notice says its version and date, and its sections carry ids", async ({ page }) => {
    await page.goto("/ro/confidentialitate");
    const main = page.locator("main");
    await expect(main.getByText(/^Versiunea \d+, în vigoare din .+$/)).toBeVisible();
    await expect(main.locator("h2#s1")).toBeVisible();
    // A link to a section lands on it.
    await page.goto("/ro/confidentialitate#s2");
    await expect(main.locator("h2#s2")).toBeInViewport();
  });

  test("the terms say the same, in English too", async ({ page }) => {
    await page.goto("/en/terms");
    await expect(page.locator("main").getByText(/^Version \d+, in force since .+$/)).toBeVisible();
    await expect(page.locator("main h2#s1")).toBeVisible();
  });
});
