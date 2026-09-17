import { expect, test } from "@playwright/test";
import { signIn } from "./support/featured-event";

/**
 * BR-REQ-053-02 — "editing" an approved legal version means starting the next version from it,
 * prefilled (DECISIONS.md §46, §53, §57). Every non-production database carries the approved
 * sample documents, so the list always has an approved version to start from.
 */
test.describe("legal documents: the next version starts from the current one", () => {
  test("an approved version offers the next version, prefilled from its text", async ({ page }) => {
    await signIn(page, "Dev Superadministrator");
    await page.goto("/ro/admin/legal");

    // The first version in the list. `/admin/legal/new` and the back link do not match the
    // trailing slash plus an id, so only version rows do — and only the visible copy: below
    // `md` the table is hidden and each row is a labelled block (BR-REQ-041-01).
    await page.locator('a[href*="/admin/legal/"]:not([href$="/new"]):visible').first().click();
    await expect(page).toHaveURL(/\/admin\/legal\/[0-9a-f-]{36}$/);

    await page.getByRole("link", { name: "Pornește versiunea următoare din aceasta" }).click();
    await expect(page).toHaveURL(/\/admin\/legal\/new\?from=[0-9a-f-]{36}$/);
    await expect(page.getByText(/Precompletat din versiunea \d+/)).toBeVisible();

    // Prefilled: both bodies already carry the current text — the whole point of the button.
    await expect(page.locator('textarea[name="roBody"]')).not.toHaveValue("");
    await expect(page.locator('textarea[name="enBody"]')).not.toHaveValue("");
  });
});
