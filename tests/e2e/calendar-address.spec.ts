import { expect, test } from "@playwright/test";

/**
 * §674 — the calendar's address, to copy (BR-REQ-020-01, BR-REQ-041-01 criterion 6).
 *
 * The owner, 2026-10-08: «Still can't re-import the Brașov Runners calendar». Google keeps a hidden
 * or removed calendar by its address, so its quick-add button can do nothing; the address pasted
 * into calendar.google.com → «Din URL» always works. At 320 pixels the calendar page's «?» fold
 * holds it: a read-only box with the feed's plain address and «Copiază», a 44-pixel target, which
 * puts the address on the clipboard and says «Copiat».
 *
 * Both projects at 320, the width the fold is drawn at (from `sm` the same box is in the fold under
 * «Adaugă în calendarul tău»). The clipboard is granted to the page, as a person's browser lends it
 * on a press; Chromium's permission names.
 */
test.beforeEach(async ({ page, context }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
});

test("the calendar page's «?» fold shows the feed's address and «Copiază» copies it", async ({ page }) => {
  await page.goto("/ro/calendar");
  const fold = page.getByTestId("calendar-intro-help");
  await fold.locator("summary").click();

  const box = page.locator("#calendar-feed-address-head");
  await expect(box).toBeVisible();
  // The plain address, from APP_BASE_URL: absolute, the locale's feed, never a `webcal://`.
  const address = await box.inputValue();
  expect(address).toMatch(/^https?:\/\/[^/]+\/ro\/events\/calendar\.ics$/);
  await expect(box).toHaveAttribute("readonly", "");

  // The words under it: what to do when Google says it already has the calendar.
  await expect(fold.getByText("„Din URL”", { exact: false })).toBeVisible();
  await expect(fold.getByText("?v=2", { exact: false })).toBeVisible();

  const copy = fold.getByRole("button", { name: "Copiază" });
  await expect(copy).toBeVisible();
  const target = await copy.boundingBox();
  expect(target?.height ?? 0, "«Copiază» is a thumb's target").toBeGreaterThanOrEqual(44);

  await copy.click();
  await expect(fold.getByRole("button", { name: "Copiat" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(address);
  // Two seconds later the button says its word again.
  await expect(fold.getByRole("button", { name: "Copiază" })).toBeVisible({ timeout: 5_000 });

  // Nothing wider than the page: the box shrinks, the button wraps under it if it must.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
