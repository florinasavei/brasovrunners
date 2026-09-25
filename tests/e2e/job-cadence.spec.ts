import { expect, test } from "@playwright/test";
import { confirmDialog } from "./support/confirm";
import { signIn } from "./support/featured-event";

/**
 * BR-REQ-090-07 criterion 7 (§334) — "Cât de des verifică platforma": the owner's throttle, on
 * `/admin/tasks` → Costuri beside the Neon plan.
 *
 * One round trip, on the page a unit test cannot see: the card says what a longer interval costs
 * and what it does not, it shows each job's last real run and next check, the select posts, the
 * sentence follows, and `/devs` reads the same row. Set back to "la nevoie" at the end, because
 * the row is shared by every spec on this database.
 */
test.describe("BR-REQ-090-07 the minimum interval between two real runs, on the costs panel", () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name !== "desktop", "one shared platform_settings row");
  });

  test("an Administrator slows the jobs to thirty minutes, reads the effect, and sets it back", async ({ page }) => {
    test.slow();
    await signIn(page, "Dev Administrator");
    await page.goto("/ro/admin/tasks?panel=costs");
    const main = page.locator("#main");
    const card = main.getByTestId("job-cadence");

    await expect(card.getByRole("heading", { name: "Cât de des verifică platforma" })).toBeVisible();
    await expect(card.getByTestId("job-cadence-in-force")).toContainText(/^Setarea în vigoare: la nevoie/);
    // What it costs the runners, and what it does not, before the choice.
    await expect(card.getByText(/pot pleca cu până la atâtea minute mai târziu/)).toBeVisible();
    await expect(card.getByText(/un loc rezervat expiră tot la timp/)).toBeVisible();
    // The measured effect, one line per job.
    const effect = card.getByTestId("job-cadence-effect");
    await expect(effect.getByRole("listitem")).toHaveCount(2);
    await expect(effect).toContainText("Mentenanța înscrierilor");
    await expect(effect).toContainText("Coada de emailuri");

    await card.getByLabel("Cel mult o dată la").selectOption("30");
    await card.getByRole("button", { name: "Salvează intervalul" }).click();
    await confirmDialog(page);

    await expect(page).toHaveURL(/panel=costs/);
    await expect(main.getByText("Intervalul a fost salvat", { exact: false })).toBeVisible();
    await expect(card.getByTestId("job-cadence-in-force")).toContainText("cel mult o dată la 30 min");

    // `/devs` reads the same row.
    await page.goto("/ro/devs");
    await expect(page.locator("#main").getByText(/Interval minim: 30 min între două rulări reale/)).toBeVisible();

    await page.goto("/ro/admin/tasks?panel=costs");
    await main.getByTestId("job-cadence").getByLabel("Cel mult o dată la").selectOption("0");
    await main.getByTestId("job-cadence").getByRole("button", { name: "Salvează intervalul" }).click();
    await confirmDialog(page);
    await expect(main.getByTestId("job-cadence-in-force")).toContainText(/^Setarea în vigoare: la nevoie/);
  });
});
