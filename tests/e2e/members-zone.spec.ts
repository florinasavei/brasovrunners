import { expect, test } from "@playwright/test";
import { hydrated } from "./support/featured-event";

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

    // The tabs (§NNN), in the owner's order, each an address of its own; «Coduri de reducere» is the zone's own,
    // and «Magazin» is drawn only once the privacy notice in force names the shop (BR-REQ-053-01).
    const tabs = page.getByTestId("members-tabs");
    await expect(tabs.getByRole("link", { name: "Coduri de reducere" })).toHaveAttribute("aria-current", "page");
    await expect(tabs.getByRole("link", { name: "Alergări" })).toBeVisible();
    for (const name of ["Coduri de reducere", "Alergări"]) {
      const box = await tabs.getByRole("link", { name }).boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
    await expect(page.getByTestId("members-upcoming")).toHaveCount(0);
    await tabs.getByRole("link", { name: "Alergări" }).click();
    await expect(page).toHaveURL(/\/ro\/zona-membri\/alergari$/);
    await expect(page.getByTestId("members-tabs").getByRole("link", { name: "Alergări" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("members-upcoming")).toBeVisible();
    await page.goto("/ro/zona-membri");

    await page.goto("/ro/admin");
    await expect(page).toHaveURL(/\/ro\/zona-membri$/);
  });
});
