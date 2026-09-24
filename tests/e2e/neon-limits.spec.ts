import { expect, test } from "@playwright/test";
import { signIn } from "./support/featured-event";

/**
 * BR-REQ-090-07 criteria 8 and 12 (§335) — the database's limits card on an environment with no
 * Neon key, and the to-do row that reads the same reading.
 *
 * The suite never reaches Neon: `playwright.config.ts` sets `E2E_DISABLE_NEON`, so the server
 * renders as an environment with neither variable. The card's states are unit-tested
 * (`neon-limits-panel.test.ts`); this is what a unit test cannot see — that the page puts the
 * card on the Costuri panel, names what is missing, offers no form, and that the to-do list keeps
 * the row open, because a limit nobody could read is a limit nobody knows is set. Read-only, so
 * it runs on both projects.
 */
test.describe("BR-REQ-090-07 the database's limits card without a key", () => {
  test("names the missing variables, offers no form, and leaves the to-do row open", async ({ page }) => {
    await signIn(page, "Dev Administrator");
    await page.goto("/ro/admin/tasks?panel=costs");
    // Scoped to `#main` for the streamed-duplicate reason `tasks-cost.spec.ts` explains (§93).
    const main = page.locator("#main");
    const card = main.getByTestId("neon-limits");

    await expect(card.getByRole("heading", { name: "Limitele bazei de date" })).toBeVisible();
    await expect(card.getByTestId("neon-limits-unconfigured")).toContainText("Lipsește NEON_API_KEY, NEON_PROJECT_ID pe acest mediu");
    await expect(card.getByTestId("neon-limits-unconfigured")).toContainText("SETUP.md §33");
    // Which key would do, per Neon's own documentation: a project-scoped one has Editor access.
    await expect(card).toContainText("„Project-scoped”");
    await expect(card.getByTestId("neon-limits-form")).toHaveCount(0);
    await expect(card.locator('select[name="maxCu"]')).toHaveCount(0);

    await page.goto("/ro/admin/tasks");
    const row = main
      .getByRole("list", { name: "Lista de sarcini" })
      .getByRole("listitem")
      .filter({ has: page.getByRole("heading", { name: "Limita lunară de calcul a bazei de date" }) });
    await expect(row).toHaveCount(1);
    await expect(row.getByText("De făcut", { exact: true })).toBeVisible();
    await expect(row).toContainText("nu a putut fi citită de la Neon");
  });
});
