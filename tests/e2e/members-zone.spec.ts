import { expect, test, type Page } from "@playwright/test";
import { hydrated } from "./support/featured-event";

/**
 * §729 — the current tab's box is inside the row's box (the row scrolls sideways, so a tab past the edge is
 * cut off), on the 320-px phone and on desktop alike.
 */
async function expectCurrentInRow(page: Page) {
  const row = await page.getByTestId("members-tabs").locator("nav").boundingBox();
  const current = await page.getByTestId("members-tabs").locator('a[aria-current="page"]').boundingBox();
  expect(row).not.toBeNull();
  expect(current).not.toBeNull();
  expect(current!.x).toBeGreaterThanOrEqual(row!.x - 0.5);
  expect(current!.x + current!.width).toBeLessThanOrEqual(row!.x + row!.width + 0.5);
}

/**
 * §524 — a club member signs in through the development switcher's «Dev Member», lands on the
 * members' zone with the club's words and the next runs, and is sent back there from `/admin`: the
 * backoffice is not theirs. (`signIn` in the support file waits for `/admin`, which a member never
 * reaches, so the member signs in here.)
 */
test.describe("§524 the members' zone", () => {
  test("a member lands on the zone and /admin sends them back to it", async ({ page }) => {
    await page.goto("/ro/autentificare?to=members");
    await page.getByRole("button", { name: /Dev Member/ }).click();
    await expect(page).toHaveURL(/\/ro\/zona-membri$/, { timeout: 30_000 });
    await hydrated(page);

    await expect(page.getByRole("heading", { level: 1, name: "Zona membrilor" })).toBeVisible();
    await expect(page.getByTestId("members-greeting")).toContainText("Dev Member");
    await expect(page.getByTestId("members-backoffice")).toHaveCount(0);

    // The tabs (§715), in the owner's order, each an address of its own; «Coduri de reducere» is the zone's own,
    // and «Magazin» is drawn only once the privacy notice in force names the shop (BR-REQ-053-01).
    const tabs = page.getByTestId("members-tabs");
    // Below `sm` a tab says its short word (§729), so the names are matched by their first word.
    const codes = tabs.getByRole("link", { name: /^Coduri/ });
    const runs = tabs.getByRole("link", { name: /^Alergări/ });
    await expect(codes).toHaveAttribute("aria-current", "page");
    await expect(runs).toBeVisible();
    await expectCurrentInRow(page);
    for (const name of [/^Coduri/, /^Alergări/]) {
      const box = await tabs.getByRole("link", { name }).boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
    await expect(page.getByTestId("members-upcoming")).toHaveCount(0);
    await runs.click();
    await expect(page).toHaveURL(/\/ro\/zona-membri\/alergari$/);
    await expect(page.getByTestId("members-tabs").getByRole("link", { name: /^Alergări/ })).toHaveAttribute("aria-current", "page");
    await expectCurrentInRow(page);
    await expect(page.getByTestId("members-upcoming")).toBeVisible();

    await page.goto("/ro/admin");
    await expect(page).toHaveURL(/\/ro\/zona-membri$/);
  });
});
