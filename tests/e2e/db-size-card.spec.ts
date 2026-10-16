import { expect, test } from "@playwright/test";
import { signIn } from "./support/featured-event";

/**
 * §NNN — «Baza de date» and «Vercel: consumul lunii» on `/devs`, and the row on «Sarcini» that opens
 * the first. The suite has no Vercel token, so the second card says it cannot read the usage — the
 * sentence a unit test renders in isolation, here on the page as served. Read-only, so it runs on
 * both projects. The numbers themselves are proved on PostgreSQL in `db-sizes.test.ts`.
 */
test.describe("§NNN the database's size and Vercel's month on /devs", () => {
  test("«Baza de date» opens onto the size, the tables and the growth, and «Vercel» says it cannot read the usage", async ({ page }) => {
    await signIn(page, "Dev Administrator");
    await page.goto("/ro/devs");

    const card = page.locator("#main").getByTestId("db-size");
    await expect(card.getByRole("heading", { name: "Baza de date: mărime și creștere" })).toBeVisible();
    // A fold starts closed with the size beside its title; the figures are behind it.
    await card.getByRole("heading", { name: "Baza de date: mărime și creștere" }).click();
    await expect(card.getByTestId("db-size-total")).toContainText("Toată baza de date:");
    await expect(card.getByTestId("db-size-tables").getByRole("listitem").first()).toBeVisible();
    await expect(card.getByTestId("db-size-growth-audit_logs")).toContainText("Jurnalul acțiunilor personalului");
    await expect(card.getByTestId("db-size-registrations")).toBeVisible();

    const vercel = page.locator("#main").getByTestId("vercel-usage");
    await vercel.getByRole("heading", { name: "Vercel: consumul lunii" }).click();
    await expect(vercel.getByTestId("vercel-usage-cannot")).toContainText("Fără VERCEL_API_TOKEN nu se poate citi consumul");
    await expect(vercel.getByRole("link", { name: "Deschide Vercel → Usage." })).toHaveAttribute("href", "https://vercel.com/dashboard/usage");
  });

  test("says the same in English", async ({ page }) => {
    await signIn(page, "Dev Administrator");
    await page.goto("/en/devs");

    await expect(page.locator("#main").getByRole("heading", { name: "The database: size and growth" })).toBeVisible();
    await expect(page.locator("#main").getByRole("heading", { name: "Vercel: this month's usage" })).toBeVisible();
  });

  test("the row «Retenția datelor» on «Sarcini» opens the database card", async ({ page }) => {
    await signIn(page, "Dev Administrator");
    await page.goto("/ro/admin/tasks");

    await expect(page.locator("#main").getByText("Retenția datelor: perioade de decis").first()).toBeVisible();
    // The row's link goes to «Setări» → «Configurație» and the card's `#`, so the card opens on arrival.
    await expect(page.locator('#main a[href$="/devs#db-size"]')).toHaveCount(1);
  });
});
