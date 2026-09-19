import { expect, test } from "@playwright/test";
import { signIn } from "./support/featured-event";

/**
 * BR-REQ-050-02 criterion 18 (`DECISIONS.md` §135) — a signed-in staff member who may edit
 * the words sees "Editează" on the public event page, one press from the editor; a visitor
 * and a volunteer see nothing of the kind.
 */
test.describe("BR-REQ-050-02 the way into the editor from the event page", () => {
  test("shows a visitor no edit button", async ({ page }) => {
    await page.goto("/ro/evenimente/tura-pe-tampa");
    await expect(page.locator("#main").getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.locator("#main").getByRole("link", { name: "Editează", exact: true })).toHaveCount(0);
  });

  test("shows a volunteer no edit button", async ({ page }) => {
    await signIn(page, "Dev Contributor");
    await page.goto("/ro/evenimente/tura-pe-tampa");
    await expect(page.locator("#main").getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.locator("#main").getByRole("link", { name: "Editează", exact: true })).toHaveCount(0);
  });

  test("takes a copywriter from the event page into its editor", async ({ page }) => {
    await signIn(page, "Dev Copywriter");
    await page.goto("/ro/evenimente/tura-pe-tampa");
    const edit = page.locator("#main").getByRole("link", { name: "Editează", exact: true });
    await expect(edit).toBeVisible();
    const box = await edit.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    await edit.click();
    await expect(page).toHaveURL(/\/ro\/admin\/events\/[0-9a-f-]{36}$/);
    await expect(page.locator("#main")).toContainText("Tură pe Tâmpa");
  });
});
