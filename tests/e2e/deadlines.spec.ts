import { expect, test } from "@playwright/test";
import { signIn } from "./support/featured-event";
import { openFold } from "./support/fold";

/**
 * §NNN — "Termene" on `/admin/emails`: the club's deadlines, one box each, the Administrator's.
 *
 * One round trip that ends where it began: the defaults are read, one deadline is changed and read
 * back in the panel's line and in the reminder's when-line under it, then everything goes back to
 * the defaults, so every other spec on this database reads the numbers it always did. Desktop
 * only, like the Mailgun plan beside it: one `platform_settings` row, two projects, one database.
 */
test.describe("§NNN the club's deadlines on /admin/emails", () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name !== "desktop", "one shared platform_settings row");
  });

  const DEFAULTS = {
    confirmationHours: "48",
    holdMinutes: "30",
    offerHours: "24",
    reminderHours: "48",
    selfCheckinHours: "24",
    raceWeekDays: "7",
    seriesHorizonDays: "56",
  };

  test("an Administrator changes a deadline, the page says it, and puts it back", async ({ page }) => {
    await signIn(page, "Dev Administrator");
    await page.goto("/ro/admin/emails");
    const main = page.locator("#main");
    const panel = main.getByTestId("deadlines");

    // A closed fold, whose line already says the four a participant meets most.
    await expect(panel).not.toHaveAttribute("open");
    await expect(panel.locator(":scope > summary")).toContainText("Link 48 de ore · loc ținut 30 de minute · ofertă 24 de ore · reminder 2 zile");
    await openFold(panel);
    for (const [name, value] of Object.entries(DEFAULTS)) await expect(panel.locator(`input[name="${name}"]`)).toHaveValue(value);

    // Three days for the reminder.
    await panel.locator('input[name="reminderHours"]').fill("72");
    await panel.getByRole("button", { name: "Salvează termenele" }).click();
    await expect(main.getByText("Termenele au fost salvate", { exact: false })).toBeVisible();
    await expect(panel).toHaveAttribute("open", "");
    await expect(panel.locator(":scope > summary")).toContainText("reminder 3 zile");
    // The reminder's card under it says the new lead before it is opened.
    await expect(main.locator("#email-EVENT_REMINDER > summary")).toContainText("cu 3 zile înainte de start");

    // A number outside its bounds is refused, naming the box, and nothing is saved.
    await panel.locator('input[name="holdMinutes"]').fill("5");
    await panel.locator('input[name="holdMinutes"]').evaluate((input: HTMLInputElement) => input.removeAttribute("min"));
    await panel.getByRole("button", { name: "Salvează termenele" }).click();
    await expect(panel.getByTestId("form-refusal")).toContainText("Locul e ținut pentru semnarea declarației (minute)");
    // The box comes back as typed (§315); the saved line still says three days.
    await expect(panel.locator('input[name="holdMinutes"]')).toHaveValue("5");
    await expect(panel.locator(":scope > summary")).toContainText("loc ținut 30 de minute");

    // Back to the defaults, so the next spec on this database reads what it always did.
    await page.goto("/ro/admin/emails");
    await openFold(main.getByTestId("deadlines"));
    for (const [name, value] of Object.entries(DEFAULTS)) await main.getByTestId("deadlines").locator(`input[name="${name}"]`).fill(value);
    await main.getByTestId("deadlines").getByRole("button", { name: "Salvează termenele" }).click();
    await expect(main.getByText("Termenele au fost salvate", { exact: false })).toBeVisible();
    await expect(main.getByTestId("deadlines").locator(":scope > summary")).toContainText("reminder 2 zile");
  });

  test("an Organizer reads the numbers in force and is offered no form", async ({ page }) => {
    await signIn(page, "Dev Moderator");
    await page.goto("/ro/admin/emails");
    const panel = page.locator("#main").getByTestId("deadlines");
    await openFold(panel);
    await expect(panel.getByText("Termenele le schimbă Administratorul", { exact: false })).toBeVisible();
    await expect(panel.getByTestId("deadline-holdMinutes")).toHaveText("30");
    await expect(panel.getByRole("button", { name: "Salvează termenele" })).toHaveCount(0);
    await expect(panel.locator("input")).toHaveCount(0);
  });
});
