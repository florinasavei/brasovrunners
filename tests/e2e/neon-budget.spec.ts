import { expect, test } from "@playwright/test";
import { signIn } from "./support/featured-event";

/**
 * §NNN — the month's budget on the screens, on an environment with no Neon key.
 *
 * The suite never reaches Neon (`E2E_DISABLE_NEON`, `playwright.config.ts`), so the governor reads
 * `unknown` and changes nothing — which is exactly what an environment without a key must do: a
 * throttle that switched itself on because a third party could not be asked would be the governor
 * causing the outage it exists to prevent. The levels and effects are unit-tested
 * (`neon-budget.test.ts`, `health-budget.test.ts`, `job-budget.test.ts`); this is what a unit test
 * cannot see — that Costuri and `/devs` carry the card and say so in words, and that the public
 * health answer names the level without a figure. Read-only, so it runs on both projects.
 */
test.describe("§NNN the month's budget", () => {
  test("Costuri says the budget is unknown and the platform does nothing extra", async ({ page }) => {
    await signIn(page, "Dev Administrator");
    await page.goto("/ro/admin/tasks?panel=costs");
    // Scoped to `#main` for the streamed-duplicate reason `tasks-cost.spec.ts` explains (§93).
    const card = page.locator("#main").getByTestId("neon-budget");

    await expect(card.getByRole("heading", { name: "Bugetul lunii" })).toBeVisible();
    await expect(card.getByTestId("neon-budget-level")).toHaveAttribute("data-level", "unknown");
    await expect(card.getByTestId("neon-budget-level")).toContainText("Neon nu a putut fi citit acum");
    await expect(card.getByTestId("neon-budget-effect")).toContainText("Ce face platforma acum: nimic în plus");
    // No reading, so no figures and no source line: nothing is invented.
    await expect(card.getByTestId("neon-budget-spent")).toHaveCount(0);
    await expect(card.getByTestId("neon-budget-source")).toHaveCount(0);
  });

  test("/devs carries the same card, in English too", async ({ page }) => {
    await signIn(page, "Dev Administrator");
    await page.goto("/en/devs");
    const card = page.locator("#main").getByTestId("neon-budget");
    await expect(card.getByRole("heading", { name: "This month's budget" })).toBeVisible();
    await expect(card.getByTestId("neon-budget-effect")).toContainText("What the platform does now: nothing extra");
  });

  test("the public health answer names the level, never a figure, and when the database was asked", async ({ request }) => {
    const response = await request.get("/api/health");
    const body = (await response.json()) as { neon: Record<string, unknown>; checkedAt: string; databaseCheckedAt: string };
    expect(body.neon).toEqual({ status: "ok", percent: null, level: "unknown" });
    // Below `tight` the database half is always fresh.
    expect(body.databaseCheckedAt).toBe(body.checkedAt);
  });
});
