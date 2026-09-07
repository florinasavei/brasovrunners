import { expect, test } from "@playwright/test";
import { signIn } from "./support/featured-event";

/**
 * BR-REQ-090-05 — the money question, on the screen a volunteer treasurer actually opens.
 *
 * Two things only, because the arithmetic and the wording are unit-tested and this is the part
 * a unit test cannot see: that an Administrator gets an answer rather than a raw message key,
 * and that the answer fits a phone. The second is not decoration — the widest thing on the page
 * is a vendor quotation like `$0.106/CU-hour` sitting in a grid cell, and §18.5 forbids sideways
 * scrolling at any width.
 */
test.describe("BR-REQ-090-05 the cost half of the task board", () => {
  test("tells an Administrator what the club pays, with no sideways scroll", async ({ page }) => {
    await signIn(page, "Dev Administrator");
    await page.goto("/ro/admin/tasks");

    await expect(page.getByRole("heading", { name: "Cât costă" })).toBeVisible();
    // The verdict and the number, before the table that justifies them.
    await expect(page.getByText(/Astăzi clubul (nu plătește nimic|plătește)/)).toBeVisible();
    await expect(page.getByText(/Prima cheltuială care urmează/)).toBeVisible();
    // A row per service, each carrying its own ceiling and how close this deployment is to it.
    await expect(page.getByRole("heading", { name: "Mailgun (trimiterea e-mailurilor)" })).toBeVisible();
    // A price with no age is a claim, so the page states how old these are.
    await expect(page.getByText(/Prețurile au fost verificate pe/)).toBeVisible();

    const overflow = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
    }));
    expect(overflow.documentWidth).toBeLessThanOrEqual(overflow.viewportWidth);
  });

  test("refuses an Editor, with the answer a missing route gives", async ({ page }) => {
    // BR-REQ-060-01. What a club is close to exceeding is not an Editor's business, and the
    // refusal is a 404 rather than a message confirming the screen exists.
    await signIn(page, "Dev Moderator");
    const response = await page.goto("/ro/admin/tasks");
    expect(response?.status()).toBe(404);
  });
});
